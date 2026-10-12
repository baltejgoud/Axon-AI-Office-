// Up-arrow recall in the chat box: which messages count as yours, and the steps through them.
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
const recall = require('../src/renderer/src/features/office/activity/recall.ts');

const msg = (content, extra = {}) => ({ role: 'user', content, conversationId: 'c1', ...extra });

test('sentTexts keeps only your own messages, oldest first', () => {
  const list = [
    msg('first'),
    { role: 'assistant', content: 'an answer', conversationId: 'c1' },
    msg('second'),
    { role: 'system', content: 'rules', conversationId: 'c1' }
  ];
  assert.deepEqual(recall.sentTexts(list), ['first', 'second']);
});

test('sentTexts skips messages a lead or teammate sent (they carry from)', () => {
  const list = [msg('mine'), msg('team brief', { from: 'chief-of-staff' }), msg('mine too')];
  assert.deepEqual(recall.sentTexts(list), ['mine', 'mine too']);
});

test('sentTexts strips the attachment and file blocks the chat hides', () => {
  const list = [
    msg('look at this\n\n<attachment name="a.png">data</attachment>'),
    msg('summarise\n\nFile context: report.md is open')
  ];
  assert.deepEqual(recall.sentTexts(list), ['look at this', 'summarise']);
});

test('sentTexts leaves out a message that is only files', () => {
  const list = [msg('before'), msg('\n\n<attachment name="a.png">data</attachment>'), msg('after')];
  assert.deepEqual(recall.sentTexts(list), ['before', 'after']);
});

test('recallStep: up, up, down, down walks back and forward, then empties the box', () => {
  const history = ['a', 'b', 'c'];
  let at = { index: -1, text: '' };
  at = recall.recallStep(history, at.index, 'up');
  assert.deepEqual(at, { index: 0, text: 'c' });
  at = recall.recallStep(history, at.index, 'up');
  assert.deepEqual(at, { index: 1, text: 'b' });
  at = recall.recallStep(history, at.index, 'down');
  assert.deepEqual(at, { index: 0, text: 'c' });
  at = recall.recallStep(history, at.index, 'down');
  assert.deepEqual(at, { index: -1, text: '' });
});

test('recallStep stops at the oldest message when up keeps going', () => {
  const history = ['a', 'b'];
  let at = { index: -1, text: '' };
  for (let i = 0; i < 5; i++) at = recall.recallStep(history, at.index, 'up');
  assert.deepEqual(at, { index: 1, text: 'a' });
});

test('recallStep does nothing with no history', () => {
  assert.deepEqual(recall.recallStep([], -1, 'up'), { index: -1, text: '' });
  assert.deepEqual(recall.recallStep([], -1, 'down'), { index: -1, text: '' });
});

test('recallStep down from the box as typed stays empty and unchanged', () => {
  assert.deepEqual(recall.recallStep(['a', 'b'], -1, 'down'), { index: -1, text: '' });
});
