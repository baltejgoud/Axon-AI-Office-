import type { FileChange, Message, ToolCall } from '../../../../../shared/types';

/** The office's share of the left side when a work surface first opens: 60 office, 40 work. */
export const DEFAULT_WORK_SPLIT = 0.6;
/** The office keeps 30–80% of the height, so the work surface always has 20–70%. */
export const MIN_OFFICE_SHARE = 0.3;
export const MAX_OFFICE_SHARE = 0.8;

export const clampWorkSplit = (share: number): number =>
  Number.isFinite(share) ? Math.min(MAX_OFFICE_SHARE, Math.max(MIN_OFFICE_SHARE, share)) : DEFAULT_WORK_SPLIT;

/** What a coworker is working in, each on its own tab of the work surface. */
export type WorkKind = 'code' | 'files' | 'terminal' | 'preview' | 'browser' | 'tool';

export const WORK_TABS: readonly { kind: WorkKind; label: string }[] = [
  { kind: 'code', label: 'Code' },
  { kind: 'files', label: 'Files' },
  { kind: 'terminal', label: 'Terminal' },
  // A page a coworker's background process serves on this machine; shown when there is one.
  { kind: 'preview', label: 'Preview' },
  { kind: 'browser', label: 'Browser' },
  { kind: 'tool', label: 'Tools' }
];

/** Asking a colleague, the planner, memory and helpers happen in the office, not on a surface. */
const OFFICE_TOOLS = new Set([
  'ask_colleague',
  'add_task',
  'list_tasks',
  'update_task',
  'complete_task',
  'read_memory',
  'update_memory',
  'dispatch_subagent',
  'find_people',
  'call_team_meeting'
]);

/** Connected tools that drive or read a web page. */
const BROWSER_TOOL =
  /browser|navigate|playwright|puppeteer|chrome|web_?fetch|fetch_?url|open_?url|screenshot/i;

/** Which surface a call is shown on; nothing for the office's own business. */
export function workKind(name: string, args: Record<string, unknown>): WorkKind | null {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return 'code';
    case 'list_files':
    case 'search_code':
      return 'files';
    case 'run_command':
    case 'git_commit':
    case 'start_process':
    case 'read_process':
    case 'stop_process':
      return 'terminal';
  }
  if (OFFICE_TOOLS.has(name)) return null;
  if (typeof args.url === 'string' || BROWSER_TOOL.test(name)) return 'browser';
  return 'tool';
}

export interface WorkStep {
  /** The tool call's id. */
  id: string;
  kind: WorkKind;
  name: string;
  args: Record<string, unknown>;
  /** Running until the tool answers (or waiting for approval, which the window keeps). */
  state: 'running' | 'done' | 'failed';
  /** The tool's answer, or why it failed; while a command runs, its output so far. */
  output: string;
  /** When the message holding the call was written. */
  at: number;
  /** What a file write changed. */
  change?: FileChange;
  /** A finished read, as the file's own lines. */
  read?: { text: string; firstLine: number };
  /** The background process a start_process call began (or read_process and stop_process name). */
  processId?: string;
  call: ToolCall;
}

export interface WorkFile {
  path: string;
  /** What the coworker last read or wrote there. */
  text: string;
  /** The first line number shown: a read can start part-way down. */
  firstLine: number;
  /** 'written' once they changed it (or are asking to). */
  touch: 'read' | 'written';
  /** The latest step on this file. */
  step: WorkStep;
  /** The latest write that went through, for its change. */
  written?: WorkStep;
}

