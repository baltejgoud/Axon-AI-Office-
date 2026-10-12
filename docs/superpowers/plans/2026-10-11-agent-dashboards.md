# Agent Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coworkers can show data they gathered as a dashboard (stat tiles, bar and line charts, tables, lists, notes) with a new `show_dashboard` tool; it appears as a card in their conversation and in a Dashboards sheet.

**Architecture:** A pure module in `src/shared/dashboards.ts` checks and cleans the tool's input (both processes use its types and helpers). `src/main/dashboards.ts` defines the tool and saves records into `state.dashboards`; the service answers the call like the planner tools and emits a `dashboards` stream event. The window draws the widgets itself (SVG/CSS, no chart library) in a card routed by `officeToolCard` and in a new `'dashboards'` overlay.

**Tech Stack:** Electron + TypeScript, React 18, Zustand, Node test runner (`node --test tests/*.test.cjs`, TS transpiled in the test file).

**Spec:** `docs/superpowers/specs/2026-10-11-agent-dashboards-design.md`

## Global Constraints

- Work only in `D:\Baltej IDE\.claude\worktrees\dashboards` (branch `feat/agent-dashboards`); never in the shared checkout.
- Limits: 40,000 characters of JSON per call; 12 widgets; 20 sources; 30 bars; 100 x labels / points; 6 series; 12 columns; 200 rows; 300 characters per cell; 50 list items; 4,000-character text body; newest 200 dashboards kept.
- Nothing the model writes is rendered as HTML; links open only when http(s), through `window.axon.openLink`.
- Chart colours: categorical slots validated by the dataviz validator against Axon's surfaces (light `#ffffff`, dark `#172032`): light `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300`, dark `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300`. Light has a contrast WARN, so every chart has a legend for 2+ series and a "Table" view.
- Copy is plain and specific, in the app's voice ("Dashboards", "Open", "Go to conversation", "Copy as CSV").
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Dashboard content checks (shared)

**Files:**
- Create: `src/shared/dashboards.ts`
- Test: `tests/dashboards.test.cjs`

**Interfaces:**
- Produces: types `Dashboard`, `DashboardContent`, `DashboardWidget`, `StatWidget`, `BarWidget`, `LineWidget`, `TableWidget`, `ListWidget`, `TextWidget`, `DashboardSource`; `DASHBOARD_LIMITS`; `normalizeDashboard(args: unknown): { dashboard: DashboardContent; id?: string } | { error: string }`; `tableCsv(columns: readonly string[], rows: readonly (string | number)[][]): string`; `compactNumber(n: number): string`; `niceTicks(min: number, max: number, count?: number): number[]`.

- [ ] **Step 1: Write the failing tests** (`tests/dashboards.test.cjs`, header copied from `tests/team-meeting.test.cjs` so `.ts` files load):

```js
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
    title: ' Leads this month ', summary: 'Up on last month.',
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
  bad({ title: 'T', widgets: [{ type: 'line', title: 'L', x: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2] }] }] },
    /widgets\[0\]\.series\[0\]\.values has 2 numbers; x has 3 labels/);
  bad({ title: 'T', widgets: [{ type: 'table', title: 'T', columns: ['a'], rows: [['1', '2']] }] }, /widgets\[0\]\.rows\[0\] has 2 cells; there are 1 columns/);
  bad({ title: 'T', widgets: [{ type: 'table', title: 'T', columns: ['a'], rows: Array(201).fill(['x']) }] }, /rows has 201; keep it to 200 or fewer/);
  bad({ title: 'x'.repeat(121), widgets: [{ type: 'text', body: 'x' }] }, /title is 121 characters; keep it to 120 or fewer/);
  bad({ title: 'T', widgets: [{ type: 'text', body: 'x'.repeat(40_001) }] }, /keep it under 40,000/);
  bad({ title: 'T', widgets: [{ type: 'bar', title: 'B', data: [{ label: 'a', value: Infinity }] }] }, /must be a number/);
});

test('only web links are kept', () => {
  const { dashboard } = ok({
    title: 'T',
    widgets: [{ type: 'list', title: 'L', items: [{ text: 'a', url: 'javascript:alert(1)' }, { text: 'b', url: 'file:///C:/x' }, { text: 'c', url: 'http://ok.test/' }] }],
    sources: [{ title: 's', url: 'ftp://x' }]
  });
  assert.deepEqual(dashboard.widgets[0].items.map((i) => i.url), [undefined, undefined, 'http://ok.test/']);
  assert.deepEqual(dashboard.sources, [{ title: 's' }]);
});

test('dashboard_id comes back for an update', () => {
  assert.equal(ok({ title: 'T', dashboard_id: 'd1', widgets: [{ type: 'text', body: 'x' }] }).id, 'd1');
});

test('tables copy as CSV, quoted and safe to open in a spreadsheet', () => {
  assert.equal(shared.tableCsv(['Name', 'Note'], [['Acme, Inc', 'said "hi"'], ['=HYPERLINK("x")', -5], ['-5', 3]]),
    'Name,Note\r\n"Acme, Inc","said ""hi"""\r\n"\'=HYPERLINK(""x"")",-5\r\n-5,3');
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
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/dashboards.test.cjs`
Expected: FAIL, `Cannot find module '../src/shared/dashboards.ts'`.

