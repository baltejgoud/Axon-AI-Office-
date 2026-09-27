import { spawn, execFile, type ChildProcess } from 'node:child_process';
import type { ProcessInfo } from '../../shared/types';

/** How much of a process's output is kept, from the end. */
const OUTPUT_TAIL = 64_000;
/** How often a running process's news reaches the window. */
const EMIT_EVERY_MS = 250;

/** Colour and cursor codes, which a terminal would draw and a log shows as noise. */
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * The first page a process says it serves on this machine: localhost, 127.0.0.1 or [::1] (and
 * 0.0.0.0, which means every address, shown as localhost). Nothing on another host counts.
 */
export function localAddress(text: string): string | undefined {
  // The host must end there: http://localhost.example.com is somewhere else.
  const found = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d{1,5})?(?![\w-]|\.\w)(?:\/[^\s'"<>)\]]*)?/i.exec(
    text.replace(ANSI, '')
  );
  // A sentence's comma or full stop after an address is not part of it.
  return found?.[0].replace(/[.,;:!?]+$/, '').replace('0.0.0.0', 'localhost');
}

interface Running {
  info: ProcessInfo;
  child: ChildProcess;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Commands that keep running after the tool call that started them: development servers and
 * watchers. A few at a time; all of them stop when Axon quits.
 */
export class ProcessManager {
  private readonly items = new Map<string, Running>();
  private counter = 0;

  constructor(
    private readonly emit: (info: ProcessInfo) => void,
    private readonly limit = 4
  ) {}

  list(): ProcessInfo[] {
    return [...this.items.values()].map((item) => ({ ...item.info }));
  }

  read(id: string): ProcessInfo | undefined {
    const item = this.items.get(id);
    return item && { ...item.info };
  }

  /**
   * Starts `command` in `cwd` and answers once it serves a local page, has run for `wait` ms, or
   * has ended, whichever comes first.
   */
  start(conversationId: string, command: string, cwd: string, wait = 10_000): Promise<ProcessInfo> {
    const running = [...this.items.values()].filter((item) => item.info.running).length;
    if (running >= this.limit)
      return Promise.reject(new Error(`At most ${this.limit} background processes run at once. Stop one first.`));
    const id = `p${++this.counter}`;
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      // Its own process group elsewhere, so stopping it stops what it started.
      detached: process.platform !== 'win32',
      // No browser windows of its own (the page shows in Axon), and no colour codes.
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' }
    });
    const item: Running = {
      child,
      info: { id, conversationId, command, cwd, running: true, output: '', startedAt: Date.now() }
    };
    this.items.set(id, item);
    const send = () => {
      if (item.timer) clearTimeout(item.timer);
      item.timer = undefined;
      this.emit({ ...item.info });
    };
    return new Promise((resolve) => {
      let answered = false;
      const answer = () => {
        if (answered) return;
        answered = true;
        clearTimeout(waiting);
        resolve({ ...item.info });
      };
      const waiting = setTimeout(answer, wait);
      const heard = (chunk: Buffer | string) => {
        item.info.output = (item.info.output + String(chunk).replace(ANSI, '')).slice(-OUTPUT_TAIL);
        if (!item.info.url) {
          const url = localAddress(item.info.output);
          if (url) {
            item.info.url = url;
            send();
            answer();
          }
        }
        if (!item.timer) item.timer = setTimeout(send, EMIT_EVERY_MS);
      };
      child.stdout?.on('data', heard);
      child.stderr?.on('data', heard);
      const ended = (code: number | null) => {
        if (!item.info.running) return;
        item.info.running = false;
        item.info.exitCode = code;
        send();
        answer();
      };
      child.on('exit', (code) => ended(code));
      child.on('error', (error) => {
        item.info.output += `\n${error.message}`;
        ended(null);
      });
      send();
    });
  }

  /** Stops a process and everything it started. False if there was nothing running by that id. */
  stop(id: string): boolean {
    const item = this.items.get(id);
    if (!item?.info.running || !item.child.pid) return false;
    const pid = item.child.pid;
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => undefined);
    else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        item.child.kill('SIGTERM');
      }
    }
    return true;
  }

  stopAll(): void {
    for (const id of this.items.keys()) this.stop(id);
  }
}
