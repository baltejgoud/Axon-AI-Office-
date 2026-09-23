import { Users } from 'lucide-react';
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
  return (
    <footer className="office-team-dock" aria-label={`${title} team`}>
      <div className="office-team-caption">
        <Users size={17} />
        <strong>{title}</strong>
        <span>
          {people.length} {people.length === 1 ? 'person' : 'people'}
        </span>
      </div>
      <div className="office-team-people">
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
