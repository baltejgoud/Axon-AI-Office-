const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composerToken, mentionChoices, withMentions } = require('../src/renderer/src/features/office/activity/composerMenu.ts');
const { followUps } = require('../src/renderer/src/features/office/activity/followUps.ts');
const { visibleUserText } = require('../src/shared/user-text.ts');
const { checkedSavedPrompts } = require('../src/shared/savedPrompts.ts');
const agents = [{ id: 'designer', name: 'Designer', role: 'Design', department: 'Design', description: '' }, { id: 'be', name: 'Backend Developer', role: 'Backend Developer', department: 'Engineering', description: '' }, { id: 'long', name: 'Designer Extra', role: 'Design', department: 'Design', description: '' }];

test('menus open at the caret for mentions and initial slashes, never emails or ordinary paths', () => {
  assert.equal(composerToken('email@example.com', 17), null);
  assert.equal(composerToken('read /src', 9), null);
  assert.deepEqual(composerToken('/rev trailing', 4), { kind: 'shortcut', start: 0, end: 4, query: 'rev' });
  assert.deepEqual(composerToken('ask @Backend', 12), { kind: 'mention', start: 4, end: 12, query: 'Backend' });
  assert.equal(composerToken('ask @Backend\n', 13), null);
});
test('mention search finds roles and departments and skips the current coworker', () => {
  assert.deepEqual(mentionChoices('engineering', agents, 'designer').map((a) => a.id), ['be']);
  assert.deepEqual(mentionChoices('be', agents, 'designer').map((a) => a.id), ['be']);
  assert.ok(!mentionChoices('', agents, 'designer').some((a) => a.id === 'designer'));
});
test('mentions are whole catalog names, deduplicated, hidden from display and ignore the current coworker', () => {
  const text = 'Ask @Designer, @Designer and @Backend Developer.';
  const result = withMentions(text, agents, 'be');
  assert.match(result, /involved: Designer\./);
  assert.equal(visibleUserText(result), text);
  assert.equal(withMentions('x @DesignerExtra', agents, 'be'), 'x @DesignerExtra');
  assert.match(withMentions('@Designer Extra', agents, 'be'), /involved: Designer Extra\./);
  assert.equal(withMentions('me@Designer', agents, 'be'), 'me@Designer');
});
test('follow-ups come only from closing offers, not code, lists or ordinary claims', () => {
  assert.deepEqual(followUps('Done. Would you like me to draft the email? I can also compare pricing. Should I make a plan?'), ['Yes, draft the email', 'Compare pricing', 'Yes, make a plan']);
  assert.deepEqual(followUps('All checks passed.'), []);
  assert.deepEqual(followUps('```js\nI can also delete everything.\n```\n- Should I make a plan?\n1. I can also draft it.\n> Would you like me to send it?'), []);
  assert.deepEqual(followUps('~~~\nI can also do it.\n~~~\nI can also compare pricing. I can also compare pricing.'), ['Compare pricing']);
  assert.deepEqual(followUps(`I can also ${'a'.repeat(61)}.`), []);
  assert.deepEqual(followUps('Should I `run this`?'), []);
  assert.ok(followUps('I can also do A. I can also do B. I can also do C. I can also do D.').length === 3);
  assert.deepEqual(followUps('I can also compare pricing.\n' + 'Done. '.repeat(250)), []);
});
test('saved prompts validate size, names, duplicate case and untrusted settings data', () => {
  assert.deepEqual(checkedSavedPrompts(undefined), []);
  assert.deepEqual(checkedSavedPrompts([{ name: ' weekly ', text: ' Write a report. ' }]), [{ name: 'weekly', text: 'Write a report.' }]);
  for (const value of [null, {}, [null], [{ name: 'bad name', text: 'hi' }], [{ name: 'a', text: '' }], [{ name: 'a', text: 'x'.repeat(4001) }], [{ name: 'a', text: 'x' }, { name: 'A', text: 'y' }], Array.from({ length: 31 }, (_, i) => ({ name: `s${i}`, text: 'x' }))]) assert.throws(() => checkedSavedPrompts(value));
});

test('editing a message replaces its mention instructions while keeping file and attachment context', () => {
  const { planEdit } = require('../src/main/rewrite.ts');
  const blocks = '\n\n<attachment name="notes.txt" attachmentId="a1">notes</attachment>\n\nFile context: folder';
  const original = { id: 'm1', role: 'user', content: withMentions('Ask @Designer', agents, 'be') + blocks };
  const edited = planEdit([original], 'm1', 'Ask @Backend Developer', 'designer');
  assert.match(edited.content, /involved: Backend Developer\./);
  assert.ok(!edited.content.includes('involved: Designer.'));
  assert.ok(edited.content.endsWith(blocks));
  assert.deepEqual(edited.rewrite.keepAttachmentIds, ['a1']);
  assert.equal(planEdit([original], 'm1', 'No colleagues needed', 'designer').content, 'No colleagues needed' + blocks);
});
