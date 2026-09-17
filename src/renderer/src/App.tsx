import { useEffect, useState } from 'react';
import {
  Bot,
  Code,
  Folder,
  Library,
  MessageCircle,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
  X
} from 'lucide-react';
import { useApp, perform } from './state';
import { Chat } from './Chat';
import { SettingsPanel } from './Settings';
import { Workspaces, Agents, Knowledge, Code as CodeWorkspace } from './Spaces';
import { Button, Icon, Kbd } from './ui';

const navItems = [
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
  { id: 'code', icon: Code, label: 'Code' },
  { id: 'knowledge', icon: Library, label: 'Knowledge' },
  { id: 'agents', icon: Bot, label: 'Agents' }
] as const;

export function App() {
  const { data, page, chatId, workspaceId, error, patch, refresh } = useApp();
  const [search, setSearch] = useState('');

  useEffect(() => {
    void perform(refresh);
  }, []);

  // Theme: resolve 'system' against the OS preference and keep it in sync.
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = data?.settings.theme ?? 'dark';
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
      if (event.channel !== 'chat' || event.done) {
        if (!timer)
          timer = setTimeout(() => {
            timer = undefined;
            void perform(refresh);
          }, 60);
        return;
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
                  streaming: event.streaming ?? m.streaming,
                  usage: event.usage ?? m.usage
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
              streaming: true,
              createdAt: Date.now()
            }
          ];
      useApp.getState().patch({ data: { ...current, messages } });
    });

    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === 'n') {
        event.preventDefault();
        patch({ page: 'chat', chatId: null });
      }
      if (event.key === 'k') {
        event.preventDefault();
        document.getElementById('chat-search')?.focus();
      }
      if (event.key === ',') {
        event.preventDefault();
        patch({ page: 'settings' });
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
          <Icon icon={Sparkles} />
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

  const navigate = (next: string, id: string | null = null) => {
    const workspace = data.workspaces.find((w) => w.id === (next === 'code' ? 'code' : id));
    const provider = data.providers.find((p) => p.enabled && p.id === workspace?.defaultProviderId);
    const defaultModel = provider?.models.find((m) => m.id === workspace?.defaultModelId);
    patch({
      page: next,
      workspaceId: id,
      chatId: null,
      ...(provider && defaultModel ? { model: `${provider.id}::${defaultModel.id}` } : {})
    });
  };

  const query = search.trim().toLowerCase();
  const chats = data.conversations
    .filter(
      (c) =>
        !query ||
        c.title.toLowerCase().includes(query) ||
        data.messages.some((m) => m.conversationId === c.id && m.content.toLowerCase().includes(query))
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const customWorkspaces = data.workspaces.filter((w) => !w.builtin);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon icon={Sparkles} />
          </span>
          <span className="brand-name">Axon</span>
          <span className="badge badge-outline">Beta</span>
        </div>

        <Button variant="primary" block icon={Plus} onClick={() => navigate('chat', workspaceId)}>
          New conversation
        </Button>

        <div className="sidebar-search" style={{ marginTop: 'var(--space-2)' }}>
          <Icon icon={Search} size="sm" />
          <input
            id="chat-search"
            aria-label="Search conversations"
            placeholder="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Kbd keys="Mod K" />
        </div>

        <nav className="nav" aria-label="Main">
          {navItems.map(({ id, icon, label }) => (
            <button
              key={id}
              className="nav-item"
              aria-current={page === id && !workspaceId ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              <Icon icon={icon} />
              <span className="nav-label">{label}</span>
              {id === 'chat' && <Kbd keys="Mod N" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <span className="label-caps">Workspaces</span>
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            iconOnly
            aria-label="Create workspace"
            onClick={() => navigate('workspaces')}
          />
        </div>
        <div className="nav">
          {customWorkspaces.map((w) => (
            <button
              key={w.id}
              className="nav-item"
              aria-current={workspaceId === w.id ? 'page' : undefined}
              onClick={() => navigate('chat', w.id)}
            >
              <Icon icon={Folder} />
              <span className="nav-label">{w.name}</span>
            </button>
          ))}
          {!customWorkspaces.length && <p className="history-empty text-caption">No workspaces yet.</p>}
        </div>

        <div className="sidebar-section">
          <span className="label-caps">Recent</span>
          <span className="text-caption">{chats.length}</span>
        </div>
        <div className="history">
          {chats.slice(0, 100).map((c) => (
            <button
              key={c.id}
              className="nav-item"
              aria-current={chatId === c.id ? 'page' : undefined}
              onClick={() =>
                patch({
                  page: 'chat',
                  chatId: c.id,
                  workspaceId: c.workspaceId,
                  model: `${c.providerId}::${c.modelId}`
                })
              }
            >
              <Icon icon={MessageCircle} size="sm" />
              <span className="nav-label">{c.title}</span>
            </button>
          ))}
          {!chats.length && <p className="history-empty text-caption">Conversations appear here.</p>}
        </div>

        <div className="sidebar-footer">
          <button
            className="nav-item"
            aria-current={page === 'settings' ? 'page' : undefined}
            onClick={() => navigate('settings')}
          >
            <Icon icon={Settings} />
            <span className="nav-label">Settings</span>
            <Kbd keys="Mod ," />
          </button>
          <div className="sidebar-status">
            <span className="status-dot" aria-hidden="true" />
            Local data · keys stay on this device
          </div>
        </div>
      </aside>

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
        {page === 'chat' && <Chat />}
        {page === 'settings' && <SettingsPanel />}
        {page === 'workspaces' && <Workspaces />}
        {page === 'agents' && <Agents />}
        {page === 'knowledge' && <Knowledge />}
        {page === 'code' && <CodeWorkspace />}
      </main>
    </div>
  );
}
