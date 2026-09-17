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
