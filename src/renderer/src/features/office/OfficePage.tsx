import './office.css';
import { OfficeCanvas } from './OfficeCanvas';
import { ActivityPanel } from './activity/ActivityPanel';

export function OfficePage() {
  return (
    <div className="office-container">
      <OfficeCanvas />
      <ActivityPanel />
    </div>
  );
}
