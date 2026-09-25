import './modelPicker.css';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Lock, Search, Settings2 } from 'lucide-react';
import { shortModelName } from '../../../shared/models';
import { useApp } from '../state';
import { Icon } from '../ui';

interface Option {
  value: string;
  providerName: string;
  id: string;
  label: string;
}

/**
 * The model a conversation uses: a button showing the choice, opening a searchable list grouped by
 * provider. Arrow keys move, Enter picks, Esc closes. Locked (with the reason on hover) once a
 * conversation has started.
 */
export function ModelPicker({
  value,
  onChange,
  onManage,
  disabled = false,
  title
}: {
  /** `providerId::modelId`, or '' for none. */
  value: string;
  onChange: (value: string) => void;
  /** Opens Settings, to connect or change models. */
  onManage: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const providers = useApp((s) => s.data?.providers ?? []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const listId = useId();

  const options = useMemo<Option[]>(
    () =>
      providers
        .filter((p) => p.enabled)
        .flatMap((p) =>
          p.models.map((m) => ({
            value: `${p.id}::${m.id}`,
            providerName: p.name,
            id: m.id,
            label: m.displayName && m.displayName !== m.id ? m.displayName : m.id
          }))
        ),
    [providers]
  );
  const current = options.find((o) => o.value === value);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) =>
        [o.id, o.label, o.providerName].some((text) => text.toLowerCase().includes(needle))
      )
    : options;

  const close = (focusTrigger = true) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger) trigger.current?.focus();
  };
  const pick = (option: Option) => {
    onChange(option.value);
    close();
  };
  const openList = () => {
    if (disabled) return;
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value)
      )
    );
    setOpen(true);
  };

  // Sits above the button (the composer is at the bottom of the window), inside the window.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const measure = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 16);
      setPlace({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - rect.top + 8,
        width
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!popover.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    popover.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      // Close the list only, not the sheet or panel around it.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const label = current
    ? shortModelName(current.id, current.label)
    : options.length
      ? 'Choose a model'
      : 'No models';
  const full = current ? `${current.providerName} · ${current.id}` : 'Choose a model';

  let lastProvider = '';
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`model-picker-trigger ${current ? '' : 'is-empty'}`}
        aria-label="AI model"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={title ? `${full} — ${title}` : full}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            openList();
          }
        }}
      >
        <span className={`model-picker-dot ${current ? 'is-set' : ''}`} aria-hidden="true" />
        <span className="model-picker-label">{label}</span>
        <Icon icon={disabled ? Lock : ChevronDown} size="sm" className="model-picker-arrow" />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={popover}
            className="model-picker-pop"
            style={{ left: place.left, bottom: place.bottom, width: place.width }}
            onKeyDown={onKeyDown}
          >
            {options.length > 0 ? (
              <>
                <label className="model-picker-search">
                  <Icon icon={Search} size="sm" />
                  <input
                    autoFocus
                    role="combobox"
                    aria-label="Search models"
                    aria-controls={listId}
                    aria-expanded="true"
                    aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                    placeholder="Search models"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="model-picker-list" role="listbox" id={listId} aria-label="Models">
                  {shown.map((option, index) => {
                    const header = option.providerName !== lastProvider;
                    lastProvider = option.providerName;
                    return (
                      <div key={option.value}>
                        {header && (
                          <div className="model-picker-group" role="presentation">
                            {option.providerName}
                          </div>
                        )}
                        <div
                          id={`${listId}-${index}`}
                          data-index={index}
                          role="option"
                          aria-selected={option.value === value}
                          className={`model-picker-option ${index === active ? 'is-active' : ''}`}
                          onMouseEnter={() => setActive(index)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pick(option);
                          }}
                        >
                          <span className="model-picker-option-name">{option.label}</span>
                          {option.value === value && <Icon icon={Check} size="sm" />}
                        </div>
                      </div>
                    );
                  })}
                  {!shown.length && <div className="model-picker-empty">No model matches “{query}”.</div>}
                </div>
              </>
            ) : (
              <div className="model-picker-empty">
                <strong>No models connected yet</strong>
                Add a provider such as Kimi, Qwen or OpenAI in Settings.
              </div>
            )}
            <button
              type="button"
              className="model-picker-manage"
              onClick={() => {
                close(false);
                onManage();
              }}
            >
              <Icon icon={Settings2} size="sm" />
              {options.length ? 'Manage models' : 'Connect a model'}
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