export interface Work {
  steps: WorkStep[];
  latest: WorkStep | undefined;
  /** The tabs with something on them, in tab order. */
  tabs: WorkKind[];
  /** Files read or written, in the order they were first opened. */
  files: WorkFile[];
  commands: WorkStep[];
  /** File listings and code searches. */
  searches: WorkStep[];
  pages: WorkStep[];
  tools: WorkStep[];
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Steps by the call they came from. The window keeps a call's object until the call changes, so a
 * thread is re-read on every streamed token without parsing a single argument twice.
 */
const stepCache = new WeakMap<ToolCall, WorkStep | null>();

function stepOf(call: ToolCall, at: number): WorkStep | null {
  const cached = stepCache.get(call);
  if (cached !== undefined) return cached;
  const args = parseArgs(call.arguments);
  const kind = workKind(call.name, args);
  const state = call.error ? 'failed' : call.result !== undefined ? 'done' : 'running';
  const step: WorkStep | null = kind && {
    id: call.id,
    kind,
    name: call.name,
    args,
    state,
    output: call.error ?? call.result ?? call.progress ?? '',
    at,
    change: call.change,
    read: call.name === 'read_file' && state === 'done' ? readText(call.result ?? '') : undefined,
    processId:
      call.process?.id ??
      (call.name.endsWith('_process') && typeof args.id === 'string' ? args.id : undefined),
    call
  };
  stepCache.set(call, step);
  return step;
}

/** A read_file answer ("12: text" per line) as the file's own lines, and where they start. */
export function readText(output: string): { text: string; firstLine: number } {
  const lines = output.split('\n');
  const first = /^(\d+): /.exec(lines[0] ?? '');
  if (!first) return { text: output === '(empty file)' ? '' : output, firstLine: 1 };
  return { text: lines.map((line) => line.replace(/^\d+: ?/, '')).join('\n'), firstLine: Number(first[1]) };
}

/** Everything a coworker did in a thread (messages as `withOutcomes` gives them), by surface. */
export function workOf(messages: readonly Message[]): Work {
  const steps = messages.flatMap((m) =>
    m.role === 'assistant'
      ? (m.toolCalls ?? []).map((call) => stepOf(call, m.createdAt)).filter((s): s is WorkStep => s !== null)
      : []
  );
  const files = new Map<string, WorkFile>();
  for (const step of steps) {
    const path = stepPath(step);
    if (step.kind !== 'code' || !path) continue;
    const current = files.get(path);
    const file: WorkFile = current ?? { path, text: '', firstLine: 1, touch: 'read', step };
    file.step = step;
    if (step.name === 'write_file' && step.state !== 'failed') {
      file.text = String(step.args.content ?? '');
      file.firstLine = 1;
      file.touch = 'written';
      if (step.state === 'done') file.written = step;
    } else if (step.name === 'edit_file' && step.state !== 'failed') {
      // Only the edit travels with the call: it is applied to what they read, when that starts at the top.
      const from = String(step.args.old_string ?? '');
      const to = String(step.args.new_string ?? '');
      if (file.firstLine === 1 && from && file.text.includes(from))
        file.text = step.args.replace_all === true ? file.text.split(from).join(to) : file.text.replace(from, () => to);
      file.touch = 'written';
      if (step.state === 'done') file.written = step;
    } else if (step.read) {
      Object.assign(file, step.read);
    }
    files.set(path, file);
  }
  const present = new Set(steps.map((s) => s.kind));
  return {
    steps,
    latest: steps[steps.length - 1],
    tabs: WORK_TABS.map((tab) => tab.kind).filter((kind) => present.has(kind)),
    files: [...files.values()],
    commands: steps.filter((s) => s.kind === 'terminal'),
    searches: steps.filter((s) => s.kind === 'files'),
    pages: steps.filter((s) => s.kind === 'browser'),
    tools: steps.filter((s) => s.kind === 'tool')
  };
}

/**
 * Whether the work surface shows. It opens by itself once the coworker uses a tool in a live run,
 * and stays while you keep watching them (`watched`); older work waits for you to open it. Your own
 * open or close holds for the rest of that run.
 */
export function surfaceOpen(input: {
  hasWork: boolean;
  watched: boolean;
  run: string;
  choice?: { open: boolean; run: string };
}): boolean {
  if (!input.hasWork) return false;
  if (input.choice && input.choice.run === input.run) return input.choice.open;
  return input.watched;
}

/** The last part of a path. */
export const baseName = (path: string) =>
  path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/** Whether a call is work shown on the surface (and summed up in the side panel), not office business. */
export const isWorkCall = (call: ToolCall, at: number): boolean => stepOf(call, at) !== null;

/** The file a code step is on, with forward slashes. */
export const stepPath = (step: WorkStep): string => String(step.args.path ?? '').replace(/\\/g, '/');

/**
 * A thread cut into runs: each of your messages starts one, and the coworker's replies and work up
 * to your next message belong to it. Each run is given with the index of its last message.
 */
export function threadRuns<T extends Pick<Message, 'role'>>(
  messages: readonly T[]
): { end: number; messages: T[] }[] {
  const runs: { end: number; messages: T[] }[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'user' || !runs.length) runs.push({ end: index, messages: [message] });
    else {
      const run = runs[runs.length - 1];
      run.messages.push(message);
      run.end = index;
    }
  });
  return runs;
}

