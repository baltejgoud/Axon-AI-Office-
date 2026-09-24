import { coworkerById } from '../../shared/coworkers';
import type { TaskItem } from '../../shared/types';
import type { TaskStore } from './store';

const TITLE_LENGTH = 80;
const QUESTION_LENGTH = 2000;
const APPROVAL = 'Waiting for your approval';

/** A task's title: the first line you wrote, without the files and attachments sent along with it. */
export function taskTitle(input: string): string {
  const visible = input.split('\n\n<file path=')[0].split('\n\nFile context: ')[0].split('\n\n<attachment')[0];
  const line = visible
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean) ?? 'Untitled task';
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

/**
 * Turns each conversation run into its task record: one `work` record per conversation with a
 * coworker, working while the run generates, needing attention while it waits for you or after it
 * failed, and done when it finishes. Colleagues answering a question get `help` records.
 */
export class TaskTracker {
  constructor(
    private readonly store: TaskStore,
    private readonly isCoworker: (agentId: string | undefined) => boolean,
    private readonly now: () => number = Date.now
  ) {}

  private work(conversationId: string): TaskItem | undefined {
    return this.store.find((task) => task.kind === 'work' && task.conversationId === conversationId);
  }

  runStarted(chat: { id: string; agentId?: string }, input: string): void {
    if (!this.isCoworker(chat.agentId)) return;
    const existing = this.work(chat.id);
    const runStartedAt = this.now();
    if (existing) {
      this.store.update(existing.id, { status: 'working', note: undefined, doneAt: undefined, runStartedAt });
      return;
    }
    this.store.add({
      kind: 'work',
      title: taskTitle(input),
      status: 'working',
      coworkerId: chat.agentId,
      conversationId: chat.id,
      runStartedAt
    });
  }

  approvalPending(conversationId: string): void {
    const task = this.work(conversationId);
    if (task) this.store.update(task.id, { status: 'attention', note: APPROVAL });
  }

  approvalResolved(conversationId: string): void {
    const task = this.work(conversationId);
    if (task?.note === APPROVAL) this.store.update(task.id, { status: 'working', note: undefined });
  }

  runEnded(conversationId: string, outcome: { error?: string; stopped?: boolean }): void {
    const task = this.work(conversationId);
    if (!task) return;
    if (outcome.stopped) this.store.update(task.id, { status: 'done', note: 'Stopped', doneAt: this.now() });
    else if (outcome.error) this.store.update(task.id, { status: 'attention', note: outcome.error });
    else this.store.update(task.id, { status: 'done', note: undefined, doneAt: this.now() });
  }

  /** After a restart nothing is running any more: whatever was mid-run needs a look. */
  interrupted(): void {
    for (const task of this.store.list())
      if (task.status === 'working') this.store.update(task.id, { status: 'attention', note: 'Interrupted' });
  }

  helpStarted(colleagueId: string, askerId: string, conversationId: string, question: string): TaskItem {
    const asker = coworkerById(askerId)?.name ?? 'a colleague';
    return this.store.add({
      kind: 'help',
      title: `Helping ${asker}`,
      notes: question.slice(0, QUESTION_LENGTH),
      status: 'working',
      coworkerId: colleagueId,
      forCoworkerId: askerId,
      conversationId
    });
  }

  helpEnded(id: string, error?: string): void {
    this.store.update(id, { status: 'done', note: error, doneAt: this.now() });
  }
}
