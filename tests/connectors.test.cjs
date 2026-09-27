// The connector catalog, who a connector serves, what a tool may do on its own, and the tool budget.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/shared/connectors.ts');
const { COWORKERS, SPECIALIST_GROUPS } = require('../src/shared/coworkers.ts');

test('the catalog: unique ids, safe addresses, known categories and real coworkers', () => {
  const ids = c.CONNECTORS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(c.CONNECTORS.length >= 35, `${c.CONNECTORS.length} connectors`);
  const people = new Set([...COWORKERS.map((w) => w.id), 'chats']);
  for (const entry of c.CONNECTORS) {
    assert.ok(entry.name && entry.description && entry.site, entry.id);
    assert.ok(Object.hasOwn(c.CATEGORY_LABELS, entry.category), entry.id);
    assert.ok(['none', 'oauth', 'oauth-app', 'github-account'].includes(entry.auth), entry.id);
    if (entry.url) assert.match(entry.url, /^https:\/\//, entry.id);
    else assert.ok(entry.command && Array.isArray(entry.args) && entry.auth === 'none', entry.id);
    if (entry.auth === 'oauth-app') assert.match(entry.clientIdEnv, /^AXON_[A-Z_]+_CLIENT_ID$/, entry.id);
    for (const p of entry.defaultCoworkers) assert.ok(people.has(p), `${entry.id}: ${p}`);
    for (const g of entry.defaultGroups) assert.ok(SPECIALIST_GROUPS.includes(g), `${entry.id}: ${g}`);
  }
  assert.ok(ids.includes(c.REQUIREMENT_CONNECTORS['mcp:rube']));
});

test('who a connector serves: by id, by department, not someone, or your own chats', () => {
  const list = ['writer', 'group:Design', 'not:product-designer', 'chats'];
  assert.ok(c.servesRun(list, { coworkerId: 'writer', department: 'Library' }));
  assert.ok(c.servesRun(list, { coworkerId: 'ui-ux-designer', department: 'Design' }));
  assert.equal(c.servesRun(list, { coworkerId: 'product-designer', department: 'Design' }), false);
  assert.ok(c.servesRun(list, {}));
  assert.equal(c.servesRun(['writer'], {}), false);
  assert.equal(c.servesRun(undefined, { coworkerId: 'writer' }), false);
});

test('switching one person on or off respects their department', () => {
  const designer = { id: 'product-designer', department: 'Design' };
  assert.deepEqual(c.assign(['group:Design'], designer, false), ['group:Design', 'not:product-designer']);
  assert.deepEqual(c.assign(['group:Design', 'not:product-designer'], designer, true), ['group:Design']);
  assert.deepEqual(c.assign([], designer, true), ['product-designer']);
  assert.deepEqual(c.assign(['product-designer'], designer, false), []);
  assert.deepEqual(c.assignGroup(['product-designer', 'not:ui-ux-designer', 'writer'], 'Design', ['product-designer', 'ui-ux-designer'], true), ['writer', 'group:Design']);
  assert.deepEqual(c.assignGroup(['group:Design', 'not:ui-ux-designer', 'writer'], 'Design', ['product-designer', 'ui-ux-designer'], false), ['writer']);
});

test('a tool runs on its own only when a trusted server marks it read-only, unless you say otherwise', () => {
  const read = { name: 'search', annotations: { readOnlyHint: true } };
  const risky = { name: 'purge', annotations: { readOnlyHint: true, destructiveHint: true } };
  const plain = { name: 'create' };
  assert.equal(c.toolAction({ catalogId: 'notion' }, read), 'allow');
  assert.equal(c.toolAction({ catalogId: 'notion' }, risky), 'ask');
  assert.equal(c.toolAction({ catalogId: 'notion' }, plain), 'ask');
  assert.equal(c.toolAction({}, read), 'ask');
  assert.equal(c.toolAction({ trustAnnotations: true }, read), 'allow');
  assert.equal(c.toolAction({ catalogId: 'notion', toolPolicy: { search: 'off', create: 'allow' } }, read), 'off');
  assert.equal(c.toolAction({ catalogId: 'notion', toolPolicy: { create: 'allow' } }, plain), 'allow');
});

test('the tool budget leaves out whole connectors from the end', () => {
  const group = (id, n) => ({ id, name: id.toUpperCase(), tools: Array.from({ length: n }, (_, i) => `${id}${i}`) });
  const out = c.withinBudget([group('a', 60), group('b', 50), group('c', 30)], 100);
  assert.equal(out.tools.length, 90);
  assert.deepEqual(out.kept, ['a', 'c']);
  assert.deepEqual(out.leftOut, ['B']);
});

test('everyone: every core coworker, every department and your chats', () => {
  const all = c.everyone();
  assert.ok(all.includes('writer') && all.includes('receptionist') && all.includes('chats'));
  for (const g of SPECIALIST_GROUPS) assert.ok(all.includes(`group:${g}`));
});

test('safe MCP addresses', () => {
  assert.ok(c.isSecureMcpUrl('https://mcp.notion.com/mcp'));
  assert.ok(c.isSecureMcpUrl('http://127.0.0.1:8000/mcp'));
  assert.equal(c.isSecureMcpUrl('http://example.com/mcp'), false);
  assert.equal(c.isSecureMcpUrl('https://user:pw@example.com/mcp'), false);
  assert.equal(c.isSecureMcpUrl('nonsense'), false);
});
