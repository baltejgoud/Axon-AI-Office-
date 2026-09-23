import { useState } from 'react';
import { Search, Building2, X } from 'lucide-react';
import { OFFICE_AGENTS } from './data/officeAgents';
import { SPECIALIST_GROUPS } from './data/coworkerCatalog';
import { useOfficeStore } from './store/officeStore';
import { AgentPortrait } from './AgentPortrait';

export function OfficeDirectory() {
  const { activeWing, setWing, selectAgent } = useOfficeStore();
  const [query, setQuery] = useState('');
  const normalized = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matches = normalized
    ? OFFICE_AGENTS.filter((agent) =>
        `${agent.name} ${agent.role}`
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .includes(normalized)
      )
    : [];
  const choose = (id: string) => {
    selectAgent(id);
    setQuery('');
  };
  return (
    <div className="office-directory">
      <label className="office-wing-picker">
        <Building2 size={17} />
        <span className="office-sr-only">Office department</span>
        <select aria-label="Office department" value={activeWing} onChange={(e) => setWing(e.target.value)}>
          <option>Headquarters</option>
          {SPECIALIST_GROUPS.map((group) => (
            <option key={group}>{group}</option>
          ))}
        </select>
      </label>
      <div className="office-find-person">
        <Search size={16} />
        <input
          aria-label="Find a coworker"
          placeholder="Find a person or specialty…"
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
        {query && (
          <div className="office-search-results" aria-label="Matching coworkers">
            <div className="office-search-count" role="status">
              {matches.length} coworkers found
            </div>
            {matches.map((agent) => (
              <button key={agent.id} onClick={() => choose(agent.id)}>
                <AgentPortrait agent={agent} />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.wing ?? 'Headquarters'}</small>
                </span>
              </button>
            ))}
            {!matches.length && <p>Try a role such as frontend, analyst, or files.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
