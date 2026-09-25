import type { ProviderConfig, ChatRequest, ChatRequestMessage, ChatUsage, ToolCall, StreamDelta, ProviderReplay } from '../shared/types';

export function endpoint(provider: ProviderConfig): URL {
  const defaults = { 'openai-compatible': 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta' };
  const url = new URL(provider.baseUrl || defaults[provider.kind]);
  if (url.username || url.password || url.search || url.hash) throw new Error('Endpoint cannot contain credentials, a query, or a fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or HTTP on localhost only.');
  return url;
}

/** Incremental SSE decoder; supports CRLF, split UTF-8, comments and multiline data. */
export async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 2_000_000) throw new Error('Provider event exceeds size limit.');
      if (done) buffer += '\n\n';
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (!line) { if (data.length) { yield data.join('\n'); data = []; } }
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** How long to wait for response headers, and for the next event once streaming. Tests shorten these. */
export const timeouts = { headersMs: 180_000, idleMs: 300_000 };
/** Anthropic requires max_tokens; used when the caller sets none. */
const DEFAULT_MAX_TOKENS = 4096;
const ATTEMPTS = 3;
/** Worth retrying before any output: timeouts, rate limits, overload and gateway errors. */
const RETRY_STATUSES = [408, 429, 500, 502, 503, 504, 529];
/** Optional fields some models refuse. A 400 that names one is retried once without it. */
const OPTIONAL_FIELDS = ['temperature', 'stream_options', 'cache_control'];
/** Fields each endpoint and model refused, so later requests leave them out from the start. */
const refused = new Map<string, Set<string>>();

export interface StreamChatResult extends ChatUsage {
  toolCalls?: ToolCall[];
  /** The assistant turn as the provider sent it, for the run's next tool round. */
  replay?: ProviderReplay;
  /** The answer stopped at the max-token limit. */
  truncated?: boolean;
}

/** A provider's HTTP failure, with the provider's own explanation when it gave one. */
export class ProviderError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`Provider returned HTTP ${status}${detail ? `: ${detail}` : '.'} ${hint(status)}`);
  }
}

function hint(status: number): string {
  if (status === 401 || status === 403) return 'Check the API key.';
  if (status === 404) return 'Check the endpoint URL and model ID.';
  if (status === 429) return 'Rate limited or out of quota; try again later.';
  if (status >= 500) return 'The provider is having trouble; try again.';
  return 'Check endpoint, model, key, and quota.';
}

/** A provider message made safe to show: one line, bounded, and never the key. */
function clean(message: string, key: string | null): string {
  const text = key && key.length >= 4 ? message.split(key).join('[key]') : message;
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** The explanation inside an error body: `{error: {message}}`, `{message}`, or Gemini's array form. Raw text is never shown. */
function errorDetail(body: string): string {
  try {
    let parsed = JSON.parse(body);
    if (Array.isArray(parsed)) parsed = parsed[0];
    const error = parsed?.error ?? parsed;
    if (typeof error === 'string') return error;
    if (typeof error?.message === 'string') return error.message;
  } catch { /* Not JSON. */ }
  return '';
}

async function providerError(response: Response, key: string | null): Promise<ProviderError> {
  return new ProviderError(response.status, clean(errorDetail(await readCapped(response, 16_000)), key));
}

/** Reads at most `limit` characters of a body, then lets the rest go. */
async function readCapped(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch { /* A broken error body leaves only the status. */ }
  finally { await reader.cancel().catch(() => undefined); }
  return text.slice(0, limit);
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

/** Anthropic messages. One round's tool results share a user message, as parallel calls expect. */
function anthropicMessages(messages: ChatRequestMessage[]): { role: string; content: unknown }[] {
  const out: { role: string; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId || '', content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b: { type?: string }) => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.replay?.kind === 'anthropic') {
      out.push({ role: 'assistant', content: m.replay.content });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({ role: 'assistant', content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...m.toolCalls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.name, input: parseArgs(tc.arguments) }))
      ] });
    } else {
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }
  }
  return out;
}

