import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { roomName, roomOf } from '../../../../../shared/rooms';
import type { Team, TeamAssignment, TeamPost, ToolCall } from '../../../../../shared/types';
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

export function TeamBody({ team }: { team: Team }) {
  const patch = useApp((s) => s.patch);
  const [busy, setBusy] = useState(false);
  const [reviewer, setReviewer] = useState(team.reviewerId ?? 'qa-engineer');
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
        <strong>Team meeting · {roomName(roomOf(team))}</strong>
        <span className={`team-chip is-${team.status}`}>{TEAM_WORDS[team.status]}</span>
      </header>
      <p className="team-goal">{team.goal}</p>
      {team.status==='planned'&&<label className="team-reviewer">Review before the lead reports<select className="input" aria-label="Team reviewer" value={reviewer} onChange={e=>setReviewer(e.target.value)}><option value="">No reviewer</option>{OFFICE_AGENTS.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      {team.review&&<section className="team-review"><strong>{nameOf(team.review.reviewerId)}’s review</strong>{team.review.checks.map(c=><p key={c.taskId}>{c.taskId}: {c.complete?'Verified':c.blockers.join(' ')}</p>)}<button onClick={()=>useOfficeStore.getState().focusOn({agentId:team.review!.reviewerId,conversationId:team.review!.conversationId})}>Read review</button></section>}
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
      {(team.channel?.length ?? 0) > 0 && <TeamChat posts={team.channel} />}
      {team.note && <p className="team-note">{team.note}</p>}
      {team.report && (
        <div className="team-report">
          <strong>Report</strong>
          <Markdown remarkPlugins={[remarkGfm]}>{team.report}</Markdown>
        </div>
      )}
      <div className="team-actions">
        {team.report && <button className="team-button" onClick={() => {
          const url = URL.createObjectURL(new Blob([`# Team completion report\n\n${team.goal}\n\n${team.report}`], { type: 'text/markdown;charset=utf-8' }));
          const link = document.createElement('a'); link.href = url; link.download = `team-report-${team.id}.md`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Download report</button>}
        {team.status === 'planned' && (
          <>
            <button className="team-button" disabled={busy} onClick={() => void act(window.axon.teamDiscard)}>
              Discard
            </button>
            <button className="team-button primary" disabled={busy} onClick={() => void act(async(id)=>{await window.axon.teamReviewer(id,reviewer||null);await window.axon.teamStart(id);})}>
              Start the work
            </button>
          </>
        )}
        {(team.status === 'meeting' || team.status === 'working' || team.status === 'reporting' || (team.status === 'failed' && team.plan)) && (
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

/** Messages shown before "Show all". */
const CHAT_SHOWN = 6;

/** What teammates said to each other while they worked: who to whom, newest last. */
function TeamChat({ posts }: { posts: TeamPost[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? posts : posts.slice(-CHAT_SHOWN);
  return (
    <section className="team-chat" aria-label="Team chat">
      <strong className="team-chat-title">Team chat ({posts.length})</strong>
      {posts.length > shown.length && <p className="team-chat-more">{posts.length - shown.length} earlier</p>}
      <ol>
        {shown.map((post) => (
          <li key={post.id} className="team-chat-post">
            <Face id={post.fromId} />
            <div className="team-chat-text">
              <span className="team-chat-head">
                <strong>{nameOf(post.fromId)}</strong> to {post.toId ? nameOf(post.toId) : 'everyone'} ·{' '}
                <time dateTime={new Date(post.at).toISOString()} title={new Date(post.at).toLocaleString()}>
                  {new Date(post.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </time>
              </span>
              <p>{post.text}</p>
            </div>
          </li>
        ))}
      </ol>
      {posts.length > CHAT_SHOWN && (
        <button className="team-open" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${posts.length}`}
        </button>
      )}
    </section>
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
