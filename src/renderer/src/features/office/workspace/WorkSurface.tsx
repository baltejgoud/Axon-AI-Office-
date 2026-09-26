import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useApp } from '../../../state';
import { OFFICE_AGENTS } from '../data/officeAgents';
import {
  IconClose,
  IconCode,
  IconFolder,
  IconMonitor,
  IconTerminal,
  IconTool,
  IconWorld,
  type IconGlyph
} from '../../../ui';
import {
  WORK_TABS,
  commandLine,
  pageAddress,
  toolLabel,
  type Work,
  type WorkKind,
  type WorkStep
} from './work';
import {
  BrowserView,
  CodeView,
  FilesView,
  PreviewView,
  TerminalView,
  ToolsView,
  baseName,
  SHORTCUT_KEY,
  useSettled,
  type Processes,
  type Requests
} from './WorkViews';

const TAB_ICONS: Record<WorkKind, IconGlyph> = {
  code: IconCode,
  files: IconFolder,
  terminal: IconTerminal,
  preview: IconMonitor,
  browser: IconWorld,
  tool: IconTool
};

/**
 * What the selected coworker is working in, below the office. It follows them: each new step
 * brings its tab (and file) forward. A tab the user picks stays until their next step.
 */
export function WorkSurface({
  work,
  agentId,
  conversationId,
  project,
  focus,
  onClose
}: {
  work: Work;
  agentId: string;
  conversationId: string;
  project: string | null;
  /** A step the side panel asked to show. */
  focus: { stepId: string; at: number } | null;
  onClose: () => void;
}) {
  const agent = OFFICE_AGENTS.find((a) => a.id === agentId);
  const approvals = useApp((s) => s.pendingApprovals);
  const requests: Requests = useMemo(
    () => new Map(Object.values(approvals).map((request) => [request.toolCallId, request])),
    [approvals]
  );
  // Their background processes, and the page the newest of them serves (the Preview tab).
  const allProcesses = useApp((s) => s.data?.processes);
  const processes: Processes = useMemo(
    () =>
      new Map((allProcesses ?? []).filter((p) => p.conversationId === conversationId).map((p) => [p.id, p])),
    [allProcesses, conversationId]
  );
  const served = [...processes.values()].filter((p) => p.url).sort((a, b) => b.startedAt - a.startedAt)[0];
  const kinds: WorkKind[] = served ? [...work.tabs, 'preview'] : work.tabs;
  /** Where a step is best seen: a server they started, on its page once it has one. */
  const kindOf = (step: WorkStep): WorkKind =>
    step.name === 'start_process' && step.processId && processes.get(step.processId)?.url
      ? 'preview'
      : step.kind;
  const latest = work.latest;
  const [pick, setPick] = useState<{ tab: WorkKind; after?: string } | null>(null);
  const followed = useSettled(latest ? kindOf(latest) : kinds[0]);
  const tab: WorkKind =
    pick && pick.after === latest?.id && kinds.includes(pick.tab)
      ? pick.tab
      : kinds.includes(followed)
        ? followed
        : kinds[0];
  // A step picked in the side panel: its tab, and (below) its file or command.
  const focused = focus ? work.steps.find((step) => step.id === focus.stepId) : undefined;
  useEffect(() => {
    if (focused) setPick({ tab: kindOf(focused), after: latest?.id });
    // A new request only; later steps don't re-apply it.
  }, [focus?.at]);
  const target = focused && focus ? { stepId: focused.id, at: focus.at } : null;
  const tabs = WORK_TABS.filter((t) => kinds.includes(t.kind));
  const tabRefs = useRef(new Map<WorkKind, HTMLButtonElement>());
  const choose = (kind: WorkKind) => setPick({ tab: kind, after: latest?.id });
  const onTabKey = (event: KeyboardEvent) => {
    const at = tabs.findIndex((t) => t.kind === tab);
    const next = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const kind = tabs[(next + tabs.length) % tabs.length].kind;
    choose(kind);
    tabRefs.current.get(kind)?.focus();
  };

  return (
    <section className="work-surface" aria-label={`${agent?.name ?? 'Coworker'} at work`}>
      <header className="work-bar">
        <div className="work-tabs" role="tablist" aria-label="What they are working in" onKeyDown={onTabKey}>
          {tabs.map(({ kind, label }) => {
            const Icon = TAB_ICONS[kind];
            const live =
              kind === 'preview'
                ? Boolean(served?.running)
                : latest?.kind === kind && latest.state === 'running';
            return (
              <button
                key={kind}
                ref={(el) => {
                  if (el) tabRefs.current.set(kind, el);
                  else tabRefs.current.delete(kind);
                }}
                role="tab"
                id={`work-tab-${kind}`}
                aria-selected={tab === kind}
                aria-controls="work-panel"
                tabIndex={tab === kind ? 0 : -1}
                className={`work-tab${tab === kind ? ' active' : ''}`}
                onClick={() => choose(kind)}
              >
                <Icon size={14} />
                {label}
                {live && <span className="work-tab-live" aria-label="(working here now)" />}
              </button>
            );
          })}
        </div>
        {latest && (
          <p
            className={`work-now is-${requests.has(latest.id) ? 'waiting' : latest.state}`}
            aria-live="polite"
          >
            <span className="work-now-dot" />
            <span className="work-now-text">
              {describe(latest, requests.has(latest.id), work, processes)}
            </span>
          </p>
        )}
        <button
          className="work-close"
          onClick={onClose}
          aria-label="Close the work surface"
          title={`Close (${SHORTCUT_KEY}+J) · the office takes the full height again`}
        >
          <IconClose size={14} />
        </button>
      </header>
      <div className="work-panel" id="work-panel" role="tabpanel" aria-labelledby={`work-tab-${tab}`}>
        {tab === 'code' && <CodeView work={work} requests={requests} project={project} target={target} />}
        {tab === 'files' && <FilesView searches={work.searches} />}
        {tab === 'terminal' && (
          <TerminalView
            commands={work.commands}
            requests={requests}
            processes={processes}
            project={project}
            target={target}
          />
        )}
        {tab === 'preview' && served && <PreviewView process={served} />}
        {tab === 'browser' && <BrowserView pages={work.pages} />}
        {tab === 'tool' && <ToolsView tools={work.tools} requests={requests} />}
      </div>
    </section>
  );
}