- [ ] **Step 3: Implement `src/shared/dashboards.ts`**

```ts
/**
 * Dashboards a coworker shows with show_dashboard: the data it gathered as number tiles, charts,
 * tables, lists and notes. The model fills in these building blocks and the window draws them, so
 * nothing it writes runs. The main process checks a call here; the window uses the types and helpers.
 */

export interface StatWidget { type: 'stat'; label: string; value: number | string; unit?: string; change?: string; note?: string }
export interface BarWidget { type: 'bar'; title: string; data: { label: string; value: number }[]; unit?: string }
export interface LineWidget { type: 'line'; title: string; x: string[]; series: { name: string; values: number[] }[]; unit?: string }
export interface TableWidget { type: 'table'; title: string; columns: string[]; rows: (string | number)[][] }
export interface ListWidget { type: 'list'; title: string; items: { text: string; detail?: string; url?: string }[] }
export interface TextWidget { type: 'text'; title?: string; body: string }
export type DashboardWidget = StatWidget | BarWidget | LineWidget | TableWidget | ListWidget | TextWidget;

/** Where the data came from. */
export interface DashboardSource { title: string; url?: string }

/** What a show_dashboard call shows, checked. */
export interface DashboardContent {
  title: string;
  summary?: string;
  widgets: DashboardWidget[];
  sources: DashboardSource[];
}

export interface Dashboard extends DashboardContent {
  id: string;
  /** The coworker who showed it; none for your own chats. */
  agentId?: string;
  conversationId: string;
  /** The show_dashboard calls that showed and updated it, oldest first. */
  toolCallIds: string[];
  createdAt: number;
  updatedAt: number;
}

export const DASHBOARD_LIMITS = {
  chars: 40_000, title: 120, summary: 600, widgets: 12, sources: 20, label: 120, short: 40,
  note: 200, bars: 30, points: 100, series: 6, columns: 12, rows: 200, cell: 300, items: 50,
  detail: 600, body: 4000
} as const;
const L = DASHBOARD_LIMITS;
const WIDGET_TYPES = ['stat', 'bar', 'line', 'table', 'list', 'text'];

/** What is wrong with a call, said so the model can fix it. */
class Problem extends Error {}
const fail = (message: string): never => {
  throw new Problem(message);
};
const count = (n: number) => n.toLocaleString('en-US');

/** Leaves out the fields that weren't given, so records stay small and tidy. */
const clean = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const record = (value: unknown, at: string): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${at} must be an object.`);

function text(value: unknown, at: string, max: number): string;
function text(value: unknown, at: string, max: number, optional: true): string | undefined;
function text(value: unknown, at: string, max: number, optional = false): string | undefined {
  if (value === undefined || value === null || value === '') return optional ? undefined : fail(`${at} is missing.`);
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') fail(`${at} must be text.`);
  const out = String(value).trim();
  if (!out) return optional ? undefined : fail(`${at} is empty.`);
  if (out.length > max) fail(`${at} is ${count(out.length)} characters; keep it to ${count(max)} or fewer.`);
  return out;
}

/** "1,284" counts as 1284; "12%" and "lots" don't. */
const NUMERIC = /^-?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/;
const number = (value: unknown, at: string): number => {
  const n = typeof value === 'string' && NUMERIC.test(value.trim()) && /\d/.test(value) ? Number(value.trim().replace(/,/g, '')) : value;
  return typeof n === 'number' && Number.isFinite(n)
    ? n
    : fail(`${at} must be a number (got ${String(JSON.stringify(value)).slice(0, 40)}).`);
};

const list = (value: unknown, at: string, max: number, min = 0): unknown[] => {
  if (value === undefined || value === null) return min ? fail(`${at} is missing.`) : [];
  if (!Array.isArray(value)) return fail(`${at} must be a list.`);
  if (value.length < min) fail(min === 1 ? `${at} is empty.` : `${at} needs at least ${min}.`);
  if (value.length > max) fail(`${at} has ${count(value.length)}; keep it to ${count(max)} or fewer.`);
  return value;
};

/** Only web links are kept; anything else is dropped rather than refused. */
const link = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  try {
    return /^https?:$/.test(new URL(value.trim()).protocol) ? value.trim() : undefined;
  } catch {
    return undefined;
  }
};

