import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ActivityPanel } from '../activity/ActivityPanel';
import { DRAWER_WIDTH, useOfficeStore } from '../store/officeStore';

/** Arrow keys on the handle move the edge this far. */
const KEY_STEP = 32;

export function ConversationDrawer() {
  const open = useOfficeStore((s) => s.conversationOpen);
  const { width, side } = useOfficeStore((s) => s.drawer);
  const [resizing, setResizing] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (root.current) root.current.inert = !open;
    if (!open && root.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement)?.blur();
    }
  }, [open]);

  const setWidth = (next: number) => useOfficeStore.getState().setDrawer({ width: next });
  // The panel never takes the whole office: at least 120px of it stays in view beside it.
  const room = () => Math.min(DRAWER_WIDTH.max, window.innerWidth - 120);
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = root.current?.getBoundingClientRect().width ?? width;
    setResizing(true);
    const move = (e: globalThis.PointerEvent) => {
      // Docked right, the handle is on the left edge: moving left widens it. Docked left, the opposite.
      const delta = side === 'right' ? startX - e.clientX : e.clientX - startX;
      setWidth(Math.min(room(), startWidth + delta));
    };
    const end = () => {
      setResizing(false);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  const keyResize = (event: KeyboardEvent<HTMLDivElement>) => {
    const wider = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
    const narrower = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === wider) setWidth(Math.min(room(), width + KEY_STEP));
    else if (event.key === narrower) setWidth(width - KEY_STEP);
    else if (event.key === 'Home') setWidth(DRAWER_WIDTH.min);
    else if (event.key === 'End') setWidth(room());
    else return;
    event.preventDefault();
  };

  return (
    <aside
      ref={root}
      className={`conversation-drawer dock-${side}${open ? ' is-open' : ''}${resizing ? ' is-resizing' : ''}`}
      data-office-obstacle={open || undefined}
      aria-label="Coworker conversation"
      aria-hidden={!open}
    >
      <div
        className="drawer-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the conversation panel"
        aria-valuemin={DRAWER_WIDTH.min}
        aria-valuemax={DRAWER_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(DRAWER_WIDTH.initial)}
        onKeyDown={keyResize}
      />
      <button
        className="drawer-close"
        onClick={() => useOfficeStore.getState().closeConversation()}
        aria-label="Close conversation"
      >
        ×
      </button>
      <ActivityPanel />
    </aside>
  );
}
