import { useEffect, useMemo, useRef } from 'react';
import type { Conversation as Thread, Message, ToolCall } from '../../../../../shared/types';
import { useApp } from '../../../state';
import { MessageView, visibleUserText } from '../../../chat/MessageView';
import { PendingApprovals } from '../../../chat/PendingApprovals';
import { ColleagueCard } from './ColleagueCard';

/** Colleagues' answers get their own card in the thread. */
const officeToolCard = (call: ToolCall) =>
  call.name === 'ask_colleague' ? <ColleagueCard call={call} /> : null;

/** The whole thread with the selected coworker, following new output unless the user scrolled up. */
export function Conversation({
  agentName,
  conversation,
  pendingTask
}: {
  agentName: string;
  conversation: Thread | undefined;
  /** A task that was just sent; shown until the saved thread includes it. */
  pendingTask?: string;
}) {
  const allMessages = useApp((s) => s.data?.messages);
  const approvals = useApp((s) => s.pendingApprovals);
  const messages = useMemo(() => {
    if (!conversation) return [];
    const thread = (allMessages ?? []).filter((m) => m.conversationId === conversation.id);
    // Tool results are shown on the call that asked for them, not as messages of their own.
    const outcomes = new Map(thread.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m]));
    return thread
      .filter((m) => m.role !== 'system' && m.role !== 'tool')
      .map((m) =>
        m.toolCalls?.some((tc) => !tc.result && !tc.error && outcomes.has(tc.id))
          ? {
              ...m,
              toolCalls: m.toolCalls.map((tc) => {
                const outcome = outcomes.get(tc.id);
                if (tc.result || tc.error || !outcome) return tc;
                return outcome.error ? { ...tc, error: outcome.content } : { ...tc, result: outcome.content };
              })
            }
          : m
      );
  }, [allMessages, conversation]);
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
    const streamingAt = messages.findIndex((m) => m.streaming);
    return streamingAt < 0
      ? [...messages, optimistic]
      : [...messages.slice(0, streamingAt), optimistic, ...messages.slice(streamingAt)];
  }, [messages, pendingTask, conversation?.id]);
  const pending = Object.values(approvals).filter((r) => r.conversationId === conversation?.id).length;
  const end = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    follow.current = true;
  }, [conversation?.id]);

  const progress = shown.map((m) => m.content.length + (m.toolCalls?.length ?? 0)).join(',');
  useEffect(() => {
    if (follow.current) end.current?.scrollIntoView({ block: 'end' });
  }, [progress, pending]);

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
            {shown.map((m) => (
              <MessageView key={m.id} message={m} authorName={agentName} renderToolCall={officeToolCard} />
            ))}
            <PendingApprovals conversationId={conversation?.id ?? null} />
          </div>
        </section>
      )}
      <div ref={end} className="office-thread-end" />
    </>
  );
}
