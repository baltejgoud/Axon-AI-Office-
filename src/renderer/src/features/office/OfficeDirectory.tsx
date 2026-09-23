import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { districtById } from './campus/districts';
import { OFFICE_AGENTS } from './data/officeAgents';
import { AgentPortrait } from './AgentPortrait';
import { searchCoworkers } from './shell/search';

/** "Find a person or specialty…": type a name or a skill, pick someone, and the camera goes to them. */
export function OfficeDirectory({ onChoose }: { onChoose: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => searchCoworkers(query, OFFICE_AGENTS, 8), [query]);
  const choose = (id: string) => {
    onChoose(id);
    setQuery('');
  };
  return (
    <div className="office-find-person">
      <Search size={16} />
      <input
        aria-label="Find a coworker"
        placeholder="Find a person or specialty… (front-end, SRE, business analyst)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('');
          if (e.key === 'Enter' && matches[0]) choose(matches[0].id);
        }}
      />
      {query && (
        <button aria-label="Clear coworker search" onClick={() => setQuery('')}>
          <X size={15} />
        </button>
      )}
      {query.trim() && (
        <div className="office-search-results" aria-label="Matching coworkers">
          <div className="office-search-count" role="status">
            {matches.length ? `Best matches for “${query.trim()}”` : 'No one matches yet'}
          </div>
          {matches.map((agent) => (
            <button key={agent.id} onClick={() => choose(agent.id)}>
              <AgentPortrait agent={agent} />
              <span>
                <strong>{agent.name}</strong>
                <small>
                  {agent.department} · {districtById(agent.district).name}
                </small>
              </span>
            </button>
          ))}
          {!matches.length && <p>Try a role such as frontend, analyst, security or files.</p>}
        </div>
      )}
    </div>
  );
}