/** A reply that is only work shown elsewhere (the run's summary): nothing of its own to show. */
export function onlyWork(message: Message): boolean {
  const calls = message.toolCalls ?? [];
  // Still marked as streaming until the run ends, but a step's calls come after its words: once it
  // has calls, it has nothing more to say.
  return (
    message.role === 'assistant' &&
    !message.content.trim() &&
    !message.thought &&
    !message.error &&
    calls.length > 0 &&
    calls.every((call) => stepOf(call, message.createdAt) !== null)
  );
}

export interface RunFile {
  path: string;
  /** Lines added and removed across the run's writes to it; unknown for older records. */
  added: number;
  removed: number;
  known: boolean;
  /** The run made it: it did not exist before its first write. */
  created: boolean;
  /** The latest write to it. */
  step: WorkStep;
}

export interface RunSummary {
  /** Files written, or asked to be. */
  files: RunFile[];
  commands: WorkStep[];
  /** Files read, listings and searches. */
  looked: WorkStep[];
  pages: WorkStep[];
  tools: WorkStep[];
}

/**
 * One run's work for the side panel. `proposed` has the changes of writes still waiting for an OK
 * (from their approval previews), by call id.
 */
export function runSummary(
  steps: readonly WorkStep[],
  proposed: ReadonlyMap<string, FileChange> = new Map()
): RunSummary {
  const files = new Map<string, RunFile>();
  for (const step of steps) {
    if (step.name !== 'write_file' && step.name !== 'edit_file') continue;
    const path = stepPath(step);
    const change = step.change ?? proposed.get(step.id);
    const file = files.get(path) ?? {
      path,
      added: 0,
      removed: 0,
      known: false,
      created: Boolean(change?.created),
      step
    };
    file.step = step;
    if (change) {
      file.added += change.added;
      file.removed += change.removed;
      file.known = true;
    }
    files.set(path, file);
  }
  return {
    files: [...files.values()],
    // Checking on or stopping a background process isn't running anything new.
    commands: steps.filter(
      (s) => s.kind === 'terminal' && s.name !== 'read_process' && s.name !== 'stop_process'
    ),
    looked: steps.filter((s) => s.name === 'read_file' || s.kind === 'files'),
    pages: steps.filter((s) => s.kind === 'browser'),
    tools: steps.filter((s) => s.kind === 'tool')
  };
}

export interface DiffRow {
  kind: 'hunk' | 'keep' | 'add' | 'del';
  text: string;
  oldLine?: number;
  newLine?: number;
  /** Where the row sits in the new file (for a removed line, the line after it). */
  at: number;
}

/** The rows of unified-diff hunks: a saved change, or an approval preview with its ---/+++ lines. */
export function diffRows(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let a = 0;
  let b = 0;
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      a = Number(hunk[1]);
      b = Number(hunk[2]);
      rows.push({ kind: 'hunk', text: line, at: b });
    } else if (!rows.length) {
      // The --- and +++ lines before the first hunk.
    } else if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1), newLine: b, at: b++ });
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line.slice(1), oldLine: a++, at: b });
    else if (line.startsWith(' '))
      rows.push({ kind: 'keep', text: line.slice(1), oldLine: a++, newLine: b, at: b++ });
    // Anything else ("[File modified: …]") is not a line of the file.
  }
  return rows;
}

