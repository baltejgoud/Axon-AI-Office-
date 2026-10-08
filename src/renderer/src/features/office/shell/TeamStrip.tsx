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
    const element = row.current;
    if (!element || !selected) return;
    const item = selected.getBoundingClientRect(),
      box = element.getBoundingClientRect();
    const delta =
      item.left < box.left ? item.left - box.left : item.right > box.right ? item.right - box.right : 0;
    if (delta) element.scrollTo({ left: element.scrollLeft + delta, behavior: 'smooth' });
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
            aria-label={`${agent.name}, ${agent.department}`}
            onKeyDown={(event) => {
              const buttons = [...(row.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
              const at = buttons.indexOf(event.currentTarget);
              const index =
                event.key === 'ArrowRight'
                  ? (at + 1) % buttons.length
                  : event.key === 'ArrowLeft'
                    ? (at - 1 + buttons.length) % buttons.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : null;
              if (index === null) return;
              event.preventDefault();
              buttons[index]?.focus();
              const element = row.current;
              const item = buttons[index]?.getBoundingClientRect();
              const box = element?.getBoundingClientRect();
              if (element && item && box)
                element.scrollLeft +=
                  item.left < box.left
                    ? item.left - box.left
                    : item.right > box.right
                      ? item.right - box.right
                      : 0;
            }}
          >
            <AgentPortrait agent={agent} />
            <span>{shortName(agent.name)}</span>
          </button>
        ))}
      </div>
    </footer>
  );
}
