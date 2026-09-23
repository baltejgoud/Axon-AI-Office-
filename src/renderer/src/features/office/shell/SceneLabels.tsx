import { forwardRef, type CSSProperties } from 'react';
import { BookOpen, Coffee, ConciergeBell, Files, LayoutGrid, MessageCircle, Users } from 'lucide-react';
import { DISTRICTS, districtById, type Bounds, type DistrictId } from '../campus/districts';
import { OFFICE_AGENTS, type AgentStatus } from '../data/officeAgents';
import { HOME_DESKS, poiById } from '../simulation/layout';
import type { Vec2, ZoneId } from '../simulation/types';
import { COMMONS_ROOMS } from './DepartmentMenu';
import { shortName, type LabelTier } from './framing';

const ROOM_ICONS: Record<ZoneId, typeof Users> = {
  chat: MessageCircle,
  workspaces: LayoutGrid,
  knowledge: BookOpen,
  files: Files,
  agents: Users,
  cafe: Coffee,
  reception: ConciergeBell
};
const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting',
  completed: 'Done',
  error: 'Needs attention'
};
const HEADCOUNT = OFFICE_AGENTS.reduce<Record<string, number>>((counts, agent) => {
  counts[agent.district] = (counts[agent.district] ?? 0) + 1;
  return counts;
}, {});
const AGENTS = new Map(OFFICE_AGENTS.map((agent) => [agent.id, agent]));
const HOME = new Map(OFFICE_AGENTS.map((agent) => [agent.id, poiById(HOME_DESKS[agent.id]).position]));
/** Most name tags shown at once; the rest appear as you zoom in. */
const MAX_TAGS = 30;

/** Who gets a name tag close up: selected and busy people first, then those nearest the centre. */
export function taggedPeople(
  bounds: Bounds,
  target: Vec2,
  statuses: Readonly<Record<string, AgentStatus>>,
  selectedId: string
): string[] {
  const inView = OFFICE_AGENTS.filter((agent) => {
    const p = HOME.get(agent.id)!;
    return p.x > bounds.minX - 1 && p.x < bounds.maxX + 1 && p.z > bounds.minZ - 1 && p.z < bounds.maxZ + 1;
  })
    .map((agent) => {
      const p = HOME.get(agent.id)!;
      const busy = statuses[agent.id] === 'working' || statuses[agent.id] === 'waiting';
      const first = agent.id === selectedId ? -2 : busy ? -1 : 0;
      return { id: agent.id, first, d: Math.hypot(p.x - target.x, p.z - target.z) };
    })
    .sort((a, b) => a.first - b.first || a.d - b.d);
  return inView.slice(0, MAX_TAGS).map((entry) => entry.id);
}

export interface SceneLabelsProps {
  tier: LabelTier;
  people: string[];
  selectedId: string;
  statuses: Readonly<Record<string, AgentStatus>>;
  loading: boolean;
  onAgent: (id: string) => void;
  onDistrict: (id: DistrictId) => void;
  onDepartment: (name: string) => void;
  onRoom: (zone: ZoneId) => void;
}

/**
 * Labels floating over the campus, by zoom: district cards from afar, department and room names
 * in between, and name tags close up. The scene positions them; `data-anchor` says where.
 */
export const SceneLabels = forwardRef<HTMLDivElement, SceneLabelsProps>(function SceneLabels(
  { tier, people, selectedId, statuses, loading, onAgent, onDistrict, onDepartment, onRoom },
  ref
) {
  const tags = tier === 'near' ? people : people.filter((id) => id === selectedId);
  return (
    <div ref={ref} className={`office-scene-labels tier-${tier} ${loading ? 'is-loading' : ''}`}>
      {tier === 'far' &&
        DISTRICTS.map((district) => (
          <button
            key={district.id}
            data-anchor={`district:${district.id}`}
            className="office-district-card"
            style={{ '--district-color': district.color } as CSSProperties}
            onClick={() => onDistrict(district.id)}
          >
            <span className="office-district-swatch" />
            <span>
              <strong>{district.name}</strong>
              <small>{HEADCOUNT[district.id]} people</small>
            </span>
          </button>
        ))}
      {tier === 'middle' && (
        <>
          {DISTRICTS.flatMap((district) =>
            district.departments.map((name) => (
              <button
                key={name}
                data-anchor={`department:${name}`}
                className="office-department-label"
                style={{ '--district-color': district.color } as CSSProperties}
                onClick={() => onDepartment(name)}
              >
                <span className="office-district-swatch" />
                {name}
              </button>
            ))
          )}
          {COMMONS_ROOMS.map((room) => {
            const Icon = ROOM_ICONS[room.zone];
            return (
              <button
                key={room.zone}
                data-anchor={`zone:${room.zone}`}
                className="office-zone-label"
                onClick={() => onRoom(room.zone)}
              >
                <Icon size={15} />
                <strong>{room.name}</strong>
              </button>
            );
          })}
        </>
      )}
      {tags.map((id) => {
        const agent = AGENTS.get(id);
        if (!agent) return null;
        const status = statuses[id] ?? 'idle';
        const selected = selectedId === id;
        return (
          <button
            key={id}
            data-anchor={`agent:${id}`}
            className={`office-person-label ${selected ? 'selected' : ''}`}
            style={{ '--agent-color': districtById(agent.district).color } as CSSProperties}
            onClick={() => onAgent(id)}
            aria-label={`Select ${agent.name}, ${status}`}
            aria-pressed={selected}
          >
            <span className={`person-status ${status}`} />
            {selected ? (
              <span className="person-label-detail">
                <strong>{agent.name}</strong>
                <small>{STATUS_LABELS[status]}</small>
              </span>
            ) : (
              shortName(agent.name)
            )}
          </button>
        );
      })}
    </div>
  );
});
