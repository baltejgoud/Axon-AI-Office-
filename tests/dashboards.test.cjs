// Dashboards: what show_dashboard accepts and refuses, how records are kept and updated, and who gets it.
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
const shared = require('../src/shared/dashboards.ts');

const ok = (args) => {
  const out = shared.normalizeDashboard(args);
  assert.ok(!('error' in out), out.error);
  return out;
};
const bad = (args, pattern) => {
  const out = shared.normalizeDashboard(args);
  assert.ok('error' in out, 'expected an error');
  assert.match(out.error, pattern);
};

test('every widget type is accepted and cleaned', () => {
  const { dashboard } = ok({
    title: ' Leads this month ',
    summary: 'Up on last month.',
    widgets: [
      { type: 'stat', label: 'Qualified leads', value: '1,284', change: '+12% vs September' },
      { type: 'stat', label: 'Best channel', value: 'LinkedIn' },
      { type: 'bar', title: 'By channel', data: [{ label: 'LinkedIn', value: 40 }, { label: 'Email', value: '22' }] },
      { type: 'line', title: 'Weekly', x: ['W1', 'W2', 'W3'], series: [{ name: 'Leads', values: [3, 5, 8] }] },
      { type: 'table', title: 'Top accounts', columns: ['Company', 'Size'], rows: [['Acme', 120], ['Globex']] },
      { type: 'list', title: 'Findings', items: ['Plain text item', { text: 'Linked', url: 'https://example.com/a' }] },
      { type: 'text', body: '**Note** the dip in W2.' }
    ],
    sources: [{ title: 'CRM export', url: 'https://example.com/crm' }, 'Sales call notes']
  });
  assert.equal(dashboard.title, 'Leads this month');
  assert.equal(dashboard.widgets[0].value, 1284);
  assert.equal(dashboard.widgets[1].value, 'LinkedIn');
  assert.equal(dashboard.widgets[2].data[1].value, 22);
  assert.deepEqual(dashboard.widgets[4].rows[1], ['Globex', '']);
  assert.deepEqual(dashboard.widgets[5].items[0], { text: 'Plain text item' });
  assert.deepEqual(dashboard.sources, [{ title: 'CRM export', url: 'https://example.com/crm' }, { title: 'Sales call notes' }]);
  assert.ok(!('unit' in dashboard.widgets[0]), 'missing optional fields are left out');
});

test('each limit is refused with where and what', () => {
  bad({ widgets: [{ type: 'text', body: 'x' }] }, /title is missing/);
  bad({ title: 'T', widgets: [] }, /widgets is empty/);
  bad({ title: 'T', widgets: Array(13).fill({ type: 'text', body: 'x' }) }, /widgets has 13; keep it to 12 or fewer/);
  bad({ title: 'T', widgets: [{ type: 'pie' }] }, /widgets\[0\]\.type must be one of stat, bar, line, table, list, text/);
  bad({ title: 'T', widgets: [{ type: 'bar', title: 'B', data: [{ label: 'a', value: 'lots' }] }] }, /widgets\[0\]\.data\[0\]\.value must be a number/);
  bad(
    { title: 'T', widgets: [{ type: 'line', title: 'L', x: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2] }] }] },
    /widgets\[0\]\.series\[0\]\.values has 2 numbers; x has 3 labels/
  );
  bad({ title: 'T', widgets: [{ type: 'table', title: 'T', columns: ['a'], rows: [['1', '2']] }] }, /widgets\[0\]\.rows\[0\] has 2 cells; there are 1 columns/);
  bad({ title: 'T', widgets: [{ type: 'table', title: 'T', columns: ['a'], rows: Array(201).fill(['x']) }] }, /rows has 201; keep it to 200 or fewer/);
  bad({ title: 'x'.repeat(121), widgets: [{ type: 'text', body: 'x' }] }, /title is 121 characters; keep it to 120 or fewer/);
  bad({ title: 'T', widgets: [{ type: 'text', body: 'x'.repeat(40_001) }] }, /keep it under 40,000/);
  bad({ title: 'T', widgets: [{ type: 'bar', title: 'B', data: [{ label: 'a', value: Infinity }] }] }, /must be a number/);
  bad({ title: 'T', widgets: [{ type: 'stat', label: 'L', value: { n: 1 } }] }, /widgets\[0\]\.value must be text/);
});

test('only web links are kept', () => {
  const { dashboard } = ok({
    title: 'T',
    widgets: [
      {
        type: 'list',
        title: 'L',
        items: [
          { text: 'a', url: 'javascript:alert(1)' },
          { text: 'b', url: 'file:///C:/x' },
          { text: 'c', url: 'http://ok.test/' }
        ]
      }
    ],
    sources: [{ title: 's', url: 'ftp://x' }]
  });
  assert.deepEqual(dashboard.widgets[0].items.map((i) => i.url), [undefined, undefined, 'http://ok.test/']);
  assert.deepEqual(dashboard.sources, [{ title: 's' }]);
});

test('dashboard_id comes back for an update', () => {
  assert.equal(ok({ title: 'T', dashboard_id: 'd1', widgets: [{ type: 'text', body: 'x' }] }).id, 'd1');
  assert.ok(!('id' in ok({ title: 'T', widgets: [{ type: 'text', body: 'x' }] })));
});

