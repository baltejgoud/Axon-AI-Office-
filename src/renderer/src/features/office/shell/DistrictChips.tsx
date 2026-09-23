import type { CSSProperties } from 'react';
import {
  BrainCircuit,
  Briefcase,
  Code2,
  Coffee,
  Crown,
  HeartHandshake,
  Palette,
  SquareKanban,
  type LucideIcon
} from 'lucide-react';
import { districtById, type DistrictId } from '../campus/districts';
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

/** One chip per district; the camera glides to the one you pick. */
export function DistrictChips({
  active,
  onChoose
}: {
  active: DistrictId | null;
  onChoose: (id: DistrictId) => void;
}) {
  return (
    <div className="office-district-chips" role="group" aria-label="Go to a district">
      {DISTRICT_ORDER.map((id) => {
        const district = districtById(id);
        const Icon = ICONS[id];
        return (
          <button
            key={id}
            className={active === id ? 'active' : ''}
            aria-pressed={active === id}
            title={district.name}
            style={{ '--district-color': district.color } as CSSProperties}
            onClick={() => onChoose(id)}
          >
            <Icon size={15} />
            {district.short}
          </button>
        );
      })}
    </div>
  );
}
