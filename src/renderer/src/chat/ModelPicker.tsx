import './modelPicker.css';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { shortModelName } from '../../../shared/models';
import { formatTokens } from '../../../shared/cost';
import { useApp } from '../state';
import { IconCaretDown, IconCheck, IconLock, IconSearch, IconSettings } from '../ui';
import { ModelIcon } from '../settings/ModelIcon';

interface Tag {
  text: string;
  title: string;
  /** A limit worth seeing before you send, such as no tools. */
  warn?: boolean;
}

interface Option {
  value: string;
  providerName: string;
  id: string;
  label: string;
  tags: Tag[];
}

/** The models you picked last, newest first, kept on this computer. */
const RECENT_KEY = 'axon.recentModels';
const RECENT_SHOWN = 3;
const readRecent = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};
const remember = (value: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([value, ...readRecent().filter((v) => v !== value)].slice(0, 8)));
  } catch {
    // Recently used is a convenience; picking still works without it.
  }
};

const PROFILE_TAG: Record<string, Tag> = {
  fast: { text: 'fast', title: 'Your Fast profile in Settings → Models' },
  deep: { text: 'deep', title: 'Your Deep profile in Settings → Models' },
  coding: { text: 'coding', title: 'Your Coding profile in Settings → Models' },
  standard: { text: 'standard', title: 'Your Standard profile in Settings → Models' }
};

/**
 * The model a conversation uses: a button showing the choice, opening a searchable list grouped by
 * provider, with the ones you used last on top. Arrow keys move, Enter picks the highlighted model
 * (the first match while you type), Esc closes. Locked (with the reason on hover) once a
 * conversation has started.
 */
