import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProcessInfo, ToolApprovalRequest } from '../../../../../shared/types';
import { decideApproval } from '../../../chat/PendingApprovals';
import { DiffLines, escapeHtml } from '../../../ui/DiffLines';
import { useApp } from '../../../state';
import hljs from 'highlight.js/lib/common';
import {
  IconArrowLeft,
  IconArrowRight,
  IconExternalLink,
  IconFileText,
  IconFolderOpen,
  IconLoader,
  IconRefresh,
  IconSearch,
  IconWorld
} from '../../../ui';
import {
  baseName,
  commandLine,
  diffRows,
  diffStats,
  fileTree,
  firstChange,
  languageOf,
  pageAddress,
  stepPath,
  toolLabel,
  type DiffRow,
  type TreeNode,
  type Work,
  type WorkFile,
  type WorkStep
} from './work';

export { baseName };

/** How long the surface stays on what it shows before following the coworker somewhere else. */
const HOLD_MS = 900;

/**
 * `value`, but a change waits until the last one has shown for `hold` ms, so a burst of quick
 * steps doesn't flick the surface back and forth. It always ends on the latest value.
 */
export function useSettled<T>(value: T, hold = HOLD_MS): T {
  const [shown, setShown] = useState(value);
  const since = useRef(0);
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const wait = Math.max(0, since.current + hold - performance.now());
    const timer = setTimeout(() => {
      since.current = performance.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, shown, hold]);
  return shown;
}

/** Approval requests waiting on the user, by the tool call that asked. */
export type Requests = ReadonlyMap<string, ToolApprovalRequest>;
/** A conversation's background processes, by id. */
export type Processes = ReadonlyMap<string, ProcessInfo>;

/** Keeps a log scrolled to its newest line, unless the user scrolled up to read. */
function useFollowScroll(progress: unknown) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [progress]);
  return scroller;
}

/* ----------------------------------- Code ------------------------------------ */

/** A step the side panel asked the surface to show. */
type Target = { stepId: string; at: number } | null;

/**
 * What changed in a file: a write waiting for an OK shows its proposal, a saved one what it
 * changed. Nothing for a file they only read.
 */
function changeRows(file: WorkFile, request: ToolApprovalRequest | undefined): DiffRow[] | null {
  if (request?.preview?.type === 'diff') return diffRows(request.preview.content);
  const change = file.written?.change;
  if (!change || !file.written) return null;
  if (change.created)
    return String(file.written.args.content ?? '')
      .split('\n')
      .map((text, i): DiffRow => ({ kind: 'add', text, newLine: i + 1, at: i + 1 }));
  return change.hunks ? diffRows(change.hunks) : null;
}