/** Lines added and removed in a diff (an approval preview's, before the write). */
export function diffStats(diff: string): FileChange {
  const rows = diffRows(diff);
  const added = rows.filter((row) => row.kind === 'add').length;
  const removed = rows.filter((row) => row.kind === 'del').length;
  // A preview of a new file compares it with nothing: "@@ -1,0 +1,n @@" and only added lines.
  const created =
    /^@@ -\d+,0 /m.test(diff) && added > 0 && rows.every((row) => row.kind === 'hunk' || row.kind === 'add');
  return { added, removed, created };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A run's heading in the side panel: "Working on 2 files…" while it runs; after, what it did,
 * such as "Changed 2 files, ran 1 command" (at most two things, the most telling first).
 */
export function runTitle(summary: RunSummary, live: boolean): string {
  const { files, commands, pages, tools, looked } = summary;
  if (live) return files.length ? `Working on ${count(files.length, 'file')}…` : 'Working…';
  const parts = [
    files.length && `changed ${count(files.length, 'file')}`,
    commands.length && `ran ${count(commands.length, 'command')}`,
    pages.length && `viewed ${count(pages.length, 'page')}`,
    tools.length && `used ${count(tools.length, 'tool')}`
  ].filter((part): part is string => Boolean(part));
  // Only looked around: say how (files read, searches, listings).
  const reads = new Set(looked.filter((s) => s.name === 'read_file').map(stepPath)).size;
  const searches = looked.filter((s) => s.name === 'search_code').length;
  const listings = looked.filter((s) => s.name === 'list_files').length;
  const lookedParts = [
    reads && `read ${count(reads, 'file')}`,
    searches && `searched ${searches === 1 ? 'once' : `${searches} times`}`,
    listings && 'listed files'
  ].filter((part): part is string => Boolean(part));
  const title = (parts.length ? parts : lookedParts).slice(0, 2).join(', ') || 'looked around';
  return title[0].toUpperCase() + title.slice(1);
}

/** The first changed line, in the new file. */
export const firstChange = (rows: readonly DiffRow[]): number | undefined =>
  rows.find((row) => row.kind === 'add' || row.kind === 'del')?.at;

/** The command line a terminal step ran. */
export function commandLine(step: WorkStep): string {
  if (step.name === 'git_commit') {
    const files = Array.isArray(step.args.files) ? step.args.files.map(String) : [];
    return `git add ${files.length ? files.join(' ') : '-A'} && git commit -m ${JSON.stringify(String(step.args.message ?? ''))}`;
  }
  return String(step.args.command ?? '');
}

/** The page a browser step was on: its own address, else the last one before it. */
export function pageAddress(pages: readonly WorkStep[], upTo: WorkStep): string {
  for (let i = pages.indexOf(upTo); i >= 0; i--) {
    const url = pages[i].args.url;
    if (typeof url === 'string' && url) return url;
  }
  return '';
}

/** A connected tool's name for people: `mcp_github_create_issue` → "github · create issue". */
export function toolLabel(name: string): string {
  const words = name.replace(/^mcp_/, '').split('_');
  return name.startsWith('mcp_') && words.length > 1
    ? `${words[0]} · ${words.slice(1).join(' ')}`
    : words.join(' ');
}

export interface TreeNode {
  name: string;
  /** The full path, for files. Folders that hold a single folder are joined: "src/components". */
  path: string;
  children?: TreeNode[];
}

/** Paths as a folder tree: folders first, then files, each alphabetical. */
export function fileTree(paths: readonly string[]): TreeNode[] {
  interface Folder {
    folders: Map<string, Folder>;
    files: string[];
  }
  const root: Folder = { folders: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean);
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      if (!folder.folders.has(part)) folder.folders.set(part, { folders: new Map(), files: [] });
      folder = folder.folders.get(part)!;
    }
    if (parts.length) folder.files.push(path);
  }
  const build = (folder: Folder, prefix: string): TreeNode[] => [
    ...[...folder.folders.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => {
        let label = name;
        let path = prefix + name;
        // Join a folder that only holds one folder, as editors do.
        while (!child.files.length && child.folders.size === 1) {
          const [[next, inner]] = [...child.folders.entries()];
          label += '/' + next;
          path += '/' + next;
          child = inner;
        }
        return { name: label, path, children: build(child, path + '/') };
      }),
    ...[...folder.files]
      .sort((a, b) => a.localeCompare(b))
      .map((path) => ({ name: path.slice(path.lastIndexOf('/') + 1), path }))
  ];
  return build(root, '');
}

/** The highlight.js language for a file, by its extension. */
export function languageOf(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'xml',
    xml: 'xml',
    svg: 'xml',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    rb: 'ruby',
    php: 'php',
    sh: 'bash',
    ps1: 'powershell',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    prisma: 'typescript',
    swift: 'swift'
  };
  return map[ext];
}
