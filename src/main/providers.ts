import type { ProviderConfig, ChatRequest, ChatRequestMessage, ChatUsage, ToolCall, StreamDelta, ProviderReplay, ModelSpec, ClaudeRateLimits } from '../shared/types';
import { catalogModelLimits, publishedOpenAILimits } from './model-limits';
import { CLAUDE_PROVIDER_ID, rateLimitsOf } from './accounts/claude';

export function endpoint(provider: ProviderConfig): URL {
  const defaults = { 'openai-compatible': 'https://api.openai.com/v1', 'openai-responses': 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta' };
  const url = new URL(provider.baseUrl || defaults[provider.kind]);
  if (url.username || url.password || url.search || url.hash) throw new Error('Endpoint cannot contain credentials, a query, or a fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or HTTP on localhost only.');
  // A pasted request URL (".../v1/chat/completions") still names the service: keep the base it sits under.
  const request = provider.kind === 'anthropic' ? /\/messages\/?$/ : provider.kind === 'openai-compatible' ? /\/chat\/completions\/?$/ : provider.kind === 'openai-responses' ? /\/responses\/?$/ : null;
  if (request) url.pathname = url.pathname.replace(request, '');
  if (provider.auth === 'chatgpt' && (provider.kind !== 'openai-responses' || url.href.replace(/\/$/, '') !== 'https://api.openai.com/v1'))
    throw new Error('ChatGPT account credentials can only be used with the official OpenAI Responses endpoint.');
  return url;
}

/**
 * A pasted API key as the provider expects it: without surrounding spaces, line breaks or quotes,
 * without a "Bearer " prefix copied from a curl example, and without the invisible characters web
 * pages carry. A key with anything else unusual in it is refused here, with a clear reason, instead
 * of failing at the provider.
 */
export function cleanApiKey(raw: string): string {
  let key = raw.replace(/[​-‍⁠﻿]/g, '').trim();
  key = key.replace(/^["'`“‘]([\s\S]*)["'`”’]$/, '$1').trim();
  key = key.replace(/^bearer\s+/i, '');
  if (/\s/.test(key)) throw new Error('The API key has a space or line break inside it. Copy the key again and paste it on its own.');
  if (/[^\x21-\x7e]/.test(key)) throw new Error('The API key has characters no key contains. Copy the key again from your provider\'s console.');
  return key;
}

/**
 * One service's addresses in other regions. A key belongs to the region its console is in (a
 * platform.moonshot.cn key fails at api.moonshot.ai; an Alibaba Singapore key fails in Beijing), so
 * set-up tries these in turn. Only the same company's own addresses are ever listed here.
 */
const SERVICE_REGIONS: readonly (readonly string[])[] = [
  ['api.moonshot.ai', 'api.moonshot.cn'],
  ['dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com', 'dashscope.aliyuncs.com', 'cn-hongkong.dashscope.aliyuncs.com']
];

/** The same endpoint at the service's other regions, in order; empty for single-region services. */
export function otherRegions(baseUrl: string): string[] {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return []; }
  const group = SERVICE_REGIONS.find(hosts => hosts.includes(url.hostname));
  if (!group) return [];
  return group.filter(host => host !== url.hostname).map(host => {
    const other = new URL(url.href);
    other.hostname = host;
    return other.href.replace(/\/$/, '');
  });
}

/** Models that think before they answer, their thinking counted in the output limit. */
const THINKS = [/kimi-k(2\.[5-9]|[3-9])/i, /thinking/i, /reasoner/i, /deepseek-r1/i, /(^|\/)qwq/i, /(^|\/)o[1-9](-|$)/i, /(^|\/)gpt-5/i, /(^|\/)gpt-oss/i];
/** Room for a thinking model to think and still answer: Kimi asks for 16,000 or more. */
export const THINKING_MIN_TOKENS = 16384;

/** The output limit to send: the setting, raised for a model that thinks first. */
export function outputLimit(model: string, configured: number): number {
  return THINKS.some(pattern => pattern.test(model)) ? Math.max(configured, THINKING_MIN_TOKENS) : configured;
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
/** Waits for other in-flight requests to settle before a credit check is allowed to fail: about two minutes. */
const CROWDED_ATTEMPTS = 8;
/** Worth retrying before any output: timeouts, rate limits, overload and gateway errors. */
const RETRY_STATUSES = [408, 429, 500, 502, 503, 504, 529];
/** Optional fields some models refuse. A 400 that names one is retried without it. */
const OPTIONAL_FIELDS = ['temperature', 'stream_options', 'cache_control', 'reasoning'];
/**
 * The two names OpenAI-compatible servers use for the output limit. Kimi and Qwen now prefer the
 * newer one; older and self-hosted servers only know the first. A 400 that names the one sent is
 * retried once with the other.
 */
const LIMIT_NAMES = ['max_tokens', 'max_completion_tokens'] as const;
/** Fields each endpoint and model refused, so later requests leave them out (or rename them) from the start. */
const refused = new Map<string, Set<string>>();

/**
 * Leaves out each field this endpoint and model refused; the output limit moves to its other name,
 * unless that one was refused too.
 */
function withoutRefused(payload: Record<string, unknown>, fields: ReadonlySet<string>): void {
  for (const field of fields) {
    if (!(field in payload)) continue;
    const limit = LIMIT_NAMES.indexOf(field as (typeof LIMIT_NAMES)[number]);
    const other = LIMIT_NAMES[1 - limit];
    if (limit >= 0 && !fields.has(other)) payload[other] = payload[field];
    delete payload[field];
  }
}

export interface StreamChatResult extends ChatUsage {
  toolCalls?: ToolCall[];
  /** The assistant turn as the provider sent it, for the run's next tool round. */
  replay?: ProviderReplay;
  /** The answer stopped at the max-token limit. */
  truncated?: boolean;
}

/** A provider's HTTP failure, with the provider's own explanation when it gave one. */
export class ProviderError extends Error {
  constructor(readonly status: number, readonly detail: string, advice = hint(status), readonly requestId?: string) {
    super(`Provider returned HTTP ${status}${detail ? `: ${/[.!?]$/.test(detail) ? detail : `${detail}.`}` : '.'} ${advice}${requestId ? ` (Request ID ${requestId})` : ''}`);
  }
}

/**
 * What to do about a failure at Anthropic's own API, where usage is billed to the key's Claude Console
 * organization: credits, spend limits and tier caps are Console settings, never Claude plan limits.
 */
function anthropicAdvice(provider: ProviderConfig, status: number, detail: string, code: string): string {
  const keys = provider.id === CLAUDE_PROVIDER_ID ? 'Settings → Accounts → Claude' : 'Settings → Models & API keys';
  if (/credit balance is too low/i.test(detail))
    return 'Add credits in Claude Console → Settings → Billing. Monthly API credits from a linked Max or Team plan appear there too; Claude plan usage limits do not apply to API keys.';
  if (/reached your specified (workspace )?API usage limits/i.test(detail))
    return 'A spend limit set in Claude Console stopped this request. Raise it under Settings → Billing (or the workspace\'s limits), or wait until it resets.';
  if (code === 'enforced_spend_limit_reached')
    return 'The organization reached its usage tier\'s monthly spend cap. Access resumes next month, or request a higher tier in Claude Console → Rate limits.';
  if (status === 401) return `Anthropic did not accept the API key; it may be mistyped, disabled, deleted or expired. Replace it in ${keys}.`;
  if (status === 403) return 'The key\'s organization or workspace is not allowed to do this. Check its access in Claude Console.';
  if (status === 404) return `Check the model ID: Anthropic answers 404 for a model that does not exist or is not available to the key's organization. Refresh the models in ${keys}.`;
  if (status === 413) return 'The request is larger than the API accepts. Remove large attachments or start a new conversation.';
  if (status === 429) return 'Rate limited by the organization\'s usage tier. Try again shortly; Claude Console → Rate limits shows the limits.';
  if (status === 529) return 'Anthropic is temporarily overloaded; try again.';
  return hint(status);
}

function hint(status: number): string {
  if (status === 401 || status === 403) return 'Check the API key.';
  if (status === 404) return 'Check the endpoint URL and model ID.';
  if (status === 402) return 'Add credits, or lower the output limit in Settings so fewer credits are held per request.';
  if (status === 429) return 'Rate limited or out of quota; try again later.';
  if (status >= 500) return 'The provider is having trouble; try again.';
  return 'Check endpoint, model, key, and quota.';
}

/** A provider message made safe to show: one line, bounded, and never the key. */
function clean(message: string, key: string | null): string {
  const text = key && key.length >= 4 ? message.split(key).join('[key]') : message;
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * The explanation inside an error body: `{error: {message}}`, `{message}`, Gemini's array form, or a
 * FastAPI-style `{detail}` (a string, or a list of `{loc, msg}`), nested or not. Raw text is never shown.
 */
function errorDetail(body: string): string {
  try {
    let parsed = JSON.parse(body);
    if (Array.isArray(parsed)) parsed = parsed[0];
    return describe(parsed?.error ?? parsed?.message ?? parsed?.detail ?? parsed);
  } catch { /* Not JSON. */ }
  return '';
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(describe).filter(Boolean).join('; ');
  if (!value || typeof value !== 'object') return '';
  const error = value as { message?: unknown; detail?: unknown; msg?: unknown; loc?: unknown };
  if (error.message !== undefined) return describe(error.message);
  if (error.detail !== undefined) return describe(error.detail);
  if (typeof error.msg === 'string') return Array.isArray(error.loc) ? `${error.loc.join('.')}: ${error.msg}` : error.msg;
  return '';
}

export async function providerError(response: Response, key: string | null, provider?: ProviderConfig): Promise<ProviderError> {
  const body = await readCapped(response, 16_000);
  const detail = clean(errorDetail(body), key);
  if (!provider || provider.kind !== 'anthropic' || endpoint(provider).hostname !== 'api.anthropic.com')
    return new ProviderError(response.status, detail);
  let code = '';
  try { code = String(JSON.parse(body)?.error?.details?.error_code ?? ''); } catch { /* Not JSON. */ }
  const requestId = response.headers.get('request-id') ?? '';
  return new ProviderError(response.status, detail, anthropicAdvice(provider, response.status, detail, code), /^[\w-]{1,100}$/.test(requestId) ? requestId : undefined);
}

/** The organization's limits as each provider's last Claude request reported them. */
const claudeLimits = new Map<string, ClaudeRateLimits>();
export function lastRateLimits(providerId: string): ClaudeRateLimits | null {
  return claudeLimits.get(providerId) ?? null;
}
export function forgetRateLimits(providerId: string): void {
  claudeLimits.delete(providerId);
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
      const last = out[out.length - 1];
      // A message you sent mid-run follows the step's results: it joins their turn, after them.
      if (m.role === 'user' && last?.role === 'user' && Array.isArray(last.content)) last.content.push({ type: 'text', text: m.content });
      else out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
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
      const last = out[out.length - 1];
      // A message you sent mid-run follows the step's answers: it joins their turn, after them.
      if (m.role === 'user' && last?.role === 'user') last.parts.push({ text: m.content });
      else out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
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

/** Stateless Responses history, including exact reasoning items while a tool round is open. */
export function responsesInput(messages: ChatRequestMessage[]): unknown[] {
  return messages.flatMap((m): unknown[] => {
    if (m.role === 'tool') return [{ type: 'function_call_output', call_id: m.toolCallId, output: m.content }];
    if (m.role === 'assistant' && m.replay?.kind === 'openai-responses') return m.replay.content;
    const content: unknown[] = m.content ? [{ role: m.role === 'system' ? 'developer' : m.role, content: m.content }] : [];
    if (m.role === 'assistant') content.push(...(m.toolCalls ?? []).map((tc) => ({ type: 'function_call', call_id: tc.id, name: tc.name, arguments: tc.arguments })));
    return content;
  });
}

function buildRequest(provider: ProviderConfig, key: string | null, request: ChatRequest): { url: string; headers: Record<string, string>; payload: Record<string, unknown> } {
  const base = endpoint(provider).href.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const temperature = request.temperature !== undefined ? { temperature: request.temperature } : {};
  const tools = request.tools?.length ? request.tools : undefined;

  if (provider.kind === 'openai-responses') {
    if (key) headers.Authorization = `Bearer ${key}`;
    const functions = tools?.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
    return { url: `${base}/responses`, headers, payload: {
      model: request.model, input: responsesInput(request.messages),
      ...(request.system ? { instructions: request.system } : {}),
      stream: true, store: false, include: ['reasoning.encrypted_content'],
      // ChatGPT plan usage currently rejects token limits and sampling parameters.
      ...(!provider.auth ? { max_output_tokens: request.maxTokens, ...temperature } : {}),
      ...(functions ? { tools: provider.auth ? [{ type: 'namespace', name: 'axon', description: 'Tools Axon executes locally for the user.', tools: functions }] : functions } : {})
    } };
  }

  if (provider.kind === 'anthropic') {
    headers['x-api-key'] = key || '';
    headers['anthropic-version'] = '2023-06-01';
    // A Claude Console key that spans several workspaces names the one each request runs in.
    if (provider.workspaceId) headers['anthropic-workspace-id'] = provider.workspaceId;
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
  const host = new URL(base).hostname;
  const limit = host === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens';
  // Quick replies: OpenRouter turns a model's thinking off (Nemotron answers in 2 s instead of 20).
  // A model that must think refuses the field once, and it stays out for that model (see open).
  const quick = request.quick && /(^|\.)openrouter\.ai$/.test(host) ? { reasoning: { enabled: false } } : {};
  return { url: `${base}/chat/completions`, headers, payload: {
    model: request.model,
    stream: true,
    stream_options: { include_usage: true },
    [limit]: request.maxTokens,
    ...quick,
    ...temperature,
    messages: openAiMessages(request),
    ...(tools ? { tools: tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {})
  } };
}

/**
 * Sends a chat request and returns the stream once the provider accepts it. A 400 that names an
 * optional field is sent again without it (or, for the output limit, under its other name), and that
 * field stays out for this endpoint and model.
 */
async function open(provider: ProviderConfig, key: string | null, request: ChatRequest, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const { url, headers, payload } = buildRequest(provider, key, request);
  const refusedKey = `${url}|${request.model}`;
  withoutRefused(payload, refused.get(refusedKey) ?? new Set());
  let response = await post(url, headers, payload, signal, request.signal);
  // One field at a time: a server may refuse two (a fixed temperature and the older limit name).
  for (let fallback = 0; response.status === 400 && fallback < 3; fallback++) {
    const error = await providerError(response, key, provider);
    const detail = error.detail.toLowerCase();
    const renamable = provider.kind === 'openai-compatible' ? LIMIT_NAMES : [];
    const field = [...OPTIONAL_FIELDS, ...renamable].find(name => name in payload && detail.includes(name));
    if (!field) throw error;
    const fields = new Set([...(refused.get(refusedKey) ?? []), field]);
    refused.set(refusedKey, fields);
    withoutRefused(payload, fields);
    response = await post(url, headers, payload, signal, request.signal);
  }
  if (!response.ok) throw await providerError(response, key, provider);
  if (provider.kind === 'anthropic') {
    const limits = rateLimitsOf(response.headers, request.model);
    if (limits) claudeLimits.set(provider.id, limits);
  }
  if (!response.body) throw new Error('Provider returned no response body.');
  return response.body;
}

/** A streamed error event becomes an error carrying the provider's message. */
function throwIfError(event: { error?: unknown; type?: string }, key: string | null): void {
  if (!event.error && event.type !== 'error') return;
  const error = event.error as { message?: unknown } | string | undefined;
  const detail = clean(typeof error === 'string' ? error : String(error?.message ?? ''), key);
  throw new Error(detail ? `The provider reported an error: ${detail}` : 'The provider reported a streaming error.');
}

/**
 * Settings' Test connection for one model: a tiny request through the same path as chat. It passes
 * once the provider starts answering with a model stream, and the rest of the answer is dropped.
 */
export async function checkModel(provider: ProviderConfig, key: string | null, model: string, signal?: AbortSignal): Promise<void> {
  const request: ChatRequest = { model, messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 16, signal };
  const body = await open(provider, key, request, signal ?? new AbortController().signal);
  for await (const raw of sse(body)) {
    if (raw === '[DONE]') break;
    let event: { error?: unknown; type?: string };
    try { event = JSON.parse(raw); } catch { break; }
    throwIfError(event, key);
    return; // Leaving the loop cancels the stream.
  }
  throw new Error('The endpoint answered, but not with a model stream. Check the base URL.');
}

/**
 * The models an endpoint offers this key, for picking IDs in Settings: sorted, without repeats.
 * OpenAI-compatible `/models` (Kimi, Qwen, OpenRouter, DeepSeek, Ollama...), Anthropic's and Gemini's own lists.
 */
const discoveredLimits = new Map<string, Partial<ModelSpec>>();
const metadataKey = (provider: ProviderConfig, id: string) => `${provider.kind}:${endpoint(provider).href}:${id}`;
export function contextModel(provider: ProviderConfig, id: string): ModelSpec | undefined {
  const manual = provider.models.find(model => model.id === id);
  const metadata = discoveredLimits.get(metadataKey(provider, id));
  if (!manual && !metadata) return undefined;
  const published = endpoint(provider).hostname === 'api.openai.com' ? publishedOpenAILimits(id) : {};
  return { id, displayName: id, ...published, ...metadata, ...manual,
    ...(metadata?.contextWindow ? { contextWindow: Math.min(manual?.contextWindow ?? metadata.contextWindow, metadata.contextWindow) } : {}),
    ...(metadata?.maxOutputTokens ? { maxOutputTokens: Math.min(manual?.maxOutputTokens ?? metadata.maxOutputTokens, metadata.maxOutputTokens) } : {}) };
}
/** Accept numeric limit fields returned by the endpoint, never model-name guesses. */
export function ingestModelLimits(provider: ProviderConfig, body: unknown): void {
  const list = Array.isArray(body) ? body : (body as any)?.data ?? (body as any)?.models;
  if (!Array.isArray(list)) return;
  for (const item of list) {
    const id = typeof item?.id === 'string' ? item.id : typeof item?.slug === 'string' ? item.slug : typeof item?.name === 'string' ? item.name.replace(/^models\//, '') : null;
    if (!id) continue;
    // Anthropic's model list names its limits max_input_tokens and max_tokens.
    const { contextWindow, maxOutputTokens } = catalogModelLimits(provider.kind === 'anthropic'
      ? { context_window: item.max_input_tokens, max_output_tokens: item.max_tokens } : item);
    if (contextWindow || maxOutputTokens) discoveredLimits.set(metadataKey(provider, id), {
      ...(contextWindow ? { contextWindow } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}) });
  }
}

export async function listModels(provider: ProviderConfig, key: string | null, signal?: AbortSignal): Promise<string[]> {
  const base = endpoint(provider).href.replace(/\/$/, '');
  const headers: Record<string, string> = {};
  let url = `${base}/models`;
  if (provider.kind === 'anthropic') {
    headers['x-api-key'] = key || '';
    headers['anthropic-version'] = '2023-06-01';
    if (provider.workspaceId) headers['anthropic-workspace-id'] = provider.workspaceId;
    url += '?limit=1000';
  } else if (provider.kind === 'gemini') {
    headers['x-goog-api-key'] = key || '';
    url += '?pageSize=1000';
  } else if (key) headers.Authorization = `Bearer ${key}`;
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers, signal, redirect: 'error' });
  } catch (error) {
    if (error instanceof TypeError && !signal?.aborted) throw unreachable(url);
    throw error;
  }
  if (!response.ok) throw await providerError(response, key, provider);
  let body: { data?: unknown; models?: unknown } | unknown[] | null = null;
  try { body = JSON.parse(await readCapped(response, 8_000_000)); } catch { /* Not a list. */ }
  const ids = modelIdsOf(provider, body);
  ingestModelLimits(provider, body);
  if (!ids) throw new Error('The endpoint did not return a model list. Type the model IDs from your provider\'s documentation.');
  return provider.auth === 'chatgpt' ? [...new Set(ids)] : [...new Set(ids)].sort();
}

function modelIdsOf(provider: ProviderConfig, body: unknown): string[] | null {
  if (provider.auth === 'chatgpt') {
    const models = (body as { models?: unknown })?.models;
    if (!Array.isArray(models)) return null;
    return models.filter((m) => m?.visibility === 'list' && typeof m?.slug === 'string').map((m) => m.slug);
  }
  if (provider.kind === 'gemini') {
    const models = (body as { models?: unknown })?.models;
    if (!Array.isArray(models)) return null;
    return models
      .filter((m: { supportedGenerationMethods?: unknown }) => !Array.isArray(m?.supportedGenerationMethods) ||
        m.supportedGenerationMethods.some((method: unknown) => method === 'generateContent' || method === 'streamGenerateContent'))
      .map((m: { name?: unknown }) => typeof m?.name === 'string' ? m.name.replace(/^models\//, '') : '')
      .filter(Boolean);
  }
  const list = Array.isArray(body) ? body : (body as { data?: unknown })?.data;
  if (!Array.isArray(list)) return null;
  return list.map((m: { id?: unknown }) => typeof m?.id === 'string' ? m.id : '').filter(Boolean);
}

/** Streams one assistant turn: text, thinking, tool calls and usage, through each protocol's adapter. */
export async function streamChat(
  provider: ProviderConfig,
  key: string | null,
  request: ChatRequest,
  emit: (text: string, delta?: StreamDelta) => void
): Promise<StreamChatResult> {
  // Aborted when the stream goes quiet for too long.
  const watchdog = new AbortController();
  const signal = request.signal ? AbortSignal.any([request.signal, watchdog.signal]) : watchdog.signal;
  const body = await open(provider, key, request, signal);

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
  let responsesComplete = false;

  const readUsage = (prompt?: unknown, completion?: unknown, cached?: unknown): void => {
    if (typeof prompt === 'number' || typeof completion === 'number')
      usage = {
        ...usage,
        ...(typeof cached === 'number' ? { cachedPromptTokens: cached } : {}),
        promptTokens: typeof prompt === 'number' ? prompt : usage.promptTokens,
        completionTokens: typeof completion === 'number' ? completion : usage.completionTokens
      };
  };
  /**
   * Anthropic reports cache reads and cache writes apart from input_tokens (the tokens after the last
   * cache breakpoint); the prompt is their sum. message_delta repeats the counts it has, cumulatively.
   */
  const claudeInput = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const readClaudeUsage = (reported: Record<string, unknown> | undefined): void => {
    if (!reported || typeof reported !== 'object') return;
    let counted = false;
    for (const field of Object.keys(claudeInput) as (keyof typeof claudeInput)[])
      if (typeof reported[field] === 'number') { claudeInput[field] = reported[field] as number; counted = true; }
    const prompt = claudeInput.input_tokens + claudeInput.cache_creation_input_tokens + claudeInput.cache_read_input_tokens;
    readUsage(counted ? prompt : undefined, reported.output_tokens, counted ? claudeInput.cache_read_input_tokens : undefined);
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
    for await (const raw of sse(body)) {
      kick();
      if (raw === '[DONE]') break;
      const event = JSON.parse(raw);
      throwIfError(event, key);

      if (provider.kind === 'openai-responses') {
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') text(event.delta);
        if (event.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') {
          received = true; emit('', { type: 'thought', text: event.delta });
        }
        if (event.type === 'response.refusal.delta') refusedAnswer = true;
        if (event.type === 'response.output_item.done' && event.item) blocks.set(event.output_index ?? blocks.size, event.item);
        if (event.type === 'response.failed') throw new Error(`The provider reported an error: ${clean(event.response?.error?.message ?? 'Response failed.', key)}`);
        if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          responsesComplete = true;
          truncated = event.type === 'response.incomplete';
          readUsage(event.response?.usage?.input_tokens, event.response?.usage?.output_tokens, event.response?.usage?.input_tokens_details?.cached_tokens);
          // The ChatGPT plan's completed event can list no output; the items streamed before it then stand.
          if (Array.isArray(event.response?.output) && event.response.output.length) {
            blocks.clear(); event.response.output.forEach((item: Record<string, unknown>, i: number) => blocks.set(i, item));
          }
          for (const item of blocks.values()) if (item.type === 'function_call') {
            received = true;
            const tc: ToolCall = { id: String(item.call_id), name: String(item.name), arguments: String(item.arguments ?? '{}') };
            toolCalls.push(tc); emit('', { type: 'tool_call', ...tc });
          }
        }
      } else if (provider.kind === 'anthropic') {
        if (event.type === 'message_start') readClaudeUsage({ ...event.message?.usage, output_tokens: undefined });
        if (event.type === 'message_delta') {
          readClaudeUsage(event.usage);
          // A full context window ends the answer early, as the output limit does.
          if (event.delta?.stop_reason === 'max_tokens' || event.delta?.stop_reason === 'model_context_window_exceeded') truncated = true;
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
        readUsage(event.usageMetadata?.promptTokenCount, event.usageMetadata?.candidatesTokenCount, event.usageMetadata?.cachedContentTokenCount);
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
        if (event.usage) readUsage(event.usage.prompt_tokens, event.usage.completion_tokens, event.usage.prompt_tokens_details?.cached_tokens);
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
              // Names arrive once, or split across chunks; some servers repeat the whole name in every chunk.
              if (tc.function?.name && tc.function.name !== existing.name) existing.name += tc.function.name;
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

  if (provider.kind === 'openai-responses' && !responsesComplete) throw new Error('The provider disconnected before completing the response. Try again.');

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
  if (provider.kind === 'openai-responses') return { kind: 'openai-responses', content: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, item]) => item) };
  if (provider.kind === 'anthropic') {
    const content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block)
      // Empty text is invalid, and a thinking block is only valid with its signature.
      .filter(block => !(block.type === 'text' && !block.text) && !(block.type === 'thinking' && !block.signature));
    return { kind: 'anthropic', content };
  }
  if (provider.kind === 'gemini') return { kind: 'gemini', content: parts };
  return reasoning ? { kind: 'openai-compatible', content: [{ reasoning_content: reasoning }] } : undefined;
}

/** A network failure said plainly: which address could not be reached, and what to check. */
export function unreachable(url: string): Error {
  const { host, hostname } = new URL(url);
  return new Error(['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    ? `Could not reach ${host}. Is the server running on this computer?`
    : `Could not reach ${host}. Check your internet connection and the endpoint.`);
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
      if (response.ok) return response;
      // "Would exceed your credits given your in-flight requests": the balance covers this request once
      // the others finish, so wait for them instead of failing. A 402 without that wording is a real shortfall.
      const crowded = response.status === 402 && attempt < CROWDED_ATTEMPTS
        && /in-flight/i.test(errorDetail(await readCapped(response.clone(), 4_000)));
      // Anthropic's monthly spend cap is a 429 without retry-after; retrying fails until next month.
      const capped = response.status === 429 && !response.headers.has('retry-after')
        && /enforced_spend_limit_reached/.test(await readCapped(response.clone(), 4_000));
      if (capped || (!crowded && (attempt >= ATTEMPTS || !RETRY_STATUSES.includes(response.status)))) return response;
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000
        : crowded ? Math.min(2000 * 2 ** (attempt - 1), 30_000) : 500 * 2 ** (attempt - 1), userSignal);
    } catch (error) {
      if (userSignal?.aborted) throw error;
      if (waiting.signal.aborted) throw new Error(`The provider did not answer within ${Math.round(timeouts.headersMs / 1000)} seconds.`);
      if (!(error instanceof TypeError)) throw error;
      if (attempt >= ATTEMPTS) throw unreachable(url);
      await sleep(500 * 2 ** (attempt - 1), userSignal);
    } finally {
      clearTimeout(timer);
    }
  }
}
