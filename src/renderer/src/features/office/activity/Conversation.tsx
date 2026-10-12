import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { runStage } from '../../../../../shared/runtimePresentation';
import { ACTIVE_RUN_STATUSES } from '../../../../../shared/runtime';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Conversation as Thread, Message, ToolCall } from '../../../../../shared/types';
import { perform, useApp } from '../../../state';
import { MessageView, visibleUserText } from '../../../chat/MessageView';
import { RetryRow } from '../../../chat/RetryRow';
import { useRewrites } from '../../../chat/rewrites';
import { filesChangedAfter, isTeamTask, writtenByYou } from '../../../../../shared/rewrite';
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
import { useOfficeStore } from '../store/officeStore';
import { ThreadRail } from '../../../chat/ThreadRail';
import { conversationCost, formatTokens, formatUsd, type ConversationCost } from '../../../../../shared/cost';

/** Under a finished task: what it cost on priced models, otherwise the tokens it used. */
function RunCost({ cost }: { cost: ConversationCost }) {
  const tokens = `${formatTokens(cost.promptTokens + cost.completionTokens)} tokens`;
  const detail = [
    `${formatTokens(cost.promptTokens)} tokens in, ${formatTokens(cost.completionTokens)} out.`,
    cost.priced
      ? cost.unpriced
        ? 'Some replies used a model without a price and are not in the dollar figure.'
        : ''
      : 'No price is set for this model, so tokens only (Settings → Models).'
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <p className="run-cost" title={detail}>
      This task: {cost.priced ? `${formatUsd(cost.actual)} · ${tokens}` : tokens}
    </p>
  );
}

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
  /** The first page of saved history has arrived (or failed), so a message not found is truly older. */
  const [historyReady, setHistoryReady] = useState(false);
  const list = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  /** Changes when a retry or an edit cuts this conversation back: the history loaded so far is out of date. */
  const rewrites = useRewrites((s) => s.epochs[conversation?.id ?? ''] ?? 0);
  useEffect(() => {
    let disposed = false;
    historyEpoch.current++;
    setLoadingHistory(false);
    setHistoryReady(false);
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
            setHistoryReady(true);
          }
        })
        .catch((error) => {
          if (!disposed) {
            setHistoryError(String(error));
            setHistoryReady(true);
          }
        });
    return () => {
      disposed = true;
    };
  }, [conversation?.id, rewrites]);
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
  // What each finished run cost, shown after its last message.
  const providers = useApp((s) => s.data?.providers);
  const runCosts = useMemo(
    () =>
      new Map(
        threadRuns(shown).flatMap((run) => {
          if (run.messages.some((m) => m.streaming)) return [];
          const cost = conversationCost(run.messages, providers ?? []);
          return cost.promptTokens + cost.completionTokens > 0 ? [[run.end, cost] as const] : [];
        })
      ),
    [shown, providers]
  );
  const lastEnd = shown.length - 1;
  const live = working || pending > 0;

  // Retry and Edit rewrite the thread, so they wait until nothing is running, and never touch a team member's task.
  const teams = useApp((s) => s.data?.teams);
  const [rewriting, setRewriting] = useState(false);
  const rewritable =
    Boolean(conversation) &&
    !isTeamTask(teams ?? [], conversation?.id ?? '') &&
    !live &&
    !rewriting &&
    !activeRun &&
    !shown.some((m) => m.streaming);
  const lastUserAt = shown.findLastIndex((m) => m.role === 'user');
  const lastShownAt = shown.findLastIndex((m) => !onlyWork(m));
  /** Under the last finished reply to something you wrote yourself. */
  const retryAt =
    rewritable &&
    lastUserAt >= 0 &&
    lastUserAt < lastShownAt &&
    shown[lastShownAt].role === 'assistant' &&
    writtenByYou(shown[lastUserAt]) &&
    shown[lastUserAt].id !== 'pending-task'
      ? lastShownAt
      : -1;
  /** Cuts the thread back and runs it again; false when it was refused (the error is on screen). */
  const rewrite = async (
    start: (conversationId: string) => Promise<void>,
    words: string
  ): Promise<boolean> => {
    if (!conversation) return false;
    let accepted = true;
    setRewriting(true);
    // The same footing as a send: the answer arrives in the chat, for the words just sent.
    if (conversation.agentId) {
      useOfficeStore.getState().setLastResponse(conversation.agentId, '');
      useOfficeStore.getState().setAgentTask(conversation.agentId, words);
    }
    await perform(async () => {
      try {
        await start(conversation.id);
      } catch (error) {
        accepted = false;
        throw error;
      }
    });
    setRewriting(false);
    return accepted;
  };
  const retry = () => {
    const asked = shown[lastUserAt];
    if (asked) void rewrite((id) => window.axon.chatRetry(id), visibleUserText(asked.content));
  };
  const editNote = (at: number) => {
    if (!shown.slice(at + 1).some((m) => m.role === 'assistant')) return undefined;
    return filesChangedAfter(shown, at + 1) > 0
      ? 'Replies after this message will be replaced. Files your coworkers changed stay changed — use Undo to roll them back.'
      : 'Replies after this message will be replaced.';
  };
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

  // A search result opened this thread at one message: load older pages until it's there, then go to it
  // and mark it for a moment. A thread that just opened settles at its newest message a few frames
  // later, so this keeps going back until the message has stayed in view.
  const reveal = useOfficeStore((s) => s.reveal);
  useEffect(() => {
    if (!reveal || reveal.conversationId !== conversation?.id || !scrollParent || !historyReady) return;
    const index = shown.findIndex((m) => m.id === reveal.messageId);
    if (index < 0) {
      if (nextBefore !== undefined) {
        if (!loadingHistory) void loadEarlier();
      } else useOfficeStore.getState().revealMessage(null);
      return;
    }
    let frame = 0;
    let attempts = 0;
    let steady = 0;
    const done = () => useOfficeStore.getState().revealMessage(null);
    const go = () => {
      if (!scrollParent.isConnected) return;
      if (++attempts > 120) return done();
      const element = scrollParent.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(reveal.messageId)}"]`
      );
      const box = scrollParent.getBoundingClientRect();
      const rect = element?.getBoundingClientRect();
      const inView = !!rect && rect.top >= box.top - 2 && rect.top < box.bottom - 40;
      steady = inView ? steady + 1 : 0;
      if (element && steady >= 4 && attempts > 8) {
        element.classList.add('message-revealed');
        setTimeout(() => element.classList.remove('message-revealed'), 2400);
        return done();
      }
      if (!inView && attempts % 6 === 1) {
        follow.current = false;
        list.current?.scrollToIndex({ index, align: 'start', offset: -12 });
      }
      frame = requestAnimationFrame(go);
    };
    frame = requestAnimationFrame(go);
    return () => cancelAnimationFrame(frame);
  }, [reveal, shown, historyReady, nextBefore, loadingHistory, scrollParent, conversation?.id]);

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
                  const cost = i === lastEnd && live ? undefined : runCosts.get(i);
                  const editable = rewritable && writtenByYou(m) && m.id !== 'pending-task';
                  return (
                    <Fragment key={m.id}>
                      {!onlyWork(m) && (
                        <MessageView
                          message={m}
                          authorName={agentName}
                          renderToolCall={(call) => officeToolCard(call, m.createdAt)}
                          onContinue={i === lastEnd && !live ? onContinue : undefined}
                          onEdit={
                            editable
                              ? (words) => rewrite((id) => window.axon.chatEdit(id, m.id, words), words)
                              : undefined
                          }
                          editNote={editable ? editNote(i) : undefined}
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
                      {cost && <RunCost cost={cost} />}
                      {i === retryAt && (
                        <RetryRow filesChanged={filesChangedAfter(shown, lastUserAt + 1)} onRetry={retry} />
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
            <ThreadRail
              messages={shown}
              list={list}
              scrollParent={scrollParent}
              agentName={agentName}
              shown={visible}
            />
            {activeRun && conversation && <RunStage run={activeRun} conversationId={conversation.id} />}
            <PendingApprovals conversationId={conversation?.id ?? null} />
          </div>
        </section>
      )}
      <div ref={end} className="office-thread-end" />
    </>
  );
}
