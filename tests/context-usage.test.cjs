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
const { ContextBudgetPlanner } = require('../src/main/context.ts');

test('meter reflects compiled token sections, reserves and model window', () => {
  const plan = new ContextBudgetPlanner().compile({model:'m', system:'rules', messages:[{role:'user',content:'hello'}],maxTokens:4096}, {id:'m',displayName:'m',contextWindow:32768});
  const usage = contextUsage(plan);
  assert.equal(usage.pct, plan.inputTokens / plan.contextWindow);
  assert.equal(usage.tokenBasis.usedTokens, Object.values(plan.sections).reduce((a,b)=>a+b,0));
  assert.equal(usage.outputReserve,4096);
  assert.equal(usage.estimated,true);
});
test('meter has no character budget and remains finite for invalid counters', () => {
  const usage=contextUsage({inputTokens:NaN,contextWindow:0});
  assert.equal(usage.pct,0);
  assert.equal(usage.budgetChars,0);
});
test('long history is archived locally while meter measures the working set', () => {
  const messages=Array.from({length:1000},(_,i)=>({role:'user',content:`Question ${i}`}));
  const plan=new ContextBudgetPlanner().compile({model:'m',messages,maxTokens:4096},{id:'m',displayName:'m',contextWindow:32768});
  const usage=contextUsage(plan);
  assert.ok(usage.pct<.5);
  assert.ok(usage.archivedTokens>0);
  assert.equal(messages.length,1000);
});

test('the meter warns as it fills', () => {
  assert.equal(meterTone(0.2), 'ok');
  assert.equal(meterTone(0.75), 'high');
  assert.equal(meterTone(0.9), 'full');
  assert.equal(meterTone(1), 'full');
});
