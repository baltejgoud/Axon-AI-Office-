import { useMemo, useState } from 'react';
import { IconSearch, IconClose } from '../../ui';
import { districtById } from './campus/districts';
import { OFFICE_AGENTS } from './data/officeAgents';
import { AgentPortrait } from './AgentPortrait';
import { searchCoworkers } from './shell/search';

/** "Find a person or specialty…": type a name or a skill, pick someone, and the camera goes to them. */
export function OfficeDirectory({ onChoose }: { onChoose: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const matches = useMemo(() => searchCoworkers(query, OFFICE_AGENTS, 8), [query]);
  const choose = (id: string) => {
    onChoose(id);
    setQuery('');
  };
  return (
    <div className="office-find-person">
      <IconSearch size={16} />
      <input
        aria-label="Find a coworker"
        placeholder="Find a person or specialty…"
        title="Try front-end, SRE or business analyst"
        value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={Boolean(query.trim())}
        aria-controls="office-person-results"
        aria-activedescendant={
          query.trim() && matches[selected] ? `office-person-${matches[selected].id}` : undefined
        }
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.preventDefault();
            setQuery('');
          }
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length) {
            e.preventDefault();
            setSelected(
              (index) => (index + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length
            );
          }
          if (e.key === 'Enter' && query.trim() && matches[selected]) {
            e.preventDefault();
            choose(matches[selected].id);
          }
        }}
      />
      {query && (
        <button aria-label="Clear coworker search" onClick={() => setQuery('')}>
          <IconClose size={15} />
        </button>
      )}
      {query.trim() && (
        <div
          className="office-search-results"
          id="office-person-results"
          role="listbox"
          aria-label="Matching coworkers"
        >
          <div className="office-search-count" role="status">
            {matches.length ? `Best matches for “${query.trim()}”` : 'No one matches yet'}
          </div>
          {matches.map((agent, index) => (
            <button
              key={agent.id}
              id={`office-person-${agent.id}`}
              role="option"
              aria-selected={selected === index}
              onMouseEnter={() => setSelected(index)}
              onClick={() => choose(agent.id)}
            >
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