/** Gemini contents. A function's answer carries the function's name; one round's answers share a turn. */
function geminiContents(messages: ChatRequestMessage[]): { role: string; parts: unknown[] }[] {
  const names = new Map<string, string>();
  for (const m of messages) for (const tc of m.toolCalls ?? []) names.set(tc.id, tc.name);
  const out: { role: string; parts: unknown[] }[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const parsed = parseArgs(m.content);
      const response = Object.keys(parsed).length ? parsed : { result: m.content };
      const part = { functionResponse: { name: names.get(m.toolCallId ?? '') ?? m.name ?? 'tool', response } };
      const last = out[out.length - 1];
      if (last?.role === 'user' && last.parts.every(p => (p as { functionResponse?: unknown }).functionResponse)) last.parts.push(part);
      else out.push({ role: 'user', parts: [part] });
    } else if (m.role === 'assistant' && m.replay?.kind === 'gemini') {
      out.push({ role: 'model', parts: m.replay.content });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({ role: 'model', parts: [
        ...(m.content ? [{ text: m.content }] : []),
        ...m.toolCalls.map(tc => ({ functionCall: { name: tc.name, args: parseArgs(tc.arguments) } }))
      ] });
    } else {
      out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
  }
  return out;
}

function openAiMessages(request: ChatRequest): unknown[] {
  return [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    ...request.messages.map(m => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId || '', content: m.content };
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const reasoning = m.replay?.kind === 'openai-compatible' ? (m.replay.content[0] as { reasoning_content?: string })?.reasoning_content : undefined;
        return {
          role: 'assistant',
          content: m.content || null,
          // Reasoning models (DeepSeek, Kimi) expect their reasoning back while a tool round is open.
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
        };
      }
      return { role: m.role, content: m.content };
    })
  ];
}

function buildRequest(provider: ProviderConfig, key: string | null, request: ChatRequest): { url: string; headers: Record<string, string>; payload: Record<string, unknown> } {
  const base = endpoint(provider).href.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const temperature = request.temperature !== undefined ? { temperature: request.temperature } : {};
  const tools = request.tools?.length ? request.tools : undefined;

  if (provider.kind === 'anthropic') {
    headers['x-api-key'] = key || '';
    headers['anthropic-version'] = '2023-06-01';
    return { url: `${base}/messages`, headers, payload: {
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(request.system ? { system: request.system } : {}),
      stream: true,
      // Caches the prompt up to the last block, so each tool round re-reads the system prompt and history cheaply.
      cache_control: { type: 'ephemeral' },
      ...temperature,
      messages: anthropicMessages(request.messages),
      ...(tools ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {})
    } };
  }
  if (provider.kind === 'gemini') {
    headers['x-goog-api-key'] = key || '';
    return { url: `${base}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`, headers, payload: {
      systemInstruction: { parts: [{ text: request.system || 'You are a helpful assistant.' }] },
      contents: geminiContents(request.messages),
      generationConfig: { maxOutputTokens: request.maxTokens, ...temperature },
      ...(tools ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }] } : {})
    } };
  }
  if (key) headers.Authorization = `Bearer ${key}`;
  // OpenAI itself wants max_completion_tokens; most compatible servers still read max_tokens.
  const limit = new URL(base).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens';
  return { url: `${base}/chat/completions`, headers, payload: {
    model: request.model,
    stream: true,
    stream_options: { include_usage: true },
    [limit]: request.maxTokens,
    ...temperature,
    messages: openAiMessages(request),
    ...(tools ? { tools: tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {})
  } };
}

