import { useState, type KeyboardEvent } from 'react';
import { ArrowUp, Paperclip, X } from 'lucide-react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { Icon } from '../../../ui';

interface AgentComposerProps {
  agentId: string;
}

export function AgentComposer({ agentId }: AgentComposerProps) {
  const { data, model, patch, workspaceId } = useApp();
  const { agentRuntime, setAgentStatus, setAgentTask, setAgentConversation, pushActivity } = useOfficeStore();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<{ id: string; name: string }[]>([]);
  const [sending, setSending] = useState(false);

  const agent = OFFICE_AGENTS.find((a) => a.id === agentId);
  const runtime = agentRuntime[agentId];
  const isBusy = sending || runtime?.status === 'working';

  const handleAttach = async () => {
    try {
      const files = await window.axon.attach();
      if (files?.length) {
        setAttachments((prev) => [...prev, ...files].slice(0, 5));
        pushActivity(agentId, {
          type: 'file',
          title: 'Files attached',
          detail: files.map((f) => f.name).join(', ')
        });
      }
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : 'Could not attach files.' });
    }
  };

  const handleSend = async () => {
    const textToSend = input.trim();
    if (!textToSend || isBusy || !agent) return;

    setSending(true);
    useOfficeStore.getState().setLastResponse(agentId, '');
    setAgentTask(agentId, textToSend);
    setAgentStatus(agentId, 'working');

    pushActivity(agentId, {
      type: 'task_assigned',
      title: 'Task assigned',
      detail: textToSend.length > 80 ? textToSend.slice(0, 80) + '…' : textToSend
    });

    try {
      let convId = runtime?.conversationId;
      if (!convId) {
        const existing = data?.conversations.find((c) => c.agentId === agentId);
        if (existing) {
          convId = existing.id;
        } else {
          const enabledProviders = data?.providers.filter((p) => p.enabled) || [];
          const chosenModel =
            model ||
            (enabledProviders[0]?.models[0]
              ? `${enabledProviders[0].id}::${enabledProviders[0].models[0].id}`
              : '');
          const [providerId, ...modelParts] = chosenModel.split('::');
          if (!providerId || modelParts.length === 0) {
            throw new Error('Please configure and enable an AI model in Settings first.');
          }

          pushActivity(agentId, {
            type: 'started',
            title: 'Preparing context',
            detail: `Starting session for ${agent.name}`
          });

          const workspace =
            data?.workspaces.find((item) => item.id === workspaceId) ??
            (agent.department === 'workspaces' ? data?.workspaces[0] : undefined);
          const savedAgent = data?.agents.find((item) => item.id === agentId);
          const created = await window.axon.chatCreate(
            providerId,
            modelParts.join('::'),
            workspace?.id ?? null,
            savedAgent?.id ?? agentId,
            { skillIds: [], roleIds: [] },
            null,
            savedAgent ? undefined : agent.systemPrompt
          );
          convId = created.id;
        }
        setAgentConversation(agentId, convId);
      }

      patch({ chatId: convId });

      const attachIds = attachments.map((a) => a.id);
      setInput('');
      setAttachments([]);

      pushActivity(agentId, {
        type: 'streaming',
        title: 'Generating response',
        detail: 'Analyzing request and streaming answer'
      });

      await window.axon.chatSend(convId, textToSend, attachIds);
      await useApp.getState().refresh();
    } catch (err) {
      setAgentStatus(agentId, 'error');
      pushActivity(agentId, {
        type: 'error',
        title: 'Error executing task',
        detail: err instanceof Error ? err.message : 'Failed to send prompt to provider'
      });
      patch({ error: err instanceof Error ? err.message : 'Failed to send task to provider.' });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="activity-composer">
      <div className="composer-recipient">
        <span className={`status-dot-sm ${isBusy ? 'working' : ''}`} />
        Message {agent?.name}
      </div>
      {attachments.length > 0 && (
        <div className="composer-attachments-preview">
          {attachments.map((att) => (
            <span key={att.id} className="composer-attachment-tag">
              <Icon icon={Paperclip} size="sm" />
              <span>{att.name}</span>
              <button
                type="button"
                className="btn-icon-subtle"
                aria-label="Remove attachment"
                onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
              >
                <Icon icon={X} size="sm" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="composer-input-wrapper">
        <textarea
          aria-label={`Give ${agent?.name ?? 'this agent'} a task`}
          className="composer-textarea"
          rows={2}
          placeholder={`Give ${agent?.name || 'this agent'} a task...`}
          value={input}
          disabled={isBusy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="composer-actions-row">
          <button
            type="button"
            className="btn-icon-subtle"
            title="Attach file"
            aria-label="Attach file"
            onClick={handleAttach}
            disabled={isBusy}
          >
            <Icon icon={Paperclip} size="sm" />
          </button>

          <span className="composer-hint">Shift+Enter for newline</span>

          <button
            type="button"
            className="composer-btn-send"
            title="Send task (Enter)"
            aria-label="Send task"
            disabled={!input.trim() || isBusy}
            onClick={() => void handleSend()}
          >
            <Icon icon={ArrowUp} size="sm" />
          </button>
        </div>
      </div>
    </div>
  );
}