/** The files they opened, and the one they are on, as an editor would show it. */
export function CodeView({
  work,
  requests,
  project,
  target
}: {
  work: Work;
  requests: Requests;
  project: string | null;
  target: Target;
}) {
  const [pick, setPick] = useState<{ path: string; after?: string } | null>(null);
  const [mode, setMode] = useState<'changes' | 'file'>('changes');
  const order = (file: WorkFile) => work.steps.indexOf(file.step);
  const following = work.files.reduce<WorkFile | undefined>(
    (best, file) => (!best || order(file) > order(best) ? file : best),
    undefined
  );
  const followedPath = useSettled(following?.path);
  const open = (path: string) => setPick({ path, after: work.latest?.id });
  // A file picked in the side panel opens on its changes.
  useEffect(() => {
    const step = target && work.steps.find((s) => s.id === target.stepId);
    if (step?.kind !== 'code') return;
    open(stepPath(step));
    setMode('changes');
  }, [target?.at]);
  const picked =
    pick && pick.after === work.latest?.id ? work.files.find((f) => f.path === pick.path) : undefined;
  const file = picked ?? work.files.find((f) => f.path === followedPath) ?? following;
  const paths = work.files.map((f) => f.path).join('\n');
  const tree = useMemo(() => fileTree(paths ? paths.split('\n') : []), [paths]);
  const written = new Set(work.files.filter((f) => f.touch === 'written').map((f) => f.path));
  const request = file ? requests.get(file.step.id) : undefined;
  const rows = useMemo(() => (file ? changeRows(file, request) : null), [file?.path, file?.written, request]);
  const showChanges = Boolean(rows?.length) && mode === 'changes';

  return (
    <div className="work-code">
      <nav className="work-explorer" aria-label="Files they opened">
        <div className="work-explorer-title">
          <IconFolderOpen size={13} />
          {project ? baseName(project) : 'Project'}
        </div>
        <FileTree nodes={tree} selected={file?.path} written={written} onOpen={open} />
      </nav>
      <div className="work-editor">
        <div className="work-editor-tabs" role="tablist" aria-label="Open files">
          {work.files.map((f) => (
            <button
              key={f.path}
              role="tab"
              aria-selected={f.path === file?.path}
              className={`work-editor-tab${f.path === file?.path ? ' active' : ''}`}
              onClick={() => open(f.path)}
              title={f.path}
            >
              {baseName(f.path)}
              {written.has(f.path) && <span className="work-changed" aria-label="(changed)" />}
            </button>
          ))}
        </div>
        {file && (
          <FileBar file={file} request={request} rows={rows} showChanges={showChanges} onMode={setMode} />
        )}
        {file &&
          (showChanges && rows ? (
            <DiffLines key={`${file.path}|changes`} rows={rows} path={file.path} />
          ) : (
            <CodeText
              key={file.path}
              text={file.text}
              firstLine={file.firstLine}
              path={file.path}
              changed={rows}
            />
          ))}
      </div>
    </div>
  );
}

