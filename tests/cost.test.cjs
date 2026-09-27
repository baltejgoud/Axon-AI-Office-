// What a turn costs, only ever from prices the user set; estimates are told apart from reported usage.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { costOf, conversationCost, estimateTokens, formatTokens, formatUsd, hasPrice, runEstimate } = require('../src/shared/cost.ts');

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≈ ${expected}`);
const priced = { id: 'm', displayName: 'm', pricePerMillionInputTokens: 3, pricePerMillionOutputTokens: 15 };
const unpriced = { id: 'u', displayName: 'u' };
const providers = [{ id: 'p', name: 'P', kind: 'openai-compatible', models: [priced, unpriced], enabled: true, createdAt: 0, hasApiKey: false }];
let n = 0;
const reply = (extra) => ({ id: `r${++n}`, conversationId: 'c', role: 'assistant', content: 'ok', createdAt: 0, providerId: 'p', modelId: 'm', ...extra });

test('a priced turn costs its reported tokens at the prices you set', () => {
  assert.equal(costOf({ promptTokens: 1_000_000, completionTokens: 100_000 }, priced), 4.5);
  assert.equal(costOf({ promptTokens: 1000 }, priced), 0.003);
});

test('no price, half a price, or no reported usage is an unknown cost, never $0.00', () => {
  assert.equal(costOf({ promptTokens: 1000, completionTokens: 10 }, unpriced), null);
  assert.equal(costOf({ promptTokens: 1000 }, { ...unpriced, pricePerMillionInputTokens: 3 }), null);
  assert.equal(costOf({}, priced), null);
  assert.equal(costOf(undefined, priced), null);
  assert.equal(costOf({ promptTokens: 10 }, undefined), null);
  assert.equal(costOf({ promptTokens: 10 }, { ...priced, pricePerMillionInputTokens: -1 }), null);
  assert.equal(costOf({ promptTokens: 10 }, { ...priced, pricePerMillionOutputTokens: NaN }), null);
});

test('a model priced at zero (a local model) really costs nothing', () => {
  const free = { id: 'f', displayName: 'f', pricePerMillionInputTokens: 0, pricePerMillionOutputTokens: 0 };
  assert.equal(hasPrice(free), true);
  assert.equal(costOf({ promptTokens: 5000, completionTokens: 500 }, free), 0);
});

test('before a call: its input by character count, and the most its answer can cost', () => {
  assert.equal(runEstimate(unpriced, 4000, 4096), undefined);
  const estimate = runEstimate(priced, 4000, 4096);
  assert.equal(estimate.inputTokens, 1000);
  assert.equal(estimate.inputCost, 0.003);
  assert.equal(estimate.maxOutputTokens, 4096);
  close(estimate.maxOutputCost, (4096 * 15) / 1e6);
  assert.equal(estimateTokens(5), 2);
  assert.equal(estimateTokens(0), 0);
});

test('a conversation total: actual from reported usage, estimated while a reply streams, unknowns counted', () => {
  const messages = [
    { id: 'u1', conversationId: 'c', role: 'user', content: 'hi', createdAt: 0 },
    reply({ usage: { promptTokens: 1000, completionTokens: 100 } }), // $0.0045
    reply({ modelId: 'u', usage: { promptTokens: 500, completionTokens: 50 } }), // no price
    reply({ usage: {} }), // finished without reporting usage
    reply({ id: 'live', content: 'x'.repeat(400), streaming: true }) // 100 tokens so far
  ];
  const cost = conversationCost(messages, providers, { live: { inputTokens: 2000, maxOutputTokens: 4096, inputCost: 0.006, maxOutputCost: 0.06144 } });
  close(cost.actual, 0.0045);
  close(cost.estimating, 0.006 + (100 * 15) / 1e6);
  assert.equal(cost.promptTokens, 1500);
  assert.equal(cost.completionTokens, 150);
  assert.equal(cost.unpriced, 1);
  assert.equal(cost.unreported, 1);
  assert.equal(cost.priced, true);
});

test('a conversation on a model without a price has tokens but no dollar figure', () => {
  const cost = conversationCost([reply({ modelId: 'u', usage: { promptTokens: 10, completionTokens: 5 } })], providers);
  assert.equal(cost.priced, false);
  assert.equal(cost.actual, 0);
  assert.equal(cost.unpriced, 1);
  assert.equal(cost.promptTokens, 10);
});

test('dollars and tokens read at a glance', () => {
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(0.00004), '<$0.0001');
  assert.equal(formatUsd(0.0042), '$0.0042');
  assert.equal(formatUsd(0.4249), '$0.42');
  assert.equal(formatUsd(12.3), '$12.30');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(12_345), '12.3K');
  assert.equal(formatTokens(2_000_000), '2M');
});
