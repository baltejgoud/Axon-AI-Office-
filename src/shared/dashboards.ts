/**
 * Dashboards a coworker shows with show_dashboard: the data it gathered as number tiles, charts,
 * tables, lists and notes. The model fills in these building blocks and the window draws them, so
 * nothing it writes runs. The main process checks a call here; the window uses the types and helpers.
 */

export interface StatWidget {
  type: 'stat';
  label: string;
  value: number | string;
  unit?: string;
  change?: string;
  note?: string;
}
export interface BarWidget {
  type: 'bar';
  title: string;
  data: { label: string; value: number }[];
  unit?: string;
}
export interface LineWidget {
  type: 'line';
  title: string;
  x: string[];
  series: { name: string; values: number[] }[];
  unit?: string;
}
export interface TableWidget {
  type: 'table';
  title: string;
  columns: string[];
  rows: (string | number)[][];
}
export interface ListWidget {
  type: 'list';
  title: string;
  items: { text: string; detail?: string; url?: string }[];
}
export interface TextWidget {
  type: 'text';
  title?: string;
  body: string;
}
export type DashboardWidget = StatWidget | BarWidget | LineWidget | TableWidget | ListWidget | TextWidget;

/** Where the data came from. */
export interface DashboardSource {
  title: string;
  url?: string;
}

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
  /** The whole call, as JSON. */
  chars: 40_000,
  title: 120,
  summary: 600,
  widgets: 12,
  sources: 20,
  label: 120,
  short: 40,
  note: 200,
  bars: 30,
  points: 100,
  series: 6,
  columns: 12,
  rows: 200,
  cell: 300,
  items: 50,
  detail: 600,
  body: 4000
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
  if (value === undefined || value === null || value === '')
    return optional ? undefined : fail(`${at} is missing.`);
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
    fail(`${at} must be text.`);
  const out = String(value).trim();
  if (!out) return optional ? undefined : fail(`${at} is empty.`);
  if (out.length > max) fail(`${at} is ${count(out.length)} characters; keep it to ${count(max)} or fewer.`);
  return out;
}

/** "1,284", "-5" and "0.5" are numbers written as text; "12%" and "lots" aren't. */
const NUMERIC = /^-?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/;
const numeric = (value: unknown): value is string =>
  typeof value === 'string' && /\d/.test(value) && NUMERIC.test(value.trim());

