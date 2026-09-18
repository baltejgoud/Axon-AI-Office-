const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true }
}).outputText, path);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dedupe, rolesBlock, skillsBlock, SKILL_BUDGET } = require('../src/main/prompt.ts');
const { catalog, skillBodies, hasSkill } = require('../src/main/skills.ts');
const { roles, roleProfiles, hasRole } = require('../src/main/roles.ts');

test('dedupe preserves first-seen order across lists', () => {
  assert.deepEqual(dedupe(['a', 'b'], ['b', 'c', 'a']), ['a', 'b', 'c']);
});

test('rolesBlock names every role and includes each profile', () => {
  const block = rolesBlock([{ id: 'x', name: 'X Dev', group: 'g', profile: 'Owns: x' }, { id: 'y', name: 'Y Dev', group: 'g', profile: 'Owns: y' }]);
  assert.ok(block.startsWith('<roles>\nYou are working as: X Dev, Y Dev.'));
  assert.ok(block.includes('## X Dev\nOwns: x'));
  assert.ok(block.includes('## Y Dev\nOwns: y'));
  assert.ok(block.trimEnd().endsWith('</roles>'));
  assert.equal(rolesBlock([]), '');
});

test('skillsBlock wraps each skill with its source and enforces the budget', () => {
  const block = skillsBlock([{ name: 'tdd', source: 'sp', body: 'Do TDD.' }]);
  assert.ok(block.includes('## Skill: tdd (sp)\nDo TDD.'));
  assert.ok(block.includes('not available here'));
  assert.equal(skillsBlock([]), '');
  assert.throws(
    () => skillsBlock([{ name: 'big', source: 's', body: 'x'.repeat(SKILL_BUDGET) }]),
    /Selected skills exceed the budget \(\d[\d,]* of 80,000 characters\)\. Remove a skill\./
  );
});

test('bundled catalogs load and resolve ids', () => {
  const { skills, sources } = catalog();
  assert.ok(skills.length > 800);
  assert.ok(sources.some((s) => s.slug === 'superpowers'));
  assert.ok(hasSkill('superpowers/brainstorming'));
  const [b] = skillBodies(['superpowers/brainstorming', 'nope/missing']);
  assert.equal(b.name, 'brainstorming');
  assert.ok(b.body.length > 100);
  assert.equal(skillBodies(['nope/missing']).length, 0);
  assert.equal(roles().length, 198);
  assert.ok(hasRole('frontend-developer'));
  assert.equal(roleProfiles(['frontend-developer', 'nope'])[0].name, 'Frontend Developer');
});