function widget(value: unknown, at: string): DashboardWidget {
  const w = record(value, at);
  const unit = () => text(w.unit, `${at}.unit`, L.short, true);
  switch (w.type) {
    case 'stat': {
      const raw = typeof w.value === 'string' && NUMERIC.test(w.value.trim()) && /\d/.test(w.value) ? number(w.value, `${at}.value`) : w.value;
      return clean({
        type: 'stat',
        label: text(w.label, `${at}.label`, L.label),
        value: typeof raw === 'number' ? number(raw, `${at}.value`) : text(raw, `${at}.value`, L.short),
        unit: unit(),
        change: text(w.change, `${at}.change`, L.short, true),
        note: text(w.note, `${at}.note`, L.note, true)
      });
    }
    case 'bar':
      return clean({
        type: 'bar',
        title: text(w.title, `${at}.title`, L.label),
        data: list(w.data, `${at}.data`, L.bars, 1).map((d, i) => {
          const item = record(d, `${at}.data[${i}]`);
          return { label: text(item.label, `${at}.data[${i}].label`, L.label), value: number(item.value, `${at}.data[${i}].value`) };
        }),
        unit: unit()
      });
    case 'line': {
      const x = list(w.x, `${at}.x`, L.points, 2).map((label, i) => text(label, `${at}.x[${i}]`, L.short));
      const series = list(w.series, `${at}.series`, L.series, 1).map((s, i) => {
        const item = record(s, `${at}.series[${i}]`);
        const values = list(item.values, `${at}.series[${i}].values`, L.points, 1).map((v, j) => number(v, `${at}.series[${i}].values[${j}]`));
        if (values.length !== x.length)
          fail(`${at}.series[${i}].values has ${values.length} numbers; x has ${x.length} labels. Give one number per label.`);
        return { name: text(item.name, `${at}.series[${i}].name`, L.label), values };
      });
      return clean({ type: 'line', title: text(w.title, `${at}.title`, L.label), x, series, unit: unit() });
    }
    case 'table': {
      const columns = list(w.columns, `${at}.columns`, L.columns, 1).map((c, i) => text(c, `${at}.columns[${i}]`, L.label));
      const rows = list(w.rows, `${at}.rows`, L.rows, 1).map((r, i) => {
        const row = list(r, `${at}.rows[${i}]`, Infinity);
        if (row.length > columns.length) fail(`${at}.rows[${i}] has ${row.length} cells; there are ${columns.length} columns.`);
        return columns.map((_, j) =>
          typeof row[j] === 'number' && Number.isFinite(row[j]) ? (row[j] as number) : (text(row[j], `${at}.rows[${i}][${j}]`, L.cell, true) ?? '')
        );
      });
      return { type: 'table', title: text(w.title, `${at}.title`, L.label), columns, rows };
    }
    case 'list':
      return {
        type: 'list',
        title: text(w.title, `${at}.title`, L.label),
        items: list(w.items, `${at}.items`, L.items, 1).map((it, i) => {
          if (typeof it === 'string') return { text: text(it, `${at}.items[${i}]`, L.cell) };
          const item = record(it, `${at}.items[${i}]`);
          return clean({
            text: text(item.text, `${at}.items[${i}].text`, L.cell),
            detail: text(item.detail, `${at}.items[${i}].detail`, L.detail, true),
            url: link(item.url)
          });
        })
      };
    case 'text':
      return clean({ type: 'text', title: text(w.title, `${at}.title`, L.label, true), body: text(w.body, `${at}.body`, L.body) });
    default:
      return fail(`${at}.type must be one of ${WIDGET_TYPES.join(', ')}.`);
  }
}

/** Checks a show_dashboard call: the dashboard to show, or exactly what is wrong with it. */
export function normalizeDashboard(args: unknown): { dashboard: DashboardContent; id?: string } | { error: string } {
  try {
    const size = JSON.stringify(args ?? null).length;
    if (size > L.chars)
      fail(`The dashboard is ${count(size)} characters of data; keep it under ${count(L.chars)}. Show fewer rows or points and sum up the rest.`);
    const input = record(args, 'The input');
    const dashboard: DashboardContent = clean({
      title: text(input.title, 'title', L.title),
      summary: text(input.summary, 'summary', L.summary, true),
      widgets: list(input.widgets, 'widgets', L.widgets, 1).map((w, i) => widget(w, `widgets[${i}]`)),
      sources: list(input.sources, 'sources', L.sources).map((s, i) => {
        if (typeof s === 'string') return link(s) ? { title: s.trim(), url: link(s) } : { title: text(s, `sources[${i}]`, L.label) };
        const item = record(s, `sources[${i}]`);
        return clean({ title: text(item.title ?? item.url, `sources[${i}].title`, L.label), url: link(item.url) });
      })
    });
    return clean({ dashboard, id: text(input.dashboard_id, 'dashboard_id', 100, true) });
  } catch (error) {
    if (error instanceof Problem) return { error: error.message };
    throw error;
  }
}

/** A table as CSV: quoted where needed, and text a spreadsheet would run as a formula kept as text. */
export function tableCsv(columns: readonly string[], rows: readonly (string | number)[][]): string {
  const cell = (value: string | number) => {
    let out = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(out) && !NUMERIC.test(out)) out = `'${out}`;
    return /[",\r\n]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
  };
  return [columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}

/** 1,284 · 12.9K · 4.2M · 0.46 */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10_000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: abs < 10 ? 2 : abs < 100 ? 1 : 0 }).format(n);
}

