import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Team, TeamAssignment, ToolCall } from '../../../../../shared/types';
import { useApp } from '../../../state';
import { IconUsers } from '../../../ui';
import { AgentPortrait } from '../AgentPortrait';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { useOfficeStore } from '../store/officeStore';
import { TASK_WORDS, TEAM_WORDS, teamOfCall } from '../team';

const agentOf = (id: string) => OFFICE_AGENTS.find((a) => a.id === id);
const nameOf = (id: string) => agentOf(id)?.name ?? id;

/** Someone's face, or a plain circle for anyone the office doesn't seat. */
function Face({ id }: { id: string }) {
  const agent = agentOf(id);
  return agent ? (
    <AgentPortrait agent={agent} className="team-face" />
  ) : (
    <span className="team-face fallback">
      <IconUsers size={12} />
    </span>
  );
}

/**
 * A team the Chief of Staff (or Ops Coordinator) gathered: who is in it, what each said, the plan
 * waiting for your Start, then each task as it goes, and the report. Lives under the lead's
 * call_team_meeting call in their thread.
 */
export function TeamCard({ call }: { call: ToolCall }) {
  const teams = useApp((s) => s.data?.teams) ?? [];
  const team = teamOfCall(call, teams);
  if (call.error) return <div className="team-card failed">{call.error}</div>;
  if (!team)
    return (
      <div className="team-card">
        <header>
          <IconUsers size={14} />
          <strong>Gathering the team…</strong>
        </header>
      </div>
    );
  return <TeamBody team={team} />;
}

function TeamBody({ team }: { team: Team }) {
  const patch = useApp((s) => s.patch);
  const [busy, setBusy] = useState(false);
  const act = async (action: (id: string) => Promise<void>) => {
    setBusy(true);
    try {
      await action(team.id);
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : 'That did not work.' });
    } finally {
      setBusy(false);
    }
  };
  const said = team.minutes.filter((m) => !m.error).length;
  const meeting = team.status === 'meeting';
  return (
    <div className={`team-card is-${team.status}`}>
      <header>
        <IconUsers size={14} />
        <strong>Team meeting</strong>
        <span className={`team-chip is-${team.status}`}>{TEAM_WORDS[team.status]}</span>
      </header>
      <p className="team-goal">{team.goal}</p>
      <ul className="team-people" aria-label="Who is in the team">
        {team.attendees.map((id) => {
          const spoke = team.minutes.find((m) => m.coworkerId === id);
          return (
            <li key={id} className={meeting && !spoke ? 'is-thinking' : ''} title={nameOf(id)}>
              <Face id={id} />
              <span>{nameOf(id)}</span>
            </li>
          );
        })}
      </ul>
      {meeting && (
        <p className="team-progress">
          {said} of {team.attendees.length} have given their input
          {said === team.attendees.length ? '; the plan is being drawn up' : ''}…
        </p>
      )}
      {team.minutes.length > 0 && (
        <details className="team-minutes">
          <summary>What each person said ({team.minutes.length})</summary>
          {team.minutes.map((m) => (
            <div key={m.coworkerId} className="team-minute">
              <strong>{nameOf(m.coworkerId)}</strong>
              {m.error ? <p className="team-error">Could not answer: {m.error}</p> : <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>}
            </div>
          ))}
        </details>
      )}
      {team.plan && (
        <div className="team-plan">
          {team.plan.summary && <p className="team-summary">{team.plan.summary}</p>}
          <ol className="team-tasks">
            {team.plan.assignments.map((a) => (
              <TaskRow key={a.id} task={a} />
            ))}
          </ol>
        </div>
      )}
      {team.note && <p className="team-note">{team.note}</p>}
      {team.report && (
        <div className="team-report">
          <strong>Report</strong>
          <Markdown remarkPlugins={[remarkGfm]}>{team.report}</Markdown>
        </div>
      )}
      <div className="team-actions">
        {team.status === 'planned' && (
          <>
            <button className="team-button" disabled={busy} onClick={() => void act(window.axon.teamDiscard)}>
              Discard
            </button>
            <button className="team-button primary" disabled={busy} onClick={() => void act(window.axon.teamStart)}>
              Start the work
            </button>
          </>
        )}
        {(team.status === 'meeting' || team.status === 'working' || team.status === 'reporting') && (
          <button className="team-button" disabled={busy} onClick={() => void act(window.axon.teamStop)}>
            Stop team
          </button>
        )}
        {(team.status === 'failed' || team.status === 'stopped') && (
          <button className="team-button primary" disabled={busy} onClick={() => void act(window.axon.teamRetry)}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

/** One task: owner, title, what it waits for and owns, and how it is going, with a way into their chat. */
function TaskRow({ task }: { task: TeamAssignment }) {
  const open = () => {
    if (!task.conversationId) return;
    const office = useOfficeStore.getState();
    office.focusOn({ agentId: task.ownerId, conversationId: task.conversationId });
    office.setPanelTab('chat');
  };
  return (
    <li className={`team-task is-${task.status}`}>
      <Face id={task.ownerId} />
      <div className="team-task-text">
        <span className="team-task-title">
          <strong>{nameOf(task.ownerId)}</strong> · {task.title}
        </span>
        <span className="team-task-meta">
          {task.dependsOn.length > 0 && <>after {task.dependsOn.join(', ')} · </>}
          {task.files.length > 0 && <code>{task.files.join(', ')}</code>}
        </span>
        {task.note && <span className="team-task-note">{task.note}</span>}
      </div>
      <span className={`team-chip is-${task.status}`}>{TASK_WORDS[task.status]}</span>
      {task.conversationId && (
        <button className="team-open" onClick={open} title={`Open ${nameOf(task.ownerId)}'s chat for this task`}>
          Open chat
        </button>
      )}
    </li>
  );
}
