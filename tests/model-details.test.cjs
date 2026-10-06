// A model's optional details as typed in the provider dialog: context window and prices.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detailsOf, withDetails } = require('../src/renderer/src/settings/modelDetails.ts');

test("saved details come back as the fields' text, and go out again unchanged", () => {
  const models = [{ id: 'm', displayName: 'm', contextWindow: 128000, pricePerMillionInputTokens: 3, pricePerMillionOutputTokens: 0.25 }, { id: 'plain', displayName: 'plain' }];
  const details = detailsOf(models);
  assert.deepEqual(details.m, { contextWindow: '128000', inputPrice: '3', outputPrice: '0.25', maxOutputTokens: '', recommendedOutputReserve: '', contextSafetyMargin: '', recentContextTurns: '', tokenizer: '' });
  assert.deepEqual(details.plain, { contextWindow: '', inputPrice: '', outputPrice: '', maxOutputTokens: '', recommendedOutputReserve: '', contextSafetyMargin: '', recentContextTurns: '', tokenizer: '' });
  assert.deepEqual(withDetails(['m', 'plain'], details), { models });
});

test('empty fields are left out; a model with no details entry is just its id', () => {
  assert.deepEqual(withDetails(['a'], {}), { models: [{ id: 'a', displayName: 'a' }] });
  assert.deepEqual(withDetails(['a'], { a: { contextWindow: '  ', inputPrice: '', outputPrice: '15' } }), { models: [{ id: 'a', displayName: 'a', pricePerMillionOutputTokens: 15 }] });
});

test('typed the way people type: "$3", "128,000", "0" for a free local model', () => {
  assert.deepEqual(withDetails(['a'], { a: { contextWindow: '128,000', inputPrice: '$3', outputPrice: '0' } }), {
    models: [{ id: 'a', displayName: 'a', contextWindow: 128000, pricePerMillionInputTokens: 3, pricePerMillionOutputTokens: 0 }]
  });
});

test('a detail that is not a number says which model and what to type', () => {
  const row = (d) => withDetails(['kimi'], { kimi: { contextWindow: '', inputPrice: '', outputPrice: '', ...d } });
  assert.match(row({ contextWindow: '0' }).error, /Context window for kimi.*whole number/);
  assert.match(row({ contextWindow: '128000.5' }).error, /whole number/);
  assert.match(row({ contextWindow: '128k' }).error, /whole number/);
  assert.match(row({ inputPrice: '-1' }).error, /Input price for kimi.*dollar amount/);
  assert.match(row({ outputPrice: 'lots' }).error, /Output price for kimi.*dollar amount/);
});

 test('explicit tokenizer selection survives provider form round trip', () => {
  const models = [{ id: 'custom', displayName: 'custom', tokenizer: 'cl100k_base' }];
  assert.deepEqual(withDetails(['custom'], detailsOf(models)), { models });
});
