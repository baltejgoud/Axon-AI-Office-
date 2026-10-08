import type { Conversation } from '../../../../../shared/types';
import { useApp } from '../../../state';

export function ContextChip({ conversation }: { conversation: Conversation }) {
  const usage = useApp((s) => s.contextUsage[conversation.id]);
  const project = useApp((s) => s.data?.projectRoot);
  const folder = conversation.projectRoot ?? project;
  const name = folder
    ?.replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .at(-1);
  return (
    <span className="drawer-context-chip" title={folder ?? 'Conversation context'}>
      {name && <span>{name}</span>}
      <span>{usage ? `${Math.round(usage.pct * 100)}% context` : 'Measuring context'}</span>
    </span>
  );
}
