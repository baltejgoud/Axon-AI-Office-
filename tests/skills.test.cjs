const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontmatter } = require('../scripts/skills/ingest-core.cjs');

test('parseFrontmatter reads plain scalars and the body', () => {
  const r = parseFrontmatter('---\nname: tdd\ndescription: Use when writing code\n---\n\n# TDD\nBody here\n');
  assert.deepEqual(r.data, { name: 'tdd', description: 'Use when writing code' });
  assert.equal(r.body, '# TDD\nBody here');
});

test('parseFrontmatter folds a ">" block scalar into one line', () => {
  const r = parseFrontmatter('---\nname: x\ndescription: >\n  Line one\n  line two.\n---\nbody');
  assert.equal(r.data.description, 'Line one line two.');
});

test('parseFrontmatter reads a nested map with list values', () => {
  const r = parseFrontmatter('---\nname: x\ndescription: "quoted"\nrequires:\n  mcp: [rube, other]\n  env: TOKEN\n---\nbody');
  assert.deepEqual(r.data.requires, { mcp: ['rube', 'other'], env: 'TOKEN' });
  assert.equal(r.data.description, 'quoted');
});

test('parseFrontmatter returns null without a frontmatter block', () => {
  assert.equal(parseFrontmatter('# no frontmatter'), null);
});

const { categorize, flattenRequires, dedupe: dedupeSkills, CATEGORIES } = require('../scripts/skills/ingest-core.cjs');

const base = { name: 'x', description: '', path: 'skills/x', requires: [] };

test('categorize: frontmatter category wins when valid', () => {
  assert.equal(categorize({ ...base, category: 'Content', description: 'review everything' }), 'content');
  assert.equal(categorize({ ...base, category: 'nonsense', description: 'audit' }), 'review');
});

test('categorize: mcp requirement or composio path → integration', () => {
  assert.equal(categorize({ ...base, requires: ['mcp:rube'], description: 'design things' }), 'integration');
  assert.equal(categorize({ ...base, path: 'composio-skills/ably-automation', description: 'design' }), 'integration');
});

test('categorize: keyword rules in priority order', () => {
  assert.equal(categorize({ ...base, name: 'requesting-code-review', description: 'plan a review' }), 'review');
  assert.equal(categorize({ ...base, name: 'brainstorming', description: 'design before implementation' }), 'workflow');
  assert.equal(categorize({ ...base, name: 'banner-design', description: 'make banners' }), 'design');
  assert.equal(categorize({ ...base, name: 'changelog-generator', description: 'writes changelogs' }), 'content');
  assert.equal(categorize({ ...base, name: 'typed-service-contracts', description: 'typescript api' }), 'engineering');
  assert.equal(categorize({ ...base, name: 'mystery', description: 'nothing matches' }), 'other');
});

test('flattenRequires turns a map into key:value strings', () => {
  assert.deepEqual(flattenRequires({ mcp: ['rube', 'x'], env: 'TOKEN' }), ['mcp:rube', 'mcp:x', 'env:TOKEN']);
  assert.deepEqual(flattenRequires(undefined), []);
});

test('dedupe keeps one skill per name, preferring skills/ then .claude/skills/', () => {
  const kept = dedupeSkills([
    { name: 'a', path: 'cli/assets/skills/a' },
    { name: 'a', path: '.claude/skills/a' },
    { name: 'a', path: 'skills/a' },
    { name: 'b', path: '.openclaw/skills/b' },
    { name: 'b', path: '.claude/skills/b' }
  ]);
  assert.deepEqual(kept.map((k) => k.path), ['skills/a', '.claude/skills/b']);
});

test('CATEGORIES lists the seven categories with integration before other', () => {
  assert.deepEqual(CATEGORIES, ['design', 'engineering', 'workflow', 'review', 'content', 'integration', 'other']);
});