/** Round axis values from min to max: 1, 2, 2.5 or 5 times a power of ten apart, about `count` steps. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return min === 0 ? [0, 1] : niceTicks(Math.min(0, min), Math.max(0, max), count);
  const span = max - min;
  const power = 10 ** Math.floor(Math.log10(span / count));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => span / s <= count) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v < max + step - 1e-9 * step; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}
```

- [ ] **Step 4: Run and pass**

Run: `node --test tests/dashboards.test.cjs` — Expected: all PASS. Adjust messages in the code (not the tests) until they do.

- [ ] **Step 5: Commit**

`git add src/shared/dashboards.ts tests/dashboards.test.cjs` then commit `feat(dashboards): check and clean what show_dashboard is given`.

---

### Task 2: The tool, records, permissions and the service

**Files:**
- Create: `src/main/dashboards.ts`
- Modify: `src/shared/platform.ts` (PlatformState `dashboards`, API `dashboardDelete`), `src/shared/types.ts` (StreamEvent `dashboards`), `src/main/repository.ts` (default + normalize), `src/main/officeTools.ts` (`toolsFor` offers it), `src/main/context.ts` (`selectTools` core keeps it), `src/main/security/permissions.ts` (allow), `src/main/service.ts` (answer the call; `dashboardDelete`), `src/main/index.ts` + `src/preload/index.ts` + `src/main/browserBridge.ts` (IPC lists)
- Test: `tests/dashboards.test.cjs` (append), `tests/dashboards-service.test.cjs` (new, setup copied from `tests/team-service.test.cjs`)

**Interfaces:**
- Consumes: `normalizeDashboard`, `Dashboard` from Task 1.
- Produces: `SHOW_DASHBOARD: ToolDefinition`; `DASHBOARDS_KEPT = 200`; `publishDashboard(dashboards: Dashboard[], call: { args: unknown; conversationId: string; agentId?: string; toolCallId: string }, make: { id: () => string; now: number }): { content: string; isError?: boolean; dashboard?: Dashboard }` (mutates `dashboards`: newest first, trimmed); `Service.dashboardDelete(id: string): Promise<boolean>`; stream event `{ channel: 'dashboards'; dashboards: Dashboard[] }`; `PlatformState.dashboards: Dashboard[]`.

- [ ] **Step 1: Failing tests.** Append to `tests/dashboards.test.cjs`:

```js
const main = require('../src/main/dashboards.ts');
const { toolsFor } = require('../src/main/officeTools.ts');
const { selectTools } = require('../src/main/context.ts');
const { PermissionManager } = require('../src/main/security/permissions.ts');

const make = (() => { let n = 0; return { id: () => `d${++n}`, now: 1000 }; })();
const args = (extra = {}) => ({ title: 'Leads', widgets: [{ type: 'stat', label: 'Leads', value: 3 }], ...extra });

test('a call saves a dashboard, newest first, and says how to update it', () => {
  const list = [];
  const first = main.publishDashboard(list, { args: args(), conversationId: 'c1', agentId: 'data-analyst', toolCallId: 't1' }, make);
  assert.ok(!first.isError);
  assert.match(first.content, /on screen for the user \(id d1\)/);
  assert.match(first.content, /dashboard_id "d1"/);
  assert.deepEqual(list[0].toolCallIds, ['t1']);
  assert.equal(list[0].agentId, 'data-analyst');
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
  assert.ok(!updated.isError);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Leads v2');
  assert.deepEqual(list[0].toolCallIds, ['t1', 't2']);
  assert.equal(list[0].createdAt, 1000);
  assert.equal(list[0].updatedAt, 2000);
  const refused = main.publishDashboard(list, { args: args({ dashboard_id: id }), conversationId: 'c2', toolCallId: 't3' }, make);
  assert.equal(refused.isError, true);
  assert.match(refused.content, /no dashboard .* in this conversation/);
});

test('a bad call is refused with what to fix, and nothing is saved', () => {
  const list = [];
  const out = main.publishDashboard(list, { args: { title: 'T', widgets: [] }, conversationId: 'c1', toolCallId: 't1' }, make);
  assert.equal(out.isError, true);
  assert.match(out.content, /^Not shown: widgets is empty\. Fix it and call show_dashboard again\.$/);
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
      assert.ok(toolsFor({ agentId, hasFolder, registry: [] }).some((t) => t.name === 'show_dashboard'), `${agentId} ${hasFolder}`);
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, description: 'x', parameters: {} }));
  assert.ok(selectTools([...many, main.SHOW_DASHBOARD], 'hello').some((t) => t.name === 'show_dashboard'));
});

test('showing a dashboard needs no approval', () => {
  const permissions = new PermissionManager();
  assert.equal(permissions.check({ toolName: 'show_dashboard', args: {} }).action, 'allow');
});
```

(Check `PermissionManager`'s real export name and constructor in `src/main/security/permissions.ts` and use them.)

New `tests/dashboards-service.test.cjs` (setup, `mockModel` and `waitFor` copied from `tests/team-service.test.cjs`; also set `electron.dialog.showMessageBox`):

```js
test('a coworker shows a dashboard: saved, sent to the window, answered, and deletable', async (t) => {
  const { service, repo, events } = await setup(t);
  repo.state.settings.autoTitleConversations = false;
  const chat = await service.chatCreate('p1', 'm1', null, 'data-analyst', { skillIds: [], roleIds: [] }, null, 'You are the Data Analyst.');
  let seen;
  mockModel(t, async (n, req, onChunk) => {
    if (n === 1) {
      assert.ok(req.tools.some((x) => x.name === 'show_dashboard'));
      return { toolCalls: [{ id: 'call1', name: 'show_dashboard', arguments: JSON.stringify({ title: 'Leads', widgets: [{ type: 'stat', label: 'Leads', value: 3 }] }) }] };
    }
    seen = req.messages.at(-1);
    onChunk('Here is the dashboard.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'show me the leads', []);
  await waitFor(() => repo.conversationMessages(chat.id).some((m) => m.role === 'assistant' && !m.streaming && m.content.includes('Here is')), 'the answer');
  assert.equal(repo.state.dashboards.length, 1);
  assert.equal(repo.state.dashboards[0].agentId, 'data-analyst');
  assert.match(String(seen.content), /on screen for the user/);
  assert.ok(events.some((e) => e.channel === 'dashboards' && e.dashboards.length === 1));
  assert.equal(service.snapshot().dashboards.length, 1);

  electron.dialog.showMessageBox = async () => ({ response: 0 });
  assert.equal(await service.dashboardDelete(repo.state.dashboards[0].id), false);
  electron.dialog.showMessageBox = async () => ({ response: 1 });
  assert.equal(await service.dashboardDelete(repo.state.dashboards[0].id), true);
  assert.equal(repo.state.dashboards.length, 0);
});

test('saved data from before dashboards loads with none', async (t) => {
  // Write a state file without `dashboards`, open a Repository on it, and expect `state.dashboards` to be [].
});
```

The second test: copy how `tests/repository.test.cjs` writes and reopens a state file, delete `dashboards` from the written JSON, reopen, `assert.deepEqual(repo.state.dashboards, [])`.

- [ ] **Step 2: Run to see them fail** — `node --test tests/dashboards.test.cjs tests/dashboards-service.test.cjs`; expected: missing module `src/main/dashboards.ts`.

- [ ] **Step 3: `src/main/dashboards.ts`**

```ts
import { DASHBOARD_LIMITS as L, normalizeDashboard, type Dashboard } from '../shared/dashboards';
import type { ToolDefinition } from '../shared/types';

/** The newest dashboards kept; older ones are dropped as new ones arrive. */
export const DASHBOARDS_KEPT = 200;

