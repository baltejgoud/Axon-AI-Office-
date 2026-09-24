import { AlertCircle, Users } from 'lucide-react';
import type { Briefing as Brief } from '../../../../../shared/planner';
import { AgentPortrait } from '../AgentPortrait';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { useOfficeStore } from '../store/officeStore';

const RECEPTIONIST = OFFICE_AGENTS.find((agent) => agent.id === 'receptionist')!;

/** The morning briefing, in the receptionist's voice. Shown once a day; never saved to her thread. */
export function Briefing({ briefing }: { briefing: Brief }) {
  const dismiss = () => {
    useOfficeStore.getState().setBriefing(null);
    useOfficeStore.getState().setPlannerOpen(true);
  };
  return (
    <section className="briefing-card" aria-label="Today’s briefing">
      <header>
        <AgentPortrait agent={RECEPTIONIST} className="briefing-portrait" />
        <span>
          <small>Receptionist</small>
          <strong>{briefing.greeting}! Here’s your day.</strong>
        </span>
      </header>
      {briefing.today.length > 0 ? (
        <>
          <h5>Today</h5>
          <ul>
            {briefing.today.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>Nothing scheduled for today.</p>
      )}
      {briefing.overdue.length > 0 && (
        <>
          <h5 className="briefing-overdue">
            <AlertCircle size={12} /> Overdue
          </h5>
          <ul>
            {briefing.overdue.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {briefing.coworkers && (
        <p className="briefing-team">
          <Users size={12} /> {briefing.coworkers}.
        </p>
      )}
      <button className="briefing-dismiss" onClick={dismiss}>
        Got it
      </button>
    </section>
  );
}
