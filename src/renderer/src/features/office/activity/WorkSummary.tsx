import './workSummary.css';
import { useMemo, type ReactNode } from 'react';
import { useApp } from '../../../state';
import { ToolCallDetails } from '../../../chat/MessageView';
import { IconFileText, IconMonitor, IconSearch, IconTerminal, IconTool, IconWorld } from '../../../ui';
import { useOfficeStore } from '../store/officeStore';
import {
  baseName,
  commandLine,
  diffStats,
  pageAddress,
  runSummary,
  runTitle,
  stepPath,
  toolLabel,
  type WorkStep
} from '../workspace/work';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One run's work in the side panel, in place of its raw tool calls: the files changed and by how
 * much, the commands run, what was looked at. Each row opens it on the work surface below the office.
 */
export function WorkSummary({
  conversationId,
  steps,
  live
}: {
  conversationId: string;
  steps: WorkStep[];
  /** The coworker is still working in this run. */
  live: boolean;
}) {
  const approvals = useApp((s) => s.pendingApprovals);
  const processes = useApp((s) => s.data?.processes);
  const requests = useMemo(
    () => new Map(Object.values(approvals).map((request) => [request.toolCallId, request])),
    [approvals]
  );
  const summary = useMemo(() => {
    const proposed = new Map(
      [...requests].flatMap(([id, request]) =>
        request.preview?.type === 'diff' ? [[id, diffStats(request.preview.content)] as const] : []
      )
    );
    return runSummary(steps, proposed);
  }, [steps, requests]);
  const show = (step: WorkStep) => useOfficeStore.getState().focusWork(conversationId, step.id);
  const state = (step: WorkStep, done: string, failed: string) =>
    requests.has(step.id)
      ? { label: 'Waiting for your OK', tone: 'waiting' }
      : step.state === 'running'
        ? { label: step.name === 'write_file' ? 'Saving…' : 'Running…', tone: 'running' }
        : step.state === 'failed'
          ? { label: failed, tone: 'failed' }
          : { label: done, tone: 'done' };

  const { files, commands, looked, pages, tools } = summary;
  const title = runTitle(summary, live);
  const reads = looked.filter((s) => s.name === 'read_file');
  const searches = looked.filter((s) => s.name === 'search_code');
  const listings = looked.filter((s) => s.name === 'list_files');
  const lookedLine = [
    reads.length && `Read ${plural(new Set(reads.map(stepPath)).size, 'file')}`,
    searches.length && plural(searches.length, 'search', 'searches'),
    listings.length && plural(listings.length, 'listing')
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className={`work-summary${live ? ' is-live' : ''}`} aria-label="What they worked on">
      <header className="work-summary-head">
        <span className="work-summary-dot" />
        <strong>{title}</strong>
      </header>
      <div className="work-summary-rows">
        {files.map((file) => {
          const { label, tone } = state(file.step, 'Saved', 'Not saved');
          const dir = file.path.slice(0, file.path.length - baseName(file.path).length).replace(/\/$/, '');
          return (
            <Row
              key={file.path}
              icon={<IconFileText size={14} />}
              onClick={() => show(file.step)}
              tone={tone}
              label={label}
            >
              <span className="work-summary-name">{baseName(file.path)}</span>
              {dir && <span className="work-summary-dir">{dir}</span>}
              {file.known && (
                <span className="work-summary-stat">
                  <span className="add">+{file.added}</span>
                  {file.created ? (
                    <span className="new">new</span>
                  ) : (
                    <span className="del">−{file.removed}</span>
                  )}
                </span>
              )}
            </Row>
          );
        })}
        {commands.map((step) => {
          // A background process: whether it still runs, and the page it serves.
          const process = step.processId ? processes?.find((p) => p.id === step.processId) : undefined;
          const { label, tone } =
            process && !requests.has(step.id)
              ? process.running
                ? {
                    label: process.url ? `Serving ${process.url.replace(/^https?:\/\//, '')}` : 'Running',
                    tone: 'running'
                  }
                : { label: 'Stopped', tone: 'done' }
              : state(step, 'Done', 'Failed');
          return (
            <Row
              key={step.id}
              icon={process?.url ? <IconMonitor size={14} /> : <IconTerminal size={14} />}
              onClick={() => show(step)}
              tone={tone}
              label={label}
            >
              <code className="work-summary-command">{commandLine(step)}</code>
            </Row>
          );
        })}
        {pages.map((step) => {
          const { label, tone } = state(step, 'Viewed', 'Failed');
          return (
            <Row
              key={step.id}
              icon={<IconWorld size={14} />}
              onClick={() => show(step)}
              tone={tone}
              label={label}
            >
              <span className="work-summary-name">{pageAddress(pages, step) || toolLabel(step.name)}</span>
            </Row>
          );
        })}
        {tools.map((step) => {
          const { label, tone } = state(step, 'Done', 'Failed');
          return (
            <Row
              key={step.id}
              icon={<IconTool size={14} />}
              onClick={() => show(step)}
              tone={tone}
              label={label}
            >
              <span className="work-summary-name">{toolLabel(step.name)}</span>
            </Row>
          );
        })}
        {lookedLine && (
          <Row icon={<IconSearch size={14} />} onClick={() => show(looked[looked.length - 1])} muted>
            <span className="work-summary-name">{lookedLine}</span>
          </Row>
        )}
      </div>
      <details className="work-summary-steps">
        <summary>{`All ${plural(steps.length, 'step')}`}</summary>
        <div className="tool-calls">
          {steps.map((step) => (
            <ToolCallDetails key={step.id} call={step.call} />
          ))}
        </div>
      </details>
    </section>
  );
}

function Row({
  icon,
  onClick,
  tone,
  label,
  muted,
  children
}: {
  icon: ReactNode;
  onClick: () => void;
  tone?: string;
  label?: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className={`work-summary-row${muted ? ' is-muted' : ''}`}
      onClick={onClick}
      title="Show below the office"
    >
      <span className="work-summary-icon">{icon}</span>
      <span className="work-summary-main">{children}</span>
      {label && <span className={`work-summary-state is-${tone}`}>{label}</span>}
    </button>
  );
}
