import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../../state';
import { draftFor, saveDraft, useOfficeStore } from '../store/officeStore';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { IconPaperclip, IconSend, IconStop, IconClose, IconFileText, IconLoader } from '../../../ui';
import { FolderPicker } from './FolderPicker';
import { ModelPicker } from '../../../chat/ModelPicker';
import { activeThread } from './thread';
import { recallStep, sentTexts } from './recall';
import { composerToken, mentionChoices, withMentions, type ComposerToken } from './composerMenu';
import { BUILTIN_PROMPTS, checkedSavedPrompts } from '../../../../../shared/savedPrompts';
import './composerMenu.css';
import { LIBRARY_RESIDENTS, syncOfficeLibrary } from '../library';
import { withFileContext } from './fileContext';
import { RECEPTIONIST_ID } from '../../../../../shared/coworkers';
import { ContextMeter } from '../../../chat/ContextMeter';
import { DictationButton } from '../../../chat/DictationButton';
import { useDictation } from '../../../chat/useDictation';
import { chosenEngine, insertDictation, speechPrompt } from '../../../../../shared/speech';
import {
  MAX_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  filesOnlyText,
  isClipboardName,
  pastedName,
  type AttachedFile
} from '../../../../../shared/attach';

/** The tallest the message box grows as you type before it scrolls. */
const MAX_BOX = 160;

interface AgentComposerProps {
  agentId: string;
}

/** An error from main as plain words, without Electron's "Error invoking remote method" wrapper. */
const plainError = (error: unknown, fallback: string) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : fallback;

