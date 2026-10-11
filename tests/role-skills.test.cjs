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
const { catalog, skillIndex, loadSkill, LOAD_SKILL, FIND_SKILLS, findSkills, searchSkills, runSkillTool } = require('../src/main/skills.ts');
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

test('loadSkill returns a coworker’s own skill whole, and says when scripts and servers are missing', () => {
  const frontend = coworkerById('frontend-developer');
  const [first] = frontend.skillIds;
  const loaded = loadSkill({ id: first }, frontend.skillIds);
  assert.equal(loaded.isError, undefined);
  assert.equal(loaded.whole, true, 'a skill is never cut down to an excerpt');
  assert.ok(loaded.content.startsWith(`<skill id="${first}">`));
  assert.ok(loaded.content.trimEnd().endsWith('</skill>'));
  assert.match(loaded.content, /not available here/, 'says scripts and tool servers are missing');
  assert.ok(loaded.content.length > 300);
});

test('loadSkill reads any skill in the library, not only the coworker’s own', () => {
  const frontend = coworkerById('frontend-developer');
  const other = catalog().skills.find((s) => s.supported && !frontend.skillIds.includes(s.id));
  const loaded = loadSkill({ id: other.id }, frontend.skillIds);
  assert.equal(loaded.isError, undefined);
  assert.ok(loaded.content.startsWith(`<skill id="${other.id}">`));
  // Your own chats have no skills of their own, and can read them all the same.
  assert.equal(loadSkill({ id: other.id }).isError, undefined);
  // A bare name finds the skill when only one has it.
  assert.ok(loadSkill({ id: 'api-design' }).content.startsWith('<skill id="ecc/api-design">'));
});

