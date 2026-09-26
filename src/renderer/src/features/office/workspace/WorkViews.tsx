import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ToolApprovalRequest } from '../../../../../shared/types';
import { decideApproval } from '../../../chat/PendingApprovals';
import hljs from 'highlight.js/lib/common';
import {
  IconArrowLeft,
  IconArrowRight,
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
            <DiffText key={`${file.path}|changes`} rows={rows} path={file.path} />
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
      ? step.name === 'write_file'
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
      </span>
    </div>
  );
}

/** Reject and approve, for a step waiting on you (the same answer as the card in the thread). */
function Decision({ request, approve }: { request: ToolApprovalRequest; approve: string }) {
  // For a command, "always" covers that exact command; for anything else, the tool itself.
  const always = EXACT_GRANTS.has(request.toolName)
    ? 'Run this exact command without asking again this session'
    : request.toolName === 'write_file'
      ? 'Save files without asking again this session'
      : `Use ${toolLabel(request.toolName)} without asking again this session`;
  return (
    <span className="work-decision">
      <button className="work-always" onClick={() => decideApproval(request, true, true)} title={always}>
        Always allow
      </button>
      <button className="work-reject" onClick={() => decideApproval(request, false)}>
        Reject
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
const EXACT_GRANTS = new Set(['run_command', 'git_commit']);

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

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

/** Diffs longer than this are shown without highlighting, to stay quick. */
const HIGHLIGHT_ROWS = 3000;

/** "Lines 16–21", from a hunk header's new side. */
function hunkLabel(header: string): string {
  const [, start, count = '1'] = /\+(\d+)(?:,(\d+))?/.exec(header) ?? [];
  const from = Number(start);
  const to = from + Number(count) - 1;
  return to > from ? `Lines ${from}–${to}` : `Line ${from}`;
}

/** A file's changes: each hunk with its old and new line numbers, starting at the first change. */
function DiffText({ rows, path }: { rows: DiffRow[]; path: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const language = languageOf(path);
  const markup = useMemo(
    () =>
      rows.map((row) =>
        row.kind === 'hunk'
          ? ''
          : rows.length <= HIGHLIGHT_ROWS && language && hljs.getLanguage(language)
            ? hljs.highlight(row.text, { language, ignoreIllegals: true }).value
            : escapeHtml(row.text)
      ),
    [rows, language]
  );
  const first = rows.findIndex((row) => row.kind === 'add' || row.kind === 'del');
  useLayoutEffect(() => {
    const el = scroller.current;
    const row = el?.querySelector<HTMLElement>(`[data-row="${first}"]`);
    if (el && row) el.scrollTop = Math.max(0, row.offsetTop - el.clientHeight / 3);
  }, [first]);
  return (
    <div
      className="work-code-scroll work-diff"
      ref={scroller}
      tabIndex={0}
      aria-label={`Changes to ${baseName(path)}`}
    >
      <table className="work-diff-table">
        <tbody>
          {rows.map((row, i) =>
            row.kind === 'hunk' ? (
              <tr key={i} className="work-diff-hunk">
                <td colSpan={3}>{hunkLabel(row.text)}</td>
              </tr>
            ) : (
              <tr key={i} className={`work-diff-${row.kind}`} data-row={i}>
                <td className="work-diff-num">{row.oldLine ?? ''}</td>
                <td className="work-diff-num">{row.newLine ?? ''}</td>
                <td className="work-diff-code">
                  <span className="work-diff-mark" aria-hidden="true">
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                  </span>
                  <code className="hljs" dangerouslySetInnerHTML={{ __html: markup[i] }} />
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- Terminal ---------------------------------- */

export function TerminalView({
  commands,
  requests,
  project,
  target
}: {
  commands: WorkStep[];
  requests: Requests;
  project: string | null;
  target: Target;
}) {
  const last = commands[commands.length - 1];
  const scroller = useFollowScroll(`${commands.length}|${last?.state}|${last?.output.length}`);
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
        return (
          <div key={step.id} className={`work-term-entry is-${step.state}`} data-step={step.id}>
            <div className="work-term-command">
              <span className="work-term-cwd">{cwd}</span>
              <span className="work-term-sigil">$</span>
              <span>{commandLine(step)}</span>
            </div>
            {request ? (
              <div className="work-term-note">
                Waiting for your OK to run this
                <Decision request={request} approve="Run" />
              </div>
            ) : (
              <>
                {step.output && <TerminalOutput text={step.output} />}
                {step.state === 'running' && <span className="work-term-cursor" aria-label="Running" />}
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
