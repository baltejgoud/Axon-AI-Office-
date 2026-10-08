import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { useEscape } from '../../../ui/escape';
import { RECEPTIONIST_ID } from '../../../../../shared/coworkers';
import { activeThread } from '../activity/thread';
import { officeCommands, type OfficeCommand } from './commands';
import { IconSearch } from '../../../ui';

export function CommandPalette() {
  const open = useOfficeStore((s) => s.commandPaletteOpen);
  return open ? <Palette /> : null;
}
function Palette() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const items = officeCommands(query);
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
    } else {
      switch (command.action) {
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
            aria-label="Search people, departments and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="office-command-results"
            aria-activedescendant={items[selected] ? `office-command-${selected}` : undefined}
            value={query}
            placeholder="Find a person, go somewhere, or ask Axon…"
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
              <span className="command-kind">
                {item.kind === 'person'
                  ? 'Person'
                  : item.kind === 'ask'
                    ? 'Ask'
                    : item.kind === 'department'
                      ? 'Department'
                      : 'Action'}
              </span>
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
