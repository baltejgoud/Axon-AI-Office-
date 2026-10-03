// A targeted edit (edit_file) shows in the work surface and the run summary as a saved change, like a whole-file write.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const work = require('../src/renderer/src/features/office/workspace/work.ts');

const call = (id, name, args, outcome = {}) => ({ id, name, arguments: JSON.stringify(args), ...outcome });
const assistant = (...toolCalls) => ({ id: 'm' + toolCalls[0].id, role: 'assistant', content: '', toolCalls });

test('an edit shows on the code surface', () => {
  assert.equal(work.workKind('edit_file', {}), 'code');
});

test('an edit to a file they read changes the text shown, and marks the file changed', () => {
  const change = { added: 1, removed: 1, created: false, hunks: '@@ -2,1 +2,1 @@\n-two\n+TWO' };
  const result = work.workOf([
    assistant(call('r', 'read_file', { path: 'a.ts' }, { result: '1: one\n2: two\n3: three' })),
    assistant(call('e', 'edit_file', { path: 'a.ts', old_string: 'two', new_string: 'TWO' }, { result: 'Edited a.ts: 1 replacement.', change }))
  ]);
  const [file] = result.files;
  assert.equal(file.text, 'one\nTWO\nthree');
  assert.equal(file.touch, 'written');
  assert.equal(file.written.id, 'e');
});

test('an edit to a file they read only part of keeps the lines shown as they were read', () => {
  const result = work.workOf([
    assistant(call('r', 'read_file', { path: 'a.ts', offset: 10 }, { result: '10: ten\n11: two' })),
    assistant(call('e', 'edit_file', { path: 'a.ts', old_string: 'two', new_string: 'TWO' }, { result: 'ok', change: { added: 1, removed: 1, created: false } }))
  ]);
  assert.equal(result.files[0].text, 'ten\ntwo');
  assert.equal(result.files[0].touch, 'written');
});

test('the run summary counts an edit with the files it changed', () => {
  const steps = work.workOf([
    assistant(call('e', 'edit_file', { path: 'a.ts', old_string: 'x', new_string: 'y' }, { result: 'ok', change: { added: 2, removed: 1, created: false } }))
  ]).steps;
  const summary = work.runSummary(steps);
  assert.deepEqual(summary.files.map((f) => [f.path, f.added, f.removed]), [['a.ts', 2, 1]]);
});
