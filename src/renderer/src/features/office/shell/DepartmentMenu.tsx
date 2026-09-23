import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Building2, ChevronDown, Search } from 'lucide-react';
import { districtById } from '../campus/districts';
import { OFFICE_AGENTS } from '../data/officeAgents';
import type { ZoneId } from '../simulation/types';
import { useEscape } from '../../../ui/escape';
import { DISTRICT_ORDER } from './framing';

/** The Commons rooms, reachable from the same menu as the departments. */
export const COMMONS_ROOMS: { name: string; zone: ZoneId }[] = [
  { name: 'Lounge', zone: 'chat' },
  { name: 'Planning rooms', zone: 'workspaces' },
  { name: 'Library', zone: 'knowledge' },
  { name: 'Files room', zone: 'files' },
  { name: 'Café', zone: 'cafe' },
  { name: 'Core team pods', zone: 'agents' }
];

const HEADCOUNT = OFFICE_AGENTS.reduce<Record<string, number>>((counts, agent) => {
  counts[agent.department] = (counts[agent.department] ?? 0) + 1;
  return counts;
}, {});

export type DepartmentChoice =
  { kind: 'department'; name: string } | { kind: 'room'; zone: ZoneId; name: string };

/** "Go to department…": every department grouped by district, plus the Commons rooms. */
export function DepartmentMenu({
  current,
  onChoose
}: {
  current: string | null;
  onChoose: (choice: DepartmentChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEscape(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTimeout(() => input.current?.focus(), 0);
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (name: string, district: string) =>
      !q || name.toLowerCase().includes(q) || district.toLowerCase().includes(q);
    return DISTRICT_ORDER.map((id) => {
      const district = districtById(id);
      const items: DepartmentChoice[] =
        id === 'commons'
          ? COMMONS_ROOMS.filter((room) => match(room.name, district.name)).map((room) => ({
              kind: 'room',
              zone: room.zone,
              name: room.name
            }))
          : district.departments
              .filter((name) => match(name, district.name))
              .map((name) => ({ kind: 'department', name }));
      return { district, items };
    }).filter((group) => group.items.length);
  }, [query]);

  const choose = (choice: DepartmentChoice) => {
    onChoose(choice);
    setOpen(false);
  };

  return (
    <div className="office-department-menu" ref={root}>
      <button
        className="office-department-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Building2 size={17} />
        <span>{current ?? 'Go to department…'}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="office-department-popover">
          <label className="office-department-search">
            <Search size={15} />
            <input
              ref={input}
              aria-label="Filter departments"
              placeholder="Filter departments"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                const first = groups[0]?.items[0];
                if (e.key === 'Enter' && first) choose(first);
              }}
            />
          </label>
          <div className="office-department-list" role="listbox" aria-label="Departments">
            {groups.map(({ district, items }) => (
              <div
                key={district.id}
                className="office-department-group"
                role="group"
                aria-label={district.name}
                style={{ '--district-color': district.color } as CSSProperties}
              >
                <div className="office-department-heading">{district.name}</div>
                {items.map((item) => (
                  <button
                    key={item.name}
                    role="option"
                    aria-selected={current === item.name}
                    onClick={() => choose(item)}
                  >
                    <span className="office-department-dot" />
                    <span className="office-department-name">{item.name}</span>
                    {item.kind === 'department' && <small>{HEADCOUNT[item.name]}</small>}
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <p className="office-department-empty">No department matches “{query}”.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
