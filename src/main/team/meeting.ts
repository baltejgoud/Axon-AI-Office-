import { coworkerById, type Coworker } from '../../shared/coworkers';
import type { ChatRequestMessage, ProviderConfig, Team, TeamAssignment, TeamPlan } from '../../shared/types';
import { rolesBlock } from '../prompt';
import type { streamChat } from '../providers';
import { roleProfiles } from '../roles';
import { RESULT_LIMIT, validatePlan } from './plan';
import { PROPOSE_PLAN } from './tools';

/** One model, as a team uses it: the lead's provider, key and model for everyone. */
export interface ModelCall {
  stream: typeof streamChat;
  provider: ProviderConfig;
  key: string | null;
  modelId: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

const nameOf = (id: string) => coworkerById(id)?.name ?? id;
/** Everyone in the room, with their department. */
const inTheRoom = (team: Team) =>
  team.attendees
    .map((id) => {
      const c = coworkerById(id);
      return c ? `${c.name} (${c.department})` : id;
    })
    .join(', ');

/** What an attendee is asked when their turn in the meeting comes. */
export const MEETING_ASK = 'The meeting is starting. Give your input now.';

/** An attendee in the meeting: who they are, the goal, who else is there, and what to bring. */
export function meetingSystemPrompt(attendee: Coworker, team: Team): string {
  return [
    attendee.systemPrompt,
    rolesBlock(roleProfiles(attendee.roleIds)),
    `${nameOf(team.leadId)} has called a team meeting about this goal:\n${team.goal}\n\nIn the room: ${inTheRoom(team)}.`,
    'From your specialty, in under 200 words: how you would approach your part, what you would own (files or areas), what you need from whom, and the main risk. Do not do the work yet; you may read the project to ground your answer.'
  ]
    .filter(Boolean)
    .join('\n\n');
}

const minutesText = (team: Team) =>
  team.minutes.map((m) => `## ${nameOf(m.coworkerId)}\n${m.error ? `(could not answer: ${m.error})` : m.text}`).join('\n\n');

/** The lead turns the minutes into a plan with propose_plan; a broken plan goes back once with the reasons. */
export async function draftPlan(team: Team, model: ModelCall): Promise<{ plan: TeamPlan } | { errors: string[] }> {
  const lead = coworkerById(team.leadId);
  const system = [
    lead?.systemPrompt ?? '',
    `You ran a team meeting about this goal:\n${team.goal}\n\nIn the room: ${inTheRoom(team)}.`,
    'Turn what the team said into a plan by calling propose_plan exactly once. Give each task to the attendee best placed for it, in enough detail to start without the meeting. Make a task depend on another only when it needs its result. Give every file to one task; two tasks that could run at the same time must never share a file.'
  ]
    .filter(Boolean)
    .join('\n\n');
  const attendees = team.attendees.map((id) => ({ id, name: nameOf(id) }));
  const messages: ChatRequestMessage[] = [{ role: 'user', content: `What the team said:\n\n${minutesText(team)}` }];
  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let said = '';
    const result = await model.stream(
      model.provider,
      model.key,
      { model: model.modelId, messages, system, temperature: 0.2, maxTokens: model.maxTokens, tools: [PROPOSE_PLAN], signal: model.signal },
      (chunk, delta) => {
        if (delta?.type !== 'thought' && chunk) said += chunk;
      }
    );
    const call = (result.toolCalls ?? []).find((tc) => tc.name === PROPOSE_PLAN.name);
    if (!call) {
      errors = ['The lead did not call propose_plan.'];
      messages.push({ role: 'assistant', content: said.trim() || '(no plan yet)' }, { role: 'user', content: 'Call propose_plan now with the plan.' });
      continue;
    }
    let args: Record<string, unknown> | null = null;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      errors = ['The plan was not valid JSON (perhaps cut off).'];
    }
    if (args) {
      const checked = validatePlan(args, attendees);
      if (checked.ok) return { plan: checked.plan };
      errors = checked.errors;
    }
    messages.push(
      { role: 'assistant', content: said, toolCalls: [call], replay: result.replay },
      {
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: `The plan was not accepted:\n- ${errors.join('\n- ')}\nCall propose_plan again with these fixed.`
      }
    );
  }
  return { errors };
}

