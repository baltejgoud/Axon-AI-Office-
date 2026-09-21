import type { ProviderConfig, ChatRequest, ChatUsage, ToolCall, StreamDelta } from '../shared/types';

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

export interface StreamChatResult extends ChatUsage {
  toolCalls?: ToolCall[];
}

/** Protocol adapters handle text streaming, thinking chunks, and tool calling. */
export async function streamChat(
  provider: ProviderConfig,
  key: string | null,
  request: ChatRequest,
  emit: (text: string, delta?: StreamDelta) => void
): Promise<StreamChatResult> {
  const base = endpoint(provider).href.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url: string, payload: Record<string, unknown>;

  if (provider.kind === 'anthropic') {
    url = `${base}/messages`;
    headers['x-api-key'] = key || '';
    headers['anthropic-version'] = '2023-06-01';
    payload = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      stream: true,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      messages: request.messages.map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.toolCallId || '', content: m.content }]
          };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          const blocks: unknown[] = [];
          if (m.content) blocks.push({ type: 'text', text: m.content });
          for (const tc of m.toolCalls) {
            let input = {};
            try { input = JSON.parse(tc.arguments); } catch { input = {}; }
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
          }
          return { role: 'assistant', content: blocks };
        }
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
      })
    };
    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }
  } else if (provider.kind === 'gemini') {
    url = `${base}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;
    headers['x-goog-api-key'] = key || '';
    payload = {
      systemInstruction: { parts: [{ text: request.system || 'You are a helpful assistant.' }] },
      contents: request.messages.map(m => {
        if (m.role === 'tool') {
          let responseData: unknown = { result: m.content };
          try { responseData = JSON.parse(m.content); } catch { responseData = { result: m.content }; }
          return {
            role: 'user',
            parts: [{ functionResponse: { name: m.name || 'tool', response: responseData } }]
          };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          const parts: unknown[] = [];
          if (m.content) parts.push({ text: m.content });
          for (const tc of m.toolCalls) {
            let args = {};
            try { args = JSON.parse(tc.arguments); } catch { args = {}; }
            parts.push({ functionCall: { name: tc.name, args } });
          }
          return { role: 'model', parts };
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
      }),
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {})
      }
    };
    if (request.tools && request.tools.length > 0) {
      payload.tools = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      }];
    }
  } else {
    url = `${base}/chat/completions`;
    if (key) headers.Authorization = `Bearer ${key}`;
    payload = {
      model: request.model,
      stream: true,
      max_completion_tokens: request.maxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      messages: [
        ...(request.system ? [{ role: 'system', content: request.system }] : []),
        ...request.messages.map(m => {
          if (m.role === 'tool') {
            return { role: 'tool', tool_call_id: m.toolCallId || '', content: m.content };
          }
          if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            return {
              role: 'assistant',
              content: m.content || null,
              tool_calls: m.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments }
              }))
            };
          }
          return { role: m.role, content: m.content };
        })
      ]
    };
    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }
    // Most third-party OpenAI-compatible APIs use max_tokens rather than max_completion_tokens.
    if (new URL(base).hostname !== 'api.openai.com') {
      payload.max_tokens = payload.max_completion_tokens;
      delete payload.max_completion_tokens;
    }
  }

  const body = JSON.stringify(payload);
  const response = await fetchWithRetry(url, headers, body, request.signal);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Provider returned HTTP ${response.status}. Check endpoint, model, key, and quota.`);
  }
  if (!response.body) throw new Error('Provider returned no response body.');

  let received = false;
  let usage: ChatUsage = {};
  const toolCalls: ToolCall[] = [];
  const openAiToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  const anthropicToolBlocks = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const raw of sse(response.body)) {
    if (raw === '[DONE]') break;
    const event = JSON.parse(raw);
    if (event.error || event.type === 'error') throw new Error('Provider reported a streaming error.');

    const readUsage = (prompt?: unknown, completion?: unknown): void => {
      if (typeof prompt === 'number' || typeof completion === 'number')
        usage = {
          promptTokens: typeof prompt === 'number' ? prompt : usage.promptTokens,
          completionTokens: typeof completion === 'number' ? completion : usage.completionTokens
        };
    };

    if (provider.kind === 'anthropic') {
      if (event.type === 'message_start') readUsage(event.message?.usage?.input_tokens);
      if (event.type === 'message_delta') readUsage(undefined, event.usage?.output_tokens);

      const directText = event.delta?.text;
      if (typeof directText === 'string' && directText) {
        received = true;
        emit(directText, { type: 'text', text: directText });
      }

      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block?.type === 'tool_use') {
          anthropicToolBlocks.set(event.index ?? 0, { id: block.id, name: block.name, arguments: '' });
        }
      } else if (event.type === 'content_block_delta' || event.delta) {
        if (event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
          received = true;
          emit('', { type: 'thought', text: event.delta.thinking });
        } else if (event.delta?.type === 'input_json_delta' && typeof event.delta.partial_json === 'string') {
          const block = anthropicToolBlocks.get(event.index ?? 0);
          if (block) block.arguments += event.delta.partial_json;
        }
      }
      if (event.type === 'content_block_stop') {
        const block = anthropicToolBlocks.get(event.index ?? 0);
        if (block) {
          received = true;
          const tc: ToolCall = {
            id: block.id,
            name: block.name,
            arguments: block.arguments || '{}'
          };
          toolCalls.push(tc);
          emit('', { type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments });
        }
      }
    } else if (provider.kind === 'gemini') {
      readUsage(event.usageMetadata?.promptTokenCount, event.usageMetadata?.candidatesTokenCount);
      const candidate = event.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (typeof part.text === 'string' && part.text) {
            received = true;
            if (part.thought) {
              emit('', { type: 'thought', text: part.text });
            } else {
              emit(part.text, { type: 'text', text: part.text });
            }
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
      }
    } else {
      if (event.usage) readUsage(event.usage.prompt_tokens, event.usage.completion_tokens);
      const choice = event.choices?.[0];
      const delta = choice?.delta;

      if (delta) {
        if (typeof delta.content === 'string' && delta.content) {
          received = true;
          emit(delta.content, { type: 'text', text: delta.content });
        }
        const thought = delta.reasoning_content || delta.thought;
        if (typeof thought === 'string' && thought) {
          received = true;
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

  // Finalize OpenAI tool calls
  for (const tc of openAiToolCalls.values()) {
    if (tc.name) {
      const toolCall: ToolCall = {
        id: tc.id || `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: tc.name,
        arguments: tc.arguments || '{}'
      };
      toolCalls.push(toolCall);
      emit('', { type: 'tool_call', id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments });
    }
  }

  if (!received) throw new Error('Provider returned no response. This model may require unsupported parameters or content types.');
  return { ...usage, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
}

/** Retries only pre-stream transport failures (429/5xx/network). Never replays a stream. */
async function fetchWithRetry(url: string, headers: Record<string, string>, body: string, signal?: AbortSignal, attempts = 3): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const signal2 = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(180_000)]);
      const response = await fetch(url, { method: 'POST', headers, body, signal: signal2, redirect: 'error' });
      if (response.ok || attempt >= attempts || ![429, 500, 502, 503, 504].includes(response.status)) return response;
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get('retry-after'));
      await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 500 * 2 ** (attempt - 1)));
      if (signal?.aborted) throw new Error('Generation stopped.');
    } catch (error) {
      if (signal?.aborted || attempt >= attempts || !(error instanceof TypeError)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
}

