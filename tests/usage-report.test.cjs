// Settings → Usage: the replies' own reported usage, added up by day, provider, model and conversation.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildUsageReport } = require('../src/main/usage-report.ts');

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≈ ${expected}`);
/** A time on a September 2026 day, local time, so the test holds in any time zone. */
const at = (day, hour = 12) => new Date(2026, 8, day, hour).getTime();
const now = new Date(2026, 8, 27, 18);
const providers = [{
  id: 'p', name: 'Paid Co', kind: 'openai-compatible', enabled: true, createdAt: 0, hasApiKey: false,
  models: [{ id: 'm', displayName: 'Model M', pricePerMillionInputTokens: 2, pricePerMillionOutputTokens: 10 }, { id: 'u', displayName: 'Model U' }]
}];
const conversations = [
  { id: 'c1', title: 'Launch plan', workspaceId: null, providerId: 'p', modelId: 'm', skillIds: [], roleIds: [], createdAt: 0, updatedAt: at(27) },
  { id: 'c2', title: 'Old chat', workspaceId: null, providerId: 'p', modelId: 'm', skillIds: [], roleIds: [], createdAt: 0, updatedAt: at(1) }
];
let n = 0;
const reply = (conversationId, createdAt, usage, extra = {}) =>
  ({ id: `r${++n}`, conversationId, role: 'assistant', content: 'ok', createdAt, providerId: 'p', modelId: 'm', usage, ...extra });
/** A hand-computed fixture: every figure below is worked out in the comments. */
const messages = [
  { id: 'q', conversationId: 'c1', role: 'user', content: 'go', createdAt: at(27) },
  reply('c1', at(27), { promptTokens: 1000, completionTokens: 200 }), // (1000×2 + 200×10) / 1e6 = $0.004
  reply('c1', at(27), { promptTokens: 3000, completionTokens: 300 }, { modelId: 'u' }), // no price
  reply('c1', at(27), { promptTokens: 10, completionTokens: 10 }, { providerId: 'gone', modelId: 'x' }), // provider removed
  reply('c1', at(23), { promptTokens: 5000, completionTokens: 1000 }), // (10000 + 10000) / 1e6 = $0.02
  reply('c2', at(1), { promptTokens: 100000, completionTokens: 0 }), // 200000 / 1e6 = $0.2
  reply('c2', at(1), undefined, { content: 'partial' }), // finished, reported nothing
  reply('c1', at(27), undefined, { content: 'still going', streaming: true }) // in progress: not counted anywhere
];
const report = buildUsageReport({ messages, providers, conversations }, now);

test('today, the last 7 days and all time', () => {
  assert.deepEqual({ ...report.today, cost: undefined }, { promptTokens: 4010, completionTokens: 510, cost: undefined, turns: 3, unpricedTurns: 2 });
  close(report.today.cost, 0.004);
  assert.equal(report.week.turns, 4);
  assert.equal(report.week.promptTokens, 9010);
  close(report.week.cost, 0.024);
  assert.equal(report.allTime.turns, 5);
  assert.equal(report.allTime.promptTokens, 109010);
  assert.equal(report.allTime.completionTokens, 1510);
  close(report.allTime.cost, 0.224);
});

test('replies that reported no usage add no tokens, and are counted apart', () => {
  assert.equal(report.unreportedTurns, 1);
  const empty = buildUsageReport({ messages: [reply('c1', at(27), undefined), reply('c1', at(27), {})], providers, conversations }, now);
  assert.deepEqual(empty.allTime, { promptTokens: 0, completionTokens: 0, cost: null, turns: 0, unpricedTurns: 0 });
  assert.equal(empty.unreportedTurns, 2);
});

test('a model with no price adds tokens but no dollars, and says it has no price', () => {
  const only = buildUsageReport({ messages: [reply('c1', at(27), { promptTokens: 3000, completionTokens: 300 }, { modelId: 'u' })], providers, conversations }, now);
  assert.equal(only.allTime.cost, null);
  assert.equal(only.allTime.promptTokens, 3000);
  assert.equal(only.allTime.unpricedTurns, 1);
  assert.equal(only.byModel[0].priced, false);
});

test('grouped by day, provider, model and conversation, biggest spend first', () => {
  assert.deepEqual(report.byDay.map((row) => row.key), ['2026-09-27', '2026-09-23', '2026-09-01']);
  assert.deepEqual(report.byProvider.map((row) => [row.label, row.totals.turns]), [['Paid Co', 4], ['Removed provider', 1]]);
  close(report.byProvider[0].totals.cost, 0.224);
  assert.equal(report.byProvider[0].totals.unpricedTurns, 1);
  assert.equal(report.byProvider[1].totals.cost, null);
  assert.deepEqual(report.byModel.map((row) => [row.label, row.detail, row.priced, row.totals.turns]), [
    ['Model M', 'Paid Co', true, 3],
    ['Model U', 'Paid Co', false, 1],
    ['x', 'Removed provider', false, 1]
  ]);
  assert.deepEqual(report.conversations.map((row) => [row.label, row.totals.turns, row.lastUsedAt]), [['Launch plan', 4, at(27)], ['Old chat', 1, at(1)]]);
  close(report.conversations[0].totals.cost, 0.024);
});
