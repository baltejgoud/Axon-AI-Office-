import { useEffect, useId, useState, type ReactNode } from 'react';

/** A titled group of settings: a small heading over one card of rows. */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      {title && <h4 className="settings-group-title">{title}</h4>}
      <div className="settings-card">{children}</div>
    </section>
  );
}

/**
 * One setting: what it is and what it does on the left, its control on the right. `stacked` puts
 * the control under the text, for wide controls.
 */
export function SettingRow({
  label,
  hint,
  children,
  stacked = false,
  id
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
  /** The control's id, so the label names it. */
  id?: string;
}) {
  return (
    <div className={`settings-row ${stacked ? 'is-stacked' : ''}`}>
      <div className="settings-row-text">
        {id ? (
          <label className="settings-row-label" htmlFor={id}>
            {label}
          </label>
        ) : (
          <div className="settings-row-label">{label}</div>
        )}
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

/** An on/off switch. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Read by screen readers; the row shows the visible label. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/** A choice between a few options, shown side by side. Arrow keys move between them. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const move = (step: number) => {
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
  };
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A number typed freely and saved when you leave the field or press Enter, kept within its range.
 * (Saving on every keystroke snapped "16000" to the minimum after its first digit.)
 */
export function NumberSetting({
  value,
  min,
  max,
  step = 1,
  onCommit,
  id,
  width = 120
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
  id?: string;
  width?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) return setDraft(String(value));
    const next = Math.min(max, Math.max(min, parsed));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      id={id}
      className="input settings-number"
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
      style={{ width }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** A slider with its value beside it, saved once you let go. */
export function SliderSetting({
  value,
  min,
  max,
  step,
  onCommit,
  label,
  format = (v) => v.toFixed(1)
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
  label: string;
  format?: (value: number) => string;
}) {
  const [draft, setDraft] = useState(value);
  const id = useId();
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className="settings-slider">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={label}
        aria-valuetext={format(draft)}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output htmlFor={id}>{format(draft)}</output>
    </div>
  );
}
