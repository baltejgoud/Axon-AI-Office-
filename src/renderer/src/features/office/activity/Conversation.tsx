import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { runStage } from '../../../../../shared/runtimePresentation';
import { ACTIVE_RUN_STATUSES } from '../../../../../shared/runtime';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Conversation as Thread, Message, ToolCall } from '../../../../../shared/types';
import { perform, useApp } from '../../../state';
import { MessageView, visibleUserText } from '../../../chat/MessageView';
import { PendingApprovals } from '../../../chat/PendingApprovals';
import { ColleagueCard } from './ColleagueCard';
import { PlannerToolCard } from './PlannerToolCard';
import { TeamCard } from './TeamCard';
import { isPlannerCall } from '../tasks';
import { withOutcomes } from './thread';
import { WorkSummary } from './WorkSummary';
import { isWorkCall, onlyWork, threadRuns, workOf } from '../workspace/work';
import { IconBell, IconCaretDown, IconLoader } from '../../../ui';
import { elapsed } from '../../../format';
import type { AgentRun } from '../../../../../shared/runtime';
import { sections, worthReading } from '../../../chat/reading';

/**
 * Colleagues' answers and the receptionist's planner changes get their own cards in the thread;
 * work (files, commands, pages, tools) is summed up once per run instead.
 */
const officeToolCard = (call: ToolCall, at: number) =>
  call.name === 'ask_colleague' ? (
    <ColleagueCard call={call} />
  ) : call.name === 'call_team_meeting' ? (
    <TeamCard call={call} />
  ) : call.name === 'find_people' ? (
    false
  ) : isPlannerCall(call) ? (
    <PlannerToolCard call={call} />
  ) : isWorkCall(call, at) ? (
    false
  ) : null;

/**
 * What the run is doing, and for how long, with a way to walk away: "Notify me when done" sends a
 * desktop notice when it ends, however it ends.
 */
function RunStage({ run, conversationId }: { run: AgentRun; conversationId: string }) {
  const [, tick] = useState(0);
  const [notify, setNotify] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="chat-run-stage" role="status">
      <IconLoader className="spin" size={14} />
      <span>{runStage(run)}</span>
      <span className="chat-run-elapsed" aria-label="Time so far">
        {elapsed(run.startedAt)}
      </span>
      <button
        type="button"
        className="chat-run-notify"
        aria-pressed={notify}
        title={notify ? 'You’ll get a notice when this ends' : 'Get a desktop notice when this ends'}
        onClick={() =>
          void perform(async () => setNotify(await window.axon.chatNotifyWhenDone(conversationId, !notify)))
        }
      >
        <IconBell size={13} />
        {notify ? 'Will notify you' : 'Notify me when done'}
      </button>
    </div>
  );
}

