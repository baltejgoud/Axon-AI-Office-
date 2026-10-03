const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);

const { test } = require('node:test');
const assert = require('node:assert/strict');
// writeGuard.ts imports nothing, so no Electron stub is needed here.
const { assessWrite, preserveTrailingNewline } = require('../src/main/tools/writeGuard.ts');

/** The rule, in one place, so the arithmetic behind each expectation is visible in the file. */
const allowanceFor = (added) => added * 4 + 20;

test('assessWrite allows a new file of any size', () => {
  assert.deepEqual(assessWrite({ created: true, added: 500, removed: 0 }), { action: 'allow' });
  // `created` wins even when the counts look like a rewrite, so it is checked first.
  assert.equal(assessWrite({ created: true, added: 5, removed: 900 }).action, 'allow');
});

test('assessWrite allows a write that removes nothing', () => {
  assert.equal(assessWrite({ created: false, added: 0, removed: 0 }).action, 'allow');
  assert.equal(assessWrite({ created: false, added: 40, removed: 0 }).action, 'allow');
});

test('assessWrite allows a one-line fix in a 2000-line file', () => {
  assert.deepEqual(assessWrite({ created: false, added: 1, removed: 1 }), { action: 'allow' });
});

test('assessWrite allows 20 added and 25 removed (25 <= 20*4+20 = 100)', () => {
  assert.equal(20 * 4 + 20, 100);
  assert.ok(25 > 20, 'past the bare allowance, so it must clear the added-scaled one');
  assert.equal(assessWrite({ created: false, added: 20, removed: 25 }).action, 'allow');
});

test('assessWrite blocks 60 removed and 5 added (60 > 5*4+20 = 40)', () => {
  assert.equal(allowanceFor(5), 40);
  const verdict = assessWrite({ created: false, added: 5, removed: 60 });
  assert.equal(verdict.action, 'block');
  assert.match(verdict.reason, /60/);
  assert.match(verdict.reason, /5/);
});

test('assessWrite allows 30 removed and 3 added (30 <= 3*4+20 = 32)', () => {
  assert.equal(allowanceFor(3), 32);
  assert.equal(assessWrite({ created: false, added: 3, removed: 30 }).action, 'allow');
  // One more removal than that is over the line: the boundary is the point of the rule.
  assert.equal(assessWrite({ created: false, added: 3, removed: 33 }).action, 'block');
});

test('assessWrite allows a real refactor: 400 removed, 420 added', () => {
  assert.equal(allowanceFor(420), 1700);
  assert.equal(assessWrite({ created: false, added: 420, removed: 400 }).action, 'allow');
});

test('assessWrite blocks 400 removed and 50 added (400 > 50*4+20 = 220)', () => {
  assert.equal(allowanceFor(50), 220);
  assert.equal(assessWrite({ created: false, added: 50, removed: 400 }).action, 'block');
});

test('assessWrite blocks emptying a file and points at a targeted edit', () => {
  assert.equal(allowanceFor(0), 20);
  const verdict = assessWrite({ created: false, added: 0, removed: 300 });
  assert.equal(verdict.action, 'block');
  assert.match(verdict.reason, /edit_file/);
  assert.match(verdict.reason, /300/);
});

test('assessWrite verdicts carry a reason only when they block', () => {
  assert.equal(assessWrite({ created: false, added: 1, removed: 1 }).reason, undefined);
  assert.ok(assessWrite({ created: false, added: 5, removed: 60 }).reason);
});

test('assessWrite reads counts only, never hunks', () => {
  const withoutHunks = assessWrite({ created: false, added: 5, removed: 60 });
  const withHunks = assessWrite({ created: false, added: 5, removed: 60, hunks: '' });
  assert.deepEqual(withHunks, withoutHunks);
  // diff.ts drops hunks for new files and huge changes; a guard keyed to them would go quiet there.
  assert.equal(assessWrite({ created: true, added: 500, removed: 0, hunks: undefined }).action, 'allow');
});

test('preserveTrailingNewline restores a dropped LF', () => {
  assert.equal(preserveTrailingNewline('a\nb\n', 'a\nb'), 'a\nb\n');
  assert.equal(preserveTrailingNewline('a\nb\nc\n', 'a\nb\nC'), 'a\nb\nC\n');
});

test('preserveTrailingNewline keeps CRLF as CRLF', () => {
  assert.equal(preserveTrailingNewline('a\r\nb\r\n', 'a\r\nb'), 'a\r\nb\r\n');
  // A model that re-emitted the file with LF endings gets the old ending back, not an LF.
  assert.equal(preserveTrailingNewline('a\r\nb\r\n', 'a\nb'), 'a\nb\r\n');
});

test('preserveTrailingNewline leaves a file that never had a trailing newline alone', () => {
  assert.equal(preserveTrailingNewline('a\nb', 'a\nb'), 'a\nb');
  assert.equal(preserveTrailingNewline('a\nb', 'a\nb\n'), 'a\nb\n');
});

test('preserveTrailingNewline never adds a second newline', () => {
  assert.equal(preserveTrailingNewline('a\nb\n', 'a\nb\n'), 'a\nb\n');
  assert.equal(preserveTrailingNewline('a\r\nb\r\n', 'a\r\nb\r\n'), 'a\r\nb\r\n');
  assert.equal(preserveTrailingNewline('a\nb\n', 'a\nb\n\n'), 'a\nb\n\n');
});

test('preserveTrailingNewline does nothing for an empty old or new file', () => {
  assert.equal(preserveTrailingNewline('', 'a\nb'), 'a\nb');
  assert.equal(preserveTrailingNewline('', ''), '');
  assert.equal(preserveTrailingNewline('a\nb\n', ''), '');
});