const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyUniqueEdit } = require('../src/main/tools/editFile.ts');

test('applyUniqueEdit replaces a unique match', () => {
  const result = applyUniqueEdit('const a = 1;\nconst b = 2;', 'const b = 2;', 'const b = 3;');
  assert.deepEqual(result, { ok: true, text: 'const a = 1;\nconst b = 3;', replacements: 1 });
});

test('applyUniqueEdit reports not found', () => {
  const result = applyUniqueEdit('hello world', 'goodbye', 'later');
  assert.equal(result.ok, false);
  assert.match(result.reason, /not found/);
});

test('applyUniqueEdit reports the count when the match is ambiguous', () => {
  const result = applyUniqueEdit('const x = 1;\nconst y = 2;\nconst z = 3;', 'const ', 'let ');
  assert.equal(result.ok, false);
  assert.match(result.reason, /3/);
  assert.match(result.reason, /surrounding context/);
});

test('applyUniqueEdit replaces every match with replaceAll', () => {
  const result = applyUniqueEdit('a\na\na', 'a', 'b', true);
  assert.deepEqual(result, { ok: true, text: 'b\nb\nb', replacements: 3 });
});

test('applyUniqueEdit rejects an empty oldString', () => {
  const result = applyUniqueEdit('anything', '', 'x');
  assert.equal(result.ok, false);
  assert.match(result.reason, /empty/);
});

test('applyUniqueEdit rejects identical old and new strings', () => {
  const result = applyUniqueEdit('text', 'same', 'same');
  assert.equal(result.ok, false);
  assert.match(result.reason, /differ/);
});

test('applyUniqueEdit matches an LF needle in a CRLF file and keeps the file EOL', () => {
  const result = applyUniqueEdit('one\r\ntwo\r\nthree', 'two\nthree', 'two\nthree!');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'one\r\ntwo\r\nthree!');
  assert.equal(result.replacements, 1);
});

test('applyUniqueEdit disambiguates repeated boilerplate lines with more context', () => {
  const result = applyUniqueEdit(
    'import a;\nimport b;\nimport c;',
    'import b;\nimport c;',
    'import b;\nimport c;\nimport d;'
  );
  assert.equal(result.ok, true);
  assert.equal(result.text, 'import a;\nimport b;\nimport c;\nimport d;');
  assert.equal(result.replacements, 1);
});

test('applyUniqueEdit leaves Unicode untouched', () => {
  const result = applyUniqueEdit('héllo wörld 👋\n日本語', 'wörld', 'mundo');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'héllo mundo 👋\n日本語');
  assert.equal(result.replacements, 1);

  // Combining sequences are matched byte-for-byte, never NFC-folded into precomposed forms.
  const decomposed = 'e\u0301'; // "e" + combining acute, not "é"
  const folded = applyUniqueEdit(`${decomposed}x`, decomposed, 'e');
  assert.equal(folded.ok, true);
  assert.equal(folded.text, 'ex');
  assert.equal(applyUniqueEdit('éx', decomposed, 'e').ok, false);
});

test('applyUniqueEdit never mutates its inputs', () => {
  const text = 'const a = 1;\nconst b = 2;';
  const oldString = 'const b = 2;';
  const newString = 'const b = 3;';
  const result = applyUniqueEdit(text, oldString, newString);
  assert.equal(result.ok, true);
  assert.equal(text, 'const a = 1;\nconst b = 2;');
  assert.equal(oldString, 'const b = 2;');
  assert.equal(newString, 'const b = 3;');
});

test('applyUniqueEdit treats a literal backslash-n as text, not a newline', () => {
  // The text contains the two characters "\" and "n", not a line feed.
  const result = applyUniqueEdit('const escaped = "\\n";', '\\n', '\\\\n');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'const escaped = "\\\\n";');
  assert.equal(result.replacements, 1);
});
