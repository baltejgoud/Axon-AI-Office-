import './workspace.css';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent
} from 'react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { OfficeCanvas } from '../OfficeCanvas';
import { activeThread, withOutcomes } from '../activity/thread';
import { WorkSurface } from './WorkSurface';
import { decideApproval } from '../../../chat/PendingApprovals';

/** Focus is in something you type into. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
import {
  DEFAULT_WORK_SPLIT,
  MAX_OFFICE_SHARE,
  MIN_OFFICE_SHARE,
  clampWorkSplit,
  surfaceOpen,
  workOf,
  type Work
} from './work';

const KEY_STEP = 0.05;
/** Office heights (px) below which it lays itself out more tightly; see workspace.css. */
const OFFICE_SIZES = [
  ['compact', 700],
  ['tight', 540],
  ['tiny', 380]
] as const;

/**
 * A persistent office with a floating work sheet. The sheet opens at 40% height when a coworker
 * first uses a tool; its top edge resizes between 20% and 70%, without resizing the canvas.
 */
export function OfficeWorkspace() {
  const root = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  const selectedAgentId = useOfficeStore((s) => s.selectedAgentId);
  const runtime = useOfficeStore((s) => s.agentRuntime[s.selectedAgentId]);
  const fullscreen = useOfficeStore((s) => s.workFullscreen);
  const split = useOfficeStore((s) => s.workSplit);
  const choices = useOfficeStore((s) => s.workChoice);
  const focus = useOfficeStore((s) => s.workFocus);
  const conversations = useApp((s) => s.data?.conversations);
  const allMessages = useApp((s) => s.data?.messages);
  const tasks = useApp((s) => s.data?.tasks);
  /** The project open in the app, where office coworkers work unless their conversation has a folder. */
  const openProject = useApp((s) => s.data?.projectRoot);
  const approvals = useApp((s) => s.pendingApprovals);
  const agent = OFFICE_AGENTS.find((a) => a.id === selectedAgentId) ?? OFFICE_AGENTS[0];
  const conversation = activeThread(conversations ?? [], agent.id, runtime);
  const messages = useMemo(
    () =>
      conversation
        ? withOutcomes((allMessages ?? []).filter((m) => m.conversationId === conversation.id))
        : [],
    [allMessages, conversation]
  );
  const work = useMemo(
    () =>
      workOf(
        messages,
        Object.values(approvals).filter((request) => request.conversationId === conversation?.id)
      ),
    [messages, approvals, conversation?.id]
  );

  // The current run: from its task record while there is one, else from your last message.
  const task = conversation
    ? tasks?.find((t) => t.kind === 'work' && t.conversationId === conversation.id)
    : undefined;
  const runStarted =
    task?.runStartedAt ?? [...messages].reverse().find((m) => m.role === 'user')?.createdAt ?? 0;
  const run = String(runStarted);
  const asking = Object.values(approvals).some((r) => r.conversationId === conversation?.id);
  const live = task?.status === 'working' || asking || work.latest?.state === 'running';
  const workingNow = live && work.steps.some((step) => step.at >= runStarted);
  // Watching: they used a tool in a live run while selected. That keeps the surface open after the
  // run ends, until you pick someone else.
  const watched = useRef<string | null>(null);
  if (watched.current !== conversation?.id) watched.current = null;
  if (workingNow && conversation) watched.current = conversation.id;
  const open = surfaceOpen({
    hasWork: Boolean(conversation),
    watched: watched.current !== null,
    run,
    choice: conversation ? choices[conversation.id] : undefined
  });
  // The surface keeps showing what it had while it slides away.
  const last = useRef<{ work: Work; agentId: string; conversationId: string; project: string | null } | null>(
    null
  );
  if (open && conversation)
    last.current = {
      work,
      agentId: agent.id,
      conversationId: conversation.id,
      project: conversation.projectRoot ?? openProject ?? null
    };
  const shown = last.current;
  useEffect(() => {
    if (!open) useOfficeStore.getState().setWorkFullscreen(false);
  }, [open]);
  // A closed surface takes no clicks or focus while it is out of sight.
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (slot.current) slot.current.inert = !open;
  }, [open]);

  /** The persistent viewport, used only for window-size density hints. */
  const office = () => root.current?.querySelector<HTMLElement>(':scope > .office-viewport') ?? null;
  // The legacy share value now controls only the sheet's top edge.
  useLayoutEffect(() => {
    root.current?.style.setProperty('--sheet-share', String(split));
  }, [split]);

  // A shorter office keeps its floor in view: the heading and team strip slim down, then step aside.
  useEffect(() => {
    const element = office();
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const height = element.clientHeight;
      const size = OFFICE_SIZES.filter(([, below]) => height < below)
        .map(([name]) => name)
        .join(' ');
      if (root.current && root.current.dataset.officeSize !== size) root.current.dataset.officeSize = size;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const setWork = (show: boolean) => {
    if (conversation) useOfficeStore.getState().setWorkChoice(conversation.id, show, run);
  };
  // A file or command picked in the side panel opens the surface on it.
  useEffect(() => {
    if (focus && conversation && focus.conversationId === conversation.id)
      useOfficeStore.getState().setWorkChoice(conversation.id, true, run);
    // Only a new request opens it; the run moving on doesn't.
  }, [focus]);

  // Ctrl+J shows or hides their work. Ctrl+Enter approves the step the surface shows waiting, when
  // you aren't typing (a text box keeps Ctrl+Enter for itself, as the commit message does).
  const keys = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    const office = useOfficeStore.getState();
    if (event.defaultPrevented || office.commandPaletteOpen || office.activityHistoryOpen || office.overlay)
      return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() === 'j' && conversation && work.latest) {
      event.preventDefault();
      setWork(!open);
    } else if (event.key === 'Enter' && open && !typing(event.target)) {
      const ids = new Set(work.steps.map((step) => step.id));
      const waiting = Object.values(approvals).filter((r) => ids.has(r.toolCallId));
      const request = waiting.find((r) => r.toolCallId === work.latest?.id) ?? waiting[0];
      if (!request) return;
      event.preventDefault();
      decideApproval(request, true);
    }
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** The office's share for a pointer at `y`, keeping the grab point under the pointer. */
  const drag = useRef<{ offset: number; share: number } | null>(null);
  const shareAt = (y: number) => {
    const box = root.current!.getBoundingClientRect();
    const space = box.height - (divider.current?.offsetHeight ?? 0);
    return clampWorkSplit(space > 0 ? (y - drag.current!.offset - box.top + 20) / space : split);
  };
  // Preview the sheet height directly; publish the share to the store once, on release.
  const preview = (share: number) => {
    drag.current!.share = share;
    root.current?.style.setProperty('--sheet-share', String(share));
    divider.current!.setAttribute('aria-valuenow', String(Math.round(share * 100)));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { offset: event.clientY - event.currentTarget.getBoundingClientRect().top, share: split };
    setResizing(true);
    useOfficeStore.getState().setResizingWork(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) preview(shareAt(event.clientY));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    // Where it was let go, even if the last move before that was folded into an earlier frame.
    if (event.type === 'pointerup') preview(shareAt(event.clientY));
    useOfficeStore.getState().setWorkSplit(drag.current.share);
    drag.current = null;
    setResizing(false);
    useOfficeStore.getState().setResizingWork(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowUp'
        ? split - KEY_STEP
        : event.key === 'ArrowDown'
          ? split + KEY_STEP
          : event.key === 'Home'
            ? MIN_OFFICE_SHARE
            : event.key === 'End'
              ? MAX_OFFICE_SHARE
              : event.key === 'Enter'
                ? DEFAULT_WORK_SPLIT
                : null;
    if (next === null) return;
    event.preventDefault();
    useOfficeStore.getState().setWorkSplit(next);
  };

  return (
    <div
      ref={root}
      className={`office-workspace${open ? ' has-work' : ''}${resizing ? ' is-resizing' : ''}${fullscreen && open ? ' work-fullscreen' : ''}`}
    >
      <OfficeCanvas work={conversation ? { open, toggle: () => setWork(!open) } : undefined} />
      <div
        ref={divider}
        className="work-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize work sheet"
        aria-valuemin={MIN_OFFICE_SHARE * 100}
        aria-valuemax={MAX_OFFICE_SHARE * 100}
        aria-valuenow={Math.round(split * 100)}
        aria-valuetext={`Work sheet ${100 - Math.round(split * 100)}%`}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        title="Drag to resize · double-click for 60/40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => useOfficeStore.getState().setWorkSplit(DEFAULT_WORK_SPLIT)}
        onKeyDown={onKeyDown}
      >
        <span className="work-divider-grip" />
      </div>
      <div
        ref={slot}
        className="work-surface-slot"
        data-office-obstacle={open || undefined}
        aria-hidden={!open}
      >
        {shown && (
          <WorkSurface
            key={shown.conversationId}
            work={shown.work}
            agentId={shown.agentId}
            conversationId={shown.conversationId}
            project={shown.project}
            focus={focus?.conversationId === shown.conversationId ? focus : null}
            onClose={() => setWork(false)}
          />
        )}
      </div>
    </div>
  );
}
