import { useEffect, useRef } from 'react';
import { ActivityPanel } from '../activity/ActivityPanel';
import { useOfficeStore } from '../store/officeStore';

export function ConversationDrawer() {
  const open = useOfficeStore((s) => s.conversationOpen);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (root.current) root.current.inert = !open;
    if (!open && root.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement)?.blur();
    }
  }, [open]);
  return (
    <aside
      ref={root}
      className={`conversation-drawer${open ? ' is-open' : ''}`}
      data-office-obstacle={open || undefined}
      aria-label="Coworker conversation"
      aria-hidden={!open}
    >
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