export const SHOW_DASHBOARD: ToolDefinition = {
  name: 'show_dashboard',
  description:
    'Show the user a dashboard of data you gathered: number tiles, bar and line charts, tables, lists of findings and short notes. Use it when the data is worth seeing at a glance (figures, comparisons, trends, a list of leads or results); a simple answer needs none. Only data you actually gathered or were given, never invented; say where it came from in sources. It appears in this conversation and in the Dashboards sheet. Still answer in text in a few lines. To change a dashboard you showed, call again with its dashboard_id.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What it shows, in a few words' },
      summary: { type: 'string', description: 'The takeaway in one or two sentences' },
      widgets: {
        type: 'array',
        description: `1-${L.widgets} blocks, shown in order. Lead with stat tiles for the headline numbers.`,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['stat', 'bar', 'line', 'table', 'list', 'text'] },
            title: { type: 'string', description: 'bar, line, table, list, text: its heading' },
            label: { type: 'string', description: 'stat: what the number is' },
            value: { type: 'string', description: 'stat: the number, e.g. "1284", or a short value like "LinkedIn"' },
            unit: { type: 'string', description: 'stat, bar, line: e.g. "%", "USD", "leads"' },
            change: { type: 'string', description: 'stat: change against an earlier period, e.g. "+12% vs September"' },
            note: { type: 'string', description: 'stat: a few words more' },
            data: {
              type: 'array',
              description: `bar: up to ${L.bars} bars`,
              items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } }, required: ['label', 'value'] }
            },
            x: { type: 'array', items: { type: 'string' }, description: `line: the labels along the bottom, e.g. months (2-${L.points})` },
            series: {
              type: 'array',
              description: `line: up to ${L.series} lines, each with one value per x label`,
              items: {
                type: 'object',
                properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } },
                required: ['name', 'values']
              }
            },
            columns: { type: 'array', items: { type: 'string' }, description: `table: column headings (up to ${L.columns})` },
            rows: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description: `table: up to ${L.rows} rows, one cell per column`
            },
            items: {
              type: 'array',
              description: `list: up to ${L.items} findings`,
              items: {
                type: 'object',
                properties: { text: { type: 'string' }, detail: { type: 'string' }, url: { type: 'string' } },
                required: ['text']
              }
            },
            body: { type: 'string', description: 'text: a short note in Markdown' }
          },
          required: ['type']
        }
      },
      sources: {
        type: 'array',
        description: 'Where the data came from',
        items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title'] }
      },
      dashboard_id: { type: 'string', description: 'Only to update a dashboard you showed earlier in this conversation' }
    },
    required: ['title', 'widgets']
  }
};

