import { forwardRef, type CSSProperties } from 'react';
import type { Bounds } from '../campus/districts';
import { OFFICE_AGENTS, type AgentStatus } from '../data/officeAgents';
import { HOME_DESKS, poiById } from '../simulation/layout';
import type { Vec2 } from '../simulation/types';
import { shortName, type LabelTier } from './framing';
import { visibleSpatialLabels } from './spatialLabels';
import { plural } from '../../../format';
import { useApp } from '../../../state';
import { endedLabel, latestRun } from '../lifecycle';
import { activeThread } from '../activity/thread';
import { useOfficeStore } from '../store/officeStore';
import type { Marker, MarkerKind } from '../presence';
import './presence.css';

/** The same words as the coworker's panel and the activity list: one status language everywhere. */
const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Needs you',
  completed: 'Completed',
  error: 'Failed'
};
/** What a badge over someone's head says to a screen reader (the pictures are not read). */
const BADGE_LABELS: Partial<Record<MarkerKind, string>> = {
  needs: 'needs you',
  done: 'just finished',
  failed: 'ran into a problem'
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
  // Selection changes before the camera reaches the new desk; keep its tag mounted throughout.
  return [
    selectedId,
    ...inView
      .filter((entry) => entry.id !== selectedId)
      .slice(0, MAX_TAGS - 1)
      .map((entry) => entry.id)
  ];
}

export interface SceneLabelsProps {
  tier: LabelTier;
  people: string[];
  /** People a search found: tagged at every zoom, and marked. */
  found?: readonly string[];
  selectedId: string;
  statuses: Readonly<Record<string, AgentStatus>>;
  /** The badge or speech bubble over each person who has one, at every zoom. */
  markers?: Readonly<Record<string, Marker>>;
  loading: boolean;
  onAgent: (id: string) => void;
  bounds: Bounds | null;
  target: Vec2;
  onPlace: (kind: 'district' | 'department', target: string) => void;
}

/**
 * Name tags floating over the campus: for the people in view close up, and for the selected
 * person at every zoom; at the middle zoom, a chip on each department's board. Districts and rooms
 * are named by signs in the world, so they get no chip: from afar a chip would sit on the sign.
 * The scene positions the tags; `data-anchor` says whom each follows.
 */
export const SceneLabels = forwardRef<HTMLDivElement, SceneLabelsProps>(function SceneLabels(
  { tier, people, found = [], selectedId, statuses, markers = {}, loading, onAgent, bounds, target, onPlace },
  ref
) {
  const tags = tier === 'near' ? people : people.filter((id) => id === selectedId || found.includes(id));
  // The quiet dot over someone working is for when their name tag (which has its own) isn't up.
  const marked = Object.entries(markers).filter(
    ([id, marker]) => AGENTS.has(id) && !(marker.kind === 'working' && tags.includes(id))
  );
  // Between tasks, the selected person's tag says how their last task ended, as their panel does.
  const runtime = useOfficeStore((s) => s.agentRuntime[selectedId]);
  const thread = useApp((s) => activeThread(s.data?.conversations ?? [], selectedId, runtime));
  const lastRun = useApp((s) => (thread ? latestRun(s.data?.runs ?? [], selectedId, thread.id) : undefined));
  const lastReply = useApp((s) =>
    thread
      ? s.data?.messages.findLast((m) => m.conversationId === thread.id && m.role === 'assistant')
      : undefined
  );
  const selectedLabel = (status: AgentStatus) =>
    (status === 'idle' && endedLabel(lastRun, lastReply)) || STATUS_LABELS[status];
  return (
    <div ref={ref} className={`office-scene-labels tier-${tier} ${loading ? 'is-loading' : ''}`}>
      {tier === 'middle' &&
        visibleSpatialLabels('department', bounds, target).map((label) => (
          <button
            key={label.id}
            data-anchor={`place:${label.id}`}
            className={`office-place-label ${label.kind}`}
            style={{ '--place-color': label.color } as CSSProperties}
            onClick={() => onPlace(label.kind, label.target)}
            aria-label={`Go to ${label.title}, ${plural(label.people, 'person', 'people')}`}
          >
            <strong>{label.title}</strong>
            <small>{plural(label.people, 'person', 'people')}</small>
          </button>
        ))}
      {tags.map((id) => {
        const agent = AGENTS.get(id);
        if (!agent) return null;
        const status = statuses[id] ?? 'idle';
        const selected = selectedId === id;
        return (
          <button
            key={id}
            data-anchor={`agent:${id}`}
            className={`office-person-label ${selected ? 'selected' : ''}${found.includes(id) ? ' found' : ''} is-${status}`}
            style={{ '--agent-color': agent.accentColor } as CSSProperties}
            onClick={() => onAgent(id)}
            title={agent.role === agent.name ? agent.name : `${agent.name} · ${agent.role}`}
            aria-label={`Select ${agent.name}, ${STATUS_LABELS[status].toLowerCase()}`}
            aria-pressed={selected}
          >
            <span className={`person-status ${status}`} />
            {selected ? (
              <span className="person-label-detail">
                <strong>{agent.name}</strong>
                <small>{selectedLabel(status)}</small>
              </span>
            ) : (
              <span className="person-label-name">{shortName(agent.name)}</span>
            )}
          </button>
        );
      })}
      {marked.map(([id, marker]) => {
        const name = AGENTS.get(id)!.name;
        const badge = BADGE_LABELS[marker.kind];
        return marker.text ? (
          <span
            key={id}
            data-anchor={`beacon:${id}`}
            data-kind={marker.kind}
            className={`office-bubble ${marker.kind}`}
            aria-hidden="true"
          >
            {marker.text}
          </span>
        ) : (
          <span
            key={id}
            data-anchor={`beacon:${id}`}
            data-kind={marker.kind}
            className={`office-beacon ${marker.kind}`}
            {...(badge ? { role: 'img', 'aria-label': `${name} ${badge}` } : { 'aria-hidden': true })}
          >
            {marker.kind === 'needs' ? '!' : marker.kind === 'done' ? '✓' : marker.kind === 'failed' ? '×' : null}
          </span>
        );
      })}
    </div>
  );
});

/**
 * What the markers over heads add up to, so the scene collects them again when one appears,
 * changes or goes.
 */
export const markerKey = (markers: Readonly<Record<string, Marker>>): string =>
  Object.entries(markers)
    .map(([id, marker]) => `${id}:${marker.kind}:${marker.text ?? ''}`)
    .join('|');
