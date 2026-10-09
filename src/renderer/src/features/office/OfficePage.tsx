import { ACTIVE_RUN_STATUSES } from '../../../../shared/runtime';
import './office.css';
import { useEffect, type CSSProperties } from 'react';
import { useApp } from '../../state';
import { OfficeWorkspace } from './workspace/OfficeWorkspace';
import { ConversationDrawer } from './shell/ConversationDrawer';
import './office-first.css';
import './polish.css';
import { Overlay } from './shell/Overlay';
import { useOfficeStore } from './store/officeStore';
import { SettingsPanel } from '../../Settings';
import { Knowledge } from '../../Knowledge';
import { CompanyOperations } from './company/CompanyOperations';
import { CommandPalette } from './shell/CommandPalette';
import { ApprovalOverlay } from './shell/ApprovalOverlay';
import { OfficeNotifications } from './shell/OfficeNotifications';

export function OfficePage() {
  const overlay = useOfficeStore((s) => s.overlay);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Menus, editors and dialogs consume Escape first. Close only one office layer. The check waits
      // for the whole key event: with a real key press a microtask would run before a layer's own
      // listener had marked the key as used, and close the conversation under it too.
      setTimeout(() => {
        if (event.defaultPrevented || useOfficeStore.getState().overlay) return;
        const office = useOfficeStore.getState();
        if (office.commandPaletteOpen) office.setCommandPaletteOpen(false);
        else if (office.workFullscreen) office.setWorkFullscreen(false);
        else if (office.coworkerCard) office.closeCoworkerCard();
        else if (office.conversationOpen) office.closeConversation();
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // People look the way their task records say, including runs started before this window opened.
  const tasks = useApp((s) => s.data?.tasks);
  const runs = useApp((s) => s.data?.runs);
  useEffect(() => {
    const office = useOfficeStore.getState();
    if (!runs) office.syncTaskStatuses(tasks ?? []);
    if (runs)
      for (const id of Object.keys(office.agentRuntime)) {
        const current = runs.filter((r) => r.agentId === id && ACTIVE_RUN_STATUSES.has(r.status));
        const run = current.at(-1);
        office.setAgentStatus(
          id,
          run
            ? run.status.startsWith('waiting') || run.status === 'queued'
              ? 'waiting'
              : 'working'
            : runs.filter((r) => r.agentId === id).at(-1)?.status === 'failed'
              ? 'error'
              : 'idle'
        );
      }
  }, [tasks, runs]);
  const close = () => useOfficeStore.getState().openOverlay(null);
  // The panel's width and side, for everything that makes room for it.
  const drawer = useOfficeStore((s) => s.drawer);
  return (
    <div
      className="office-container"
      data-drawer-side={drawer.side}
      style={{ '--drawer-width': `${drawer.width}px` } as CSSProperties}
    >
      <OfficeWorkspace />
      <ConversationDrawer />
      <ApprovalOverlay />
      <OfficeNotifications />
      <CommandPalette />
      {overlay === 'company' && (
        <Overlay title="Company operations" onClose={close} wide>
          <CompanyOperations />
        </Overlay>
      )}
      {overlay === 'settings' && (
        <Overlay title="Settings" onClose={close} wide flush>
          <SettingsPanel />
        </Overlay>
      )}
      {overlay === 'knowledge' && (
        <Overlay title="Library" onClose={close} wide>
          <Knowledge />
        </Overlay>
      )}
    </div>
  );
}