/** Streams one assistant turn: text, thinking, tool calls and usage, through each protocol's adapter. */
export async function streamChat(
  provider: ProviderConfig,
  key: string | null,
  request: ChatRequest,
  emit: (text: string, delta?: StreamDelta) => void
): Promise<StreamChatResult> {
  const { url, headers, payload } = buildRequest(provider, key, request);
  const refusedKey = `${url}|${request.model}`;
  for (const field of refused.get(refusedKey) ?? []) delete payload[field];
  // Aborted when the stream goes quiet for too long.
  const watchdog = new AbortController();
  const signal = request.signal ? AbortSignal.any([request.signal, watchdog.signal]) : watchdog.signal;

  let response = await post(url, headers, payload, signal, request.signal);
  if (response.status === 400) {
    const error = await providerError(response, key);
    const field = OPTIONAL_FIELDS.find(name => name in payload && error.detail.toLowerCase().includes(name));
    if (!field) throw error;
    delete payload[field];
    refused.set(refusedKey, new Set([...(refused.get(refusedKey) ?? []), field]));
    response = await post(url, headers, payload, signal, request.signal);
  }
  if (!response.ok) throw await providerError(response, key);
  if (!response.body) throw new Error('Provider returned no response body.');

  let received = false, truncated = false, refusedAnswer = false;
  let usage: ChatUsage = {};
  const toolCalls: ToolCall[] = [];
  const openAiToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let openAiReasoning = '';
  /** Anthropic content blocks by index, kept whole for replay. */
  const blocks = new Map<number, Record<string, unknown>>();
  const toolJson = new Map<number, string>();
  /** Gemini parts in order, kept whole for replay. */
  const parts: Record<string, unknown>[] = [];

  const readUsage = (prompt?: unknown, completion?: unknown): void => {
    if (typeof prompt === 'number' || typeof completion === 'number')
      usage = {
        promptTokens: typeof prompt === 'number' ? prompt : usage.promptTokens,
        completionTokens: typeof completion === 'number' ? completion : usage.completionTokens
      };
  };
  const text = (value: string, index?: number): void => {
    received = true;
    emit(value, { type: 'text', text: value });
    if (provider.kind !== 'anthropic') return;
    const block = blocks.get(index ?? 0);
    if (block?.type === 'text') block.text += value;
    else if (!block) blocks.set(index ?? 0, { type: 'text', text: value });
  };

  let idle: ReturnType<typeof setTimeout> | undefined;
  const kick = (): void => { clearTimeout(idle); idle = setTimeout(() => watchdog.abort(), timeouts.idleMs); };
  kick();
  try {
    for await (const raw of sse(response.body)) {
      kick();
      if (raw === '[DONE]') break;
      const event = JSON.parse(raw);
      if (event.error || event.type === 'error') {
        const detail = clean(typeof event.error === 'string' ? event.error : String(event.error?.message ?? ''), key);
        throw new Error(detail ? `The provider reported an error: ${detail}` : 'The provider reported a streaming error.');
      }

      if (provider.kind === 'anthropic') {
        if (event.type === 'message_start') readUsage(event.message?.usage?.input_tokens);
        if (event.type === 'message_delta') {
          readUsage(undefined, event.usage?.output_tokens);
          if (event.delta?.stop_reason === 'max_tokens') truncated = true;
          if (event.delta?.stop_reason === 'refusal') refusedAnswer = true;
        }
        const index = event.index ?? 0;
        if (event.type === 'content_block_start') {
          const block = event.content_block ?? {};
          if (block.type === 'tool_use') { blocks.set(index, { type: 'tool_use', id: block.id, name: block.name, input: {} }); toolJson.set(index, ''); }
          else if (block.type === 'thinking') blocks.set(index, { type: 'thinking', thinking: block.thinking ?? '', signature: block.signature ?? '' });
          else if (block.type === 'text') blocks.set(index, { type: 'text', text: block.text ?? '' });
          else blocks.set(index, { ...block });
        } else if (event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
          received = true;
          const block = blocks.get(index);
          if (block?.type === 'thinking') block.thinking += event.delta.thinking;
          emit('', { type: 'thought', text: event.delta.thinking });
        } else if (event.delta?.type === 'signature_delta' && typeof event.delta.signature === 'string') {
          const block = blocks.get(index);
          if (block?.type === 'thinking') block.signature = event.delta.signature;
        } else if (event.delta?.type === 'input_json_delta' && typeof event.delta.partial_json === 'string') {
          if (toolJson.has(index)) toolJson.set(index, toolJson.get(index) + event.delta.partial_json);
        } else if (typeof event.delta?.text === 'string' && event.delta.text) {
          text(event.delta.text, index);
        }
        if (event.type === 'content_block_stop' && toolJson.has(index)) {
          const block = blocks.get(index)!;
          const args = toolJson.get(index) || '{}';
          block.input = parseArgs(args);
          toolJson.delete(index);
          received = true;
          const tc: ToolCall = { id: String(block.id), name: String(block.name), arguments: args };
          toolCalls.push(tc);
          emit('', { type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments });
        }
      } else if (provider.kind === 'gemini') {
        readUsage(event.usageMetadata?.promptTokenCount, event.usageMetadata?.candidatesTokenCount);
        const candidate = event.candidates?.[0];
        if (candidate?.finishReason === 'MAX_TOKENS') truncated = true;
        if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(candidate?.finishReason)) refusedAnswer = true;
        for (const part of candidate?.content?.parts ?? []) {
          const last = parts[parts.length - 1];
          // Streamed text arrives in pieces; pieces join unless a signature marks a boundary.
          if (typeof part.text === 'string' && !part.thoughtSignature && last && typeof last.text === 'string' && !last.thoughtSignature && !last.thought === !part.thought) last.text += part.text;
          else parts.push({ ...part });
          if (typeof part.text === 'string' && part.text) {
            received = true;
            if (part.thought) emit('', { type: 'thought', text: part.text });
            else emit(part.text, { type: 'text', text: part.text });
          }
          if (part.functionCall) {
            received = true;
            const tc: ToolCall = {
              id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {})
            };
            toolCalls.push(tc);
            emit('', { type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments });
          }
        }
      } else {
        if (event.usage) readUsage(event.usage.prompt_tokens, event.usage.completion_tokens);
        const choice = event.choices?.[0];
        if (choice?.finish_reason === 'length') truncated = true;
        if (choice?.finish_reason === 'content_filter') refusedAnswer = true;
        const delta = choice?.delta;
        if (delta) {
          if (typeof delta.content === 'string' && delta.content) text(delta.content);
          const thought = delta.reasoning_content || delta.thought;
          if (typeof thought === 'string' && thought) {
            received = true;
            if (delta.reasoning_content) openAiReasoning += thought;
            emit('', { type: 'thought', text: thought });
          }
          if (Array.isArray(delta.tool_calls)) {
            received = true;
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = openAiToolCalls.get(idx) || { id: tc.id || '', name: '', arguments: '' };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
              openAiToolCalls.set(idx, existing);
            }
          }
        }
      }
    }
  } catch (error) {
    if (watchdog.signal.aborted && !request.signal?.aborted) throw new Error('The provider stopped responding partway through the answer. Try again.');
    throw error;
  } finally {
    clearTimeout(idle);
  }

  for (const tc of openAiToolCalls.values()) {
    if (!tc.name) continue;
    const toolCall: ToolCall = { id: tc.id || `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: tc.name, arguments: tc.arguments || '{}' };
    toolCalls.push(toolCall);
    emit('', { type: 'tool_call', id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments });
  }

  if (!received) {
    if (refusedAnswer) throw new Error('The model declined this request.');
    throw new Error('Provider returned no response. This model may require unsupported parameters or content types.');
  }
  return {
    ...usage,
    ...(toolCalls.length ? { toolCalls, replay: replayOf(provider, blocks, parts, openAiReasoning) } : {}),
    ...(truncated ? { truncated } : {})
  };
}

/** What a tool round must send back unchanged: Anthropic blocks with signatures, Gemini parts, OpenAI-style reasoning. */
function replayOf(provider: ProviderConfig, blocks: Map<number, Record<string, unknown>>, parts: Record<string, unknown>[], reasoning: string): ProviderReplay | undefined {
  if (provider.kind === 'anthropic') {
    const content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block)
      // Empty text is invalid, and a thinking block is only valid with its signature.
      .filter(block => !(block.type === 'text' && !block.text) && !(block.type === 'thinking' && !block.signature));
    return { kind: 'anthropic', content };
  }
  if (provider.kind === 'gemini') return { kind: 'gemini', content: parts };
  return reasoning ? { kind: 'openai-compatible', content: [{ reasoning_content: reasoning }] } : undefined;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('Generation stopped.'));
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = (): void => { clearTimeout(timer); reject(new Error('Generation stopped.')); };
  signal?.addEventListener('abort', stop, { once: true });
});

/**
 * Sends the request, retrying only failures before any output (429/5xx/529/network). Never replays
 * a stream. The headers timeout covers waiting for the provider to answer, not the answer itself.
 */
async function post(url: string, headers: Record<string, string>, payload: Record<string, unknown>, signal: AbortSignal, userSignal?: AbortSignal): Promise<Response> {
  const body = JSON.stringify(payload);
  for (let attempt = 1; ; attempt++) {
    const waiting = new AbortController();
    const timer = setTimeout(() => waiting.abort(), timeouts.headersMs);
    try {
      const response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.any([signal, waiting.signal]), redirect: 'error' });
      if (response.ok || attempt >= ATTEMPTS || !RETRY_STATUSES.includes(response.status)) return response;
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 500 * 2 ** (attempt - 1), userSignal);
    } catch (error) {
      if (userSignal?.aborted) throw error;
      if (waiting.signal.aborted) throw new Error(`The provider did not answer within ${Math.round(timeouts.headersMs / 1000)} seconds.`);
      if (attempt >= ATTEMPTS || !(error instanceof TypeError)) throw error;
      await sleep(500 * 2 ** (attempt - 1), userSignal);
    } finally {
      clearTimeout(timer);
    }
  }
}
