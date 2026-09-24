import { COWORKERS, SPECIALIST_GROUPS, coworkerById, type Coworker } from '../shared/coworkers';
import { scoreCoworkers } from '../shared/coworkerSearch';
import type { ChatRequestMessage, ProviderConfig, ToolDefinition } from '../shared/types';
import { rolesBlock } from './prompt';
import type { streamChat } from './providers';
import { roleProfiles } from './roles';

/** Questions a coworker may put to colleagues in one run. */
export const MAX_ASKS = 3;
export const LIMIT_REACHED = 'You have asked three colleagues already; finish with what you have.';
/** Steps a colleague may take to answer. */
const CONSULT_STEPS = 5;
/** A search score that names one person rather than a whole field. */
const CLEAR_MATCH = 55;

export const ASK_COLLEAGUE: ToolDefinition = {
  name: 'ask_colleague',
  description:
    'Ask a colleague at Axon a question while you work on this task; they answer from their own expertise. ' +
    'Name them by role, e.g. "Backend Developer" or "Security Engineer". Departments: ' +
    `${SPECIALIST_GROUPS.join(', ')}; plus the core team (Research Analyst, Writer, Designer, Product Coach, ` +
    'Knowledge Librarian, Files Agent, Marketing Strategist, Ops Coordinator). At most three questions per task.',
  parameters: {
    type: 'object',
    properties: {
      colleague: { type: 'string', description: 'Their role, e.g. "Backend Developer"' },
      question: { type: 'string', description: 'What you want to know, with the context they need' }
    },
    required: ['colleague', 'question']
  }
};

const bare = (name: string) =>
  name
    .replace(/\s*\([^()]*\)\s*$/, '')
    .trim()
    .toLowerCase();

/**
 * The colleague a coworker means: an exact name or id first, otherwise the one person the
 * specialty search clearly points to. Anything vaguer comes back as an error naming the
 * closest matches, so the model can ask again.
 */
export function resolveColleague(name: string, askerId: string): { coworker: Coworker } | { error: string } {
  const wanted = bare(name);
  const exact =
    coworkerById(name.trim()) ??
    COWORKERS.find((c) => bare(c.name) === wanted || c.name.toLowerCase() === name.trim().toLowerCase());
  if (exact)
    return exact.id === askerId ? { error: 'Ask someone other than yourself.' } : { coworker: exact };
  const others = COWORKERS.filter((c) => c.id !== askerId);
  const ranked = scoreCoworkers(name, others, (c) => ({
    name: c.name,
    area: `${c.department} ${c.role}`,
    about: `${c.capabilities.join(' ')} ${c.description}`,
    prompt: c.systemPrompt
  }));
  // One strong name match is who they mean; several ("engineer") is a question back.
  const strong = ranked.filter((entry) => entry.score >= CLEAR_MATCH);
  if (strong.length === 1) return { coworker: strong[0].item };
  const closest = ranked.slice(0, 5).map((entry) => entry.item.name);
  return {
    error: `No single colleague matches "${name}".${closest.length ? ` Closest: ${closest.join(', ')}.` : ''}`
  };
}

/** Who the colleague is, and how to answer a teammate. */
export function consultSystemPrompt(colleague: Coworker, askerName: string): string {
  return [
    colleague.systemPrompt,
    rolesBlock(roleProfiles(colleague.roleIds)),
    `${askerName} is asking you a question while working on a task for the user. Answer from your expertise, concisely. You cannot ask other colleagues.`
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface ConsultDeps {
  stream: typeof streamChat;
  /** Stops the colleague when the asker's run is stopped. */
  signal?: AbortSignal;
  /** Read-only tools when the asker's conversation has a folder; otherwise none. */
  tools: ToolDefinition[];
  execute: (name: string, args: Record<string, unknown>) => Promise<string>;
}

/** The colleague thinks it through, reading files if allowed, and returns their answer. */
export async function consult(
  provider: ProviderConfig,
  key: string | null,
  modelId: string,
  colleague: Coworker,
  askerName: string,
  question: string,
  deps: ConsultDeps
): Promise<string> {
  const system = consultSystemPrompt(colleague, askerName);
  const allowed = new Set(deps.tools.map((tool) => tool.name));
  const messages: ChatRequestMessage[] = [{ role: 'user', content: question }];
  let output = '';
  for (let step = 0; step < CONSULT_STEPS; step++) {
    let text = '';
    const result = await deps.stream(
      provider,
      key,
      {
        model: modelId,
        messages,
        system,
        temperature: 0.3,
        tools: deps.tools.length ? deps.tools : undefined,
        signal: deps.signal
      },
      (chunk, delta) => {
        if (delta?.type === 'text') text += delta.text;
        else if (chunk && delta?.type !== 'thought') text += chunk;
      }
    );
    output += text;
    const calls = result.toolCalls ?? [];
    if (!calls.length) break;
    messages.push({ role: 'assistant', content: text, toolCalls: calls });
    for (const call of calls) {
      let content = 'Not available to you here.';
      if (allowed.has(call.name)) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments);
        } catch {
          // Arguments the model mangled read as none.
        }
        content = await deps.execute(call.name, args);
      }
      messages.push({ role: 'tool', toolCallId: call.id, content });
    }
  }
  return output.trim() || '(no answer)';
}
