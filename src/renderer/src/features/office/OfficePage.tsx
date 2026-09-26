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
  useEffect(() => {
    useOfficeStore.getState().syncTaskStatuses(tasks ?? []);
  }, [tasks]);
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
