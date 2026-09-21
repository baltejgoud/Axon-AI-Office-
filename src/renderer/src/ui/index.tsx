import { useEffect, useId, useRef, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, type LucideIcon } from 'lucide-react';
import { useApp } from '../state';

/* ---------- Icon ---------- */
const iconSizes = { sm: 14, md: 16, lg: 20, xl: 32 } as const;
export type IconSize = keyof typeof iconSizes;

/** Lucide icon with a tokenised size. Decorative by default (aria-hidden). */
export function Icon({
  icon: Glyph,
  size = 'md',
  label,
  className = ''
}: {
  icon: LucideIcon;
  size?: IconSize;
  label?: string;
  className?: string;
}) {
  return (
    <Glyph
      size={iconSizes[size]}
      strokeWidth={1.75}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={className}
    />
  );
}

/* ---------- Axon Logo ---------- */
export function AxonLogo({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8 8L16 16M16 16L24 10M16 16L8 24M16 16L24 22"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="3.5" fill="currentColor" />
      <circle cx="24" cy="10" r="3.5" fill="currentColor" />
      <circle cx="8" cy="24" r="3.5" fill="currentColor" />
      <circle cx="24" cy="22" r="3.5" fill="currentColor" />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
    </svg>
  );
}

/* ---------- Button ---------- */
type ButtonBase = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  block?: boolean;
};
type ButtonProps =
  | (ButtonBase & { children: ReactNode; iconOnly?: false })
  | (ButtonBase & { children?: never; iconOnly: true; 'aria-label': string; icon: LucideIcon });

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block,
  iconOnly,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'sm' && 'btn-sm',
    iconOnly && 'btn-icon-only',
    block && 'btn-block',
    className
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} title={iconOnly ? rest['aria-label'] : rest.title} {...rest}>
      {icon && <Icon icon={icon} size={size === 'sm' ? 'sm' : 'md'} />}
      {children}
    </button>
  );
}

/* ---------- Kbd ---------- */
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
/** Keyboard shortcut hint that renders the correct modifier for the platform. */
export function Kbd({ keys }: { keys: string }) {
  return <kbd className="kbd">{keys.replace(/\bMod\b/g, isMac ? '⌘' : 'Ctrl')}</kbd>;
}

/* ---------- Modal ---------- */
const escapeStack: (() => void)[] = [];
let escapeBound = false;
function bindEscape() {
  if (escapeBound) return;
  escapeBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') escapeStack[escapeStack.length - 1]?.();
  });
}

export function Modal({
  title,
  onClose,
  onSubmit,
  submitLabel = 'Save',
  submitDisabled,
  children
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const first = form.current?.querySelector<HTMLElement>('input, select, textarea');
    first?.focus();
    bindEscape();
    const entry = () => closeRef.current();
    escapeStack.push(entry);
    return () => {
      escapeStack.splice(escapeStack.lastIndexOf(entry), 1);
    };
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onSubmit();
  };
  return createPortal(
    <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={form}
        className="overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
      >
        <div className="overlay-header">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" icon={X} iconOnly aria-label="Close" onClick={onClose} />
        </div>
        <div className="overlay-body">{children}</div>
        <div className="overlay-footer">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}

/* ---------- Field ---------- */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/* ---------- PageHeader ---------- */
export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

/* ---------- ToastStack ---------- */
/** Transient confirmations for save/delete/copy actions. Mount once at the app root. */
export function ToastStack() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismissToast(t.id)}>
          <Icon icon={t.tone === 'error' ? X : Check} size="sm" />
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}

/* ---------- EmptyState ---------- */
export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="icon-tile">
        <Icon icon={icon} size="lg" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
