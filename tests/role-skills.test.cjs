// Every coworker comes with skills for their title, listed in their prompt and read when a task needs one.
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mapping = require('../src/roles/role-skills.json');
const { COWORKERS, SPECIALIST_ROLES, SPECIALIST_GROUPS, RECEPTIONIST_ID, coworkerById } = require('../src/shared/coworkers.ts');
const { catalog, skillIndex, loadSkill, LOAD_SKILL } = require('../src/main/skills.ts');
const { skillIndexBlock } = require('../src/main/prompt.ts');
const { toolsFor } = require('../src/main/officeTools.ts');
const { PermissionManager } = require('../src/main/security/permissions.ts');

const byId = new Map(catalog().skills.map((s) => [s.id, s]));

test('every coworker but the receptionist comes with 5–16 skills, each bundled and usable without scripts', () => {
  for (const c of COWORKERS) {
    if (c.id === RECEPTIONIST_ID) {
      assert.deepEqual(c.skillIds, [], 'the receptionist keeps to her planner');
      continue;
    }
    assert.ok(c.skillIds.length >= 5 && c.skillIds.length <= 16, `${c.id}: ${c.skillIds.length} skills`);
    assert.equal(new Set(c.skillIds).size, c.skillIds.length, `${c.id}: duplicate skill`);
    for (const id of c.skillIds) {
      const skill = byId.get(id);
      assert.ok(skill, `${c.id}: unknown skill ${id}`);
      assert.ok(skill.supported, `${c.id}: ${id} needs scripts or a tool server`);
    }
  }
});

/** Titles whose skills wait on other work: the Social Media Manager's profile is being rewritten. */
const PENDING = new Set(['social-media-manager']);

test('each specialist has at least one skill chosen for their title, not only their department’s', () => {
  for (const role of SPECIALIST_ROLES) {
    if (PENDING.has(role.id)) {
      assert.equal(mapping.roles[role.id], undefined, `${role.id} is left to its own work for now`);
      continue;
    }
    const own = (mapping.roles[role.id] ?? []).filter((id) => !(mapping.groups[role.group] ?? []).includes(id));
    assert.ok(own.length >= 1, `${role.id} has nothing of its own`);
  }
});

test('the mapping names only real coworkers and departments, and every department has a baseline', () => {
  for (const id of Object.keys(mapping.roles)) assert.ok(coworkerById(id), `unknown coworker ${id}`);
  assert.deepEqual(Object.keys(mapping.groups).sort(), [...SPECIALIST_GROUPS].sort());
});

test('a coworker’s own skills come before their department’s', () => {
  const frontend = coworkerById('frontend-developer');
  assert.equal(frontend.skillIds[0], mapping.roles['frontend-developer'][0]);
  assert.ok(frontend.skillIds.includes(mapping.groups['Web & Frontend'][0]));
});

test('skillIndexBlock lists each skill by id with its description and says to load it first', () => {
  const block = skillIndexBlock([
    { id: 'ecc/api-design', name: 'api-design', description: 'REST API design patterns.' },
    { id: 'axon/grilling', name: 'grilling', description: 'x'.repeat(400) }
  ]);
  assert.ok(block.startsWith('<available_skills>\n'));
  assert.match(block, /load_skill/);
  assert.ok(block.includes('- ecc/api-design: REST API design patterns.'));
  assert.ok(block.includes(`- axon/grilling: ${'x'.repeat(199)}…`), 'long descriptions are clipped');
  assert.ok(block.trimEnd().endsWith('</available_skills>'));
  assert.equal(skillIndexBlock([]), '');
});

test('every coworker’s skill index stays small enough to send on every turn', () => {
  for (const c of COWORKERS) {
    const size = skillIndexBlock(skillIndex(c.skillIds)).length;
    assert.ok(size < 6000, `${c.id}: ${size} characters`);
  }
});

test('loadSkill returns a skill the coworker has, and refuses any other', () => {
  const frontend = coworkerById('frontend-developer');
  const [first] = frontend.skillIds;
  const loaded = loadSkill({ id: first }, frontend.skillIds);
  assert.equal(loaded.isError, undefined);
  assert.ok(loaded.content.startsWith(`<skill id="${first}">`));
  assert.match(loaded.content, /not available here/, 'says scripts and tool servers are missing');
  assert.ok(loaded.content.length > 300);

  const other = catalog().skills.find((s) => !frontend.skillIds.includes(s.id)).id;
  const refused = loadSkill({ id: other }, frontend.skillIds);
  assert.equal(refused.isError, true);
  assert.match(refused.content, new RegExp(`isn't one of your skills\\. Yours: .*${first.replace('/', '\\/')}`));
  assert.equal(loadSkill({}, frontend.skillIds).isError, true);
});

test('coworkers with skills are offered load_skill; the receptionist and plain chats are not', () => {
  const names = (agentId) => toolsFor({ agentId, hasFolder: false, registry: [] }).map((tool) => tool.name);
  assert.deepEqual(names('frontend-developer'), ['ask_colleague', 'load_skill']);
  assert.ok(!names(RECEPTIONIST_ID).includes('load_skill'));
  assert.deepEqual(names(undefined), []);
  assert.equal(LOAD_SKILL.name, 'load_skill');
  assert.deepEqual(LOAD_SKILL.parameters.required, ['id']);
});

test('reading a skill needs no approval', () => {
  assert.equal(new PermissionManager([], false).check({ toolName: 'load_skill', args: { id: 'x' } }).action, 'allow');
});