/** One line on what the coworker is doing (or last did), as the status on the surface's bar. */
function describe(step: WorkStep, waiting: boolean, work: Work, processes: Processes): string {
  const file = baseName(String(step.args.path ?? ''));
  const running = step.state === 'running';
  const failed = step.state === 'failed';
  switch (step.name) {
    case 'read_file':
      return running ? `Opening ${file}` : failed ? `Couldn’t open ${file}` : `Reading ${file}`;
    case 'write_file':
      return waiting
        ? `Waiting for your OK to save ${file}`
        : running
          ? `Saving ${file}`
          : failed
            ? `${file} was not saved`
            : `Saved ${file}`;
    case 'list_files': {
      const where = String(step.args.directory ?? '').trim();
      return running ? 'Looking through the files' : `Looked through ${where ? where + '/' : 'the project'}`;
    }
    case 'search_code':
      return `${running ? 'Searching' : 'Searched'} for “${String(step.args.query ?? '')}”`;
    case 'run_command':
    case 'git_commit': {
      const line = commandLine(step);
      return waiting
        ? `Waiting for your OK to run ${line}`
        : running
          ? `Running ${line}`
          : failed
            ? `${line} failed`
            : `Ran ${line}`;
    }
  }
  if (step.name === 'start_process') {
    const line = commandLine(step);
    const process = step.processId ? processes.get(step.processId) : undefined;
    if (waiting) return `Waiting for your OK to start ${line}`;
    if (step.state === 'running') return `Starting ${line}`;
    if (!process) return step.state === 'failed' ? `${line} failed` : `Started ${line}`;
    if (!process.running) return `${line} stopped`;
    return process.url ? `Serving ${hostOf(process.url)}` : `${line} is running`;
  }
  if (step.name === 'read_process') return `Checked the output of ${step.processId ?? 'a process'}`;
  if (step.name === 'stop_process') return `Stopped ${step.processId ?? 'a process'}`;
  if (step.kind === 'browser') {
    return `${running ? 'Browsing' : 'Viewed'} ${hostOf(pageAddress(work.pages, step)) || 'a page'}`;
  }
  return `${waiting ? 'Waiting for your OK to use' : running ? 'Using' : failed ? 'Couldn’t use' : 'Used'} ${toolLabel(step.name)}`;
}

/** An address's host and port, or the address as given when it isn't a full one. */
function hostOf(address: string): string {
  try {
    return new URL(address).host || address;
  } catch {
    return address;
  }
}
