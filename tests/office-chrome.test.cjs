// Office chrome: short model names for the composer chip, and fitting district chips on one line.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        resolveJsonModule: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const models = require('../src/shared/models.ts');
const chips = require('../src/renderer/src/features/office/shell/chipFit.ts');

test('short model names', () => {
  const cases = [
    ['claude-sonnet-4-5-20250929', undefined, 'Sonnet 4.5'],
    ['claude-opus-5-5', undefined, 'Opus 5.5'],
    ['claude-haiku-4-5-20251001', undefined, 'Haiku 4.5'],
    ['claude-3-5-sonnet-20241022', undefined, '3.5 Sonnet'],
    ['gpt-4o-mini', undefined, 'GPT-4o mini'],
    ['gpt-4o-2024-08-06', undefined, 'GPT-4o'],
    ['gpt-5', undefined, 'GPT-5'],
    ['o3-mini', undefined, 'o3 mini'],
    ['gemini-2.5-pro', undefined, 'Gemini 2.5 Pro'],
    ['models/gemini-2.5-flash-preview-05-20', undefined, 'Gemini 2.5 Flash'],
    ['deepseek-chat', undefined, 'DeepSeek'],
    ['meta-llama/llama-3.1-70b-instruct', undefined, 'Llama 3.1 70b'],
    ['fixture', 'Fixture', 'Fixture'],
    ['x', 'Claude Sonnet 4.5 (Thinking)', 'Sonnet 4.5 Thin…']
  ];
  for (const [id, name, expected] of cases) assert.equal(models.shortModelName(id, name), expected, id);
});

test('district chips fit on one line; the rest go to More', () => {
  assert.equal(chips.fitChips([80, 90, 70], 300, 60, 4), 3);
  assert.equal(chips.fitChips([80, 90, 70], 247, 60, 4), 2);
  assert.equal(chips.fitChips([80, 90, 70], 150, 60, 4), 1);
  assert.equal(chips.fitChips([80, 90, 70], 100, 60, 4), 0);
  assert.equal(chips.fitChips([], 100, 60, 4), 0);
});
