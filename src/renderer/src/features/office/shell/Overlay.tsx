import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useEscape } from '../../../ui/escape';

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** A sheet over the office for Settings and the library. Esc, the close button or the backdrop dismisses it. */
export function Overlay({
  title,
  onClose,
  children,
  wide = false
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEscape(onClose);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);

  // Keep Tab inside the sheet while it is open.
  const trapTab = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="office-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        className={`office-overlay-panel ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <header className="office-overlay-header">
          <h2 id={titleId}>{title}</h2>
          <button className="office-overlay-close" aria-label={`Close ${title}`} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="office-overlay-body">{children}</div>
      </div>
    </div>
  );
}
