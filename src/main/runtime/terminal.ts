import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as pty from 'node-pty';
import type { TerminalSession } from '../../shared/runtime';
import { within } from '../project';
export function defaultShell(platform = process.platform, env = process.env): string {
  if (platform === 'win32') {
    for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter))
      if (existsSync(join(dir, 'pwsh.exe'))) return join(dir, 'pwsh.exe');
    const powershell = join(
      env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    return existsSync(powershell) ? powershell : (env.ComSpec ?? 'cmd.exe');
  }
  return env.SHELL && existsSync(env.SHELL) ? env.SHELL : platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}
/** PATH discovery only: never executes a program while preparing model context. */
export function executableAvailability() {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(delimiter);
  return ['git', 'node', 'npm', 'python', 'python3', 'rg', 'pwsh'].filter((name) =>
    dirs.some((dir) => extensions.some((ext) => existsSync(join(dir, name + ext))))
  );
}
export function shellArguments(shell: string, command?: string): string[] {
  if (/powershell|pwsh/i.test(shell))
    return [
      '-NoLogo',
      '-NoProfile',
      ...(command === undefined ? [] : ['-NonInteractive', '-Command', command])
    ];
  if (/cmd(\.exe)?$/i.test(shell)) return command === undefined ? [] : ['/d', '/s', '/c', command];
  return command === undefined ? [] : ['-c', command];
}
export async function terminalCwd(root: string, cwd?: string) {
  const canonicalRoot = await realpath(root);
  const candidate = resolve(canonicalRoot, cwd || '.');
  if (!within(canonicalRoot, candidate))
    throw new Error('Working directory outside project root is not permitted.');
  const actual = await realpath(candidate);
  if (!within(canonicalRoot, actual)) throw new Error('Symbolic link or junction escapes the project.');
  if (!(await stat(actual)).isDirectory()) throw new Error('Working directory is not a folder.');
  return actual;
}
interface Item {
  info: TerminalSession;
  terminal: pty.IPty;
  pending: string;
  timer?: NodeJS.Timeout;
  resolve?: (result: CommandResult) => void;
  cancel?: () => void;
}
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: number;
  duration: number;
  cwd: string;
  shell: string;
  sessionId: string;
}
export class TerminalService {
  private listeners = new Set<(session: TerminalSession, data: string) => void>();
  subscribe(listener: (session: TerminalSession, data: string) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async background(input: {
    conversationId: string;
    root: string;
    command: string;
    cwd?: string;
    runId?: string;
  }) {
    return this.launch(
      {
        conversationId: input.conversationId,
        runId: input.runId,
        projectRoot: input.root,
        cwd: await terminalCwd(input.root, input.cwd),
        owner: 'agent'
      },
      input.command
    ).info;
  }
  private sessions = new Map<string, Item>();
  constructor(private emit: (session: TerminalSession, data: string) => void) {}
  list(conversationId?: string) {
    return [...this.sessions.values()]
      .filter((i) => !conversationId || i.info.conversationId === conversationId)
      .map((i) => ({ ...i.info }));
  }
  private launch(
    input: Omit<TerminalSession, 'id' | 'output' | 'running' | 'startedAt' | 'shell'>,
    command?: string
  ) {
    if ([...this.sessions.values()].filter((i) => i.info.running).length >= 16)
      throw new Error('Too many terminal sessions. Stop a session first.');
    const shell = defaultShell();
    const terminal = pty.spawn(shell, shellArguments(shell, command), {
      name: 'xterm-256color',
      cols: 100,
      rows: 28,
      cwd: input.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: true
    });
    const info: TerminalSession = {
      ...input,
      id: randomUUID(),
      output: '',
      running: true,
      startedAt: Date.now(),
      shell
    };
    const item: Item = { info, terminal, pending: '' };
    this.sessions.set(info.id, item);
    const send = () => {
      clearTimeout(item.timer);
      item.timer = undefined;
      const data = item.pending;
      item.pending = '';
      this.emit({ ...info }, data);
      for (const listener of this.listeners) listener({ ...info }, data);
    };
    terminal.onData((data) => {
      info.output = (info.output + data).slice(-128000);
      item.pending = (item.pending + data).slice(-128000);
      if (!item.timer) item.timer = setTimeout(send, 60);
    });
    terminal.onExit(({ exitCode, signal }) => {
      // ConPTY retains its native console handle after process exit unless explicitly released.
      try {
        terminal.kill();
      } catch {}
      info.running = false;
      info.exitCode = exitCode;
      info.signal = signal;
      item.cancel?.();
      send();
      item.resolve?.({
        stdout: info.output,
        stderr: '',
        exitCode,
        signal,
        duration: Date.now() - info.startedAt,
        cwd: info.cwd,
        shell,
        sessionId: info.id
      });
      // Completed sessions are bounded, including their retained ANSI output.
      const ended = [...this.sessions.values()].filter((i) => !i.info.running);
      for (const old of ended.slice(0, Math.max(0, ended.length - 40))) this.sessions.delete(old.info.id);
    });
    send();
    return item;
  }
  async open(conversationId: string, root: string) {
    const existing = this.list(conversationId).find(
      (s) => s.owner === 'user' && s.running && s.projectRoot === root
    );
    if (existing) return existing;
    return this.launch({ conversationId, projectRoot: root, cwd: await realpath(root), owner: 'user' }).info;
  }
  async run(input: {
    conversationId: string;
    runId?: string;
    root: string;
    command: string;
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
  }) {
    const cwd = await terminalCwd(input.root, input.cwd);
    if (input.signal?.aborted) throw new Error('Command canceled.');
    const item = this.launch(
      {
        conversationId: input.conversationId,
        runId: input.runId,
        projectRoot: input.root,
        cwd,
        owner: 'agent'
      },
      input.command
    );
    return new Promise<CommandResult>((resolve) => {
      item.resolve = resolve;
      const abort = () => this.kill(item.info.id);
      const timer = setTimeout(abort, Math.max(100, Math.min(600000, input.timeout ?? 60000)));
      input.signal?.addEventListener('abort', abort, { once: true });
      item.cancel = () => {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', abort);
      };
      if (input.signal?.aborted) abort();
    });
  }
  write(id: string, data: string) {
    const i = this.require(id);
    if (!i.info.running) throw new Error('Terminal has exited. Restart it.');
    i.terminal.write(data);
  }
  resize(id: string, cols: number, rows: number) {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 2 ||
      rows < 1 ||
      cols > 500 ||
      rows > 200
    )
      throw new Error('Invalid terminal dimensions.');
    const i = this.require(id);
    if (i.info.running) i.terminal.resize(cols, rows);
  }
  kill(id: string) {
    const i = this.require(id);
    if (!i.info.running) return;
    if (process.platform === 'win32')
      execFile('taskkill', ['/pid', String(i.terminal.pid), '/T', '/F'], { windowsHide: true }, () => {
        try {
          i.terminal.kill();
        } catch {}
      });
    else {
      try {
        process.kill(-i.terminal.pid, 'SIGTERM');
      } catch {
        i.terminal.kill();
      }
    }
  }
  stopRun(runId: string) {
    for (const i of this.sessions.values())
      if (i.info.runId === runId && i.info.running) this.kill(i.info.id);
  }
  stopConversation(id: string) {
    for (const i of this.sessions.values())
      if (i.info.conversationId === id && i.info.owner === 'agent' && i.info.running) this.kill(i.info.id);
  }
  stopAll() {
    for (const i of this.sessions.values()) if (i.info.running) this.kill(i.info.id);
  }
  private require(id: string) {
    const i = this.sessions.get(id);
    if (!i) throw new Error('Terminal session not found.');
    return i;
  }
}