test('loadSkill says when a skill needs tools Axon does not have', () => {
  const unsupported = catalog().skills.find((s) => !s.supported && s.requires.length);
  const loaded = loadSkill({ id: unsupported.id });
  assert.equal(loaded.isError, undefined);
  assert.match(loaded.content, /written for tools Axon doesn't have/);
  assert.ok(loaded.content.includes(unsupported.requires[0]));
});

test('loadSkill refuses an id that is not in the library, and points to find_skills and to the coworker’s own', () => {
  const frontend = coworkerById('frontend-developer');
  const refused = loadSkill({ id: 'nope/not-a-skill' }, frontend.skillIds);
  assert.equal(refused.isError, true);
  assert.match(refused.content, /There is no skill called "nope\/not-a-skill"\. Use find_skills/);
  assert.ok(refused.content.includes(frontend.skillIds[0]), 'lists the coworker’s own');
  assert.equal(loadSkill({}, frontend.skillIds).isError, true);
  assert.ok(!loadSkill({ id: 'nope/x' }).content.includes('or read one of yours'), 'plain chats have none to list');
});

test('findSkills lists the best matches as "id — name: description", at most 8, descriptions clipped to 160', () => {
  const result = findSkills({ query: 'cold email follow-ups' });
  assert.equal(result.isError, undefined);
  const lines = result.content.split('\n');
  const found = lines.slice(0, -1);
  assert.ok(found.length >= 1 && found.length <= 8);
  assert.match(lines.at(-1), /load_skill/, 'ends by saying how to read one');
  const byId = new Map(catalog().skills.map((s) => [s.id, s]));
  for (const line of found) {
    const [, id, name, description] = line.match(/^(\S+) — (\S+): (.*)$/);
    assert.ok(byId.has(id), `${id} is a real skill`);
    assert.equal(byId.get(id).name, name);
    assert.ok(description.length <= 160, `${id}: ${description.length} characters`);
  }
  assert.equal(found[0].split(' ')[0], 'ecc/investor-outreach', 'cold emails and follow-ups come first');
});

test('findSkills ranks a name match first, then what a skill says it does, and understands plurals', () => {
  assert.equal(searchSkills('api design')[0].id, 'ecc/api-design');
  assert.equal(searchSkills('seo')[0].id, 'ecc/seo');
  assert.equal(searchSkills('how to write a changelog')[0].id, 'awesome-claude-skills/changelog-generator');
  // Said in the description, not the name.
  const social = searchSkills('linkedin posts').map((s) => s.id);
  assert.ok(social.slice(0, 3).includes('ecc/content-engine'));
  assert.deepEqual(searchSkills('emails').map((s) => s.id), searchSkills('email').map((s) => s.id));
  // The skill that covers more of what was asked comes before one that covers a part.
  const both = searchSkills('rest api design', 50).map((s) => s.id);
  assert.ok(both.indexOf('ecc/api-design') < both.indexOf('awesome-claude-skills/canvas-design'));
  // Filler words don't pick skills.
  assert.deepEqual(searchSkills('how to use the skill for seo').map((s) => s.id), searchSkills('seo').map((s) => s.id));
});

test('findSkills searches the whole supported library and leaves out skills that could not run here', () => {
  const all = catalog().skills;
  for (const query of ['email', 'design', 'test', 'plan', 'research', 'data', 'automate', 'api']) {
    for (const skill of searchSkills(query, 50)) assert.ok(skill.supported, `${query}: ${skill.id} needs tools Axon doesn't have`);
  }
  // Every supported skill can be found by its own name.
  for (const skill of all.filter((s) => s.supported)) {
    const ids = searchSkills(skill.name, 8).map((s) => s.id);
    assert.ok(ids.includes(skill.id), `${skill.id} is not found by its own name`);
  }
});

test('findSkills copes with nothing to go on', () => {
  assert.equal(findSkills({}).isError, true);
  assert.equal(findSkills({ query: '   ' }).isError, true);
  const none = findSkills({ query: 'xyzzyplugh' });
  assert.equal(none.isError, undefined);
  assert.match(none.content, /No skill matches "xyzzyplugh"/);
  assert.deepEqual(searchSkills('how to use the skills'), [], 'a query of only filler words picks nothing');
});

test('runSkillTool answers both tools from the catalog', () => {
  assert.match(runSkillTool('find_skills', { query: 'seo' }).content, /^ecc\/seo — seo:/);
  assert.ok(runSkillTool('load_skill', { id: 'ecc/seo' }, []).content.startsWith('<skill id="ecc/seo">'));
});

test('everyone but the receptionist is offered find_skills and load_skill, in their own chats too', () => {
  const names = (agentId) => toolsFor({ agentId, hasFolder: false, registry: [] }).map((tool) => tool.name);
  assert.deepEqual(names('frontend-developer'), ['ask_colleague', 'find_skills', 'load_skill']);
  assert.deepEqual(names(undefined), ['find_skills', 'load_skill'], 'your own chats');
  for (const c of COWORKERS) {
    const offered = names(c.id);
    assert.equal(offered.includes('find_skills'), c.id !== RECEPTIONIST_ID, c.id);
    assert.equal(offered.includes('load_skill'), c.id !== RECEPTIONIST_ID, c.id);
  }
  assert.ok(!names(RECEPTIONIST_ID).some((name) => name.endsWith('_skill') || name.endsWith('_skills')));
  assert.equal(LOAD_SKILL.name, 'load_skill');
  assert.deepEqual(LOAD_SKILL.parameters.required, ['id']);
  assert.equal(FIND_SKILLS.name, 'find_skills');
  assert.deepEqual(FIND_SKILLS.parameters.required, ['query']);
});

test('the skill tools say what they are in words a tool search would match', () => {
  for (const tool of [FIND_SKILLS, LOAD_SKILL]) {
    for (const word of ['skill', 'playbook', 'guide', 'how-to']) assert.match(tool.description, new RegExp(word, 'i'), `${tool.name}: ${word}`);
  }
});

test('looking up and reading a skill need no approval', () => {
  const permissions = new PermissionManager([], false);
  assert.equal(permissions.check({ toolName: 'load_skill', args: { id: 'x' } }).action, 'allow');
  assert.equal(permissions.check({ toolName: 'find_skills', args: { query: 'x' } }).action, 'allow');
});

test('the skill tools always survive the tool filter that trims a long list', () => {
  const { selectTools } = require('../src/main/context.ts');
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `connector_${i}`, description: `Does thing ${i}`, parameters: {} }));
  const tools = [...many.slice(0, 20), FIND_SKILLS, LOAD_SKILL, ...many.slice(20)];
  const chosen = selectTools(tools, 'connector_39 please').map((tool) => tool.name);
  assert.equal(chosen.length, 20);
  assert.ok(chosen.includes('find_skills') && chosen.includes('load_skill'));
});

test('the Growth & Outreach team has its own picks, drawn from skills that run here', () => {
  const growth = SPECIALIST_ROLES.filter((role) => role.group === 'Growth & Outreach').map((role) => role.id);
  assert.deepEqual(growth.sort(), [
    'content-creator',
    'copywriter',
    'email-marketing-specialist',
    'lead-generation-specialist',
    'sales-development-representative'
  ]);
  for (const id of growth) {
    const coworker = coworkerById(id);
    assert.ok(coworker.skillIds.includes('ecc/brand-voice'), `${id} writes in the brand's voice`);
    assert.ok(coworker.skillIds.length >= 6, `${id}: ${coworker.skillIds.length} skills`);
  }
  assert.ok(coworkerById('copywriter').skillIds.includes('ecc/seo'));
  assert.ok(coworkerById('sales-development-representative').skillIds.includes('ecc/investor-outreach'));
});

test('the core team all come with skills except the receptionist', () => {
  for (const c of COWORKERS.filter((coworker) => coworker.core)) {
    if (c.id === RECEPTIONIST_ID) assert.deepEqual(c.skillIds, []);
    else assert.ok(c.skillIds.length >= 5, `${c.id}: ${c.skillIds.length} skills`);
  }
});
