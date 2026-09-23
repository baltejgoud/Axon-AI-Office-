import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BrainCircuit,
  Briefcase,
  ChevronDown,
  Code2,
  Coffee,
  Crown,
  HeartHandshake,
  Palette,
  SquareKanban,
  type LucideIcon
} from 'lucide-react';
import { districtById, type DistrictId } from '../campus/districts';
import { useEscape } from '../../../ui/escape';
import { fitChips } from './chipFit';
import { DISTRICT_ORDER } from './framing';

const ICONS: Record<DistrictId, LucideIcon> = {
  commons: Coffee,
  engineering: Code2,
  'ai-data': BrainCircuit,
  design: Palette,
  product: SquareKanban,
  business: Briefcase,
  'people-ops': HeartHandshake,
  leadership: Crown
};
/** Space between chips, as in shell.css. */
const GAP = 4;

function Chip({
  id,
  active,
  onChoose,
  role
}: {
  id: DistrictId;
  active: boolean;
  onChoose?: (id: DistrictId) => void;
  role?: 'menuitem';
}) {
  const district = districtById(id);
  const Icon = ICONS[id];
  return (
    <button
      className={active ? 'active' : ''}
      role={role}
      aria-pressed={role ? undefined : active}
      title={district.name}
      tabIndex={onChoose ? undefined : -1}
      style={{ '--district-color': district.color } as CSSProperties}
      onClick={onChoose && (() => onChoose(id))}
    >
      <Icon size={15} />
      {district.short}
    </button>
  );
}

/**
 * One chip per district on a single line; the camera glides to the one you pick. When the row is
 * too narrow, the chips that don't fit move into a "More" menu instead of wrapping.
 */
export function DistrictChips({
  active,
  onChoose
}: {
  active: DistrictId | null;
  onChoose: (id: DistrictId) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(DISTRICT_ORDER.length);
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false), open);

  useLayoutEffect(() => {
    const host = row.current;
    const ruler = measure.current;
    if (!host || !ruler) return;
    const update = () => {
      const widths = [...ruler.children].map((child) => (child as HTMLElement).offsetWidth);
      const more = widths.pop() ?? 0;
      setShown(fitChips(widths, host.clientWidth, more, GAP));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!row.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const visible = DISTRICT_ORDER.slice(0, shown);
  const hidden = DISTRICT_ORDER.slice(shown);
  const hiddenActive = active !== null && hidden.includes(active);
  return (
    <div ref={row} className="office-district-chips" role="group" aria-label="Go to a district">
      <div ref={measure} className="office-district-chips-ruler" aria-hidden="true">
        {DISTRICT_ORDER.map((id) => (
          <Chip key={id} id={id} active={false} />
        ))}
        <button tabIndex={-1}>
          More <ChevronDown size={14} />
        </button>
      </div>
      {visible.map((id) => (
        <Chip key={id} id={id} active={active === id} onChoose={onChoose} />
      ))}
      {hidden.length > 0 && (
        <div className="office-chip-more" data-hidden={hidden.length}>
          <button
            className={hiddenActive ? 'active' : ''}
            aria-haspopup="menu"
            aria-expanded={open}
            style={
              hiddenActive
                ? ({ '--district-color': districtById(active!).color } as CSSProperties)
                : undefined
            }
            onClick={() => setOpen(!open)}
          >
            More <ChevronDown size={14} />
          </button>
          {open && (
            <div className="office-chip-menu" role="menu" aria-label="More districts">
              {hidden.map((id) => (
                <Chip
                  key={id}
                  id={id}
                  role="menuitem"
                  active={active === id}
                  onChoose={(choice) => {
                    setOpen(false);
                    onChoose(choice);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
