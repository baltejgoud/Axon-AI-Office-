import { useId } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Button } from './index';
import { useEscape } from './escape';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for deletes: Cancel gets focus, so a stray Enter keeps the item. */
  tone?: 'danger' | 'default';
}

interface ConfirmRequest extends ConfirmOptions {
  id: number;
  /** The element that had focus when the question was asked; focus goes back to it. */
  returnTo: HTMLElement | null;
  resolve: (confirmed: boolean) => void;
}

const useConfirm = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));
let lastId = 0;

/** Closes `request` if it is still the open one. Nothing happens for a request that was already replaced. */
function settle(request: ConfirmRequest, confirmed: boolean) {
  if (useConfirm.getState().request !== request) return;
  useConfirm.setState({ request: null });
  request.returnTo?.focus();
  request.resolve(confirmed);
}

/** Asks in an Axon dialog before an action that needs a yes. Resolves true only if the confirm button is pressed. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const open = useConfirm.getState().request;
    if (open) settle(open, false);
    const active = document.activeElement;
    useConfirm.setState({
      request: {
        ...options,
        id: ++lastId,
        returnTo: active instanceof HTMLElement ? active : null,
        resolve
      }
    });
  });
}

/** Renders the open confirmation, if any. Mount once at the app root, beside ToastStack. */
export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  return request ? <ConfirmDialog key={request.id} request={request} /> : null;
}

function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  const { title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', tone = 'default' } = request;
  const titleId = useId();
  const messageId = useId();
  const cancel = () => settle(request, false);
  useEscape(cancel);
  const danger = tone === 'danger';
  return createPortal(
    <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        className="overlay confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
      >
        <div className="overlay-body">
          <div className="overlay-title">
            <h2 id={titleId}>{title}</h2>
            {message && (
              <p id={messageId} className="confirm-message">
                {message}
              </p>
            )}
          </div>
        </div>
        <div className="overlay-footer">
          <Button variant="ghost" autoFocus={danger} onClick={cancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            autoFocus={!danger}
            onClick={() => settle(request, true)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
