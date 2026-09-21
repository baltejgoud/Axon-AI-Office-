import { useEffect, useState } from 'react';
import {
  Bell,
  Bot,
  ChevronDown,
  Code,
  FileText,
  Folder,
  HelpCircle,
  LayoutGrid,
  Library,
  MessageCircle,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  X
} from 'lucide-react';
import { useApp, perform } from './state';
import { timeAgo } from './format';
import { Chat } from './Chat';
import { SettingsPanel } from './Settings';
import { Workspaces, Agents, Knowledge, Code as CodeWorkspace } from './Spaces';
import { AxonLogo, Button, Icon, Kbd, ToastStack } from './ui';

const navItems = [
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
  { id: 'code', icon: Code, label: 'Code' },
  { id: 'knowledge', icon: Library, label: 'Knowledge' },
  { id: 'agents', icon: Bot, label: 'Agents' },
  { id: 'workspaces', icon: LayoutGrid, label: 'Workspaces' }
] as const;

export function App() {
  const { data, page, chatId, workspaceId, error, patch, refresh } = useApp();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);

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
      if (event.key === 'n') {
        event.preventDefault();
        patch({ page: 'chat', chatId: null });
      }
      if (event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        setTimeout(() => document.getElementById('chat-search')?.focus(), 50);
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
  const generating = new Set(data.messages.filter((m) => m.streaming).map((m) => m.conversationId));
  const activeWorkspace = data.workspaces.find((w) => w.id === workspaceId);

  const displayedChats = showAllRecent ? chats : chats.slice(0, 5);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-traffic-lights" aria-hidden="true">
          <span className="traffic-dot dot-close" />
          <span className="traffic-dot dot-min" />
          <span className="traffic-dot dot-max" />
        </div>

        <div className="brand">
          <span className="brand-mark-logo">
            <AxonLogo size={24} />
          </span>
          <span className="brand-name">Axon</span>
          <span className="badge badge-beta">Beta</span>
        </div>

        <button
          className="btn-new-chat"
          onClick={() => navigate('chat', workspaceId)}
          title="New chat (Ctrl+K)"
        >
          <span className="btn-new-chat-left">
            <Icon icon={Plus} size="sm" />
            <span>New chat</span>
          </span>
          <Kbd keys="Mod K" />
        </button>

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
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <span className="label-caps">Recent</span>
          <button
            className="btn-icon-subtle"
            aria-label="Search conversations"
            title="Search conversations"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Icon icon={Search} size="sm" />
          </button>
        </div>

        {searchOpen && (
          <div className="sidebar-search">
            <Icon icon={Search} size="sm" />
            <input
              id="chat-search"
              aria-label="Search conversations"
              placeholder="Search conversations…"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="btn-icon-subtle" onClick={() => setSearch('')} aria-label="Clear">
                <Icon icon={X} size="sm" />
              </button>
            )}
          </div>
        )}

        <div className="history">
          {displayedChats.map((c) => (
            <button
              key={c.id}
              className="nav-item history-item"
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
              <Icon icon={FileText} size="sm" />
              <span className="nav-label">{c.title}</span>
              {generating.has(c.id) ? (
                <span className="thinking-dots nav-generating" aria-label="Generating">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <span className="nav-time">{timeAgo(c.updatedAt)}</span>
              )}
            </button>
          ))}
          {!chats.length && <p className="history-empty text-caption">No conversations yet.</p>}
          {chats.length > 5 && !showAllRecent && (
            <button className="recent-view-all" onClick={() => setShowAllRecent(true)}>
              View all
            </button>
          )}
          {showAllRecent && chats.length > 5 && (
            <button className="recent-view-all" onClick={() => setShowAllRecent(false)}>
              Show less
            </button>
          )}
        </div>

        <div className="sidebar-footer">
          <div
            className="sidebar-workspace-card"
            onClick={() => navigate('workspaces')}
            title="Switch or manage workspaces"
          >
            <div className="workspace-card-icon">
              <Icon icon={Folder} size="sm" />
            </div>
            <div className="workspace-card-info">
              <span className="workspace-card-name">
                {activeWorkspace ? activeWorkspace.name : 'Personal Workspace'}
                <Icon icon={ChevronDown} size="sm" />
              </span>
              <span className="workspace-card-plan">Free plan</span>
            </div>
          </div>

          <button
            className="nav-item"
            aria-current={page === 'settings' ? 'page' : undefined}
            onClick={() => navigate('settings')}
          >
            <Icon icon={Settings} />
            <span className="nav-label">Settings</span>
          </button>

          <button
            className="nav-item"
            onClick={() => {
              window.open('https://github.com', '_blank');
            }}
          >
            <Icon icon={HelpCircle} />
            <span className="nav-label">Help &amp; Feedback</span>
          </button>

          <div className="sidebar-user-card">
            <div className="user-avatar">A</div>
            <div className="user-details">
              <span className="user-name">Alex</span>
              <span className="user-email">alex@axon.ai</span>
            </div>
            <button
              className="user-menu-btn"
              aria-label="User settings"
              title="User settings"
              onClick={() => navigate('settings')}
            >
              <Icon icon={MoreHorizontal} size="sm" />
            </button>
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
      <ToastStack />
    </div>
  );
}
