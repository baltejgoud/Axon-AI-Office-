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
const { requestHistory } = require('../src/main/history.ts');

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

test('provider call IDs reused in later turns cannot replace earlier results', () => {
  const history=requestHistory([
    msg('user','first'),msg('assistant','',{toolCalls:[call('reused')]}),msg('tool','first output',{toolCallId:'reused'}),
    msg('user','second'),msg('assistant','',{toolCalls:[call('reused')]}),msg('tool','second output',{toolCallId:'reused'})
  ]);
  assert.deepEqual(history.filter(m=>m.role==='tool').map(m=>m.content),['first output','second output']);
});
