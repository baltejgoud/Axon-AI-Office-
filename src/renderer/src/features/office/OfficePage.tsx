import './office.css';
import { OfficeCanvas } from './OfficeCanvas';
import { ActivityPanel } from './activity/ActivityPanel';
import { Overlay } from './shell/Overlay';
import { useOfficeStore } from './store/officeStore';
import { SettingsPanel } from '../../Settings';
import { Knowledge } from '../../Knowledge';

export function OfficePage() {
  const overlay = useOfficeStore((s) => s.overlay);
  const close = () => useOfficeStore.getState().openOverlay(null);
  return (
    <div className="office-container">
      <OfficeCanvas />
      <ActivityPanel />
      {overlay === 'settings' && (
        <Overlay title="Settings" onClose={close} wide>
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
