// The conversation history each request carries: every tool call paired with its result, trimmed by whole turns.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestHistory, fitToBudget } = require('../src/main/history.ts');

let clock = 0;
const msg = (role, content, extra = {}) => ({ id: `m${++clock}`, conversationId: 'c', role, content, createdAt: clock, ...extra });
const call = (id, name = 'read_file') => ({ id, name, arguments: '{"path":"a"}' });

test('a tool call that failed keeps its result, so the next request is valid', () => {
  const history = requestHistory([
    msg('user', 'Read a'),
    msg('assistant', '', { toolCalls: [call('t1')] }),
    msg('tool', 'Error reading file: ENOENT', { toolCallId: 't1', error: 'Error reading file: ENOENT' }),
    msg('assistant', 'It does not exist.')
  ]);
  assert.deepEqual(history.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal(history[2].toolCallId, 't1');
});

test('calls left without a result (a stopped run) are answered as not run', () => {
  const history = requestHistory([
    msg('user', 'Read a and b'),
    msg('assistant', '', { toolCalls: [call('t1'), call('t2')], error: 'Generation stopped.' }),
    msg('tool', 'A', { toolCallId: 't1' })
  ]);
  assert.deepEqual(history.map((m) => [m.role, m.toolCallId]), [['user', undefined], ['assistant', undefined], ['tool', 't1'], ['tool', 't2']]);
  assert.match(history[3].content, /not run/i);
});

test('results whose call is gone, system prompts and empty failed answers are left out', () => {
  const history = requestHistory([
    msg('system', 'You are Axon.'),
    msg('user', 'Hi'),
    msg('assistant', '', { error: 'Provider returned HTTP 500.' }),
    msg('tool', 'orphan', { toolCallId: 'gone' }),
    msg('user', 'Hi again')
  ]);
  assert.deepEqual(history.map((m) => m.content), ['Hi', 'Hi again']);
});

test('trimming drops whole oldest turns, so history starts with the user', () => {
  const big = 'x'.repeat(400);
  const requests = requestHistory([
    msg('user', big),
    msg('assistant', '', { toolCalls: [call('t1')] }),
    msg('tool', big, { toolCallId: 't1' }),
    msg('assistant', big),
    msg('user', 'Latest question')
  ]);
  const fitted = fitToBudget(requests, 500);
  assert.equal(fitted[0].role, 'user');
  assert.equal(fitted[fitted.length - 1].content, 'Latest question');
  assert.ok(!fitted.some((m) => m.role === 'tool'));
});

test('a single turn over budget keeps its question, shortened', () => {
  const fitted = fitToBudget([{ role: 'user', content: 'y'.repeat(5000) }], 1000);
  assert.equal(fitted.length, 1);
  assert.ok(fitted[0].content.length < 5000);
  assert.match(fitted[0].content, /truncated/);
});
