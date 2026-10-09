import { runLifecycle } from '../lifecycle';
import type { RunStatus } from '../../../../../shared/runtime';

export function LifecycleBadge({ status, stoppedEarly = false }: { status: RunStatus; stoppedEarly?: boolean }) {
  const state = runLifecycle(status, stoppedEarly);
  return (
    <span
      className={`lifecycle-badge is-${state.tone} status-badge ${state.tone === 'attention' ? 'waiting' : state.tone === 'failed' ? 'error' : state.tone}`}
    >
      <span aria-hidden="true" />
      {state.label}
    </span>
  );
}
