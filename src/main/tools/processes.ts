import { TerminalService } from '../runtime/terminal';
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
  const found =
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d{1,5})?(?![\w-]|\.\w)(?:\/[^\s'"<>)\]]*)?/i.exec(
      text.replace(ANSI, '')
    );
  // A sentence's comma or full stop after an address is not part of it.
  return found?.[0].replace(/[.,;:!?]+$/, '').replace('0.0.0.0', 'localhost');
}

interface Running {
  info: ProcessInfo;
  terminalId: string;
}
/** Background commands are views over the same PTY service used by agent and user terminals. */
export class ProcessManager {
  private readonly items = new Map<string, Running>();
  private counter = 0;
  private readonly terminals: TerminalService;
  constructor(
    private readonly emit: (info: ProcessInfo) => void,
    private readonly limit = 4,
    terminals?: TerminalService
  ) {
    this.terminals = terminals ?? new TerminalService(() => {});
    this.terminals.subscribe((session) => {
      const item = [...this.items.values()].find((i) => i.terminalId === session.id);
      if (!item) return;
      item.info.output = session.output.replace(ANSI, '').slice(-OUTPUT_TAIL);
      item.info.running = session.running;
      item.info.exitCode = session.exitCode;
      item.info.url ??= localAddress(item.info.output);
      this.emit({ ...item.info });
    });
  }
  list(): ProcessInfo[] {
    return [...this.items.values()].map((item) => ({ ...item.info }));
  }
  read(id: string): ProcessInfo | undefined {
    const item = this.items.get(id);
    return item && { ...item.info };
  }
  async start(conversationId: string, command: string, cwd: string, wait = 10000): Promise<ProcessInfo> {
    if (this.list().filter((i) => i.running).length >= this.limit)
      throw new Error(`At most ${this.limit} background processes run at once. Stop one first.`);
    const session = await this.terminals.background({ conversationId, command, root: cwd });
    const id = `p${++this.counter}`;
    const item: Running = {
      terminalId: session.id,
      info: {
        id,
        conversationId,
        command,
        cwd,
        running: session.running,
        output: session.output.replace(ANSI, ''),
        startedAt: session.startedAt
      }
    };
    this.items.set(id, item);
    this.emit({ ...item.info });
    const until = Date.now() + wait;
    while (item.info.running && !item.info.url && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 50));
    // Bound completed process metadata; full terminal history is owned by TerminalService.
    const ended = [...this.items.values()].filter((i) => !i.info.running);
    for (const old of ended.slice(0, Math.max(0, ended.length - 40))) this.items.delete(old.info.id);
    return { ...item.info };
  }
  stop(id: string): boolean {
    const item = this.items.get(id);
    if (!item?.info.running) return false;
    this.terminals.kill(item.terminalId);
    return true;
  }
  stopConversation(conversationId: string): void {
    for (const item of this.items.values())
      if (item.info.conversationId === conversationId) this.stop(item.info.id);
  }
  stopAll(): void {
    for (const id of this.items.keys()) this.stop(id);
  }
}
