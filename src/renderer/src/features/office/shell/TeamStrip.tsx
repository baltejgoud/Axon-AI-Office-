import { useEffect, useRef } from 'react';
import { IconUsers } from '../../../ui';
import type { OfficeAgent } from '../data/officeAgents';
import { AgentPortrait } from '../AgentPortrait';
import { shortName } from './framing';

/** The people of the area in view (or the department you picked), one tap from a conversation. */
export function TeamStrip({
  title,
  people,
  selectedId,
  onChoose
}: {
  title: string;
  people: OfficeAgent[];
  selectedId: string;
  onChoose: (id: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);

  // The strip has no scrollbar, so the wheel moves it sideways (a trackpad's own sideways swipe is left alone).
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || element.scrollWidth <= element.clientWidth)
        return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // Whoever is picked (here, on the floor, or from a search) is kept in view.
  useEffect(() => {
    const selected = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selectedId, people]);

  return (
    <footer className="office-team-dock" aria-label={`${title} team`}>
      <div className="office-team-caption">
        <IconUsers size={17} />
        <strong>{title}</strong>
        <span>
          {people.length} {people.length === 1 ? 'person' : 'people'}
        </span>
      </div>
      <div ref={row} className="office-team-people">
        {people.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onChoose(agent.id)}
            className={selectedId === agent.id ? 'selected' : ''}
            aria-pressed={selectedId === agent.id}
            title={`${agent.name} · ${agent.department}`}
          >
            <AgentPortrait agent={agent} />
            <span>{shortName(agent.name)}</span>
          </button>
        ))}
      </div>
    </footer>
  );
}
