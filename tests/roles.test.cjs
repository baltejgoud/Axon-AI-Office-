const { test } = require('node:test');
const assert = require('node:assert/strict');
const roles = require('../src/roles/roles.json');

const GROUPS = [
  'Web & Frontend', 'Backend & APIs', 'Mobile', 'Cloud & Infrastructure', 'Security', 'AI, ML & Data',
  'Architecture & General Engineering', 'Design', 'QA & Release', 'Platforms & Enterprise', 'Emerging Tech',
  'Executive Leadership', 'General Management', 'Product Management', 'Project Management', 'Engineering Management',
  'Operations Management', 'Sales Management', 'Marketing Management', 'HR & People', 'Customer Success', 'Strategy & Innovation'
];

test('roles.json has 198 roles with unique kebab-case ids', () => {
  assert.equal(roles.length, 198);
  const ids = roles.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
});

test('every role has the four profile parts in order and belongs to a known group', () => {
  for (const r of roles) {
    assert.ok(GROUPS.includes(r.group), `${r.id}: unknown group ${r.group}`);
    const parts = ['Owns:', 'Optimises for:', 'Pushes back on:', 'Communicates:'];
    let last = -1;
    for (const p of parts) {
      const at = r.profile.indexOf(p);
      assert.ok(at > last, `${r.id}: missing or misordered "${p}"`);
      last = at;
    }
    const words = r.profile.split(/\s+/).length;
    assert.ok(words >= 60 && words <= 160, `${r.id}: ${words} words`);
  }
});

test('no group is empty', () => {
  for (const g of GROUPS) assert.ok(roles.some((r) => r.group === g), `empty group ${g}`);
});
