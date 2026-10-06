import { ACTIVE_RUN_STATUSES, type AgentRun, type RunStatus } from '../../shared/runtime';
export class RunSupervisor {
  private lanes = new Map<string, string>();
  private waiters = new Map<string, (() => void)[]>();
  private controls = new Map<string, { controller: AbortController; cleanup?: () => void }>();
  constructor(
    private records: AgentRun[],
    private id: () => string,
    private changed: () => void
  ) {
    for (const run of records)
      if (ACTIVE_RUN_STATUSES.has(run.status) || run.status === 'planned') {
        Object.assign(run, {
          status: 'interrupted',
          error: 'Interrupted by application exit',
          completedAt: Date.now(),
          updatedAt: Date.now()
        });
      }
  }
  list() {
    return this.records;
  }
  get(id: string) {
    return this.records.find((r) => r.runId === id);
  }
  active(conversationId?: string) {
    return this.records.filter(
      (r) => ACTIVE_RUN_STATUSES.has(r.status) && (!conversationId || r.conversationId === conversationId)
    );
  }
  bySignal(signal?: AbortSignal) {
    return [...this.controls]
      .map(([id, control]) => (control.controller.signal === signal ? this.get(id) : undefined))
      .find(Boolean);
  }
  latest(conversationId: string) {
    return this.records.filter((r) => r.conversationId === conversationId).at(-1);
  }
  start(
    input: Pick<AgentRun, 'conversationId' | 'agentId'> & Partial<AgentRun>,
    controller = new AbortController(),
    cleanup?: () => void
  ) {
    if (input.parentRunId && !this.get(input.parentRunId)) throw new Error('Parent run not found.');
    if (input.dependencies?.some((id) => this.get(id)?.status !== 'completed'))
      throw new Error('Run dependencies are incomplete.');
    const now = Date.now();
    const run: AgentRun = {
      runId: this.id(),
      status: 'starting',
      startedAt: now,
      updatedAt: now,
      dependencies: [],
      children: [],
      artifactRefs: [],
      ...input
    };
    this.records.push(run);
    if (run.parentRunId) this.get(run.parentRunId)!.children.push(run.runId);
    this.controls.set(run.runId, { controller, cleanup });
    this.changed();
    return run;
  }
  async acquire(id: string): Promise<void> {
    const run = this.get(id);
    const control = this.controls.get(id);
    if (!run || !control || control.controller.signal.aborted) throw new Error('Run canceled.');
    const lane = run.agentId;
    while (this.lanes.has(lane) && this.lanes.get(lane) !== id) {
      this.update(id, { status: 'queued', summary: 'Waiting for this coworker to finish earlier work' });
      await new Promise<void>((resolve, reject) => {
        const queue = this.waiters.get(lane) ?? [];
        this.waiters.set(lane, queue);
        const wake = () => {
          control.controller.signal.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          const i = queue.indexOf(wake);
          if (i >= 0) queue.splice(i, 1);
          reject(new Error('Run canceled.'));
        };
        queue.push(wake);
        control.controller.signal.addEventListener('abort', abort, { once: true });
        if (control.controller.signal.aborted) abort();
      });
    }
    if (control.controller.signal.aborted) throw new Error('Run canceled.');
    this.lanes.set(lane, id);
    this.update(id, { status: 'starting' });
  }
  private release(run: AgentRun) {
    if (this.lanes.get(run.agentId) === run.runId) {
      this.lanes.delete(run.agentId);
      this.waiters.get(run.agentId)?.shift()?.();
    }
  }
  update(id: string, patch: Partial<AgentRun>) {
    const run = this.get(id);
    if (!run) return;
    if (['canceled', 'interrupted', 'completed', 'failed'].includes(run.status)) return;
    Object.assign(run, patch, { updatedAt: Date.now() });
    if (patch.status && ['completed', 'failed', 'canceled'].includes(patch.status)) {
      run.completedAt = Date.now();
      this.release(run);
      this.controls.delete(id);
      run.activeTool = undefined;
    }
    this.changed();
  }
  cancel(id: string, reason = 'Stopped by you') {
    const run = this.get(id);
    if (!run) return;
    for (const child of [...run.children]) this.cancel(child, reason);
    if (!ACTIVE_RUN_STATUSES.has(run.status) && run.status !== 'planned' && run.status !== 'blocked') return;
    this.update(id, { status: 'canceling', cancellationReason: reason });
    const control = this.controls.get(id);
    control?.controller.abort();
    control?.cleanup?.();
    this.update(id, { status: 'canceled' });
  }
  cancelConversation(id: string) {
    for (const run of this.records.filter((r) => r.conversationId === id)) this.cancel(run.runId);
  }
  cancelProject(root: string) {
    for (const run of this.records.filter((r) => r.projectId === root)) this.cancel(run.runId);
  }
  finish(id: string, status: RunStatus, error?: string) {
    this.update(id, { status, error });
  }
}
