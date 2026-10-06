import { ACTIVE_RUN_STATUSES } from '../../../../shared/runtime';
import './office.css';
import { useEffect } from 'react';
import { useApp } from '../../state';
import { OfficeWorkspace } from './workspace/OfficeWorkspace';
import { ActivityPanel } from './activity/ActivityPanel';
import { Overlay } from './shell/Overlay';
import { useOfficeStore } from './store/officeStore';
import { SettingsPanel } from '../../Settings';
import { Knowledge } from '../../Knowledge';

export function OfficePage() {
  const overlay = useOfficeStore((s) => s.overlay);
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
  return (
    <div className="office-container">
      <OfficeWorkspace />
      <ActivityPanel />
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
