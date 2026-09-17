import type { ProviderConfig, ChatRequest, ChatUsage } from '../shared/types';

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

/** Protocol adapters only return text. No model output can execute tools. */
export async function streamChat(provider: ProviderConfig, key: string | null, request: ChatRequest, emit: (text: string) => void): Promise<ChatUsage> {
  const base = endpoint(provider).href.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url: string, payload: unknown;
  if (provider.kind === 'anthropic') {
    url = `${base}/messages`;
    headers['x-api-key'] = key || ''; headers['anthropic-version'] = '2023-06-01';
    payload = { model: request.model, max_tokens: request.maxTokens, system: request.system, stream: true,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      messages: request.messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })) };
  } else if (provider.kind === 'gemini') {
    url = `${base}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;
    headers['x-goog-api-key'] = key || '';
    payload = { systemInstruction: { parts: [{ text: request.system || 'You are a helpful assistant.' }] },
      contents: request.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: request.maxTokens, ...(request.temperature !== undefined ? { temperature: request.temperature } : {}) } };
  } else {
    url = `${base}/chat/completions`;
    if (key) headers.Authorization = `Bearer ${key}`;
    payload = { model: request.model, stream: true, max_completion_tokens: request.maxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      messages: [...(request.system ? [{ role: 'system', content: request.system }] : []), ...request.messages.map(m => ({ role: m.role, content: m.content }))] };
    // Most third-party OpenAI-compatible APIs use max_tokens rather than max_completion_tokens.
    if (new URL(base).hostname !== 'api.openai.com') {
      const p = payload as Record<string, unknown>; p.max_tokens = p.max_completion_tokens; delete p.max_completion_tokens;
    }
  }
  const body = JSON.stringify(payload);
  const response = await fetchWithRetry(url, headers, body, request.signal);
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Provider returned HTTP ${response.status}. Check endpoint, model, key, and quota.`); }
  if (!response.body) throw new Error('Provider returned no response body.');
  let received = false, usage: ChatUsage = {};
  for await (const raw of sse(response.body)) {
    if (raw === '[DONE]') break;
    const event = JSON.parse(raw);
    if (event.error || event.type === 'error') throw new Error('Provider reported a streaming error.');
    const readUsage = (prompt?: unknown, completion?: unknown): void => {
      if (typeof prompt === 'number' || typeof completion === 'number')
        usage = { promptTokens: typeof prompt === 'number' ? prompt : usage.promptTokens, completionTokens: typeof completion === 'number' ? completion : usage.completionTokens };
    };
    if (provider.kind === 'anthropic') {
      if (event.type === 'message_start') readUsage(event.message?.usage?.input_tokens);
      if (event.type === 'message_delta') readUsage(undefined, event.usage?.output_tokens);
    } else if (provider.kind === 'gemini') {
      readUsage(event.usageMetadata?.promptTokenCount, event.usageMetadata?.candidatesTokenCount);
    } else if (event.usage) readUsage(event.usage.prompt_tokens, event.usage.completion_tokens);
    const text = provider.kind === 'anthropic' ? event.delta?.text : provider.kind === 'gemini'
      ? event.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('')
      : event.choices?.[0]?.delta?.content;
    if (typeof text === 'string' && text) { received = true; emit(text); }
  }
  if (!received) throw new Error('Provider returned no text. This model may require unsupported parameters or content types.');
  return usage;
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

