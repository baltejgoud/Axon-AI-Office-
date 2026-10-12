import './askCard.css';
import type { ToolRisk } from '../../../shared/toolRisk';

/** What a step could do, as a small label ("Changes files") on an approval card. */
export function RiskLabel({ risk }: { risk: ToolRisk }) {
  return (
    <span className={`approval-risk is-${risk.kind}`} title="What this step could do">
      {risk.label}
    </span>
  );
}
