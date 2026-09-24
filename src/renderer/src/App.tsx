import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useApp, perform } from './state';
import { AxonLogo, Button, ToastStack } from './ui';
import { OfficePage } from './features/office/OfficePage';
import { useOfficeStore } from './features/office/store/officeStore';

export function App() {
  const { data, error, patch, refresh } = useApp();

  useEffect(() => {
    void perform(refresh);
  }, []);

  // Theme: resolve 'system' against the OS preference and keep it in sync.
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = data?.settings.theme ?? 'light';
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data?.settings.theme]);

  // Streaming: patch the message in place from the event; refresh only on completion.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.axon.onStream((event) => {
      // Task records arrive whole after every change: swap them in without a full refresh.
      if (event.channel === 'tasks') {
        const current = useApp.getState().data;
        if (current) useApp.getState().patch({ data: { ...current, tasks: event.tasks } });
        return;
      }
      // Sync stream events with office runtime
      if (event.channel === 'chat') {
        const conv = useApp.getState().data?.conversations.find((c) => c.id === event.conversationId);
        const office = useOfficeStore.getState();
        const associatedAgent = Object.entries(office.agentRuntime).find(
          ([, runtime]) => runtime.conversationId === event.conversationId
        )?.[0];
        const agentId = associatedAgent || conv?.agentId;
        if (agentId) {
          if (event.contentSoFar !== undefined) {
            office.setLastResponse(agentId, event.contentSoFar);
          }
          // Status comes from the task records; the feed keeps its own entries.
          if (event.done && event.error) {
            office.pushActivity(agentId, {
              type: 'error',
              title: 'Task error',
              detail: event.error
            });
          } else if (event.done) {
            office.pushActivity(agentId, {
              type: 'completed',
              title: 'Task completed',
              detail: 'Response finished streaming'
            });
          }
        }
      }

      if (event.channel !== 'chat' || event.done) {
        if (!timer)
          timer = setTimeout(() => {
            timer = undefined;
            void perform(refresh);
          }, 60);
        return;
      }
      if (event.approvalRequired) {
        const pending = {
          ...useApp.getState().pendingApprovals,
          [event.approvalRequired.id]: event.approvalRequired
        };
        useApp.getState().patch({ pendingApprovals: pending });
      }
      const current = useApp.getState().data;
      if (!current) return;
      const exists = current.messages.some((m) => m.id === event.messageId);
      const messages = exists
        ? current.messages.map((m) =>
            m.id === event.messageId
              ? {
                  ...m,
                  content: event.contentSoFar ?? m.content,
                  thought: event.thoughtSoFar ?? m.thought,
                  streaming: event.streaming ?? m.streaming,
                  usage: event.usage ?? m.usage,
                  toolCalls: event.toolCall
                    ? [...(m.toolCalls?.filter((tc) => tc.id !== event.toolCall!.id) || []), event.toolCall]
                    : m.toolCalls
                }
              : m
          )
        : [
            ...current.messages,
            {
              id: event.messageId,
              conversationId: event.conversationId,
              role: 'assistant' as const,
              content: event.contentSoFar ?? '',
              thought: event.thoughtSoFar ?? '',
              streaming: true,
              createdAt: Date.now(),
              toolCalls: event.toolCall ? [event.toolCall] : []
            }
          ];
      useApp.getState().patch({ data: { ...current, messages } });
    });

    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === 'k') {
        event.preventDefault();
        useOfficeStore.getState().openOverlay(null);
        setTimeout(
          () => document.querySelector<HTMLInputElement>('[aria-label="Find a coworker"]')?.focus(),
          50
        );
      }
      if (event.key === ',') {
        event.preventDefault();
        useOfficeStore.getState().openOverlay('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      if (timer) clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!data)
    return (
      <div className="startup">
        <span className="brand-mark">
          <AxonLogo size={32} />
        </span>
        <h1>Axon</h1>
        <p>{error || 'Loading your workspace…'}</p>
        {error && (
          <Button variant="primary" onClick={() => void perform(refresh)}>
            Try again
          </Button>
        )}
      </div>
    );

  return (
    <div className="app-shell office-shell">
      <main className="main-area">
        {error && (
          <div className="banner-error" role="alert">
            <span>{error}</span>
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              iconOnly
              aria-label="Dismiss error"
              onClick={() => patch({ error: '' })}
            />
          </div>
        )}
        <OfficePage />
      </main>
      <ToastStack />
    </div>
  );
}