/** The whole thread with the selected coworker, following new output unless the user scrolled up. */
export function Conversation({
  agentName,
  conversation,
  pendingTask,
  working,
  shown: visible = true,
  onContinue,
  scrollParent,
  jumpSlot
}: {
  agentName: string;
  conversation: Thread | undefined;
  /** Asks them to carry on after a reply that stopped early. */
  onContinue?: () => void;
  /** The panel's scroll area: the thread scrolls with it, so there is one scrollbar, not two. */
  scrollParent: HTMLElement | null;
  /** Where "Latest messages" goes: a row of its own under the thread, never over its last lines. */
  jumpSlot: HTMLElement | null;
  /** A task that was just sent; shown until the saved thread includes it. */
  pendingTask?: string;
  /** The coworker is working on this thread now. */
  working: boolean;
  /** The chat tab is showing; coming back to it picks up at the newest message again. */
  shown?: boolean;
}) {
  const activeRun = useApp((s) =>
    s.data?.runs?.findLast((r) => r.conversationId === conversation?.id && ACTIVE_RUN_STATUSES.has(r.status))
  );
  const allMessages = useApp((s) => s.data?.messages);
  const historyEpoch = useRef(0);
  const [history, setHistory] = useState<Message[]>([]);
  const [nextBefore, setNextBefore] = useState<number>();
  const [historyError, setHistoryError] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const list = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    let disposed = false;
    historyEpoch.current++;
    setLoadingHistory(false);
    setHistory([]);
    setNextBefore(undefined);
    setHistoryError('');
    if (conversation)
      void window.axon
        .chatHistoryPage(conversation.id)
        .then((page) => {
          if (!disposed) {
            setHistory(page.messages);
            setNextBefore(page.nextBefore);
          }
        })
        .catch((error) => {
          if (!disposed) setHistoryError(String(error));
        });
    return () => {
      disposed = true;
    };
  }, [conversation?.id]);
  const loadEarlier = async () => {
    if (!conversation || nextBefore === undefined || loadingHistory) return;
    setLoadingHistory(true);
    const epoch = historyEpoch.current;
    try {
      const page = await window.axon.chatHistoryPage(conversation.id, nextBefore);
      if (epoch !== historyEpoch.current) return;
      setHistory((previous) => [...page.messages, ...previous]);
      setNextBefore(page.nextBefore);
    } catch (error) {
      if (epoch === historyEpoch.current) setHistoryError(String(error));
    } finally {
      if (epoch === historyEpoch.current) setLoadingHistory(false);
    }
  };
  const approvals = useApp((s) => s.pendingApprovals);
  // When the current run began: the task you sent goes just before what it produced.
  const runStartedAt = useApp(
    (s) => s.data?.tasks.find((t) => t.kind === 'work' && t.conversationId === conversation?.id)?.runStartedAt
  );
  const messages = useMemo(
    () =>
      conversation
        ? withOutcomes([
            ...new Map(
              [...history, ...(allMessages ?? []).filter((m) => m.conversationId === conversation.id)].map(
                (m) => [m.id, m]
              )
            ).values()
          ])
        : [],
    [allMessages, conversation, history]
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
  const longReply = shown.findLast((m) => m.role === 'assistant' && worthReading(m.content));
  const contents = useMemo(() => sections(longReply?.content ?? ''), [longReply?.content]);
  const jumpToSection = (id: string) => {
    if (!longReply || !scrollParent) return;
    follow.current = false;
    list.current?.scrollToIndex({ index: shown.indexOf(longReply), align: 'start' });
    // Virtualized replies mount after the list moves to their item.
    let attempts = 0;
    const findHeading = () => {
      if (!scrollParent.isConnected) return;
      const message = scrollParent.querySelector(`[data-message-id="${CSS.escape(longReply.id)}"]`);
      const heading = message?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      if (heading) {
        scrollParent.scrollBy({
          top: heading.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top - 12
        });
      } else if (++attempts < 30) requestAnimationFrame(findHeading);
    };
    requestAnimationFrame(findHeading);
  };
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
      {visible &&
        contents.length > 1 &&
        jumpSlot &&
        createPortal(
          <details className="thread-scrub">
            <summary>Reply sections ({contents.length})</summary>
            <nav aria-label="Reply sections">
              {contents.map((section) => (
                <button key={section.id} title={section.title} onClick={() => jumpToSection(section.id)}>
                  {section.title}
                </button>
              ))}
            </nav>
          </details>,
          jumpSlot
        )}
      {(shown.length > 0 || pending > 0) && (
        <section className="office-thread" aria-label={`Conversation with ${agentName}`}>
          <div className="messages">
            {nextBefore !== undefined && (
              <button disabled={loadingHistory} onClick={() => void loadEarlier()}>
                {loadingHistory ? 'Loading history...' : 'Load earlier messages'}
              </button>
            )}
            {historyError && <p role="alert">{historyError}</p>}
            {scrollParent && (
              <Virtuoso
                key={conversation?.id ?? 'new'}
                ref={list}
                customScrollParent={scrollParent}
                data={shown}
                computeItemKey={(_, m) => m.id}
                followOutput="auto"
                atBottomStateChange={setAtBottom}
                atBottomThreshold={80}
                initialTopMostItemIndex={Math.max(0, shown.length - 1)}
                itemContent={(i, m) => {
                  const steps = summaries.get(i);
                  return (
                    <Fragment key={m.id}>
                      {!onlyWork(m) && (
                        <MessageView
                          message={m}
                          authorName={agentName}
                          renderToolCall={(call) => officeToolCard(call, m.createdAt)}
                          onContinue={i === lastEnd && !live ? onContinue : undefined}
                          folder={conversation?.projectRoot}
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
                }}
              />
            )}
            {!atBottom &&
              jumpSlot &&
              createPortal(
                <button
                  type="button"
                  className="chat-jump"
                  onClick={() => {
                    follow.current = true;
                    list.current?.scrollToIndex({ index: 'LAST', align: 'end' });
                    // Then past the list: an approval or the run's progress may sit under it.
                    requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'end' }));
                  }}
                >
                  <IconCaretDown size={13} />
                  Latest messages
                </button>,
                jumpSlot
              )}
            {activeRun && conversation && <RunStage run={activeRun} conversationId={conversation.id} />}
            <PendingApprovals conversationId={conversation?.id ?? null} />
          </div>
        </section>
      )}
      <div ref={end} className="office-thread-end" />
    </>
  );
}