/** Undo for a saved write: asks natively first, and says why when it can't. */
function UndoChange({ step }: { step: WorkStep }) {
  const [busy, setBusy] = useState(false);
  const change = step.change;
  if (!change || step.state !== 'done') return null;
  if (change.revertedAt) return <span className="work-file-note">Undone</span>;
  if (change.undo !== 'kept')
    return (
      <span className="work-file-note">
        {change.undo === 'unreadable' ? "Can't be undone: over 1 MB or not text" : "Can't be undone"}
      </span>
    );
  const undo = async () => {
    setBusy(true);
    try {
      await window.axon.revertChange(step.id);
      await useApp.getState().refresh();
      useApp.getState().pushToast('Change undone');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(error);
      if (!/cancelled/i.test(message)) useApp.getState().patch({ error: message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="work-undo" disabled={busy} onClick={() => void undo()}>
      {busy ? 'Undoing…' : 'Undo this change'}
    </button>
  );
}

/** The open file's path, what is happening to it, and what you can do: see changes or the file, approve. */
function FileBar({
  file,
  request,
  rows,
  showChanges,
  onMode
}: {
  file: WorkFile;
  request: ToolApprovalRequest | undefined;
  rows: DiffRow[] | null;
  showChanges: boolean;
  onMode: (mode: 'changes' | 'file') => void;
}) {
  const { step } = file;
  const note = request
    ? 'Proposed change'
    : step.state === 'running'
      ? step.name === 'write_file' || step.name === 'edit_file'
        ? 'Saving…'
        : 'Opening…'
      : step.state === 'failed'
        ? step.output
        : null;
  const added = rows?.filter((row) => row.kind === 'add').length ?? 0;
  const removed = rows?.filter((row) => row.kind === 'del').length ?? 0;
  // A new file: what it adds is all there is to it.
  const created =
    request?.preview?.type === 'diff'
      ? diffStats(request.preview.content).created
      : Boolean(file.written?.change?.created);
  return (
    <div className={`work-file-path is-${request ? 'waiting' : step.state}`}>
      <span className="work-file-name">{file.path}</span>
      {rows && rows.length > 0 && (
        <span
          className="work-stat"
          aria-label={created ? `a new file of ${added} lines` : `${added} lines added, ${removed} removed`}
        >
          <span className="work-stat-add">+{added}</span>
          {created ? (
            <span className="work-stat-new">new file</span>
          ) : (
            <span className="work-stat-del">−{removed}</span>
          )}
        </span>
      )}
      {note && <span className="work-file-note">{note}</span>}
      <span className="work-file-actions">
        {rows && rows.length > 0 && (
          <span className="work-segment" role="group" aria-label="Show">
            <button aria-pressed={showChanges} onClick={() => onMode('changes')}>
              Changes
            </button>
            <button aria-pressed={!showChanges} onClick={() => onMode('file')}>
              File
            </button>
          </span>
        )}
        {request && <Decision request={request} approve="Approve" />}
        {!request && file.written && <UndoChange step={file.written} />}
      </span>
    </div>
  );
}

/** Reject and approve, for a step waiting on you (the same answer as the card in the thread). */
function Decision({ request, approve }: { request: ToolApprovalRequest; approve: string }) {
  // For a command, "always" covers that exact command; for anything else, the tool itself.
  const always = EXACT_GRANTS.has(request.toolName)
    ? 'Run this exact command without asking again this session'
    : request.toolName === 'write_file' || request.toolName === 'edit_file'
      ? 'Save files without asking again this session'
      : `Use ${toolLabel(request.toolName)} without asking again this session`;
  return (
    <span className="work-decision">
      <button className="work-always" onClick={() => decideApproval(request, true, 'session')} title={always}>
        Always allow
      </button>
      <button className="work-reject" onClick={() => decideApproval(request, false)}>
        Reject
      </button>
      <button
        className="work-always"
        onClick={() => decideApproval(request, true, 'task')}
        title={`Don’t ask again for ${toolLabel(request.toolName)} until this task is done`}
      >
        Allow for this task
      </button>
      <button
        className="work-approve"
        onClick={() => decideApproval(request, true)}
        title={`${approve} (${SHORTCUT_KEY}+Enter)`}
      >
        {approve}
      </button>
    </span>
  );
}

/** The key the office's shortcuts use: ⌘ on a Mac, Ctrl elsewhere. */
export const SHORTCUT_KEY = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
/** Commands whose "always allow" covers only the exact call (as in the main process's permissions). */
const EXACT_GRANTS = new Set(['run_command', 'start_process', 'git_commit']);

function FileTree({
  nodes,
  selected,
  written,
  onOpen,
  depth = 0
}: {
  nodes: TreeNode[];
  selected?: string;
  written: ReadonlySet<string>;
  onOpen: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="work-tree" role={depth ? 'group' : 'tree'}>
      {nodes.map((node) =>
        node.children ? (
          <li key={node.path} role="treeitem" aria-expanded>
            <span className="work-tree-folder" style={{ paddingLeft: 8 + depth * 12 }}>
              {node.name}
            </span>
            <FileTree
              nodes={node.children}
              selected={selected}
              written={written}
              onOpen={onOpen}
              depth={depth + 1}
            />
          </li>
        ) : (
          <li key={node.path} role="treeitem" aria-selected={node.path === selected}>
            <button
              className={`work-tree-file${node.path === selected ? ' active' : ''}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => onOpen(node.path)}
              title={node.path}
            >
              <IconFileText size={13} />
              <span>{node.name}</span>
              {written.has(node.path) && <span className="work-changed" aria-label="(changed)" />}
            </button>
          </li>
        )
      )}
    </ul>
  );
}

/** Highlighted markup for a file's text; highlight.js escapes what it is given. */
function highlighted(text: string, path: string): string {
  const language = languageOf(path);
  if (language && text.length < 200_000 && hljs.getLanguage(language))
    try {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      // Fall through to plain text.
    }
  return escapeHtml(text);
}

/** Scrolls `scroller` so `line` (of lines starting at `firstLine`) sits a third of the way down. */
function scrollToLine(scroller: HTMLElement, line: number, firstLine: number) {
  const pre = scroller.querySelector<HTMLElement>('.work-code-text');
  const height = pre ? parseFloat(getComputedStyle(pre).lineHeight) : 19;
  scroller.scrollTop = Math.max(0, (line - firstLine) * height - scroller.clientHeight / 3);
}

function CodeText({
  text,
  firstLine,
  path,
  changed
}: {
  text: string;
  firstLine: number;
  path: string;
  /** The file's latest change, to mark its lines and start there. */
  changed: DiffRow[] | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const html = useMemo(() => highlighted(text, path), [text, path]);
  const count = text ? text.split('\n').length : 0;
  const marked = useMemo(
    () => new Set((changed ?? []).filter((row) => row.kind === 'add').map((row) => row.newLine)),
    [changed]
  );
  const focus = changed ? firstChange(changed) : undefined;
  useLayoutEffect(() => {
    if (scroller.current && focus) scrollToLine(scroller.current, focus, firstLine);
  }, [focus, firstLine]);
  return (
    <div className="work-code-scroll" ref={scroller} tabIndex={0} aria-label={`${baseName(path)} contents`}>
      <pre className="work-gutter" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => {
          const line = firstLine + i;
          return (
            <span key={line} className={marked.has(line) ? 'is-changed' : undefined}>
              {line}
              {'\n'}
            </span>
          );
        })}
      </pre>
      <pre className="work-code-text">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

/* --------------------------------- Terminal ---------------------------------- */

export function TerminalView({
  commands: all,
  requests,
  processes,
  project,
  target
}: {
  commands: WorkStep[];
  requests: Requests;
  processes: Processes;
  project: string | null;
  target: Target;
}) {
  // Reading a background process's output is the coworker checking its log: nothing to show.
  const commands = all.filter((step) => step.name !== 'read_process');
  const last = commands[commands.length - 1];
  const lastProcess = last?.processId ? processes.get(last.processId) : undefined;
  const scroller = useFollowScroll(
    `${commands.length}|${last?.state}|${last?.output.length}|${lastProcess?.output.length}|${lastProcess?.running}`
  );
  const home = project ? baseName(project) : 'project';
  // A command picked in the side panel scrolls into view.
  useLayoutEffect(() => {
    const el = scroller.current;
    const entry = target && el?.querySelector<HTMLElement>(`[data-step="${CSS.escape(target.stepId)}"]`);
    if (el && entry) el.scrollTop = entry.offsetTop - 8;
  }, [target?.at]);
  return (
    <div className="work-terminal" ref={scroller} role="log" aria-label="Terminal" tabIndex={0}>
      {commands.map((step) => {
        const cwd = typeof step.args.cwd === 'string' && step.args.cwd ? `${home}/${step.args.cwd}` : home;
        const request = requests.get(step.id);
        const process = step.processId ? processes.get(step.processId) : undefined;
        if (step.name === 'stop_process')
          return (
            <div key={step.id} className="work-term-entry work-term-event" data-step={step.id}>
              Stopped {process ? `${process.id} (${process.command})` : (step.processId ?? 'a process')}
            </div>
          );
        // A background process: its own output as it goes, for as long as it runs.
        const output = process?.output || step.output;
        const running = process ? process.running : step.state === 'running';
        return (
          <div key={step.id} className={`work-term-entry is-${step.state}`} data-step={step.id}>
            <div className="work-term-command">
              <span className="work-term-cwd">{cwd}</span>
              <span className="work-term-sigil">$</span>
              <span>{commandLine(step)}</span>
              {process && (
                <span className={`work-term-badge${process.running ? ' is-running' : ''}`}>
                  {process.running
                    ? `${process.id} · running in the background`
                    : `${process.id} · stopped${process.exitCode ? ` (exit ${process.exitCode})` : ''}`}
                </span>
              )}
              {process?.running && (
                <button className="work-term-stop" onClick={() => void window.axon.processStop(process.id)}>
                  Stop
                </button>
              )}
            </div>
            {request ? (
              <div className="work-term-note">
                Waiting for your OK to {step.name === 'start_process' ? 'start' : 'run'} this
                <Decision request={request} approve={step.name === 'start_process' ? 'Start' : 'Run'} />
              </div>
            ) : (
              <>
                {output && <TerminalOutput text={output} />}
                {running && <span className="work-term-cursor" aria-label="Running" />}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A command's output, with anything it wrote to stderr set apart. */
function TerminalOutput({ text }: { text: string }) {
  const at = text.indexOf('[stderr]\n');
  if (at < 0) return <pre className="work-term-output">{text}</pre>;
  return (
    <pre className="work-term-output">
      {text.slice(0, at)}
      <span className="work-term-stderr">{text.slice(at + 9)}</span>
    </pre>
  );
}

/* ----------------------------------- Files ----------------------------------- */

const LISTING_LIMIT = 300;

/** File listings and code searches, newest last. */
export function FilesView({ searches }: { searches: WorkStep[] }) {
  const last = searches[searches.length - 1];
  const scroller = useFollowScroll(`${searches.length}|${last?.state}`);
  return (
    <div className="work-files" ref={scroller} tabIndex={0}>
      {searches.map((step) => (
        <section key={step.id} className="work-files-step">
          <h4>
            {step.name === 'search_code' ? <IconSearch size={13} /> : <IconFolderOpen size={13} />}
            {step.name === 'search_code'
              ? `Search for “${String(step.args.query ?? '')}”`
              : String(step.args.directory ?? '').trim() || 'All files'}
          </h4>
          {step.state === 'running' ? (
            <p className="work-muted">
              <IconLoader size={13} className="work-spin" /> Looking…
            </p>
          ) : step.state === 'failed' ? (
            <p className="work-error">{step.output}</p>
          ) : step.name === 'search_code' ? (
            <SearchHits output={step.output} />
          ) : (
            <Listing output={step.output} />
          )}
        </section>
      ))}
    </div>
  );
}

function Listing({ output }: { output: string }) {
  const paths = output === 'No files found.' ? [] : output.split('\n').filter(Boolean);
  const tree = useMemo(() => fileTree(paths.slice(0, LISTING_LIMIT)), [output]);
  if (!paths.length) return <p className="work-muted">No files found.</p>;
  return (
    <>
      <PlainTree nodes={tree} />
      {paths.length > LISTING_LIMIT && <p className="work-muted">and {paths.length - LISTING_LIMIT} more</p>}
    </>
  );
}

function PlainTree({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  return (
    <ul className="work-tree is-plain">
      {nodes.map((node) => (
        <li key={node.path}>
          <span
            className={node.children ? 'work-tree-folder' : 'work-tree-leaf'}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            {!node.children && <IconFileText size={12} />}
            {node.name}
          </span>
          {node.children && <PlainTree nodes={node.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function SearchHits({ output }: { output: string }) {
  if (output === 'No matches found.') return <p className="work-muted">No matches.</p>;
  const byFile = new Map<string, { line: string; text: string }[]>();
  for (const row of output.split('\n')) {
    const hit = /^(.*?):(\d+) {2}(.*)$/.exec(row);
    if (!hit) continue;
    byFile.set(hit[1], [...(byFile.get(hit[1]) ?? []), { line: hit[2], text: hit[3] }]);
  }
  return (
    <div className="work-hits">
      {[...byFile].map(([path, hits]) => (
        <div key={path} className="work-hits-file">
          <strong>
            <IconFileText size={12} />
            {path}
          </strong>
          {hits.map((hit) => (
            <div key={hit.line} className="work-hit">
              <span>{hit.line}</span>
              <code>{hit.text}</code>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- Browser ---------------------------------- */

/** The page their browser tool is on: its address, and what the tool read from it. */
export function BrowserView({ pages }: { pages: WorkStep[] }) {
  const step = pages[pages.length - 1];
  if (!step) return null;
  const address = pageAddress(pages, step);
  return (
    <div className="work-browser">
      <div className="work-browser-bar">
        <span className="work-browser-nav" aria-hidden="true">
          <IconArrowLeft size={14} />
          <IconArrowRight size={14} />
          <IconRefresh size={14} className={step.state === 'running' ? 'work-spin' : ''} />
        </span>
        <div className="work-address" title={address}>
          <IconWorld size={13} />
          <span>{address || toolLabel(step.name)}</span>
        </div>
      </div>
      <div className="work-page" tabIndex={0}>
        {step.state === 'running' ? (
          <p className="work-muted">
            <IconLoader size={13} className="work-spin" /> Loading…
          </p>
        ) : (
          <pre className={step.state === 'failed' ? 'work-error' : ''}>{step.output}</pre>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Preview ---------------------------------- */

/** An address on this machine the Preview may show: http(s) on localhost, 127.0.0.1 or [::1]. */
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

/**
 * The page a coworker's background process serves, live, as they build it. It shows in a
 * sandboxed frame: it may run its scripts and forms, but not reach Axon, open windows or leave
 * this machine (the window's content policy and navigation guard say the same).
 */
export function PreviewView({ process }: { process: ProcessInfo }) {
  const [reload, setReload] = useState(0);
  const url = process.url ?? '';
  // Axon's own page (while developing Axon) is never framed: it would share its origin.
  const sameOrigin = (() => {
    try {
      return new URL(url).origin === window.location.origin;
    } catch {
      return true;
    }
  })();
  const allowed = LOOPBACK.test(url) && !sameOrigin;
  return (
    <div className="work-browser">
      <div className="work-browser-bar">
        <button
          className="work-browser-button"
          onClick={() => setReload((n) => n + 1)}
          disabled={!process.running || !allowed}
          aria-label="Reload the preview"
          title="Reload"
        >
          <IconRefresh size={14} />
        </button>
        <div className="work-address" title={url}>
          <IconWorld size={13} />
          <span>{url}</span>
        </div>
        <button
          className="work-browser-button"
          onClick={() => void window.axon.processOpen(process.id)}
          disabled={!process.running}
          aria-label="Open in your browser"
          title="Open in your browser"
        >
          <IconExternalLink size={14} />
        </button>
        {process.running && (
          <button className="work-term-stop" onClick={() => void window.axon.processStop(process.id)}>
            Stop
          </button>
        )}
      </div>
      {!allowed ? (
        <div className="work-page">
          <p className="work-error">Axon only previews pages on this machine, other than its own.</p>
        </div>
      ) : process.running ? (
        <iframe
          key={reload}
          className="work-preview-frame"
          src={url}
          title={`Preview of ${url}`}
          sandbox="allow-scripts allow-forms allow-same-origin"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="work-page">
          <p className="work-muted">
            {process.command} stopped{process.exitCode ? ` (exit ${process.exitCode})` : ''}. Its last output:
          </p>
          <pre>{process.output.slice(-3000)}</pre>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------- Tools ----------------------------------- */

/** Connected tools (databases, documents, deploys…): what was asked and what came back. */
export function ToolsView({ tools, requests }: { tools: WorkStep[]; requests: Requests }) {
  const last = tools[tools.length - 1];
  const scroller = useFollowScroll(`${tools.length}|${last?.state}`);
  return (
    <div className="work-files" ref={scroller} tabIndex={0}>
      {tools.map((step) => (
        <section key={step.id} className="work-files-step">
          <h4>{toolLabel(step.name)}</h4>
          <pre className="work-tool-args">{JSON.stringify(step.args, null, 2)}</pre>
          {requests.get(step.id) ? (
            <p className="work-muted">
              Waiting for your OK to use it
              <Decision request={requests.get(step.id)!} approve="Allow" />
            </p>
          ) : step.state === 'running' ? (
            <p className="work-muted">
              <IconLoader size={13} className="work-spin" /> Working…
            </p>
          ) : (
            <pre className={`work-tool-output${step.state === 'failed' ? ' work-error' : ''}`}>
              {step.output}
            </pre>
          )}
        </section>
      ))}
    </div>
  );
}