/**
 * Saves what a show_dashboard call shows into `dashboards` (newest first, the newest
 * DASHBOARDS_KEPT kept), or says what is wrong with it so the model can call again.
 */
export function publishDashboard(
  dashboards: Dashboard[],
  call: { args: unknown; conversationId: string; agentId?: string; toolCallId: string },
  make: { id: () => string; now: number }
): { content: string; isError?: boolean; dashboard?: Dashboard } {
  const checked = normalizeDashboard(call.args);
  if ('error' in checked) return { content: `Not shown: ${checked.error} Fix it and call show_dashboard again.`, isError: true };
  const { dashboard: content, id } = checked;
  if (id) {
    const at = dashboards.findIndex((d) => d.id === id && d.conversationId === call.conversationId);
    if (at < 0)
      return { content: `There is no dashboard ${id} in this conversation. Leave dashboard_id out to show a new one.`, isError: true };
    const [old] = dashboards.splice(at, 1);
    const dashboard: Dashboard = {
      ...content,
      id,
      ...(old.agentId ? { agentId: old.agentId } : {}),
      conversationId: old.conversationId,
      toolCallIds: [...old.toolCallIds, call.toolCallId],
      createdAt: old.createdAt,
      updatedAt: make.now
    };
    dashboards.unshift(dashboard);
    return { content: `Dashboard "${dashboard.title}" is updated on screen for the user (id ${id}).`, dashboard };
  }
  const dashboard: Dashboard = {
    ...content,
    id: make.id(),
    ...(call.agentId ? { agentId: call.agentId } : {}),
    conversationId: call.conversationId,
    toolCallIds: [call.toolCallId],
    createdAt: make.now,
    updatedAt: make.now
  };
  dashboards.unshift(dashboard);
  dashboards.splice(DASHBOARDS_KEPT);
  return {
    content: `Dashboard "${dashboard.title}" is on screen for the user (id ${dashboard.id}). To change it, call show_dashboard again with dashboard_id "${dashboard.id}".`,
    dashboard
  };
}
```

- [ ] **Step 4: Wire it in**

`src/shared/platform.ts`: `import type { Dashboard } from './dashboards';`; in `PlatformState` after `teams`: `/** Dashboards coworkers showed, newest first. */ dashboards: Dashboard[];`; in `PlatformAPI` next to `chatDelete`: `/** Deletes a dashboard after a native confirm; false when cancelled or gone. */ dashboardDelete(id: string): Promise<boolean>;`.

`src/shared/types.ts` StreamEvent, after the `teams` member:
```ts
  | {
      /** Every dashboard, after any change. */
      channel: 'dashboards';
      dashboards: import('./dashboards').Dashboard[];
    }
```

`src/main/repository.ts`: default state `teams: [], dashboards: []`; after the teams normalize line:
```ts
    // Dashboards arrived with show_dashboard (2026-10).
    state.dashboards = Array.isArray(state.dashboards) ? state.dashboards : [];
```

`src/main/officeTools.ts` `toolsFor`, before connector tools: `// Anyone can show what they gathered as a dashboard; it only displays. tools.push(SHOW_DASHBOARD);` and update the doc comment.

`src/main/context.ts` `selectTools` core set: add `'show_dashboard'`.

`src/main/security/permissions.ts` `decide`, after the team tools line: `// A dashboard only displays data; it touches nothing else. if (toolName === 'show_dashboard') return { action: 'allow' };`

`src/main/service.ts`, after the planner block in the tool loop:
```ts
          // A dashboard: saved to the dashboard records and shown, never the tool registry.
          if (tc.name === SHOW_DASHBOARD.name) {
            if (this.permissions.check({ toolName: tc.name, args: parsedArgs }, scope).action === 'allow') {
              const shown = publishDashboard(
                this.state.dashboards,
                { args: parsedArgs, conversationId: id, agentId: chat.agentId, toolCallId: tc.id },
                { id: () => this.repo.id(), now: Date.now() }
              );
              answer(tc, { content: shown.content, isError: shown.isError }, 'allowed');
              if (shown.dashboard) {
                this.emit({ channel: 'dashboards', dashboards: this.state.dashboards });
                await this.repo.save();
              }
            } else answer(tc, { content: 'Tool execution denied by security policy.', isError: true }, 'denied');
            continue;
          }
```
and next to `chatDelete`:
```ts
  /** Deletes a dashboard after asking; false when you cancelled or it is already gone. */
  async dashboardDelete(id: string): Promise<boolean> {
    const dashboard = this.state.dashboards.find((d) => d.id === text(id, 100));
    if (!dashboard) return false;
    const choice = await dialog.showMessageBox({
      type: 'warning',
      message: `Delete the dashboard "${dashboard.title}"?`,
      detail: 'The conversation it came from stays as it is.',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0
    });
    if (choice.response !== 1) return false;
    this.state.dashboards = this.state.dashboards.filter((d) => d.id !== dashboard.id);
    this.emit({ channel: 'dashboards', dashboards: this.state.dashboards });
    await this.repo.save();
    return true;
  }
```
IPC: add `'dashboardDelete'` after `'chatDelete'` in `src/main/index.ts` and in `src/main/browserBridge.ts`'s `methods`; `dashboardDelete: invoke('dashboardDelete'),` in `src/preload/index.ts`.