export function ModelPicker({
  value,
  onChange,
  onManage,
  disabled = false,
  title,
  note
}: {
  /** `providerId::modelId`, or '' for none. */
  value: string;
  onChange: (value: string) => void;
  /** Opens Settings, to connect or change models. */
  onManage: () => void;
  disabled?: boolean;
  title?: string;
  /** A word beside the choice, explained on hover, e.g. that it carried over from another conversation. */
  note?: { text: string; title: string };
}) {
  const providers = useApp((s) => s.data?.providers ?? []);
  const profiles = useApp((s) => s.data?.settings.modelProfiles);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; bottom: number; width: number } | null>(null);
  /** The list keeps the height it opened at, so rows don't move under the pointer while you type. */
  const [height, setHeight] = useState<number>();
  const [recent, setRecent] = useState<string[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const listId = useId();

  const options = useMemo<Option[]>(
    () =>
      providers
        .filter((p) => p.enabled)
        .flatMap((p) =>
          p.models.map((m) => {
            const value = `${p.id}::${m.id}`;
            const tags: Tag[] = Object.entries(profiles ?? {})
              .filter(([, chosen]) => chosen && `${chosen.providerId}::${chosen.modelId}` === value)
              .map(([profile]) => PROFILE_TAG[profile])
              .filter(Boolean);
            if (m.contextWindow)
              tags.push({ text: formatTokens(m.contextWindow), title: `Holds ${m.contextWindow.toLocaleString()} tokens of context` });
            if (m.supportsVision) tags.push({ text: 'images', title: 'Can read images you attach' });
            if (m.supportsTools === false)
              tags.push({
                text: 'no tools',
                warn: true,
                title: 'Can’t use tools: coworkers who read files, search or call connectors won’t work with it'
              });
            return {
              value,
              providerName: p.name,
              id: m.id,
              label: m.displayName && m.displayName !== m.id ? m.displayName : shortModelName(m.id),
              tags
            };
          })
        ),
    [providers, profiles]
  );
  const current = options.find((o) => o.value === value);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) =>
        [o.id, o.label, o.providerName].some((text) => text.toLowerCase().includes(needle))
      )
    : options;
  // Rows in the order they show: recently used first (only while not searching), then by provider.
  const recentRows = needle
    ? []
    : recent
        .map((v) => options.find((o) => o.value === v))
        .filter((o): o is Option => Boolean(o))
        .slice(0, RECENT_SHOWN);
  const rows = [
    ...recentRows.map((option) => ({ option, group: 'Recently used', key: `recent:${option.value}` })),
    ...shown.map((option) => ({ option, group: option.providerName, key: option.value }))
  ];

  const close = (focusTrigger = true) => {
    setOpen(false);
    setQuery('');
    setHeight(undefined);
    if (focusTrigger) trigger.current?.focus();
  };
  const pick = (option: Option) => {
    remember(option.value);
    onChange(option.value);
    close();
  };
  const openList = () => {
    if (disabled) return;
    const latest = readRecent();
    setRecent(latest);
    const shownRecent = latest.filter((v) => options.some((o) => o.value === v)).slice(0, RECENT_SHOWN);
    const inRecent = shownRecent.indexOf(value);
    setActive(Math.max(0, inRecent >= 0 ? inRecent : shownRecent.length + options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  // Sits above the button (the composer is at the bottom of the window), inside the window.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const measure = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
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
  useLayoutEffect(() => {
    if (open && place && height === undefined && popover.current) setHeight(popover.current.offsetHeight);
  }, [open, place, height]);

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
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      // Always a model, never an action: the highlighted one, else the first match; nothing when none match.
      event.preventDefault();
      event.stopPropagation();
      const row = rows[active] ?? rows[0];
      if (row) pick(row.option);
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

  let lastGroup = '';
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
        title={[title ? `${full} — ${title}` : full, note?.title].filter(Boolean).join('\n')}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            openList();
          }
        }}
      >
        {current ? (
          <ModelIcon name={current.providerName} size={15} className="model-picker-brand-icon" />
        ) : (
          <span className="model-picker-dot" aria-hidden="true" />
        )}
        <span className="model-picker-label">{label}</span>
        {note && current && <span className="model-picker-note">{note.text}</span>}
        {disabled ? <IconLock size={12} className="model-picker-arrow" /> : <IconCaretDown size={11} className="model-picker-arrow" />}
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={popover}
            className="model-picker-pop"
            style={{ left: place.left, bottom: place.bottom, width: place.width, height }}
            onKeyDown={onKeyDown}
          >
            {options.length > 0 ? (
              <>
                <label className="model-picker-search">
                  <IconSearch size={14} />
                  <input
                    autoFocus
                    role="combobox"
                    aria-label="Search models"
                    aria-controls={listId}
                    aria-expanded="true"
                    aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
                    placeholder="Search models"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="model-picker-list" role="listbox" id={listId} aria-label="Models">
                  {rows.map(({ option, group, key }, index) => {
                    const header = group !== lastGroup;
                    lastGroup = group;
                    return (
                      <div key={key}>
                        {header && (
                          <div className="model-picker-group" role="presentation">
                            {group === 'Recently used' ? null : <ModelIcon name={option.providerName} size={13} />}
                            <span>{group}</span>
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
                          <ModelIcon
                            name={option.providerName}
                            size={15}
                            className="model-picker-option-icon"
                          />
                          <span className="model-picker-option-copy">
                            <span className="model-picker-option-name">{option.label}</span>
                            {option.label !== option.id && (
                              <span className="model-picker-option-id">{option.id}</span>
                            )}
                          </span>
                          {option.tags.length > 0 && (
                            <span className="model-picker-tags">
                              {option.tags.map((tag) => (
                                <span key={tag.text} className={`model-picker-tag${tag.warn ? ' warn' : ''}`} title={tag.title}>
                                  {tag.text}
                                </span>
                              ))}
                            </span>
                          )}
                          {option.value === value && <IconCheck size={13} />}
                        </div>
                      </div>
                    );
                  })}
                  {!rows.length && <div className="model-picker-empty">No model matches “{query}”.</div>}
                </div>
              </>
            ) : (
              <div className="model-picker-empty">
                <strong>No models connected yet</strong>
                Add a provider such as Kimi, Qwen or OpenAI in Settings.
              </div>
            )}
            {/* Set apart from the models, and never what Enter or Tab lands on. */}
            <button
              type="button"
              tabIndex={-1}
              className="model-picker-manage"
              onClick={() => {
                close(false);
                onManage();
              }}
            >
              <IconSettings size={14} />
              {options.length ? 'Manage models…' : 'Connect a model'}
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
