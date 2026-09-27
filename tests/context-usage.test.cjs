// The context meter: how full a conversation is, by the same measure that trims it.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contextUsage, meterTone, MIN_CONTEXT_WINDOW } = require('../src/shared/context-usage.ts');
const { fitToBudget, requestSize } = require('../src/main/history.ts');

test('an empty conversation is an empty meter, estimated from characters', () => {
  assert.deepEqual(contextUsage({ usedChars: 0, budgetChars: 300000 }), { usedChars: 0, budgetChars: 300000, pct: 0, estimated: true });
});

test('a conversation over budget is full, and keeps its real size so the window can say turns are left out', () => {
  const usage = contextUsage({ usedChars: 450000, budgetChars: 300000 });
  assert.equal(usage.pct, 1);
  assert.equal(usage.usedChars, 450000);
  assert.equal(usage.estimated, true);
});

test('a model with a context window and a reported prompt size is measured in tokens', () => {
  const usage = contextUsage({ usedChars: 30000, budgetChars: 300000, contextWindow: 8192, promptTokens: 6144 });
  assert.deepEqual(usage.tokenBasis, { usedTokens: 6144, windowTokens: 8192 });
  assert.equal(usage.estimated, false);
  assert.equal(usage.pct, 0.75);
});

test('without a window, or without a reported prompt size, the meter stays on characters', () => {
  for (const input of [{ promptTokens: 5000 }, { contextWindow: 128000 }, {}]) {
    const usage = contextUsage({ usedChars: 60000, budgetChars: 300000, ...input });
    assert.equal(usage.estimated, true);
    assert.equal(usage.tokenBasis, undefined);
    assert.equal(usage.pct, 0.2);
  }
});

test('a context window typed wrong (zero, negative, not a number, tiny) is ignored: never a NaN or negative meter', () => {
  for (const contextWindow of [0, -128000, NaN, Infinity, MIN_CONTEXT_WINDOW - 1]) {
    const usage = contextUsage({ usedChars: 60000, budgetChars: 300000, contextWindow, promptTokens: 5000 });
    assert.equal(usage.estimated, true, `window ${contextWindow}`);
    assert.equal(usage.pct, 0.2, `window ${contextWindow}`);
  }
  assert.equal(contextUsage({ usedChars: 10, budgetChars: 0 }).pct, 0);
  assert.equal(contextUsage({ usedChars: NaN, budgetChars: 300000 }).pct, 0);
});

test('the fuller of the two limits wins: a large window never hides that Axon is trimming', () => {
  // 70K tokens of a 200K window is 35%, but the history is past the character budget.
  const usage = contextUsage({ usedChars: 330000, budgetChars: 300000, contextWindow: 200000, promptTokens: 70000 });
  assert.equal(usage.pct, 1);
  assert.equal(usage.estimated, false);
});

test('the meter reaches 100% exactly where fitToBudget starts leaving turns out', () => {
  const system = 'You are Axon.';
  const turn = (i) => [{ role: 'user', content: `question ${i} ${'x'.repeat(100)}` }, { role: 'assistant', content: `answer ${i}` }];
  const history = [...turn(1), ...turn(2), { role: 'user', content: 'now' }];
  const budget = system.length + requestSize(history);
  assert.equal(contextUsage({ usedChars: system.length + requestSize(history), budgetChars: budget }).pct, 1);
  assert.equal(fitToBudget(history, budget - system.length).length, history.length, 'at exactly 100% nothing is trimmed');
  const over = contextUsage({ usedChars: system.length + requestSize(history), budgetChars: budget - 1 });
  assert.ok(over.usedChars > over.budgetChars);
  assert.ok(fitToBudget(history, budget - 1 - system.length).length < history.length, 'one character more and the oldest turn goes');
});

test('the meter warns as it fills', () => {
  assert.equal(meterTone(0.2), 'ok');
  assert.equal(meterTone(0.75), 'high');
  assert.equal(meterTone(0.9), 'full');
  assert.equal(meterTone(1), 'full');
});