- [ ] **Step 5: Run and pass** — `node --test tests/dashboards.test.cjs tests/dashboards-service.test.cjs`, then `npm test` and `npm run typecheck` (fix any test elsewhere that lists exact tool catalogs by adding `show_dashboard`, after checking that the test's intent is the catalog, not an accident).

- [ ] **Step 6: Commit** `feat(dashboards): show_dashboard tool, records and delete`.

---

### Task 3: Widgets and the full dashboard view

**Files:**
- Create: `src/renderer/src/features/office/dashboards/Widgets.tsx`, `src/renderer/src/features/office/dashboards/DashboardView.tsx`, `src/renderer/src/features/office/dashboards/dashboards.css`

**Interfaces:**
- Consumes: Task 1 types, `tableCsv`, `compactNumber`, `niceTicks`; `MessageMarkdown` (`src/renderer/src/chat/MessageMarkdown.tsx`); `useApp().pushToast`; `window.axon.openLink`.
- Produces: `StatTile({ widget: StatWidget })`, `WidgetView({ widget: DashboardWidget })`, `DashboardView({ dashboard: Dashboard; actions?: ReactNode })`, `formatValue(value: number | string, unit?: string): string`, `widgetSummary(widgets: DashboardWidget[]): string` ("2 charts · 1 table · 1 list").

Behaviour (each must hold; check in the desktop harness, Task 5):
- **Stat tile:** label (secondary ink), value large semibold (`compactNumber` for numbers, unit after it), change in secondary ink with ▲/▼ only when it starts with + or −, note muted. Consecutive stat widgets render as one row (`dash-stats`, auto-fit `minmax(160px, 1fr)`).
- **Bar (horizontal):** CSS grid rows `label | track | value`; bars ≤ 20px tall, rounded 4px on the data end, square at the zero line, colour `--series-1`; negative values grow left of a zero line; a 2px gap between rows; the value at each bar's tip in text ink; each row `title` = "label: value unit" and a hover lift. A "Table" toggle swaps in the same data as a table.
- **Line (SVG):** width from a `ResizeObserver`, height 220; y ticks from `niceTicks` (domain includes 0 unless every value is above half the max), hairline gridlines `--dash-grid`, muted tick labels with `tabular-nums`; up to 6 x labels shown, evenly spaced; 2px lines in `--series-n` in fixed order; an end dot r=4 with a 2px surface ring; a legend (line keys) above the plot for 2+ series; a crosshair that snaps to the nearest x on pointer move and Left/Right keys when focused, with one tooltip listing every series at that x (value strong, name secondary, a line key per row); a "Table" toggle.
- **Table:** sticky header, numbers right-aligned `tabular-nums`, scrolls inside the card (max-height 320px); "Copy as CSV" writes `tableCsv` to the clipboard and toasts "Table copied as CSV".
- **List:** each item's text, detail in secondary ink, and an "Open link" button (opens through `window.axon.openLink`) when it has a url.
- **Text:** `MessageMarkdown`.
- **DashboardView:** header (title, summary, "Updated {timeAgo}"), actions slot on the right, stat rows then other widgets in a grid (`repeat(auto-fit, minmax(340px, 1fr))`; tables and text span the full row), sources at the bottom as a list (links open through `openLink`).
- **Colours:** in `dashboards.css`, `.dash { --series-1..6 }` with the dark values by default and `:root[data-theme='light'] .dash { … }` with the light values (Global Constraints), `--dash-grid: var(--border-subtle)`, `--dash-axis: var(--border-default)`, `--dash-surface: var(--surface-raised)`. Text uses `--text-primary/secondary/tertiary` only.

- [ ] **Step 1:** Write `Widgets.tsx` with the components above; text from the model only as React text children. A small hook `useWidth(ref)` (ResizeObserver) lives in the same file.
- [ ] **Step 2:** Write `DashboardView.tsx` and `dashboards.css`.
- [ ] **Step 3:** `npm run typecheck` passes; add to `tests/dashboards.test.cjs` a test for `widgetSummary` if it lives in a `.ts` file (put `widgetSummary` and `formatValue` in `src/shared/dashboards.ts` so Node tests can load them):

```js
test('a card sums up what else is on the dashboard', () => {
  assert.equal(shared.widgetSummary([{ type: 'stat' }, { type: 'bar' }, { type: 'line' }, { type: 'table' }, { type: 'list' }, { type: 'text' }]), '2 charts · 1 table · 1 list · 1 note');
  assert.equal(shared.formatValue(12900, 'USD'), '12.9K USD');
  assert.equal(shared.formatValue('LinkedIn'), 'LinkedIn');
  assert.equal(shared.formatValue(42, '%'), '42%');
});
```
- [ ] **Step 4: Commit** `feat(dashboards): draw stat tiles, charts, tables and lists`.

---

### Task 4: The card, the sheet, and how you get there

**Files:**
- Create: `src/renderer/src/features/office/dashboards/DashboardCard.tsx`, `src/renderer/src/features/office/dashboards/DashboardsSheet.tsx`
- Modify: `src/renderer/src/features/office/store/officeStore.ts` (`Overlay` gains `'dashboards'`; `dashboardId: string | null`; `openDashboard(id?: string | null)`), `src/renderer/src/features/office/OfficePage.tsx` (render the overlay: `<Overlay title="Dashboards" onClose={close} wide flush><DashboardsSheet /></Overlay>`), `src/renderer/src/features/office/activity/Conversation.tsx` (`officeToolCard`: `call.name === 'show_dashboard' ? <DashboardCard call={call} /> :` first), `src/renderer/src/features/office/workspace/work.ts` (`OFFICE_TOOLS` gains `'show_dashboard'`), `src/renderer/src/features/office/shell/GlobalWork.tsx` (a "Dashboards" link after "Company operations", with the count when there are any), `src/renderer/src/features/office/shell/commands.ts` + `CommandPalette.tsx` (action `'dashboards'`: "Open dashboards" / "Data your coworkers gathered, as charts, tables and lists" → `office.openDashboard()`), `src/renderer/src/App.tsx` (swap in `event.dashboards` like teams)

**Interfaces:**
- Consumes: `DashboardView`, `StatTile`, `widgetSummary` (Task 3); `Dashboard` (Task 1); `window.axon.dashboardDelete` (Task 2); `OFFICE_AGENTS`, `AgentPortrait`; `timeAgo` from `src/renderer/src/format.ts`.

Behaviour:
- **Card:** finds the dashboard whose `toolCallIds` include the call's id; none (failed or still being written) → nothing. Shows an `IconChartBar` tile, the title, "Dashboard" (or "Dashboard updated" when the call isn't the first) · time ago, up to 4 stat tiles in a compact row, `widgetSummary` of the rest, and an **Open** button (`openDashboard(dashboard.id)`). When the call isn't the latest: "Updated since. Open shows the latest."
- **Sheet:** empty → `EmptyState` (`IconChartBar`, "No dashboards yet", "When a coworker gathers data worth seeing at a glance, they can show it here as charts, tables and lists. Try asking one to put what they found in a dashboard."). Otherwise a left column (280px): a "Who" `<select>` (Everyone + each coworker who made one, "You" for your own chats), then the list newest first, each a button with the coworker's portrait (or the Axon logo), title, name · time ago, `aria-current` on the shown one. The right side: `DashboardView` with actions "Go to conversation" (only for coworkers' dashboards whose conversation still exists: close the overlay, `focusOn({ agentId, conversationId })`, `setPanelTab('chat')`) and "Delete" (`perform(() => window.axon.dashboardDelete(id))`). At narrow widths (< 760px) the list stacks above the view.

