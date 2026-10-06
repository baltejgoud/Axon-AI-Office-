import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import type { TerminalSession } from '../../../../../shared/runtime';
export function LiveTerminal({ conversationId }: { conversationId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal>();
  const search = useRef<SearchAddon>();
  const selected = useRef<string>();
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void window.axon
      .terminalList(conversationId)
      .then((items) => {
        setSessions(items);
        setSessionId(items.at(-1)?.id ?? '');
      })
      .catch((e) => setError(String(e)));
  }, [conversationId]);
  useEffect(() => {
    const term = new Terminal({
      scrollback: 2000,
      fontSize: 12,
      convertEol: true,
      theme: { background: '#10151e' }
    });
    const fit = new FitAddon();
    const finder = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(finder);
    terminal.current = term;
    search.current = finder;
    term.open(host.current!);
    const input = term.onData((data) => {
      if (selected.current)
        void window.axon.terminalWrite(selected.current, data).catch((e) => setError(String(e)));
    });
    const resize = new ResizeObserver(() => {
      if (!host.current?.clientHeight) return;
      fit.fit();
      if (selected.current)
        void window.axon.terminalResize(selected.current, term.cols, term.rows).catch(() => {});
    });
    resize.observe(host.current!);
    const off = window.axon.onStream((event) => {
      if (event.channel !== 'terminal' || event.session.conversationId !== conversationId) return;
      setSessions((items) => [...items.filter((s) => s.id !== event.session.id), event.session].slice(-40));
      if (selected.current === event.session.id) term.write(event.data);
      if (!selected.current) setSessionId(event.session.id);
    });
    return () => {
      off();
      resize.disconnect();
      input.dispose();
      term.dispose();
    };
  }, [conversationId]);
  useEffect(() => {
    selected.current = sessionId;
    terminal.current?.reset();
    const info = sessions.find((s) => s.id === sessionId);
    if (info) terminal.current?.write(info.output);
  }, [sessionId]);
  const open = () => {
    void window.axon
      .terminalOpen(conversationId)
      .then((s) => {
        setSessions((items) => [...items.filter((i) => i.id !== s.id), s]);
        setSessionId(s.id);
      })
      .catch((e) => setError(String(e)));
  };
  const current = sessions.find((s) => s.id === sessionId);
  return (
    <section className="live-terminal">
      <div className="live-terminal-toolbar">
        <select
          aria-label="Terminal session"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
        >
          <option value="">Choose session</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.owner} · {s.shell.split(/[\\/]/).at(-1)} · {s.running ? 'running' : `exit ${s.exitCode}`}
            </option>
          ))}
        </select>
        <button onClick={open}>User terminal</button>
        <button
          disabled={!current?.running}
          onClick={() => void window.axon.terminalWrite(sessionId, '\x03')}
        >
          Ctrl+C
        </button>
        <button disabled={!current?.running} onClick={() => void window.axon.terminalKill(sessionId)}>
          Kill
        </button>
        <button onClick={() => terminal.current?.clear()}>Clear</button>
        <button
          onClick={() =>
            void navigator.clipboard.writeText(terminal.current?.getSelection() || current?.output || '')
          }
        >
          Copy
        </button>
        <input
          aria-label="Search terminal output"
          placeholder="Search output"
          onChange={(e) => search.current?.findNext(e.target.value)}
        />
      </div>
      <small>
        {current
          ? `${current.owner === 'user' ? 'Human-controlled terminal' : 'Approved agent command'} · ${current.cwd}`
          : 'Agent command sessions appear here. Open a user terminal to type directly.'}
      </small>
      {error && <p role="alert">{error}</p>}
      <div ref={host} className="live-terminal-screen" />
    </section>
  );
}
