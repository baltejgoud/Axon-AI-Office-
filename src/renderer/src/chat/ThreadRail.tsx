import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject
} from 'react';
import { createPortal } from 'react-dom';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../../../shared/types';
import { visibleUserText } from '../../../shared/user-text';
import './threadRail.css';

/** A thread shorter than this many screens scrolls well enough without the rail. */
const LONG_THREAD_SCREENS = 2.5;

/**
 * Each message's share of the rail, roughly its height: long replies get long stretches, so dragging
 * through one moves through its text rather than jumping past it. The list is virtualized, so real
 * heights are only known for what is on screen.
 */
const weightOf = (m: Message) => 2 + (m.content.length + (m.toolCalls?.length ?? 0) * 120) / 90;

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * A scrub bar beside a long conversation: drag it to move through the whole thread, with a label
 * saying whose message you're on; marks show where you asked something. It stands in for the panel's
 * own scrollbar while the thread is long.
 */
export function ThreadRail({
  messages,
  list,
  scrollParent,
  agentName,
  shown
}: {
  messages: readonly Message[];
  list: RefObject<VirtuosoHandle>;
  scrollParent: HTMLElement | null;
  agentName: string;
  /** The chat tab is showing. */
  shown: boolean;
}) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [long, setLong] = useState(false);
  const [position, setPosition] = useState(1);
  const [label, setLabel] = useState<{ at: number; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(null);

  const layout = useMemo(() => {
    const starts: number[] = [];
    let total = 0;
    for (const m of messages) {
      starts.push(total);
      total += weightOf(m);
    }
    return { starts, total: Math.max(total, 1) };
  }, [messages]);
  const marks = useMemo(
    () =>
      messages.flatMap((m, i) =>
        m.role === 'user' ? [{ id: m.id, at: layout.starts[i] / layout.total }] : []
      ),
    [messages, layout]
  );

  /** The message at a point on the rail (0 top, 1 bottom), and how far into it. */
  const messageAt = (at: number) => {
    const target = Math.min(Math.max(at, 0), 1) * layout.total;
    let index = layout.starts.length - 1;
    while (index > 0 && layout.starts[index] > target) index--;
    const weight = weightOf(messages[index]);
    return { index, within: Math.min(1, Math.max(0, (target - layout.starts[index]) / weight)) };
  };
  const describe = (index: number) => {
    const m = messages[index];
    if (!m) return '';
    const who = m.role === 'user' ? 'You' : agentName;
    const words = (m.role === 'user' ? visibleUserText(m.content) : m.content)
      .replace(/[#*_`>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `${who} · ${timeOf(m.createdAt)}${words ? ` — ${words.slice(0, 48)}${words.length > 48 ? '…' : ''}` : ''}`;
  };

  // Where the rail sits (over the chat's own area of the panel) and whether the thread is long.
  useEffect(() => {
    if (!scrollParent) return;
    const measure = () => {
      setBox({ top: scrollParent.offsetTop, height: scrollParent.clientHeight });
      setLong(scrollParent.scrollHeight > scrollParent.clientHeight * LONG_THREAD_SCREENS);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollParent);
    for (const child of scrollParent.children) observer.observe(child);
    return () => observer.disconnect();
  }, [scrollParent, messages.length]);

  const active = shown && long && !!box && messages.length > 1;
  // The panel's own scrollbar steps aside while the rail does its job.
  useEffect(() => {
    if (!scrollParent) return;
    scrollParent.classList.toggle('has-thread-rail', active);
    return () => scrollParent.classList.remove('has-thread-rail');
  }, [scrollParent, active]);

  // The thumb follows the top of what is on screen: which message, and how far into it.
  useEffect(() => {
    if (!scrollParent || !active) return;
    let frame = 0;
    const follow = () => {
      frame = 0;
      const top = scrollParent.getBoundingClientRect().top;
      const index = new Map(messages.map((m, i) => [m.id, i]));
      for (const element of scrollParent.querySelectorAll<HTMLElement>('[data-message-id]')) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= top + 1) continue;
        const i = index.get(element.dataset.messageId ?? '');
        if (i === undefined) continue;
        const within = rect.height ? Math.min(1, Math.max(0, (top - rect.top) / rect.height)) : 0;
        const atEnd = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight < 4;
        setPosition(atEnd ? 1 : (layout.starts[i] + within * weightOf(messages[i])) / layout.total);
        return;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(follow);
    };
    follow();
    scrollParent.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollParent.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollParent, active, messages, layout]);

  /** Goes to a point of the thread: the message there, then as far into it as the point says. */
  const seek = (at: number) => {
    if (!scrollParent) return;
    const run = () => {
      const wanted = pendingSeek.current;
      pendingSeek.current = null;
      if (wanted === null) return;
      if (wanted >= 0.999) {
        scrollParent.scrollTo({ top: scrollParent.scrollHeight });
        return;
      }
      const { index, within } = messageAt(wanted);
      const find = () =>
        scrollParent.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messages[index].id)}"]`);
      const land = (element: HTMLElement) => {
        const offset = element.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top;
        scrollParent.scrollTop += offset + within * element.offsetHeight;
      };
      const element = find();
      if (element) land(element);
      else {
        list.current?.scrollToIndex({ index, align: 'start' });
        requestAnimationFrame(() => {
          const mounted = find();
          if (mounted) land(mounted);
        });
      }
    };
    const first = pendingSeek.current === null;
    pendingSeek.current = at;
    if (first) requestAnimationFrame(run);
  };

  const pointAt = (clientY: number) => {
    const rect = rail.current?.getBoundingClientRect();
    return rect ? Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) : 0;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const at = pointAt(event.clientY);
    setLabel({ at, text: describe(messageAt(at).index) });
    seek(at);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const at = pointAt(event.clientY);
    setLabel({ at, text: describe(messageAt(at).index) });
    if (dragging) seek(at);
  };
  const onPointerEnd = () => {
    setDragging(false);
    setLabel(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Up goes to the start of the message on screen, or the one before when already at its start.
    const { index: current, within } = messageAt(position);
    const next =
      event.key === 'ArrowDown'
        ? Math.min(messages.length - 1, current + 1)
        : event.key === 'ArrowUp'
          ? Math.max(0, within > 0.02 ? current : current - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? messages.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    list.current?.scrollToIndex({ index: next, align: next === messages.length - 1 ? 'end' : 'start' });
  };

  if (!active || !scrollParent?.parentElement || !box) return null;
  const thumb = Math.max(0.04, Math.min(1, scrollParent.clientHeight / scrollParent.scrollHeight));
  return createPortal(
    <div
      ref={rail}
      className={`thread-rail${dragging ? ' is-dragging' : ''}`}
      style={{ top: box.top + 6, height: box.height - 12 }}
      role="scrollbar"
      aria-label="Move through the conversation"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position * 100)}
      aria-valuetext={describe(messageAt(position).index)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={() => !dragging && setLabel(null)}
      onKeyDown={onKeyDown}
    >
      <div className="thread-rail-track">
        {marks.map((mark) => (
          <span key={mark.id} className="thread-rail-mark" style={{ top: `${mark.at * 100}%` }} />
        ))}
        <span
          className="thread-rail-thumb"
          style={{
            height: `${thumb * 100}%`,
            top: `${Math.min(1 - thumb, Math.max(0, position - thumb * position)) * 100}%`
          }}
        />
      </div>
      {label && (
        <span className="thread-rail-label" style={{ top: `${label.at * 100}%` }}>
          {label.text}
        </span>
      )}
    </div>,
    scrollParent.parentElement
  );
}