- [ ] **Step 1:** Store changes and the `dashboards` stream handling.
- [ ] **Step 2:** `DashboardCard.tsx` and its route in `officeToolCard`; `OFFICE_TOOLS`.
- [ ] **Step 3:** `DashboardsSheet.tsx`, the overlay in `OfficePage`, the rail link, the Ctrl+K command.
- [ ] **Step 4:** `npm run typecheck`, `npm test` pass; `npm run format` on the touched renderer files.
- [ ] **Step 5: Commit** `feat(dashboards): card in the conversation and a Dashboards sheet`.

---

### Task 5: In the real window

**Files:**
- Create: `tests/dashboards-desktop.cjs` (modelled on `tests/friendly-desktop.cjs`)

The loopback provider streams, for the first request of a conversation, an OpenAI-compatible tool call to `show_dashboard` with a realistic marketing dashboard (3 stat tiles, a bar chart of leads by channel, a 2-series line chart over 8 weeks, a 12-row table, a list of 4 findings with links, a text note, 2 sources), then "Here is the dashboard." on the next request. The harness: seeds a provider and opens the office, sends "Put the lead numbers in a dashboard" to a coworker (the Data Analyst, or the first core coworker if absent), waits for the card, screenshots the panel; clicks Open, screenshots the sheet; hovers the line chart and screenshots the tooltip; clicks "Copy as CSV" and checks the clipboard; Delete (the native confirm is stubbed to "Delete") and checks the empty state. Size and theme from argv like the friendly harness; screenshots to `test-results/dashboards`.

- [ ] **Step 1:** Write the harness.
- [ ] **Step 2:** `npx electron-vite build`, then `npx electron tests/dashboards-desktop.cjs 1536x816` and `… 1536x816 dark`. Look at every screenshot: no clipped labels, no overflow, readable in both themes, the legend and tooltip correct.
- [ ] **Step 3:** Fix what the screenshots show; re-run.
- [ ] **Step 4: Commit** `test(dashboards): desktop check of the card and the sheet`.