const number = (value: unknown, at: string): number => {
  const n = numeric(value) ? Number(value.trim().replace(/,/g, '')) : value;
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
    case 'stat':
      return clean<StatWidget>({
        type: 'stat',
        label: text(w.label, `${at}.label`, L.label),
        value:
          typeof w.value === 'number' || numeric(w.value)
            ? number(w.value, `${at}.value`)
            : text(w.value, `${at}.value`, L.short),
        unit: unit(),
        change: text(w.change, `${at}.change`, L.short, true),
        note: text(w.note, `${at}.note`, L.note, true)
      });
    case 'bar':
      return clean<BarWidget>({
        type: 'bar',
        title: text(w.title, `${at}.title`, L.label),
        data: list(w.data, `${at}.data`, L.bars, 1).map((d, i) => {
          const item = record(d, `${at}.data[${i}]`);
          return {
            label: text(item.label, `${at}.data[${i}].label`, L.label),
            value: number(item.value, `${at}.data[${i}].value`)
          };
        }),
        unit: unit()
      });
    case 'line': {
      const x = list(w.x, `${at}.x`, L.points, 2).map((label, i) => text(label, `${at}.x[${i}]`, L.short));
      const series = list(w.series, `${at}.series`, L.series, 1).map((s, i) => {
        const item = record(s, `${at}.series[${i}]`);
        const values = list(item.values, `${at}.series[${i}].values`, L.points, 1).map((v, j) =>
          number(v, `${at}.series[${i}].values[${j}]`)
        );
        if (values.length !== x.length)
          fail(
            `${at}.series[${i}].values has ${values.length} numbers; x has ${x.length} labels. Give one number per label.`
          );
        return { name: text(item.name, `${at}.series[${i}].name`, L.label), values };
      });
      return clean<LineWidget>({ type: 'line', title: text(w.title, `${at}.title`, L.label), x, series, unit: unit() });
    }
    case 'table': {
      const columns = list(w.columns, `${at}.columns`, L.columns, 1).map((c, i) =>
        text(c, `${at}.columns[${i}]`, L.label)
      );
      const rows = list(w.rows, `${at}.rows`, L.rows, 1).map((r, i) => {
        const row = list(r, `${at}.rows[${i}]`, Infinity);
        if (row.length > columns.length)
          fail(`${at}.rows[${i}] has ${row.length} cells; there are ${columns.length} columns.`);
        // A short row is filled out with empty cells: models often leave trailing blanks out.
        return columns.map((_, j) => {
          const cell = row[j];
          return typeof cell === 'number' && Number.isFinite(cell)
            ? cell
            : (text(cell, `${at}.rows[${i}][${j}]`, L.cell, true) ?? '');
        });
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
      return clean<TextWidget>({
        type: 'text',
        title: text(w.title, `${at}.title`, L.label, true),
        body: text(w.body, `${at}.body`, L.body)
      });
    default:
      return fail(`${at}.type must be one of ${WIDGET_TYPES.join(', ')}.`);
  }
}

/** Checks a show_dashboard call: the dashboard to show, or exactly what is wrong with it. */
export function normalizeDashboard(args: unknown): { dashboard: DashboardContent; id?: string } | { error: string } {
  try {
    const size = JSON.stringify(args ?? null).length;
    if (size > L.chars)
      fail(
        `The dashboard is ${count(size)} characters of data; keep it under ${count(L.chars)}. Show fewer rows or points and sum up the rest.`
      );
    const input = record(args, 'The input');
    const dashboard = clean<DashboardContent>({
      title: text(input.title, 'title', L.title),
      summary: text(input.summary, 'summary', L.summary, true),
      widgets: list(input.widgets, 'widgets', L.widgets, 1).map((w, i) => widget(w, `widgets[${i}]`)),
      sources: list(input.sources, 'sources', L.sources).map((s, i) => {
        if (typeof s === 'string') {
          const url = link(s);
          return url ? { title: url, url } : { title: text(s, `sources[${i}]`, L.label) };
        }
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
export function tableCsv(columns: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const cell = (value: string | number) => {
    let out = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(out) && !numeric(out)) out = `'${out}`;
    return /[",\r\n]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
  };
  return [columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}

/** 1,284 · 12.9K · 4.2M · 0.46 */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10_000)
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: abs < 10 ? 2 : abs < 100 ? 1 : 0 }).format(n);
}

/** A value with its unit: "1,284 leads", "42%", "$4.2M", "LinkedIn". */
export function formatValue(value: number | string, unit?: string): string {
  const shown = typeof value === 'number' ? compactNumber(value) : value;
  if (!unit) return shown;
  if (/^[$€£¥₹]$/.test(unit)) return shown.startsWith('-') ? `-${unit}${shown.slice(1)}` : `${unit}${shown}`;
  return unit === '%' ? `${shown}%` : `${shown} ${unit}`;
}

/** What else a dashboard has besides its number tiles: "2 charts · 1 table · 1 list · 1 note". */
export function widgetSummary(widgets: readonly Pick<DashboardWidget, 'type'>[]): string {
  const of = (...types: DashboardWidget['type'][]) => widgets.filter((w) => types.includes(w.type)).length;
  return (
    [
      [of('bar', 'line'), 'chart'],
      [of('table'), 'table'],
      [of('list'), 'list'],
      [of('text'), 'note']
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`)
    .join(' · ');
}

/** Round axis values covering min to max: 1, 2, 2.5 or 5 times a power of ten apart, about `count` steps. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return min === 0 ? [0, 1] : niceTicks(Math.min(0, min), Math.max(0, max), count);
  const span = max - min;
  const power = 10 ** Math.floor(Math.log10(span / count));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => span / s <= count) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v < max + step * (1 - 1e-9); v += step)
    ticks.push(Number(v.toPrecision(12)));
  return ticks;
}
