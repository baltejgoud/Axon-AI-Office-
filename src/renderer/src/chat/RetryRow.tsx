import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button, IconRefresh } from '../ui';
import './rewrite.css';

/**
 * "Retry" under the last finished reply: asks again for a new answer. When the reply changed files,
 * it first says so, because the replies it replaces take their Undo buttons with them.
 */
export function RetryRow({ filesChanged, onRetry }: { filesChanged: number; onRetry: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();
  const row = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);
  // Asking puts you on Cancel (the safe answer); cancelling puts you back on Retry.
  useEffect(() => {
    const target = confirming ? '[data-action="cancel-retry"]' : '[data-action="retry"]';
    if (confirming || wasConfirming.current) row.current?.querySelector<HTMLElement>(target)?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (confirming && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setConfirming(false);
    }
  };
  if (confirming)
    return (
      <div ref={row} className="thread-retry" role="group" aria-label="Ask again" onKeyDown={keys}>
        <p className="thread-retry-note" id={noteId}>
          This replaces their last reply. Files they changed stay changed, so use Undo first if you want them
          back.
        </p>
        <Button
          variant="primary"
          size="sm"
          icon={IconRefresh}
          aria-describedby={noteId}
          onClick={() => {
            setConfirming(false);
            onRetry();
          }}
        >
          Ask again
        </Button>
        <Button variant="ghost" size="sm" data-action="cancel-retry" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    );
  return (
    <div ref={row} className="thread-retry">
      <Button
        variant="ghost"
        size="sm"
        icon={IconRefresh}
        data-action="retry"
        title="Ask again for a new answer"
        aria-label="Retry: ask again for a new answer"
        onClick={() => (filesChanged > 0 ? setConfirming(true) : onRetry())}
      >
        Retry
      </Button>
    </div>
  );
}
