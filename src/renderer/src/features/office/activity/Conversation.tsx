import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { Conversation as Thread, Message, ToolCall } from '../../../../../shared/types';
import { useApp } from '../../../state';
import { MessageView, visibleUserText } from '../../../chat/MessageView';
import { PendingApprovals } from '../../../chat/PendingApprovals';
import { ColleagueCard } from './ColleagueCard';
import { PlannerToolCard } from './PlannerToolCard';
import { isPlannerCall } from '../tasks';
import { withOutcomes } from './thread';
import { WorkSummary } from './WorkSummary';
import { isWorkCall, onlyWork, threadRuns, workOf } from '../workspace/work';

/**
 * Colleagues' answers and the receptionist's planner changes get their own cards in the thread;
 * work (files, commands, pages, tools) is summed up once per run instead.
 */
const officeToolCard = (call: ToolCall, at: number) =>
  call.name === 'ask_colleague' ? (
    <ColleagueCard call={call} />
  ) : isPlannerCall(call) ? (
    <PlannerToolCard call={call} />
  ) : isWorkCall(call, at) ? (
    false
  ) : null;

/** The whole thread with the selected coworker, following new output unless the user scrolled up. */
export function Conversation({
  agentName,
  conversation,
  pendingTask,
  working,
  shown: visible = true
}: {
  agentName: string;
  conversation: Thread | undefined;
  /** A task that was just sent; shown until the saved thread includes it. */
  pendingTask?: string;
  /** The coworker is working on this thread now. */
  working: boolean;
  /** The chat tab is showing; coming back to it picks up at the newest message again. */
  shown?: boolean;
}) {
  const allMessages = useApp((s) => s.data?.messages);
  const approvals = useApp((s) => s.pendingApprovals);
  // When the current run began: the task you sent goes just before what it produced.
  const runStartedAt = useApp(
    (s) => s.data?.tasks.find((t) => t.kind === 'work' && t.conversationId === conversation?.id)?.runStartedAt
  );
  const messages = useMemo(
    () =>
      conversation
        ? withOutcomes((allMessages ?? []).filter((m) => m.conversationId === conversation.id))
        : [],
    [allMessages, conversation]
  );
  const shown = useMemo(() => {
    if (!pendingTask) return messages;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser && visibleUserText(lastUser.content) === pendingTask) return messages;
    const optimistic: Message = {
      id: 'pending-task',
      conversationId: conversation?.id ?? '',
      role: 'user',
      content: pendingTask,
      createdAt: Date.now()
    };
    // The run's replies are dated from its start; without a task record, from the first still streaming.
    const at = messages.findIndex((m) =>
      runStartedAt !== undefined ? m.role === 'assistant' && m.createdAt >= runStartedAt : m.streaming
    );
    return at < 0 ? [...messages, optimistic] : [...messages.slice(0, at), optimistic, ...messages.slice(at)];
  }, [messages, pendingTask, conversation?.id, runStartedAt]);
  const pending = Object.values(approvals).filter((r) => r.conversationId === conversation?.id).length;
  // Each run's work, summed up after its last message.
  const summaries = useMemo(
    () =>
      new Map(
        threadRuns(shown)
          .map((run) => [run.end, workOf(run.messages).steps] as const)
          .filter(([, steps]) => steps.length > 0)
      ),
    [shown]
  );
  const lastEnd = shown.length - 1;
  const live = working || pending > 0;
  const end = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    follow.current = true;
  }, [conversation?.id]);

  const progress = shown.map((m) => m.content.length + (m.toolCalls?.length ?? 0)).join(',');
  useEffect(() => {
    if (visible && follow.current) end.current?.scrollIntoView({ block: 'end' });
  }, [progress, pending, visible]);

  useEffect(() => {
    const scroller = end.current?.closest<HTMLElement>('.activity-body');
    if (!scroller) return;
    const onScroll = () => {
      follow.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    };
    scroller.addEventListener('scroll', onScroll);
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      {(shown.length > 0 || pending > 0) && (
        <section className="office-thread" aria-label={`Conversation with ${agentName}`}>
          <div className="messages">
            {shown.map((m, i) => {
              const steps = summaries.get(i);
              return (
                <Fragment key={m.id}>
                  {!onlyWork(m) && (
                    <MessageView
                      message={m}
                      authorName={agentName}
                      renderToolCall={(call) => officeToolCard(call, m.createdAt)}
                    />
                  )}
                  {steps && conversation && (
                    <WorkSummary
                      conversationId={conversation.id}
                      steps={steps}
                      live={i === lastEnd && (live || steps.some((step) => step.state === 'running'))}
                    />
                  )}
                </Fragment>
              );
            })}
            <PendingApprovals conversationId={conversation?.id ?? null} />
          </div>
        </section>
      )}
      <div ref={end} className="office-thread-end" />
    </>
  );
}
