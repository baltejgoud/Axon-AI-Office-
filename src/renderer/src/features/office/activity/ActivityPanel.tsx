import { Activity, ArrowUpRight, Check, FileText, Sparkles } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useOfficeStore } from '../store/officeStore';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { useApp } from '../../../state';
import { AgentComposer } from './AgentComposer';
import { AgentPortrait } from '../AgentPortrait';

export function ActivityPanel() {
  const { data, patch, workspaceId } = useApp();
  const { selectedAgentId, agentRuntime } = useOfficeStore();
  const agent = OFFICE_AGENTS.find((a) => a.id === selectedAgentId) ?? OFFICE_AGENTS[0];
  const runtime = agentRuntime[agent.id];
  const conversation =
    data?.conversations.find((c) => c.id === runtime?.conversationId) ??
    data?.conversations.find((c) => c.agentId === agent.id);
  const messages = data?.messages.filter((m) => m.conversationId === conversation?.id) ?? [];
  const assistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastTask = [...messages]
    .reverse()
    .find((m) => m.role === 'user')
    ?.content.split('\n\n<attachment')[0];
  const task = runtime?.currentTask ?? lastTask;
  const status =
    runtime?.status === 'idle' && assistant
      ? assistant.error
        ? 'error'
        : assistant.streaming
          ? 'working'
          : 'completed'
      : (runtime?.status ?? 'idle');
  const response = runtime?.lastResponse || assistant?.content || '';
  const streaming = status === 'working';
  const openConversation = () =>
    patch({
      page: 'chat',
      chatId: conversation?.id ?? runtime?.conversationId ?? null,
      workspaceId: conversation?.workspaceId ?? workspaceId,
      ...(conversation ? { model: `${conversation.providerId}::${conversation.modelId}` } : {})
    });

  return (
    <aside className="office-activity-panel" aria-label="Selected coworker activity">
      <header className="activity-header">
        <div className="activity-title-icon">
          <Activity size={23} />
        </div>
        <div>
          <h2>Activity</h2>
          <p>See what your team is working on.</p>
        </div>
        <span className={`live-badge ${streaming ? 'is-live' : ''}`}>
          <span />
          {streaming ? 'Live' : 'Ready'}
        </span>
      </header>
      <div className="activity-agent-hero">
        <AgentPortrait agent={agent} className="activity-portrait" />
        <div className="activity-agent-meta">
          <span className="activity-selected-tag">Selected coworker</span>
          <h3>{agent.name}</h3>
          <p>{agent.role}</p>
          <span className={`status-badge ${status}`} role="status">
            <span className="status-dot-sm" />
            {status === 'waiting' ? 'Waiting for input' : status[0].toUpperCase() + status.slice(1)}
          </span>
        </div>
      </div>
      <div className="activity-body">
        <section className="current-task-card">
          <div className="activity-section-heading">
            <FileText size={15} />
            <h4>{task ? 'Current task' : 'Let’s make progress'}</h4>
          </div>
          {task ? (
            <p className="current-task-title">{task}</p>
          ) : (
            <>
              <p className="activity-intro">{agent.description}</p>
              <div className="activity-capabilities">
                {agent.capabilities.slice(0, 3).map((cap) => (
                  <span key={cap}>{cap}</span>
                ))}
              </div>
            </>
          )}
          {task && (
            <div className="activity-lifecycle" aria-label={`Task status: ${status}`}>
              <span className="done">
                <Check size={12} />
                Assigned
              </span>
              <span className={streaming ? 'active' : status === 'completed' ? 'done' : ''}>
                <span />
                Generating
              </span>
              <span className={status === 'completed' ? 'done' : status === 'error' ? 'failed' : ''}>
                <span />
                {status === 'error' ? 'Error' : 'Complete'}
              </span>
            </div>
          )}
        </section>
        {response && (
          <section className="response-preview-box">
            <div className="activity-section-heading">
              <Sparkles size={15} />
              <h4>{streaming ? 'Response streaming' : 'Latest response'}</h4>
            </div>
            <div className="markdown-content">
              <Markdown remarkPlugins={[remarkGfm]}>{response}</Markdown>
            </div>
          </section>
        )}
        {assistant?.error && (
          <p className="office-task-error" role="alert">
            {assistant.error}
          </p>
        )}
        <section className="activity-feed-section">
          <div className="activity-section-heading">
            <Activity size={15} />
            <h4>Recent updates</h4>
            <span className="activity-session-label">This session</span>
          </div>
          {runtime?.activities.length ? (
            <ol className="activity-feed-list">
              {runtime.activities.map((event) => (
                <li key={event.id} className={`activity-item type-${event.type}`}>
                  <time>
                    {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                  <div>
                    <strong>{event.title}</strong>
                    {event.detail && <p>{event.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="activity-empty">
              <span>
                <Sparkles size={20} />
              </span>
              <strong>A clear desk. A fresh start.</strong>
              <p>
                Give {shortName(agent.name)} a task.
                <br />
                Updates and answers will appear here.
              </p>
            </div>
          )}
        </section>
        {(conversation || runtime?.conversationId) && (
          <button className="activity-open-chat" onClick={openConversation}>
            Open full conversation
            <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      <AgentComposer key={agent.id} agentId={agent.id} />
    </aside>
  );
}

function shortName(name: string) {
  return name === 'Research Analyst' ? 'your analyst' : `the ${name.toLowerCase()}`;
}
