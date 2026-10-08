const ts = require('typescript');
const fs = require('node:fs');
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
const { officeCommands } = require('../src/renderer/src/features/office/shell/commands.ts');
const { placeOverlay, overlaps } = require('../src/renderer/src/features/office/shell/overlayPlacement.ts');
const { SPATIAL_LABELS } = require('../src/renderer/src/features/office/shell/spatialLabels.ts');
const { OFFICE_AGENTS } = require('../src/renderer/src/features/office/data/officeAgents.ts');
const { DISTRICTS } = require('../src/renderer/src/features/office/campus/districts.ts');
const { workOf } = require('../src/renderer/src/features/office/workspace/work.ts');

test('commands find people and departments, and prepare unmatched text for the receptionist', () => {
  assert.ok(
    officeCommands('frontend').some((c) => c.kind === 'person' && c.agentId === 'frontend-developer')
  );
  assert.ok(
    officeCommands('Backend & APIs').some((c) => c.kind === 'department' && c.department === 'Backend & APIs')
  );
  assert.ok(officeCommands('planner').some((c) => c.kind === 'action' && c.action === 'planner'));
  assert.deepEqual(
    officeCommands('Please organize our quarterly offsite').at(-1).prompt,
    'Please organize our quarterly offsite'
  );
  assert.equal(
    officeCommands('').some((c) => c.kind === 'ask'),
    false
  );
});
test('department and district labels have real anchors and catalog headcounts', () => {
  assert.equal(
    SPATIAL_LABELS.filter((l) => l.kind === 'department').length,
    DISTRICTS.reduce((n, d) => n + d.departments.length, 0)
  );
  for (const label of SPATIAL_LABELS) {
    assert.equal(
      label.people,
      OFFICE_AGENTS.filter((a) =>
        label.kind === 'district' ? a.district === label.target : a.department === label.target
      ).length
    );
    assert.ok(Number.isFinite(label.point.x) && Number.isFinite(label.point.z));
  }
});
test('a pinned card flips below a top anchor and avoids the navigation and neighboring cards', () => {
  const obstacles = [
    { x: 0, y: 0, w: 900, h: 90 },
    { x: 580, y: 110, w: 300, h: 320 }
  ];
  const card = placeOverlay(
    { x: 460, y: 120 },
    { w: 310, h: 170 },
    { x: 12, y: 12, w: 876, h: 576 },
    obstacles
  );
  assert.ok(card && card.y > 120);
  assert.ok(obstacles.every((o) => !overlaps(card, o)));
  const second = placeOverlay({ x: 460, y: 120 }, { w: 150, h: 100 }, { x: 12, y: 12, w: 876, h: 576 }, [
    ...obstacles,
    card
  ]);
  assert.ok(second && !overlaps(card, second));
});
test('no fit returns null instead of clipping or covering another overlay', () => {
  assert.equal(placeOverlay({ x: 30, y: 30 }, { w: 300, h: 200 }, { x: 0, y: 0, w: 200, h: 300 }, []), null);
  assert.equal(
    placeOverlay({ x: 30, y: 30 }, { w: 100, h: 100 }, { x: 0, y: 0, w: 200, h: 300 }, [
      { x: 0, y: 0, w: 200, h: 300 }
    ]),
    null
  );
});
test('review has a work step even when approval arrives before the streamed tool call', () => {
  const approval = {
    id: 'a',
    conversationId: 'c',
    messageId: 'm',
    toolCallId: 'call',
    toolName: 'write_file',
    arguments: { path: 'notes/demo.ts', content: 'ready' }
  };
  const work = workOf([], [approval]);
  assert.equal(work.latest.id, 'call');
  assert.equal(work.files[0].path, 'notes/demo.ts');
  const messages = [
    {
      id: 'm',
      conversationId: 'c',
      role: 'assistant',
      content: '',
      createdAt: 1,
      toolCalls: [{ id: 'call', name: 'write_file', arguments: JSON.stringify(approval.arguments) }]
    }
  ];
  assert.equal(workOf(messages, [approval]).steps.length, 1);
});

const { runLifecycle, historyRuns, latestRun } = require('../src/renderer/src/features/office/lifecycle.ts');
test('lifecycle distinguishes dependency waits, user requests, failure and completion', () => {
  assert.equal(runLifecycle('waiting_for_agent').tone, 'working');
  assert.equal(runLifecycle('waiting_for_approval').action, 'Review request');
  assert.equal(runLifecycle('waiting_for_user').action, 'Reply to coworker');
  assert.equal(runLifecycle('blocked').tone, 'attention');
  assert.equal(runLifecycle('completed').label, 'Completed');
  assert.equal(runLifecycle('failed').action, 'Review error');
  assert.equal(runLifecycle('canceled').tone, 'stopped');
  assert.equal(runLifecycle('interrupted').action, 'Resume conversation');
});
test('history searches persisted results, orders by update time and includes blockers in attention', () => {
  const runs = [
    {
      runId: 'old',
      agentId: 'dev',
      conversationId: 'a',
      updatedAt: 1,
      status: 'completed',
      summary: 'Saved the report'
    },
    {
      runId: 'new',
      agentId: 'dev',
      conversationId: 'b',
      updatedAt: 8,
      status: 'working',
      summary: 'Read files'
    },
    { runId: 'blocked', agentId: 'ops', conversationId: 'c', updatedAt: 5, status: 'blocked' },
    {
      runId: 'failed',
      agentId: 'ops',
      conversationId: 'd',
      updatedAt: 4,
      status: 'failed',
      error: 'Connection refused'
    }
  ];
  const name = (id) => (id === 'dev' ? 'Frontend Developer' : 'Operations');
  assert.deepEqual(
    historyRuns(runs, 'all', '', name).map((r) => r.runId),
    ['new', 'blocked', 'failed', 'old']
  );
  assert.deepEqual(
    historyRuns(runs, 'completed', 'frontend report', name).map((r) => r.runId),
    ['old']
  );
  assert.deepEqual(
    historyRuns(runs, 'attention', '', name).map((r) => r.runId),
    ['blocked', 'failed']
  );
  assert.deepEqual(
    historyRuns(runs, 'active', '', name).map((r) => r.runId),
    ['new']
  );
  assert.deepEqual(
    historyRuns(runs, 'all', 'refused', name).map((r) => r.runId),
    ['failed']
  );
  assert.equal(latestRun(runs, 'dev', 'a').runId, 'old');
  assert.equal(latestRun(runs, 'dev').runId, 'new');
  assert.equal(latestRun(runs, 'missing'), undefined);
  assert.deepEqual(
    runs.map((r) => r.runId),
    ['old', 'new', 'blocked', 'failed']
  );
});