test('tables copy as CSV, quoted and safe to open in a spreadsheet', () => {
  assert.equal(
    shared.tableCsv(['Name', 'Note'], [['Acme, Inc', 'said "hi"'], ['=HYPERLINK("x")', -5], ['-5', 3]]),
    'Name,Note\r\n"Acme, Inc","said ""hi"""\r\n"\'=HYPERLINK(""x"")",-5\r\n-5,3'
  );
});

test('numbers read short and axes get clean ticks', () => {
  assert.equal(shared.compactNumber(1284), '1,284');
  assert.equal(shared.compactNumber(12900), '12.9K');
  assert.equal(shared.compactNumber(4200000), '4.2M');
  assert.equal(shared.compactNumber(0.456), '0.46');
  assert.deepEqual(shared.niceTicks(0, 87), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(shared.niceTicks(0, 0), [0, 1]);
  assert.deepEqual(shared.niceTicks(-12, 30), [-20, -10, 0, 10, 20, 30]);
});

test('a card sums up what else is on the dashboard, and values read with their units', () => {
  assert.equal(
    shared.widgetSummary([{ type: 'stat' }, { type: 'bar' }, { type: 'line' }, { type: 'table' }, { type: 'list' }, { type: 'text' }]),
    '2 charts · 1 table · 1 list · 1 note'
  );
  assert.equal(shared.widgetSummary([{ type: 'stat' }]), '');
  assert.equal(shared.formatValue(12900, 'USD'), '12.9K USD');
  assert.equal(shared.formatValue('LinkedIn'), 'LinkedIn');
  assert.equal(shared.formatValue(42, '%'), '42%');
  assert.equal(shared.formatValue(-4200000, '$'), '-$4.2M');
});

const main = require('../src/main/dashboards.ts');
const { toolsFor } = require('../src/main/officeTools.ts');
const { selectTools } = require('../src/main/context.ts');
const { PermissionManager } = require('../src/main/security/permissions.ts');

const make = (() => {
  let n = 0;
  return { id: () => `d${++n}`, now: 1000 };
})();
const args = (extra = {}) => ({ title: 'Leads', widgets: [{ type: 'stat', label: 'Leads', value: 3 }], ...extra });

test('a call saves a dashboard, newest first, and says how to update it', () => {
  const list = [];
  const first = main.publishDashboard(list, { args: args(), conversationId: 'c1', agentId: 'research-analyst', toolCallId: 't1' }, make);
  assert.ok(!first.isError);
  const id = list[0].id;
  assert.ok(first.content.includes(`on screen for the user (id ${id})`), first.content);
  assert.match(first.content, new RegExp(`dashboard_id "${id}"`));
  assert.deepEqual(list[0].toolCallIds, ['t1']);
  assert.equal(list[0].agentId, 'research-analyst');
  main.publishDashboard(list, { args: args({ title: 'Second' }), conversationId: 'c1', toolCallId: 't2' }, make);
  assert.equal(list[0].title, 'Second');
  assert.ok(!('agentId' in list[0]), 'your own chat has no coworker');
});

test('an update by id replaces it in place; another conversation cannot', () => {
  const list = [];
  main.publishDashboard(list, { args: args(), conversationId: 'c1', toolCallId: 't1' }, make);
  const id = list[0].id;
  const later = { ...make, now: 2000 };
  const updated = main.publishDashboard(list, { args: args({ title: 'Leads v2', dashboard_id: id }), conversationId: 'c1', toolCallId: 't2' }, later);
  assert.ok(!updated.isError, updated.content);
  assert.match(updated.content, /updated on screen/);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Leads v2');
  assert.deepEqual(list[0].toolCallIds, ['t1', 't2']);
  assert.equal(list[0].createdAt, 1000);
  assert.equal(list[0].updatedAt, 2000);
  const refused = main.publishDashboard(list, { args: args({ dashboard_id: id }), conversationId: 'c2', toolCallId: 't3' }, make);
  assert.equal(refused.isError, true);
  assert.match(refused.content, /no dashboard .* in this conversation/);
  assert.equal(list[0].title, 'Leads v2');
});

test('a bad call is refused with what to fix, and nothing is saved', () => {
  const list = [];
  const out = main.publishDashboard(list, { args: { title: 'T', widgets: [] }, conversationId: 'c1', toolCallId: 't1' }, make);
  assert.equal(out.isError, true);
  assert.equal(out.content, 'Not shown: widgets is empty. Fix it and call show_dashboard again.');
  assert.equal(list.length, 0);
});

test('only the newest 200 are kept', () => {
  const list = [];
  for (let i = 0; i < 205; i++) main.publishDashboard(list, { args: args(), conversationId: 'c1', toolCallId: `t${i}` }, make);
  assert.equal(list.length, main.DASHBOARDS_KEPT);
  assert.deepEqual(list[0].toolCallIds, ['t204']);
});

test('every coworker and your own chats are offered the tool, with or without a folder, and it stays among many tools', () => {
  for (const agentId of [undefined, 'receptionist', 'chief-of-staff', 'backend-developer'])
    for (const hasFolder of [true, false])
      assert.ok(
        toolsFor({ agentId, hasFolder, registry: [] }).some((t) => t.name === 'show_dashboard'),
        `${agentId} ${hasFolder}`
      );
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, description: 'x', parameters: {} }));
  assert.ok(selectTools([...many, main.SHOW_DASHBOARD], 'hello').some((t) => t.name === 'show_dashboard'));
});

test('showing a dashboard needs no approval', () => {
  const permissions = new PermissionManager([], false);
  assert.equal(permissions.check({ toolName: 'show_dashboard', args: {} }).action, 'allow');
});
