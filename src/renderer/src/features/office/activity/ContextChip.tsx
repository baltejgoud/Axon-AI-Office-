import type { Conversation } from '../../../../../shared/types';
import { useApp } from '../../../state';

/**
 * The folder this conversation works in, under the coworker's name. How full the context is lives
 * in one place only: the meter beside the message box.
 */
export function ContextChip({ conversation }: { conversation: Conversation }) {
  const project = useApp((s) => s.data?.projectRoot);
  const folder = conversation.projectRoot ?? project;
  const name = folder
    ?.replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .at(-1);
  if (!name) return null;
  return (
    <span className="drawer-context-chip" title={`Works in ${folder}`}>
      <span>{name}</span>
    </span>
  );
}
