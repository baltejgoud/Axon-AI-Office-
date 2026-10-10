import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { useEscape } from '../../../ui/escape';
import { RECEPTIONIST_ID } from '../../../../../shared/coworkers';
import { activeThread } from '../activity/thread';
import { conversationCommands, officeCommands, type OfficeCommand } from './commands';
import { IconSearch } from '../../../ui';
import type { ConversationHit } from '../../../../../shared/platform';

/** How long typing pauses before past conversations are searched. */
const SEARCH_PAUSE_MS = 160;

const KIND_LABEL: Record<OfficeCommand['kind'], string> = {
  person: 'Person',
  ask: 'Ask',
  department: 'Department',
  action: 'Action',
  conversation: 'Conversation'
};

export function CommandPalette() {
  const open = useOfficeStore((s) => s.commandPaletteOpen);
  return open ? <Palette /> : null;
}
function Palette() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Past conversations, searched in the main process once typing pauses; a slower, older answer is dropped.
  const [hits, setHits] = useState<{ query: string; found: ConversationHit[] }>({ query: '', found: [] });
  useEffect(() => {
    const wanted = query.trim();
    if (wanted.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      window.axon
        .chatSearch(wanted)
        .then((found) => {
          if (current) setHits({ query: wanted, found });
        })
        .catch(() => undefined);
    }, SEARCH_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);
  const commands = officeCommands(query);
  const found = hits.query === query.trim() ? conversationCommands(hits.found) : [];
  // The "Ask the receptionist" row stays last, after the conversations.
  const ask = commands.filter((item) => item.kind === 'ask');
  const items = [...commands.filter((item) => item.kind !== 'ask'), ...found, ...ask];
  const close = () => useOfficeStore.getState().setCommandPaletteOpen(false);
  useEscape(close);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => {
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus();
    };
  }, []);
  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const choose = (command: OfficeCommand) => {
    const office = useOfficeStore.getState();
    close();
    if (command.kind === 'person') office.flyToAgent(command.agentId);
    else if (command.kind === 'department') office.navigateOffice({ department: command.department });
    else if (command.kind === 'ask') {
      office.focusOn({ agentId: RECEPTIONIST_ID });
      office.compose(RECEPTIONIST_ID, command.prompt);
    } else if (command.kind === 'conversation') {
      office.focusOn({ agentId: command.agentId, conversationId: command.conversationId });
      office.setPanelTab('chat');
      office.revealMessage(
        command.messageId ? { conversationId: command.conversationId, messageId: command.messageId } : null
      );
    } else {
      switch (command.action) {
        case 'welcome':
          office.setWelcomeOpen(true);
          break;
        case 'company':
          office.openOverlay('company');
          break;
        case 'history':
          office.setWorkFullscreen(false);
          office.setFocusMode(false);
          office.setActivityHistoryOpen(true);
          break;
        case 'planner':
          office.closeConversation();
          office.closeCoworkerCard();
          office.setWorkFullscreen(false);
          office.setPlannerOpen(true);
          office.setFocusMode(false);
          break;
        case 'library':
          office.openOverlay('knowledge');
          break;
        case 'settings':
          office.openOverlay('settings');
          break;
        case 'overview':
          office.navigateOffice({ overview: true });
          break;
        case 'focus':
          office.setFocusMode(!office.focusMode);
          break;
        case 'team':
          office.toggle3d();
          break;
        case 'work': {
          const data = useApp.getState().data;
          const thread = activeThread(
            data?.conversations ?? [],
            office.selectedAgentId,
            office.agentRuntime[office.selectedAgentId]
          );
          if (thread)
            office.setWorkChoice(
              thread.id,
              true,
              String(
                data?.tasks.find((t) => t.kind === 'work' && t.conversationId === thread.id)?.runStartedAt ??
                  [...(data?.messages ?? [])]
                    .reverse()
                    .find((m) => m.conversationId === thread.id && m.role === 'user')?.createdAt ??
                  0
              )
            );
          else office.openConversation();
          break;
        }
      }
    }
  };
  return (
    <div
      className="office-command-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={root}
        className="office-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Ask Axon and office commands"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (items[selected]) choose(items[selected]);
          }
          if (e.key === 'Tab') {
            const focusable = Array.from(root.current?.querySelectorAll<HTMLElement>('input,button') ?? []);
            const first = focusable[0],
              last = focusable.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="office-command-search">
          <IconSearch size={20} />
          <input
            ref={input}
            aria-label="Search people, departments, actions and past conversations"
            role="combobox"
            aria-expanded="true"
            aria-controls="office-command-results"
            aria-activedescendant={items[selected] ? `office-command-${selected}` : undefined}
            value={query}
            placeholder="Find a person, a past conversation, or ask Axon…"
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
          />
          <button onClick={close} aria-label="Close command palette">
            Esc
          </button>
        </div>
        <div id="office-command-results" role="listbox" aria-label="Office commands">
          {items.map((item, index) => (
            <button
              key={item.id}
              id={`office-command-${index}`}
              role="option"
              aria-selected={selected === index}
              onMouseMove={() => setSelected(index)}
              onClick={() => choose(item)}
            >
              <span className="command-kind">{KIND_LABEL[item.kind]}</span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </button>
          ))}
        </div>
        <footer>↑ ↓ to browse · Enter to choose · Esc to close</footer>
      </div>
    </div>
  );
}
