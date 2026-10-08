import type { ClaudeRateLimits, ModelSpec, RateLimit } from '../../shared/types';

/**
 * Claude through a Claude Console API key. Anthropic does not let third-party apps offer Claude
 * account sign-in or use Claude plan limits (code.claude.com/docs/en/legal-and-compliance), so this
 * is API access, billed to the key's Console organization: no OAuth, no borrowed client ID, no cookies.
 * The key is kept in the vault under the provider's ID, like any provider's key.
 */
export const CLAUDE_PROVIDER_ID = 'claude-console';
export const CLAUDE_API = 'https://api.anthropic.com/v1';
export const ANTHROPIC_VERSION = '2023-06-01';
/** The model list is paged; a key never needs more than a few pages. */
const PAGES = 5;
const MAX_MODELS = 100;
const WORKSPACE = /^wrkspc_[A-Za-z0-9]{4,64}$/;
const ORGANIZATION = /^[A-Za-z0-9-]{8,64}$/;

export interface ClaudeKeyCheck {
  organizationId?: string;
  workspaceId?: string;
  models: ModelSpec[];
}

/** Why a key check failed, said as what to do next. */
export class ClaudeKeyError extends Error {
  constructor(
    message: string,
    /** The key spans several workspaces, or the workspace given was refused: ask for one. */
    readonly needsWorkspace = false
  ) {
    super(message);
  }
}

/** A workspace ID as Claude Console shows it; empty means the key's own workspace. */
export function cleanWorkspaceId(raw: string | undefined): string | undefined {
  const id = (raw ?? '').trim();
  if (!id) return undefined;
  if (!WORKSPACE.test(id))
    throw new ClaudeKeyError('A workspace ID starts with wrkspc_. Copy it from Claude Console → Settings → Workspaces.', true);
  return id;
}

/**
 * Checks a key with Anthropic's model list, which is free: no message is sent and nothing is billed.
 * Returns the models the key can use in Anthropic's order, with their published limits, and the
 * organization and workspace Anthropic's response headers name.
 */
export async function checkClaudeKey(key: string, workspaceId: string | undefined, signal: AbortSignal): Promise<ClaudeKeyCheck> {
  const headers: Record<string, string> = {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {})
  };
  const models: ModelSpec[] = [];
  let identity: Omit<ClaudeKeyCheck, 'models'> = {};
  let after = '';
  for (let page = 0; page < PAGES && models.length < MAX_MODELS; page++) {
    const url = new URL(`${CLAUDE_API}/models`);
    url.searchParams.set('limit', '1000');
    if (after) url.searchParams.set('after_id', after);
    let response: Response;
    try {
      response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    } catch {
      if (signal.aborted) throw new Error('Key check cancelled.');
      throw new ClaudeKeyError('Could not reach api.anthropic.com. Check your internet connection and try again.');
    }
    if (!response.ok) throw await refusal(response, key);
    if (page === 0) identity = identityOf(response.headers);
    let body: { data?: unknown; has_more?: unknown; last_id?: unknown };
    try {
      const raw = await response.text();
      if (raw.length > 4_000_000) throw new Error('oversized');
      body = JSON.parse(raw);
    } catch {
      throw new ClaudeKeyError('Anthropic sent a model list Axon could not read. Try again.');
    }
    if (!Array.isArray(body?.data)) throw new ClaudeKeyError('Anthropic did not return a model list. Try again.');
    for (const item of body.data) {
      const spec = modelSpec(item);
      if (spec && models.length < MAX_MODELS && !models.some((m) => m.id === spec.id)) models.push(spec);
    }
    if (body.has_more !== true || typeof body.last_id !== 'string') break;
    after = body.last_id;
  }
  if (!models.length)
    throw new ClaudeKeyError("The key works, but its workspace can't use any Claude models. Check the workspace's model access in Claude Console.");
  return { ...identity, models };
}

/** One entry of the model list, with the limits Anthropic publishes for it; never guessed from the name. */
function modelSpec(item: unknown): ModelSpec | null {
  const m = item as { id?: unknown; display_name?: unknown; max_input_tokens?: unknown; max_tokens?: unknown; capabilities?: { image_input?: { supported?: unknown } } };
  if (typeof m?.id !== 'string' || !/^[\w.:@-]{1,200}$/.test(m.id)) return null;
  const tokens = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 100_000_000 ? value : undefined;
  const contextWindow = tokens(m.max_input_tokens);
  const maxOutputTokens = tokens(m.max_tokens);
  const vision = m.capabilities?.image_input?.supported;
  const name = typeof m.display_name === 'string' ? m.display_name.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  return {
    id: m.id,
    displayName: name || m.id,
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(typeof vision === 'boolean' ? { supportsVision: vision } : {})
  };
}

