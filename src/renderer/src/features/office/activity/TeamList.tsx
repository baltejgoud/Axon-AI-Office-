import { useState, type CSSProperties } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { TaskItem } from '../../../../../shared/types';
import { timeAgo } from '../../../format';
import { useApp } from '../../../state';
import { useEscape } from '../../../ui/escape';
import { AgentPortrait } from '../AgentPortrait';
import { TASK_BOARDS } from '../campus/boards';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { shortName } from '../shell/framing';
import { useOfficeStore } from '../store/officeStore';
import { teamList, type Team } from '../tasks';

const DONE_SHOWN = 20;
const EMPTY: TaskItem[] = [];
const STATUS_LABEL: Record<TaskItem['status'], string> = {
  attention: 'Needs attention',
  working: 'Working',
  done: 'Done',
  open: 'To do'
};

/** One team's tasks, from its board: what needs you, what is under way, and what is done. */
export function TeamList({ team }: { team: Team }) {
  const tasks = useApp((s) => s.data?.tasks ?? EMPTY);
  const [more, setMore] = useState(false);
  const board = TASK_BOARDS.find((b) => b.team === team);
  const groups = teamList(tasks, team);
  const close = () => useOfficeStore.getState().openTeamBoard(null);
  useEscape(close);

  /** Opens the conversation behind a task: the coworker's own, or the one they were helping with. */
  const open = (task: TaskItem) => {
    const agentId = task.kind === 'help' ? task.forCoworkerId : task.coworkerId;
    if (!agentId) return;
    const store = useOfficeStore.getState();
    store.flyToAgent(agentId);
    if (task.conversationId) store.setAgentConversation(agentId, task.conversationId);
  };

  const done = more ? groups.done : groups.done.slice(0, DONE_SHOWN);
  const empty = !groups.attention.length && !groups.working.length && !groups.done.length;
  return (
    <div className="team-list" style={{ '--team-color': board?.color ?? '#3867f6' } as CSSProperties}>
      <header className="team-list-header">
        <button className="team-list-back" aria-label="Back to the coworker" onClick={close}>
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2>{board?.title ?? team}</h2>
          <p>Team tasks</p>
        </div>
      </header>
      <div className="team-list-body">
        {empty && (
          <p className="team-list-empty">
            No tasks yet. Give someone on this team a task and it shows up here.
          </p>
        )}
        <Group title="Needs attention" tasks={groups.attention} onOpen={open} />
        <Group title="Working" tasks={groups.working} onOpen={open} />
        <Group title="Done" tasks={done} onOpen={open} />
        {groups.done.length > DONE_SHOWN && !more && (
          <button className="team-list-more" onClick={() => setMore(true)}>
            Show more ({groups.done.length - DONE_SHOWN})
          </button>
        )}
      </div>
    </div>
  );
}

function Group({
  title,
  tasks,
  onOpen
}: {
  title: string;
  tasks: TaskItem[];
  onOpen: (task: TaskItem) => void;
}) {
  if (!tasks.length) return null;
  return (
    <section className="team-list-group">
      <h3>
        {title} <span>{tasks.length}</span>
      </h3>
      <ul>
        {tasks.map((task) => {
          const person = OFFICE_AGENTS.find((agent) => agent.id === task.coworkerId);
          return (
            <li key={task.id}>
              <button className={`team-list-row status-${task.status}`} onClick={() => onOpen(task)}>
                {person && <AgentPortrait agent={person} className="team-list-portrait" />}
                <span className="team-list-text">
                  <strong>{task.title}</strong>
                  <small>
                    {shortName(person?.name ?? '')} · {STATUS_LABEL[task.status]} · {timeAgo(task.updatedAt)}
                  </small>
                  {task.note && task.status !== 'done' && (
                    <small className="team-list-note">{task.note}</small>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
