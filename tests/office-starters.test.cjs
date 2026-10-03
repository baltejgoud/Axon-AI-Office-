// The suggestions in an empty chat: what a coworker owns, turned into things you could ask them.
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
const { starters } = require('../src/renderer/src/features/office/activity/starters.ts');
const { COWORKERS } = require('../src/shared/coworkers.ts');

const person = (description, capabilities = ['Group', 'Dedicated conversation', 'File context'], core = false) => ({
  description,
  capabilities,
  core
});

test('a specialist’s list after the dash becomes three things to ask about', () => {
  const result = starters(
    person(
      'the training and serving path — feature pipelines, model training code, experiment tracking, serving infrastructure, and the monitoring that catches drift.'
    )
  );
  assert.deepEqual(
    result.map((s) => s.label),
    ['Feature pipelines', 'Model training code', 'Experiment tracking']
  );
  assert.equal(result[0].prompt, 'Help me with feature pipelines');
});

test('a description with no dash is split on its commas, and "and" before the last item', () => {
  const result = starters(person('the cloud accounts, networks, identity boundaries and landing zones.'));
  assert.deepEqual(
    result.map((s) => s.label),
    ['The cloud accounts', 'Networks', 'Identity boundaries']
  );
});

test('the core team offers its real capabilities, and acronyms keep their capitals', () => {
  const result = starters(person('Designs go-to-market strategies.', ['GTM strategy', 'Positioning frameworks', 'Value propositions', 'Campaign design'], true));
  assert.deepEqual(
    result.map((s) => s.label),
    ['GTM strategy', 'Positioning frameworks', 'Value propositions']
  );
  assert.equal(result[0].prompt, 'Help me with GTM strategy');
  assert.equal(result[1].prompt, 'Help me with positioning frameworks');
});

test('items too long for a chip are skipped rather than cut off', () => {
  const result = starters(
    person(
      'a long list — an extraordinarily long item that would never fit on a single small chip, short one, another short one, third short one.'
    )
  );
  assert.deepEqual(
    result.map((s) => s.label),
    ['Short one', 'Another short one', 'Third short one']
  );
});

test('a coworker with fewer than two short items also gets the general question', () => {
  const some = starters(person('x — one short item, and a very long item that cannot possibly fit in one chip at all.'));
  assert.deepEqual(
    some.map((s) => s.label),
    ['One short item', 'What can you help me with?']
  );
  const none = starters(person(''));
  assert.deepEqual(
    none.map((s) => s.prompt),
    ['What can you help me with?']
  );
});

test('every coworker in the office gets at least two suggestions, none of them empty', () => {
  for (const coworker of COWORKERS) {
    const result = starters(coworker);
    assert.ok(result.length >= 2, `${coworker.name}: ${result.length} suggestions from "${coworker.description}"`);
    for (const s of result) {
      assert.ok(s.label.trim() && s.prompt.trim(), `${coworker.name} has an empty suggestion`);
      assert.ok(s.label.length <= 36, `${coworker.name}: "${s.label}" is too long for a chip`);
    }
  }
});
