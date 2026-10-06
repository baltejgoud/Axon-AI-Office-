const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunSupervisor } = require('../src/main/runtime/supervisor.ts');
const { AgentMessageBus } = require('../src/main/runtime/messages.ts');
const { ProviderRuntimeManager, providerProblem } = require('../src/main/runtime/providers.ts');
const { ProviderError } = require('../src/main/providers.ts');
const {
  TerminalService,
  terminalCwd,
  defaultShell,
  shellArguments
} = require('../src/main/runtime/terminal.ts');
const create = () => {
  let n = 0;
  const records = [];
  return {
    records,
    supervisor: new RunSupervisor(
      records,
      () => String(++n),
      () => {}
    )
  };
};
const provider = { id: 'p', enabled: true, models: [{ id: 'm' }] };
test('parent cancellation aborts descendants and cleanup even after parent completes', () => {
  const { supervisor } = create();
  const parent = supervisor.start({ conversationId: 'c', agentId: 'lead' });
  const signal = new AbortController();
  let cleaned = 0;
  const child = supervisor.start(
    { conversationId: 'worker', agentId: 'worker', parentRunId: parent.runId },
    signal,
    () => cleaned++
  );
  supervisor.finish(parent.runId, 'completed');
  supervisor.cancel(parent.runId);
  assert.equal(child.status, 'canceled');
  assert.equal(signal.signal.aborted, true);
  assert.equal(cleaned, 1);
  supervisor.finish(child.runId, 'completed');
  assert.equal(child.status, 'canceled');
});
test('restart marks unfinished work interrupted and leaves results alone', () => {
  const { records, supervisor } = create();
  const r = supervisor.start({ conversationId: 'c', agentId: 'a' });
  new RunSupervisor(
    records,
    () => 'next',
    () => {}
  );
  assert.equal(r.status, 'interrupted');
  assert.match(r.error, /application exit/);
});
test('dependencies cannot start before their prerequisites finish', () => {
  const { supervisor } = create();
  const first = supervisor.start({ conversationId: 'c', agentId: 'a' });
  assert.throws(
    () => supervisor.start({ conversationId: 'b', agentId: 'b', dependencies: [first.runId] }),
    /dependencies/
  );
  supervisor.finish(first.runId, 'completed');
  assert.ok(supervisor.start({ conversationId: 'b', agentId: 'b', dependencies: [first.runId] }));
});
test('project cancellation stops only the selected project', () => {
  const { supervisor } = create();
  const a = supervisor.start({ conversationId: 'a', agentId: 'a', projectId: 'one' });
  const b = supervisor.start({ conversationId: 'b', agentId: 'b', projectId: 'two' });
  supervisor.cancelProject('one');
  assert.equal(a.status, 'canceled');
  assert.equal(b.status, 'starting');
});
test('message delivery, duplicate prevention, handoffs and replies are explicit', () => {
  const messages = [];
  let n = 0;
  const bus = new AgentMessageBus(
    messages,
    () => String(++n),
    () => {}
  );
  const input = {
    runId: 'r',
    fromAgentId: 'backend',
    toAgentId: 'security',
    type: 'review_request',
    purpose: 'review',
    content: 'Review redirects',
    requiresResponse: true,
    artifactRefs: ['callback.ts']
  };
  const request = bus.send(input);
  assert.equal(request.status, 'delivered');
  assert.throws(() => bus.send(input), /already waiting/);
  bus.send({
    ...input,
    fromAgentId: 'security',
    toAgentId: 'backend',
    type: 'review_result',
    content: 'Fix redirect validation',
    replyTo: request.messageId,
    requiresResponse: false
  });
  assert.equal(request.status, 'answered');
  const handoff = bus.send({ ...input, type: 'handoff', content: 'Ready for QA', requiresResponse: false });
  assert.equal(handoff.type, 'handoff');
  assert.throws(() => bus.send({ ...input, toAgentId: 'backend' }), /itself/);
});
test('provider queue respects concurrency and releases slots after failures', async () => {
  const manager = new ProviderRuntimeManager();
  let active = 0,
    peak = 0;
  const execute = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return 'ok';
  };
  await Promise.all(Array.from({ length: 7 }, () => manager.call(provider, 'm', undefined, 2, execute)));
  assert.equal(peak, 2);
  await assert.rejects(
    manager.call(provider, 'm', undefined, 1, async () => {
      throw new Error('failed');
    })
  );
  assert.equal(await manager.call(provider, 'm', undefined, 1, execute), 'ok');
});
test('queued provider requests cancel without spending a request', async () => {
  const manager = new ProviderRuntimeManager();
  let release;
  const first = manager.call(provider, 'm', undefined, 1, () => new Promise((r) => (release = r)));
  await new Promise((r) => setImmediate(r));
  const controller = new AbortController();
  let started = false;
  const next = manager.call(provider, 'm', controller.signal, 1, async () => {
    started = true;
  });
  controller.abort();
  await assert.rejects(next, /canceled/);
  release();
  await first;
  assert.equal(started, false);
});
test('invalid models are cached until provider configuration is corrected; 402 is readable', async () => {
  const manager = new ProviderRuntimeManager();
  let calls = 0;
  await assert.rejects(
    manager.call(provider, 'm', undefined, 1, async () => {
      calls++;
      throw new ProviderError(404, 'model missing');
    })
  );
  await assert.rejects(
    manager.call(provider, 'm', undefined, 1, async () => {
      calls++;
    }),
    /Choose another model/
  );
  assert.equal(calls, 1);
  manager.reset('p');
  await manager.call(provider, 'm', undefined, 1, async () => calls++);
  assert.equal(calls, 2);
  assert.match(providerProblem(new ProviderError(402, 'raw private body')), /insufficient available credits/);
  assert.doesNotMatch(providerProblem(new ProviderError(402, 'raw private body')), /raw private/);
});
test('terminal validates canonical cwd, traversal and junction escapes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-terminal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  assert.equal(await terminalCwd(root, 'src'), await fs.promises.realpath(path.join(root, 'src')));
  await assert.rejects(terminalCwd(root, '..'), /outside/);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(terminalCwd(root, 'escape'), /escapes/);
});
test(
  'native PTY streams PowerShell commands, exposes metadata and cleans up',
  { timeout: 15000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-pty-'));
    const events = [];
    const terminals = new TerminalService((s, data) => events.push({ s, data }));
    t.after(() => {
      terminals.stopAll();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const result = await terminals.run({
      root,
      conversationId: 'c',
      command: process.platform === 'win32' ? 'Write-Output AXON_PTY; Get-Location' : 'printf AXON_PTY; pwd'
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /AXON_PTY/);
    assert.equal(result.cwd, await fs.promises.realpath(root));
    assert.ok(events.some((e) => e.data.includes('AXON_PTY')));
    assert.equal(terminals.list()[0].running, false);
    if (process.platform === 'win32') assert.match(result.shell, /powershell|pwsh/i);
  }
);
test('command abort terminates owned PTY and settles execution', { timeout: 15000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-abort-'));
  const terminals = new TerminalService(() => {});
  const controller = new AbortController();
  t.after(() => {
    terminals.stopAll();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const command = terminals.run({
    root,
    conversationId: 'c',
    runId: 'r',
    signal: controller.signal,
    command: process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30'
  });
  setTimeout(() => controller.abort(), 500);
  await command;
  assert.equal(terminals.list()[0].running, false);
});
