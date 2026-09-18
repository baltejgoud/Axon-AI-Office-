import { useMemo, useState, type ReactNode } from 'react';
import { Lock, X } from 'lucide-react';
import type { Selection } from '../../../shared/types';
import { useApp } from '../state';
import { Icon, Modal } from './index';

interface Item {
  id: string;
  name: string;
  description: string;
  group: string;
  meta?: ReactNode;
}
interface Group {
  id: string;
  label: string;
}

function CatalogPicker({
  title,
  items,
  groups,
  sourceOptions,
  sourceOf,
  selected,
  onApply,
  onClose,
  summary
}: {
  title: string;
  items: Item[];
  groups: Group[];
  sourceOptions?: string[];
  sourceOf?: (item: Item) => string;
  selected: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
  summary: (ids: string[]) => string;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [source, setSource] = useState('all');
  const [picked, setPicked] = useState<string[]>(selected);
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          (group === 'all' || i.group === group) &&
          (source === 'all' || !sourceOf || sourceOf(i) === source) &&
          (!q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
      ),
    [items, group, source, q, sourceOf]
  );
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Modal title={title} onClose={onClose} onSubmit={() => onApply(picked)} submitLabel="Apply">
      <div className="picker-toolbar">
        <div className="picker-filters">
          <input
            className="input"
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Search by name or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {sourceOptions && (
            <select
              className="select select-sm"
              aria-label="Source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="all">All sources</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="picker-tabs" role="tablist">
          {[{ id: 'all', label: 'All' }, ...groups].map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              className="picker-tab"
              aria-selected={group === g.id}
              onClick={() => setGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div className="picker-list">
        {visible.length ? (
          visible.map((i) => (
            <label key={i.id} className="picker-row">
              <input type="checkbox" checked={picked.includes(i.id)} onChange={() => toggle(i.id)} />
              <span>
                <span className="picker-row-name">{i.name}</span>
                <span className="picker-row-desc">{i.description}</span>
              </span>
              <span className="picker-row-meta">{i.meta}</span>
            </label>
          ))
        ) : (
          <p className="picker-empty">Nothing matches.</p>
        )}
      </div>
      <p className="picker-summary">{summary(picked)}</p>
    </Modal>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  design: 'Design',
  engineering: 'Engineering',
  workflow: 'Workflow',
  review: 'Review',
  content: 'Content',
  integration: 'Integration',
  other: 'Other'
};
const kb = (n: number) => `${Math.max(1, Math.round(n / 1000))}k`;

export function SkillPicker({
  selected,
  onApply,
  onClose
}: {
  selected: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const data = useApp((s) => s.data)!;
  const { items, bySize } = useMemo(() => {
    const items: Item[] = data.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      group: s.category,
      meta: (
        <>
          {!s.supported && <span className="badge">Needs tools</span>}
          <span>{kb(s.bytes)}</span>
        </>
      )
    }));
    const bySize = new Map(data.skills.map((s) => [s.id, s.bytes]));
    return { items, bySize };
  }, [data.skills]);
  return (
    <CatalogPicker
      title="Skills"
      items={items}
      groups={Object.entries(CATEGORY_LABELS).map(([id, label]) => ({ id, label }))}
      sourceOptions={data.skillSources.map((s) => s.slug)}
      sourceOf={(i) => i.id.split('/')[0]}
      selected={selected}
      onApply={onApply}
      onClose={onClose}
      summary={(ids) =>
        `${ids.length} selected · ${kb(ids.reduce((n, id) => n + (bySize.get(id) ?? 0), 0))} of 80k characters`
      }
    />
  );
}

export function RolePicker({
  selected,
  onApply,
  onClose
}: {
  selected: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const data = useApp((s) => s.data)!;
  const { items, groups } = useMemo(() => {
    const groups = [...new Set(data.roles.map((r) => r.group))].map((g) => ({ id: g, label: g }));
    const items: Item[] = data.roles.map((r) => ({
      id: r.id,
      name: r.name,
      group: r.group,
      description: r.profile.split('\n')[0].replace(/^Owns:\s*/, '')
    }));
    return { items, groups };
  }, [data.roles]);
  return (
    <CatalogPicker
      title="Roles"
      items={items}
      groups={groups}
      selected={selected}
      onApply={onApply}
      onClose={onClose}
      summary={(ids) => `${ids.length} selected`}
    />
  );
}

/** Chips for an active selection. Inherited ids render locked; others get a remove button when onRemove is given. */
export function SelectionChips({
  selection,
  inherited,
  onRemove
}: {
  selection: Selection;
  inherited?: Selection;
  onRemove?: (kind: 'skill' | 'role', id: string) => void;
}) {
  const data = useApp((s) => s.data)!;
  const roleName = (id: string) => data.roles.find((r) => r.id === id)?.name ?? `${id} (unavailable)`;
  const skillName = (id: string) => data.skills.find((s) => s.id === id)?.name ?? `${id} (unavailable)`;
  const chip = (kind: 'skill' | 'role', id: string, label: string, locked: boolean) => {
    const cls = `chip ${kind === 'role' ? 'chip-role' : ''} ${locked || !onRemove ? 'chip-static' : ''}`;
    if (locked || !onRemove)
      return (
        <span key={`${kind}:${id}`} className={cls} title={locked ? 'Set by the workspace' : undefined}>
          {label}
          {locked && <Icon icon={Lock} size="sm" />}
        </span>
      );
    return (
      <button
        key={`${kind}:${id}`}
        type="button"
        className={cls}
        aria-label={`Remove ${label}`}
        onClick={() => onRemove(kind, id)}
      >
        {label}
        <Icon icon={X} size="sm" />
      </button>
    );
  };
  const roleIds = [...new Set([...(inherited?.roleIds ?? []), ...selection.roleIds])];
  const skillIds = [...new Set([...(inherited?.skillIds ?? []), ...selection.skillIds])];
  if (!roleIds.length && !skillIds.length) return null;
  return (
    <div className="selection-chips">
      {roleIds.map((id) => chip('role', id, roleName(id), (inherited?.roleIds ?? []).includes(id)))}
      {skillIds.map((id) => chip('skill', id, skillName(id), (inherited?.skillIds ?? []).includes(id)))}
    </div>
  );
}
