import { forwardRef, type CSSProperties } from 'react';
import { districtById, type Bounds } from '../campus/districts';
import { OFFICE_AGENTS, type AgentStatus } from '../data/officeAgents';
import { HOME_DESKS, poiById } from '../simulation/layout';
import type { Vec2 } from '../simulation/types';
import { shortName, type LabelTier } from './framing';
const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting',
  completed: 'Done',
  error: 'Needs attention'
};
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
}

/**
 * Name tags floating over the campus: for the people in view close up, and for the selected
 * person at every zoom. Districts, departments and rooms are named by signs in the world.
 * The scene positions the tags; `data-anchor` says whom each follows.
 */
export const SceneLabels = forwardRef<HTMLDivElement, SceneLabelsProps>(function SceneLabels(
  { tier, people, selectedId, statuses, loading, onAgent },
  ref
) {
  const tags = tier === 'near' ? people : people.filter((id) => id === selectedId);
  return (
    <div ref={ref} className={`office-scene-labels tier-${tier} ${loading ? 'is-loading' : ''}`}>
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
