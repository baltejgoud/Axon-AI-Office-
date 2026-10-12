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

const picture = (id, name = `${id}.png`) => ({ id, name, mime: 'image/png', size: 10, path: `/attachments/${id}.png`, kind: 'image' });
const { requestSize } = require('../src/main/history.ts');

test('a message you sent with pictures carries them, as the run loaded them', () => {
  const loaded = new Map([['a1', { name: 'shot.png', mime: 'image/png', base64: 'AAAA' }]]);
  const history = requestHistory([
    msg('user', 'What is in this?', { attachments: [picture('a1', 'shot.png'), picture('gone')] }),
    msg('assistant', 'A chart.')
  ], (a) => loaded.get(a.id));
  assert.deepEqual(history[0].images, [{ name: 'shot.png', mime: 'image/png', base64: 'AAAA' }]);
  assert.equal(history[1].images, undefined);
});

test('without a way to load pictures, the history carries none (the context meter and checkpoints read it so)', () => {
  const history = requestHistory([msg('user', 'What is in this?', { attachments: [picture('a1')] })]);
  assert.equal(history[0].images, undefined);
});

test('a picture counts as a fixed amount of the budget, not by its bytes', () => {
  const small = [{ role: 'user', content: 'Look', images: [{ name: 'a.png', mime: 'image/png', base64: 'A'.repeat(10) }] }];
  const large = [{ role: 'user', content: 'Look', images: [{ name: 'a.png', mime: 'image/png', base64: 'A'.repeat(2_000_000) }] }];
  assert.equal(requestSize(small), requestSize(large));
  assert.ok(requestSize(small) > requestSize([{ role: 'user', content: 'Look' }]) + 1000);
});