export function AgentComposer({ agentId }: AgentComposerProps) {
  const { data, model, patch } = useApp();
  const { agentRuntime, setAgentStatus, setAgentTask, setAgentConversation, pushActivity, removeFile } =
    useOfficeStore();
  const handed = useOfficeStore((s) => s.pendingFiles[agentId]) ?? [];

  // The box opens with whatever was left unsent for this coworker.
  const [input, setInput] = useState(() => draftFor(agentId));
  const [token, setToken] = useState<ComposerToken | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [savingShortcut, setSavingShortcut] = useState(false);
  const [shortcutName, setShortcutName] = useState('');
  const [shortcutError, setShortcutError] = useState('');
  const [saving, setSaving] = useState(false);
  const shortcutInput = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const savedPrompts = data?.settings.savedPrompts ?? [];
  const menuItems =
    token?.kind === 'mention'
      ? mentionChoices(token.query, OFFICE_AGENTS, agentId).map((a) => ({
          key: a.id,
          label: a.name,
          detail: a.department,
          text: `@${a.name} `
        }))
      : token?.kind === 'shortcut'
        ? [
            ...savedPrompts,
            ...BUILTIN_PROMPTS.filter((p) => !savedPrompts.some((s) => s.name.toLowerCase() === p.name))
          ]
            .filter((p) => p.name.toLowerCase().startsWith(token.query.toLowerCase()))
            .slice(0, 8)
            .map((p) => ({ key: p.name, label: `/${p.name}`, detail: p.text, text: p.text }))
        : [];
  const updateMenu = (text: string, caret: number) => {
    const next = composerToken(text, caret);
    const completedMention =
      next?.kind === 'mention' &&
      OFFICE_AGENTS.some((a) => next.query.toLowerCase().startsWith(`${a.name.toLowerCase()} `));
    setToken(completedMention ? null : next);
    setMenuIndex(0);
  };
  const insertMenuItem = (index: number) => {
    const item = menuItems[index];
    if (!token || !item) return;
    const next = input.slice(0, token.start) + item.text + input.slice(token.end);
    const caret = token.start + item.text.length;
    setInput(next);
    setToken(null);
    recalled.current = { index: -1, text: '' };
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(caret, caret);
    });
  };
  useEffect(() => {
    if (savingShortcut) shortcutInput.current?.focus();
  }, [savingShortcut]);
  useEffect(() => {
    if (!token) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        event.target !== box.current
      )
        setToken(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [token]);
  const saveShortcut = async () => {
    if (!data || saving) return;
    setSaving(true);
    setShortcutError('');
    try {
      const prompts = checkedSavedPrompts([...savedPrompts, { name: shortcutName, text: input }]);
      await window.axon.settingsSave({ ...useApp.getState().data!.settings, savedPrompts: prompts });
      await useApp.getState().refresh();
      setSavingShortcut(false);
      setShortcutName('');
      box.current?.focus();
    } catch (error) {
      setShortcutError(plainError(error, 'Could not save the shortcut.'));
    } finally {
      setSaving(false);
    }
  };
  /** The message Up last brought back: its place in what you sent (steps back from the newest) and its text. */
  const recalled = useRef({ index: -1, text: '' });
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  /** What is attached right now, for batches of pasted or dropped files that arrive while another is still being read. */
  const held = useRef<AttachedFile[]>([]);
  const setHeld = (next: AttachedFile[]) => {
    held.current = next;
    setAttachments(next);
  };
  /** Something to say about the files you added (some left out, one unreadable); it fades by itself. */
  const [attachNote, setAttachNote] = useState('');
  const [adding, setAdding] = useState(false);
  /** The panel's box (and the office it sits in, which holds the colours) while files are dragged over it. */
  const [dropping, setDropping] = useState<{ box: DOMRect; host: Element } | null>(null);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Where the cursor was when you started speaking: the words go there. */
  const dictateAt = useRef({ start: 0, end: 0 });

  // The box starts at one line and grows with what you type.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_BOX)}px`;
  }, [input]);

  // A suggestion picked in the empty chat lands in the box, ready to send or to add to; Continue sends.
  const request = useOfficeStore((s) => s.composeRequest);
  useEffect(() => {
    if (!request || request.agentId !== agentId) return;
    useOfficeStore.getState().clearCompose();
    if (request.send) {
      void handleSend(request.text);
      return;
    }
    setInput(request.text);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(request.text.length, request.text.length);
    });
  }, [request, agentId]);

  // Whatever is in the box is kept for this coworker, so it comes back when you return; sending empties it.
  useEffect(() => {
    saveDraft(agentId, input);
  }, [agentId, input]);

  const agent = OFFICE_AGENTS.find((a) => a.id === agentId);
  const runtime = agentRuntime[agentId];
  const conversation = activeThread(data?.conversations ?? [], agentId, runtime);
  const conversationId = conversation?.id;
  // What you sent in this conversation, for Up to bring back (the newest messages the app holds).
  const sent = useMemo(
    () => sentTexts((data?.messages ?? []).filter((m) => m.conversationId === conversationId)),
    [data?.messages, conversationId]
  );
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
  // A new conversation starts with the model this coworker used last; failing that, the one you used last
  // anywhere, marked as inherited so it is never a surprise.
  const enabledModels = (data?.providers ?? [])
    .filter((p) => p.enabled)
    .flatMap((p) => p.models.map((m) => `${p.id}::${m.id}`));
  const remembered = useOfficeStore((s) => s.agentModels[agentId]);
  const ownModel = remembered && enabledModels.includes(remembered) ? remembered : '';
  const startModel = ownModel || model;
  const lastPick = useOfficeStore((s) => s.lastPick);
  const inheritedFrom =
    !conversation && !ownModel && lastPick && lastPick.agentId !== agentId && lastPick.model === model
      ? (OFFICE_AGENTS.find((a) => a.id === lastPick.agentId)?.name ?? 'another coworker')
      : null;
  const needsModel = !conversation && !startModel;
  // The receptionist keeps the planner with tools; a model marked as having none can't.
  const chosen = conversation ? `${conversation.providerId}::${conversation.modelId}` : startModel;
  const [chosenProvider, ...chosenModel] = chosen.split('::');
  // A model marked as having no tools: said before you send, not after the run fails.
  const chosenSpec = data?.providers
    .find((p) => p.id === chosenProvider)
    ?.models.find((m) => m.id === chosenModel.join('::'));
  const noTools = chosenSpec?.supportsTools === false;

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
        setAttachNote('');
        setHeld([...held.current, ...files].slice(0, MAX_ATTACHMENTS));
        pushActivity(agentId, {
          type: 'file',
          title: 'Files attached',
          detail: files.map((f) => f.name).join(', ')
        });
      }
    } catch (error) {
      patch({ error: plainError(error, 'Could not attach files.') });
    }
  };

  /** Batches of pasted or dropped files wait their turn, so the five-file limit counts what the last batch added. */
  const batches = useRef<Promise<void>>(Promise.resolve());
  /**
   * Pasted or dropped files: each is read here and handed over as its bytes (main keeps its own copy
   * under a name it makes up; no path is ever sent). Up to five go with a message; what doesn't fit,
   * or can't be read, is said in a note.
   */
  const addFiles = (files: File[], options: { pasted?: boolean; folders?: number } = {}) => {
    if (!files.length && !options.folders) return;
    batches.current = batches.current.then(async () => {
      const notes: string[] = [];
      if (options.folders)
        notes.push(
          "Folders can't go in a message. To let a coworker work in a folder, choose it with the folder button; or drop the files inside it."
        );
      const room = Math.max(0, MAX_ATTACHMENTS - held.current.length);
      const taking = files.slice(0, room);
      if (files.length > taking.length)
        notes.push(
          room === 0
            ? `A message can carry up to ${MAX_ATTACHMENTS} files, and this one has them. Send it, or remove one first.`
            : `A message can carry up to ${MAX_ATTACHMENTS} files, so I added the first ${taking.length} and left out ${files.length - taking.length}.`
        );
      setAdding(taking.length > 0);
      const added: string[] = [];
      let pictures = 0;
      for (const file of taking) {
        // The clipboard calls every screenshot "image.png"; a name made from the time tells them apart.
        const name =
          options.pasted && file.type.startsWith('image/') && isClipboardName(file.name)
            ? pastedName(file.type, new Date(), ++pictures)
            : file.name || 'Attachment';
        if (file.size === 0) notes.push(`${name} is empty.`);
        else if (file.size > MAX_UPLOAD_BYTES)
          notes.push(`${name} is over 20 MB, which is too big to attach.`);
        else
          try {
            const attached = await window.axon.attachData(name, new Uint8Array(await file.arrayBuffer()));
            setHeld([...held.current, attached].slice(0, MAX_ATTACHMENTS));
            added.push(attached.name);
          } catch (error) {
            notes.push(plainError(error, `Could not attach ${name}.`));
          }
      }
      setAdding(false);
      setAttachNote(notes.join(' '));
      if (added.length)
        pushActivity(agentId, { type: 'file', title: 'Files attached', detail: added.join(', ') });
    });
  };

  // The note fades by itself.
  useEffect(() => {
    if (!attachNote) return;
    const timer = setTimeout(() => setAttachNote(''), 10000);
    return () => clearTimeout(timer);
  }, [attachNote]);

  /** A screenshot or file pasted into the box is attached; text, even with a picture of it alongside, pastes as text. */
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length || e.clipboardData.getData('text/plain').trim()) return;
    e.preventDefault();
    addFiles(files, { pasted: true });
  };

  // Files dragged over the conversation or the box: a calm overlay says where they will go.
  const adder = useRef(addFiles);
  adder.current = addFiles;
  useEffect(() => {
    const panel = root.current?.closest('.office-activity-panel');
    if (!panel) return;
    let depth = 0;
    const withFiles = (e: Event) => Array.from((e as DragEvent).dataTransfer?.types ?? []).includes('Files');
    const enter = (e: Event) => {
      if (!withFiles(e)) return;
      e.preventDefault();
      depth++;
      setDropping({
        box: panel.getBoundingClientRect(),
        host: panel.closest('.office-container') ?? document.body
      });
    };
    const over = (e: Event) => {
      if (!withFiles(e)) return;
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: Event) => {
      if (!withFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(null);
    };
    const drop = (e: Event) => {
      if (!withFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(null);
      const transfer = (e as DragEvent).dataTransfer!;
      // Folders are told from files while the drop is still happening; later the entries are gone.
      const files: File[] = [];
      let folders = 0;
      const items = Array.from(transfer.items ?? []).filter((item) => item.kind === 'file');
      if (items.length)
        for (const item of items) {
          if (item.webkitGetAsEntry?.()?.isDirectory) folders++;
          else {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
      else files.push(...Array.from(transfer.files));
      adder.current(files, { folders });
    };
    const events: [string, (e: Event) => void][] = [
      ['dragenter', enter],
      ['dragover', over],
      ['dragleave', leave],
      ['drop', drop]
    ];
    for (const [type, handler] of events) panel.addEventListener(type, handler);
    return () => {
      for (const [type, handler] of events) panel.removeEventListener(type, handler);
      setDropping(null);
    };
  }, []);

  /** Stops the run: the reply so far stays, a waiting approval is withdrawn, and a message you queued goes next. */
  const handleStop = () => {
    if (!conversation) return;
    void window.axon
      .chatStop(conversation.id)
      .catch((error) => patch({ error: error instanceof Error ? error.message : 'Could not stop.' }));
    pushActivity(agentId, { type: 'message', title: 'Stopped', detail: 'You stopped this task' });
  };

  /** While they work, a message waits for their next step instead of being turned away. */
  const handleQueue = async (textToSend: string) => {
    if (!conversation) return;
    const attachIds = attachments.map((a) => a.id);
    setInput('');
    setHeld([]);
    try {
      await window.axon.chatSend(
        conversation.id,
        withFileContext(
          withMentions(textToSend, OFFICE_AGENTS, agentId),
          useOfficeStore.getState().pendingFiles[agentId] ?? []
        ),
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

  const handleSend = async (text = input) => {
    setToken(null);
    // Files can go on their own: a pasted screenshot needs no words.
    const textToSend = text.trim() || (attachments.length ? filesOnlyText(attachments) : '');
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
    // Working indicators are set only by the main-process supervisor.

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
          startModel ||
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

      // A Continue leaves what you were writing, and its attachments, in the box.
      const fromBox = text === input;
      const attachIds = fromBox ? attachments.map((a) => a.id) : [];
      if (fromBox) {
        setInput('');
        setHeld([]);
        setAttachNote('');
      }

      pushActivity(agentId, {
        type: 'streaming',
        title: 'Generating response',
        detail: 'Analyzing request and streaming answer'
      });

      await window.axon.chatSend(
        convId,
        withFileContext(
          withMentions(textToSend, OFFICE_AGENTS, agentId),
          useOfficeStore.getState().pendingFiles[agentId] ?? []
        ),
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

  /**
   * Up in an empty box brings back what you last sent, and each further Up goes one message back. Down
   * comes forward, and past the newest the box is empty again. Typing starts over.
   */
  const handleRecall = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const up = e.key === 'ArrowUp';
    const last = recalled.current;
    const recalling = last.index >= 0 && input === last.text;
    if (!recalling && (!up || input !== '')) return;
    // A recalled message over several lines: the arrows move the cursor through it first.
    if (recalling) {
      const el = e.currentTarget;
      const beyondCaret = up ? el.value.slice(0, el.selectionStart) : el.value.slice(el.selectionEnd);
      if (beyondCaret.includes('\n')) return;
    }
    const step = recallStep(sent, recalling ? last.index : -1, up ? 'up' : 'down');
    if (!recalling && step.index < 0) return;
    e.preventDefault();
    recalled.current = step;
    setInput(step.text);
    requestAnimationFrame(() => box.current?.setSelectionRange(step.text.length, step.text.length));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (token && !dictating && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setToken(null);
        return;
      }
      if (menuItems.length && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(e.key) && !e.shiftKey) {
        e.preventDefault();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown')
          setMenuIndex((menuIndex + (e.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length);
        else insertMenuItem(menuIndex);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // While you speak, Enter finishes the recording; nothing is sent until the words are in.
      if (dictation.phase === 'recording') dictation.finish();
      else if (!dictating) void handleSend();
    } else if (e.key === 'Escape' && running && !input && !dictating) {
      e.preventDefault();
      handleStop();
    } else if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !e.nativeEvent.isComposing &&
      !dictating
    ) {
      handleRecall(e);
    }
  };

  // A picture only helps a model that can see pictures; said before you send.
  const hasPictures = attachments.some((a) => a.thumbnail);
  const blind = hasPictures && chosenSpec?.supportsVision === false;

  return (
    <div className="activity-composer" ref={root}>
      {dropping &&
        createPortal(
          <div
            className="drop-overlay"
            aria-hidden="true"
            style={{
              left: dropping.box.left,
              top: dropping.box.top,
              width: dropping.box.width,
              height: dropping.box.height
            }}
          >
            <div className="drop-overlay-card">
              <IconPaperclip size={22} />
              <strong>Drop files to attach</strong>
              <span>Pictures, PDFs, Word, Excel and text files, up to {MAX_ATTACHMENTS} per message</span>
            </div>
          </div>,
          dropping.host
        )}
      {noTools && (
        <p className="composer-notice" role="note">
          {agentId === RECEPTIONIST_ID
            ? 'This model can’t use tools, so I can’t keep your planner. Pick another model.'
            : `${chosenSpec?.displayName || 'This model'} can’t use tools, so ${agent?.name ?? 'they'} can only answer from what you write here: no files, searches or connectors. Pick another model for that.`}
        </p>
      )}
      {blind && (
        <p className="composer-notice" role="note">
          {`${chosenSpec?.displayName || 'This model'} can’t see pictures, so it would only get their file names. Pick a model that can see pictures for it to look.`}
        </p>
      )}
      {attachNote && (
        <p className="composer-notice" role="status">
          {attachNote}
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
      {(attachments.length > 0 || adding) && (
        <div className="composer-attachments-preview">
          {attachments.map((att) => (
            <span key={att.id} className="composer-attachment-tag">
              {att.thumbnail ? (
                <img className="composer-attachment-thumb" src={att.thumbnail} alt="" />
              ) : (
                <IconPaperclip size={13} />
              )}
              <span>{att.name}</span>
              <button
                type="button"
                className="btn-icon-subtle"
                aria-label={`Remove ${att.name}`}
                onClick={() => setHeld(held.current.filter((a) => a.id !== att.id))}
              >
                <IconClose size={12} />
              </button>
            </span>
          ))}
          {adding && (
            <span className="composer-attachment-tag adding" role="status">
              <IconLoader className="spin" size={13} />
              <span>Adding…</span>
            </span>
          )}
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
        {token && !dictating && (
          <div className="composer-menu" ref={menu}>
            <div
              id={`composer-menu-${agentId}`}
              role="listbox"
              aria-label={token.kind === 'mention' ? 'Mention a colleague' : 'Prompt shortcuts'}
            >
              {menuItems.map((item, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={i === menuIndex}
                  id={`composer-option-${agentId}-${i}`}
                  key={item.key}
                  tabIndex={-1}
                  className={i === menuIndex ? 'selected' : ''}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMenuItem(i)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </button>
              ))}
            </div>
            {!menuItems.length && <p role="status">No matches</p>}
            <small>↑ ↓ to choose · Enter or Tab to insert · Esc to close</small>
          </div>
        )}
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
                  : attachments.length > 0
                    ? `What should ${agent?.name || 'they'} do with ${attachments.length === 1 ? 'this' : 'these'}?`
                    : `Give ${agent?.name || 'this agent'} a task...`
          }
          value={input}
          aria-haspopup="listbox"
          aria-controls={token && !dictating ? `composer-menu-${agentId}` : undefined}
          aria-activedescendant={
            token && !dictating && menuItems.length ? `composer-option-${agentId}-${menuIndex}` : undefined
          }
          disabled={sending && !conversation}
          onChange={(e) => {
            recalled.current = { index: -1, text: '' };
            setInput(e.target.value);
            updateMenu(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => updateMenu(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setToken(null)}
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key))
              updateMenu(e.currentTarget.value, e.currentTarget.selectionStart);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        <div className="composer-actions-row">
          <button
            type="button"
            className="btn-icon-subtle"
            aria-label="Prompt shortcuts"
            title="Prompt shortcuts"
            onClick={() => {
              setToken({ kind: 'shortcut', start: 0, end: 0, query: '' });
              setMenuIndex(0);
              box.current?.focus();
            }}
          >
            /
          </button>
          <button
            type="button"
            className="btn-icon-subtle"
            title="Attach file"
            aria-label="Attach file"
            onClick={handleAttach}
          >
            <IconPaperclip size={15} />
          </button>

          <DictationButton
            canRetry={dictation.canRetry}
            onRetry={dictation.retry}
            phase={dictation.phase}
            elapsed={dictation.elapsed}
            meter={dictation.meter}
            onClick={toggleDictation}
          />

          <ModelPicker
            value={chosen}
            disabled={isBusy}
            title={conversation ? 'Change the model for the next message' : 'Model for this conversation'}
            note={
              inheritedFrom
                ? {
                    text: 'inherited',
                    title: `Carried over from ${inheritedFrom}. Pick a model to keep one for ${agent?.name ?? 'this coworker'}.`
                  }
                : undefined
            }
            onChange={(value) => {
              patch({ model: value });
              useOfficeStore.getState().setAgentModel(agentId, value);
              if (!conversation) return;
              const [providerId, ...modelParts] = value.split('::');
              void window.axon
                .chatModelSet(conversation.id, providerId, modelParts.join('::'))
                .then(() => useApp.getState().refresh())
                .catch((error) =>
                  patch({ error: error instanceof Error ? error.message : 'Could not change the model.' })
                );
            }}
            onManage={() => useOfficeStore.getState().openOverlay('settings', 'models')}
          />

          {agentId !== RECEPTIONIST_ID && <FolderPicker folder={folder} disabled={isBusy} />}

          {conversation && <ContextMeter key={conversation.id} conversation={conversation} />}

          <span className="composer-end">
            <span className="composer-hint">
              {dictation.phase === 'recording'
                ? 'Enter to finish · Esc to cancel'
                : 'Shift+Enter for a new line'}
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
                {(!running || input.trim() || attachments.length > 0) && (
                  <button
                    type="button"
                    className="composer-btn-send"
                    title={running ? 'Send now; they read it after this step (Enter)' : 'Send task (Enter)'}
                    aria-label={running ? 'Send for their next step' : 'Send task'}
                    disabled={
                      (!input.trim() && !attachments.length) || (sending && !conversation) || dictating
                    }
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
      {input.trim() && !savingShortcut && (
        <button
          type="button"
          className="composer-save-shortcut"
          onClick={() => {
            setToken(null);
            setSavingShortcut(true);
          }}
        >
          Save what’s in the box as a shortcut…
        </button>
      )}
      {savingShortcut && (
        <form
          className="composer-shortcut-save"
          onSubmit={(e) => {
            e.preventDefault();
            void saveShortcut();
          }}
        >
          <label>
            Shortcut name
            <input
              ref={shortcutInput}
              value={shortcutName}
              maxLength={40}
              placeholder="e.g. weekly-update"
              onChange={(e) => setShortcutName(e.target.value)}
              disabled={saving}
            />
          </label>
          <button type="submit" disabled={saving || !shortcutName.trim() || !input.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setSavingShortcut(false);
              box.current?.focus();
            }}
          >
            Cancel
          </button>
          {shortcutError && <p role="alert">{shortcutError}</p>}
        </form>
      )}
    </div>
  );
}