function identityOf(headers: Headers): Omit<ClaudeKeyCheck, 'models'> {
  const organizationId = headers.get('anthropic-organization-id') ?? '';
  const workspaceId = headers.get('anthropic-workspace-id') ?? '';
  return {
    ...(ORGANIZATION.test(organizationId) ? { organizationId } : {}),
    ...(WORKSPACE.test(workspaceId) ? { workspaceId } : {})
  };
}

/** A refused check, with Anthropic's own explanation (never the key) and the request ID support asks for. */
async function refusal(response: Response, key: string): Promise<ClaudeKeyError> {
  let message = '';
  try {
    const body = JSON.parse((await response.text()).slice(0, 16_000));
    message = typeof body?.error?.message === 'string' ? body.error.message : '';
  } catch {
    /* Only the status is known. */
  }
  message = (key.length >= 4 ? message.split(key).join('[key]') : message).replace(/\s+/g, ' ').trim().slice(0, 240);
  const requestId = response.headers.get('request-id') ?? '';
  const reference = /^[\w-]{1,100}$/.test(requestId) ? ` (request ${requestId})` : '';
  const say = (text: string, needsWorkspace = false) => new ClaudeKeyError(text + reference, needsWorkspace);
  if (/anthropic-workspace-id is required/i.test(message))
    return say('This key works in more than one workspace. Enter the workspace to use: its ID is in Claude Console → Settings → Workspaces.', true);
  if (/workspace/i.test(message) && (response.status === 400 || response.status === 404))
    return say(`Anthropic did not accept the workspace: ${message}`, true);
  if (response.status === 401)
    return say('Anthropic did not accept this API key. Copy it again from Claude Console → API keys; a disabled, deleted or expired key has to be replaced with a new one.');
  if (response.status === 403)
    return say(`Anthropic refused this key${message ? `: ${message}` : '.'} Check its organization and workspace access in Claude Console.`);
  if (response.status === 429) return say('Anthropic is rate limiting this organization. Wait a moment, then try again.');
  if (response.status >= 500) return say(`Anthropic is having trouble (HTTP ${response.status}). Try again shortly.`);
  return say(`Anthropic returned HTTP ${response.status}${message ? `: ${message}` : '.'}`);
}

/** The organization's request, input and output limits from a Messages response's headers, if it sent them. */
export function rateLimitsOf(headers: Headers, model: string, at = Date.now()): ClaudeRateLimits | null {
  const read = (name: string): RateLimit | undefined => {
    const prefix = `anthropic-ratelimit-${name}`;
    if (!headers.has(`${prefix}-limit`) || !headers.has(`${prefix}-remaining`)) return undefined;
    const limit = Number(headers.get(`${prefix}-limit`));
    const remaining = Number(headers.get(`${prefix}-remaining`));
    if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit < 0 || remaining < 0) return undefined;
    const reset = headers.get(`${prefix}-reset`) ?? '';
    return { limit, remaining, ...(reset && !Number.isNaN(Date.parse(reset)) ? { reset } : {}) };
  };
  const requests = read('requests'), inputTokens = read('input-tokens'), outputTokens = read('output-tokens');
  if (!requests && !inputTokens && !outputTokens) return null;
  return { model, at, ...(requests ? { requests } : {}), ...(inputTokens ? { inputTokens } : {}), ...(outputTokens ? { outputTokens } : {}) };
}

/** One key check at a time; Cancel stops the one under way. */
export class ClaudeConnection {
  private checking: AbortController | null = null;
  cancel(): void {
    this.checking?.abort();
  }
  async check(key: string, workspaceId?: string): Promise<ClaudeKeyCheck> {
    this.cancel();
    const abort = new AbortController();
    this.checking = abort;
    try {
      return await checkClaudeKey(key, workspaceId, abort.signal);
    } finally {
      if (this.checking === abort) this.checking = null;
    }
  }
}
