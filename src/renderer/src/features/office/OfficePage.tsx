import './office.css';
import { useEffect, type CSSProperties } from 'react';
import { useApp } from '../../state';
import { OfficeWorkspace } from './workspace/OfficeWorkspace';
import { ConversationDrawer } from './shell/ConversationDrawer';
import './office-first.css';
import './polish.css';
import { Overlay } from './shell/Overlay';
import { useOfficeStore } from './store/officeStore';
import { derivePresence } from './presence';
import { SettingsPanel } from '../../Settings';
import { Knowledge } from '../../Knowledge';
import { CompanyOperations } from './company/CompanyOperations';
import { DashboardsSheet } from './dashboards/DashboardsSheet';
import { CommandPalette } from './shell/CommandPalette';
import { ApprovalOverlay } from './shell/ApprovalOverlay';
import { OfficeNotifications } from './shell/OfficeNotifications';
import { WelcomeGuide, firstStart } from './shell/WelcomeGuide';

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
  // People look the way their runs say, including runs started before this window opened: working,
  // needing you, just finished (for a short while after, so the celebration and the green strip
  // can show), or failed. A badge or the finished status that runs out by itself is looked at again
  // when it does.
  const tasks = useApp((s) => s.data?.tasks);
  const runs = useApp((s) => s.data?.runs);
  const conversations = useApp((s) => s.data?.conversations);
  const approvals = useApp((s) => s.pendingApprovals);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const office = useOfficeStore.getState();
      if (!runs) return office.syncTaskStatuses(tasks ?? []);
      const presence = derivePresence({
        agentIds: Object.keys(office.agentRuntime),
        runs,
        tasks: tasks ?? [],
        conversations: conversations ?? [],
        approvals: Object.values(approvals),
        now: Date.now()
      });
      office.applyPresence(presence.statuses, presence.beacons);
      if (presence.nextChange !== null) timer = setTimeout(apply, Math.max(50, presence.nextChange - Date.now() + 25));
    };
    apply();
    return () => clearTimeout(timer);
  }, [tasks, runs, conversations, approvals]);
  // Someone's first start: the welcome guide opens by itself (once; Ctrl+K brings it back).
  const welcome = useApp((s) => firstStart(s.data));
  useEffect(() => {
    if (welcome) useOfficeStore.getState().setWelcomeOpen(true);
  }, [welcome]);
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
      <WelcomeGuide />
      {overlay === 'company' && (
        <Overlay title="Company operations" onClose={close} wide>
          <CompanyOperations />
        </Overlay>
      )}
      {overlay === 'dashboards' && (
        <Overlay title="Dashboards" onClose={close} wide flush className="dashboards">
          <DashboardsSheet />
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
