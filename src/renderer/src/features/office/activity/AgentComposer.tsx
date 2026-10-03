import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { IconPaperclip, IconSend, IconStop, IconClose, IconFileText } from '../../../ui';
import { FolderPicker } from './FolderPicker';
import { ModelPicker } from '../../../chat/ModelPicker';
import { activeThread } from './thread';
import { LIBRARY_RESIDENTS, syncOfficeLibrary } from '../library';
import { withFileContext } from './fileContext';
import { RECEPTIONIST_ID } from '../../../../../shared/coworkers';
import { ContextMeter } from '../../../chat/ContextMeter';
import { DictationButton } from '../../../chat/DictationButton';
import { useDictation } from '../../../chat/useDictation';
import { chosenEngine, insertDictation, speechPrompt } from '../../../../../shared/speech';

/** The tallest the message box grows as you type before it scrolls. */
const MAX_BOX = 160;

interface AgentComposerProps {
  agentId: string;
}

export function AgentComposer({ agentId }: AgentComposerProps) {
  const { data, model, patch } = useApp();
  const { agentRuntime, setAgentStatus, setAgentTask, setAgentConversation, pushActivity, removeFile } =
    useOfficeStore();
  const handed = useOfficeStore((s) => s.pendingFiles[agentId]) ?? [];

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<{ id: string; name: string }[]>([]);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  /** Where the cursor was when you started speaking: the words go there. */
  const dictateAt = useRef({ start: 0, end: 0 });

  // The box starts at one line and grows with what you type.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_BOX)}px`;
  }, [input]);

  // A suggestion picked in the empty chat lands in the box, ready to send or to add to.
  const request = useOfficeStore((s) => s.composeRequest);
  useEffect(() => {
    if (!request || request.agentId !== agentId) return;
    setInput(request.text);
    useOfficeStore.getState().clearCompose();
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(request.text.length, request.text.length);
    });
  }, [request, agentId]);

  const agent = OFFICE_AGENTS.find((a) => a.id === agentId);
  const runtime = agentRuntime[agentId];
  const conversation = activeThread(data?.conversations ?? [], agentId, runtime);
  // A run is going while its reply streams, while it waits on your OK, or while this box's send is out.
  const running =
    sending ||
    runtime?.status === 'working' ||
    runtime?.status === 'waiting' ||
    Boolean(conversation && data?.messages.some((m) => m.conversationId === conversation.id && m.streaming));
  const isBusy = running;
  const waiting = useOfficeStore((s) => (conversation ? s.queued[conversation.id] : undefined)) ?? [];
  const libraryResident = LIBRARY_RESIDENTS.includes(agentId);
  // Where they work: their conversation's own folder, else the project open in the app.
  const folder = conversation?.projectRoot ?? data?.projectRoot ?? null;
  const needsModel = !conversation && !model;
  // The receptionist keeps the planner with tools; a model marked as having none can't.
  const chosen = conversation ? `${conversation.providerId}::${conversation.modelId}` : model;
  const [chosenProvider, ...chosenModel] = chosen.split('::');
  const noTools =
    agentId === RECEPTIONIST_ID &&
    data?.providers.find((p) => p.id === chosenProvider)?.models.find((m) => m.id === chosenModel.join('::'))
      ?.supportsTools === false;

  // Voice typing: the words land at the cursor, to read over before sending.
  const engine = data ? chosenEngine(data.providers, data.settings.voice) : null;
  const dictation = useDictation({
    prompt: () => {
      const recent = conversation
        ? (data?.messages ?? [])
            .filter((m) => m.conversationId === conversation.id)
            .slice(-8)
            .map((m) => m.content)
            .join('\n')
        : '';
      const folderName = folder?.split(/[\\/]/).filter(Boolean).pop() ?? '';
      return speechPrompt({
        names: ['Axon', agent?.name ?? '', folderName],
        recent,
        draft: input.slice(0, dictateAt.current.start)
      });
    },
    onText: (spoken) => {
      const el = box.current;
      const live = !!el && document.activeElement === el;
      setInput((current) => {
        const start = Math.min(live ? el.selectionStart : dictateAt.current.start, current.length);
        const end = Math.min(live ? el.selectionEnd : dictateAt.current.end, current.length);
        const next = insertDictation(current, spoken, start, end);
        dictateAt.current = { start: next.caret, end: next.caret };
        return next.text;
      });
      requestAnimationFrame(() => {
        const caret = dictateAt.current.start;
        box.current?.focus();
        box.current?.setSelectionRange(caret, caret);
      });
    },
    onError: (message) => patch({ error: message })
  });
  const dictating = dictation.phase !== 'idle';

  /** The microphone button and Ctrl+M: start speaking, or finish and type it out. */
  const toggleDictation = () => {
    if (dictation.phase === 'idle') {
      if (!engine) {
        useOfficeStore.getState().openOverlay('settings', 'voice');
        return;
      }
      const el = box.current;
      dictateAt.current = {
        start: el?.selectionStart ?? input.length,
        end: el?.selectionEnd ?? input.length
      };
    }
    dictation.toggle();
  };

  /** Keys anywhere in the composer: Ctrl+M starts or finishes voice typing; Esc drops it. */
  const handleDictationKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleDictation();
    } else if (e.key === 'Escape' && dictating) {
      e.preventDefault();
      e.stopPropagation();
      dictation.cancel();
    }
  };

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

  /** Stops the run: the reply so far stays, a waiting approval is withdrawn, and a message you queued goes next. */
  const handleStop = () => {
    if (!conversation) return;
    void window.axon.chatStop(conversation.id).catch((error) =>
      patch({ error: error instanceof Error ? error.message : 'Could not stop.' })
    );
    pushActivity(agentId, { type: 'message', title: 'Stopped', detail: 'You stopped this task' });
  };

  /** While they work, a message waits for their next step instead of being turned away. */
  const handleQueue = async (textToSend: string) => {
    if (!conversation) return;
    const attachIds = attachments.map((a) => a.id);
    setInput('');
    setAttachments([]);
    try {
      await window.axon.chatSend(
        conversation.id,
        withFileContext(textToSend, useOfficeStore.getState().pendingFiles[agentId] ?? []),
        attachIds
      );
      useOfficeStore.getState().clearFiles(agentId);
      pushActivity(agentId, {
        type: 'message',
        title: 'Message queued',
        detail: 'They read it after their current step'
      });
    } catch (err) {
      // Nothing is lost: what you wrote goes back in the box.
      setInput(textToSend);
      patch({ error: err instanceof Error ? err.message : 'Could not send your message.' });
    }
  };

  const handleSend = async () => {
    const textToSend = input.trim();
    if (!textToSend || !agent) return;
    if (running) {
      if (conversation) await handleQueue(textToSend);
      return;
    }

    setSending(true);
    // The answer arrives in the chat, so that is where the panel goes.
    useOfficeStore.getState().setPanelTab('chat');
    useOfficeStore.getState().setLastResponse(agentId, '');
    setAgentTask(agentId, textToSend);
    setAgentStatus(agentId, 'working');

    pushActivity(agentId, {
      type: 'task_assigned',
      title: 'Task assigned',
      detail: textToSend.length > 80 ? textToSend.slice(0, 80) + '…' : textToSend
    });

    try {
      let convId = conversation?.id;
      if (convId && libraryResident) await syncOfficeLibrary();
      if (!convId) {
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

        const workspaceId = libraryResident ? await syncOfficeLibrary() : null;
        const savedAgent = data?.agents.find((item) => item.id === agentId);
        const created = await window.axon.chatCreate(
          providerId,
          modelParts.join('::'),
          workspaceId,
          savedAgent?.id ?? agentId,
          { skillIds: [], roleIds: agent.roleIds ?? [] },
          null,
          savedAgent ? undefined : agent.systemPrompt
        );
        convId = created.id;
        setAgentConversation(agentId, convId);
        // The panel shows threads from the snapshot, so load the new conversation before streaming.
        await useApp.getState().refresh();
      }

      const attachIds = attachments.map((a) => a.id);
      setInput('');
      setAttachments([]);

      pushActivity(agentId, {
        type: 'streaming',
        title: 'Generating response',
        detail: 'Analyzing request and streaming answer'
      });

      await window.axon.chatSend(
        convId,
        withFileContext(textToSend, useOfficeStore.getState().pendingFiles[agentId] ?? []),
        attachIds
      );
      useOfficeStore.getState().clearFiles(agentId);
      await useApp.getState().refresh();
    } catch (err) {
      // What you wrote goes back in the box, unless you've started another.
      setInput((current) => current || textToSend);
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
      // While you speak, Enter finishes the recording; nothing is sent until the words are in.
      if (dictation.phase === 'recording') dictation.finish();
      else if (!dictating) void handleSend();
    } else if (e.key === 'Escape' && running && !input && !dictating) {
      e.preventDefault();
      handleStop();
    }
  };

  return (
    <div className="activity-composer">
      {noTools && (
        <p className="composer-notice" role="note">
          This model can’t use tools, so I can’t keep your planner. Pick another model.
        </p>
      )}
      {handed.length > 0 && (
        <div className="composer-attachments-preview composer-handed" aria-label="Files handed over">
          {handed.map((file) => (
            <span key={file.path} className="composer-attachment-tag handed" title={file.path}>
              <IconFileText size={13} />
              <span>{file.path.split('/').pop()}</span>
              <button aria-label={`Remove ${file.path}`} onClick={() => removeFile(agentId, file.path)}>
                <IconClose size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="composer-attachments-preview">
          {attachments.map((att) => (
            <span key={att.id} className="composer-attachment-tag">
              <IconPaperclip size={13} />
              <span>{att.name}</span>
              <button
                type="button"
                className="btn-icon-subtle"
                aria-label="Remove attachment"
                onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
              >
                <IconClose size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {waiting.length > 0 && (
        <div className="composer-queued" aria-live="polite">
          {waiting.map((text, i) => (
            <p key={i} className="composer-queued-item" title={text}>
              <span className="composer-queued-label">Waiting for their next step</span>
              <span className="composer-queued-text">{text}</span>
            </p>
          ))}
        </div>
      )}

      <div className="composer-input-wrapper" onKeyDown={handleDictationKeys}>
        <textarea
          ref={box}
          aria-label={`Give ${agent?.name ?? 'this agent'} a task`}
          className="composer-textarea"
          rows={1}
          placeholder={
            dictation.phase === 'recording'
              ? 'Listening… press Enter when you’re done, or Esc to cancel'
              : dictation.phase === 'transcribing'
                ? 'Writing down what you said…'
                : running
                  ? `Add to what ${agent?.name || 'they'} is doing — they read it after this step`
                  : `Give ${agent?.name || 'this agent'} a task...`
          }
          value={input}
          disabled={sending && !conversation}
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
            <IconPaperclip size={15} />
          </button>

          <DictationButton
            phase={dictation.phase}
            elapsed={dictation.elapsed}
            meter={dictation.meter}
            onClick={toggleDictation}
          />

          <ModelPicker
            value={conversation ? `${conversation.providerId}::${conversation.modelId}` : model}
            disabled={isBusy}
            title={conversation ? 'Change the model for the next message' : 'Model for this conversation'}
            onChange={(value) => {
              patch({ model: value });
              if (!conversation) return;
              const [providerId, ...modelParts] = value.split('::');
              void window.axon
                .chatModelSet(conversation.id, providerId, modelParts.join('::'))
                .then(() => useApp.getState().refresh())
                .catch((error) => patch({ error: error instanceof Error ? error.message : 'Could not change the model.' }));
            }}
            onManage={() => useOfficeStore.getState().openOverlay('settings')}
          />

          {agentId !== RECEPTIONIST_ID && <FolderPicker folder={folder} disabled={isBusy} />}

          {conversation && <ContextMeter key={conversation.id} conversation={conversation} />}

          <span className="composer-end">
            <span className="composer-hint">
              {dictation.phase === 'recording' ? 'Enter to finish · Esc to cancel' : 'Shift+Enter for a new line'}
            </span>

            {needsModel ? (
              <button
                type="button"
                className="composer-connect"
                onClick={() => useOfficeStore.getState().openOverlay('settings')}
              >
                Connect a model
              </button>
            ) : (
              <>
                {running && conversation && (
                  <button
                    type="button"
                    className="composer-btn-stop"
                    title={`Stop ${agent?.name ?? 'them'}`}
                    aria-label={`Stop ${agent?.name ?? 'this task'}`}
                    onClick={handleStop}
                  >
                    <IconStop size={13} />
                    <span>Stop</span>
                  </button>
                )}
                {(!running || input.trim()) && (
                  <button
                    type="button"
                    className="composer-btn-send"
                    title={running ? 'Send now; they read it after this step (Enter)' : 'Send task (Enter)'}
                    aria-label={running ? 'Send for their next step' : 'Send task'}
                    disabled={!input.trim() || (sending && !conversation) || dictating}
                    onClick={() => void handleSend()}
                  >
                    <IconSend size={15} />
                  </button>
                )}
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