/** The lead's report once every task is done: no tools, from the goal, plan and hand-offs. */
export async function writeReport(team: Team, model: ModelCall): Promise<string> {
  const lead = coworkerById(team.leadId);
  const work = (team.plan?.assignments ?? [])
    .map((a) => `## ${a.title} (${nameOf(a.ownerId)})\n${a.result || '(no hand-off)'}`)
    .join('\n\n');
  let text = '';
  await model.stream(
    model.provider,
    model.key,
    {
      model: model.modelId,
      system: [
        lead?.systemPrompt ?? '',
        'Your team has finished. Report to the user in under 250 words: what was done and by whom, anything left open, and what they should check.'
      ]
        .filter(Boolean)
        .join('\n\n'),
      messages: [
        {
          role: 'user',
          content: `Goal:\n${team.goal}\n\nPlan:\n${team.plan?.summary ?? ''}\n\nWhat each person handed in:\n\n${work}`
        }
      ],
      temperature: 0.3,
      maxTokens: model.maxTokens,
      signal: model.signal
    },
    (chunk, delta) => {
      if (delta?.type !== 'thought' && chunk) text += chunk;
    }
  );
  return text.trim();
}

/** What an owner is sent to start their task: the goal, their part, who owns what, and what they build on. */
export function taskBrief(team: Team, assignment: TeamAssignment): string {
  const all = team.plan?.assignments ?? [];
  const others = all.filter((a) => a.id !== assignment.id);
  const handOffs = assignment.dependsOn
    .map((id) => all.find((a) => a.id === id))
    .filter((a): a is TeamAssignment => !!a)
    .map((a) => `### ${a.title} (${nameOf(a.ownerId)})\n${a.result || '(no hand-off)'}`);
  return [
    `Team goal: ${team.goal}`,
    team.plan?.summary ? `The plan: ${team.plan.summary}` : '',
    `Your task (${assignment.id}): ${assignment.title}\n${assignment.brief}`,
    assignment.files.length ? `Files that are yours to create or change: ${assignment.files.join(', ')}` : '',
    others.length
      ? `The rest of the team (do not edit files someone else owns; ask them with ask_colleague):\n${others
          .map((a) => `- ${nameOf(a.ownerId)}: ${a.title}${a.files.length ? ` (owns ${a.files.join(', ')})` : ''}, ${a.status}`)
          .join('\n')}`
      : '',
    handOffs.length ? `What you are building on:\n\n${handOffs.join('\n\n')}` : '',
    'When you are done, end with a short hand-off: what you did, where it is, and anything the next person must know.'
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** A lead's recent teams, for their system prompt: so they can say how it is going and act on it. */
export function teamsBlock(teams: Team[]): string {
  if (!teams.length) return '';
  return [
    '## Your teams',
    ...teams.map((t) =>
      [
        `### ${t.goal} — ${t.status}${t.note ? ` (${t.note})` : ''}`,
        ...(t.plan?.assignments ?? []).map(
          (a) => `- ${a.id} ${a.title}: ${nameOf(a.ownerId)}, ${a.status}${a.note ? ` (${a.note})` : ''}`
        ),
        t.report ? `Report: ${t.report}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
  ].join('\n\n');
}

/** Said to a colleague a teammate asks: they share a team, and here is their own part. Empty when they don't. */
export function teammateContext(team: Team, colleagueId: string): string {
  const mine = team.plan?.assignments.find((a) => a.ownerId === colleagueId);
  if (!mine) return '';
  return `You are both on the team for: ${team.goal}\nYour task: ${mine.title} (${mine.status}).${
    mine.result ? `\nYour hand-off so far: ${mine.result.slice(0, RESULT_LIMIT / 2)}` : ''
  }`;
}
