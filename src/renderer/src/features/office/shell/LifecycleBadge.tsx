import { runLifecycle } from '../lifecycle';
import type { RunStatus } from '../../../../../shared/runtime';

export function LifecycleBadge({ status }: { status: RunStatus }) {
  const state = runLifecycle(status);
  return (
    <span
      className={`lifecycle-badge is-${state.tone} status-badge ${state.tone === 'attention' ? 'waiting' : state.tone === 'failed' ? 'error' : state.tone}`}
    >
      <span aria-hidden="true" />
      {state.label}
    </span>
  );
}
