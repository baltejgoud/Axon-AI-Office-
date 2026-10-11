import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  compactNumber,
  formatValue,
  niceTicks,
  tableCsv,
  type BarWidget,
  type DashboardWidget,
  type LineWidget,
  type ListWidget,
  type StatWidget,
  type TableWidget,
  type TextWidget
} from '../../../../../shared/dashboards';
import { MessageMarkdown } from '../../../chat/MessageMarkdown';
import { perform, useApp } from '../../../state';
import { IconCopy, IconExternalLink } from '../../../ui';

/**
 * The building blocks a coworker's dashboard is made of, drawn here: everything the model wrote is
 * shown as text (notes go through the same Markdown as messages), and links open in the browser.
 * Charts are SVG and CSS drawn by hand; every chart can also be read as a table.
 */

const seriesColor = (index: number) => `var(--series-${(index % 6) + 1})`;
const openLink = (url: string) => void perform(() => window.axon.openLink(url));

/** A headline number: what it is, the value, and how it changed. */
export function StatTile({ widget }: { widget: StatWidget }) {
  const sign = widget.change?.trim()[0];
  const arrow = sign === '+' ? '▲ ' : sign === '-' || sign === '−' ? '▼ ' : '';
  return (
    <div className="dash-stat">
      <span className="dash-stat-label">{widget.label}</span>
      <strong
        className="dash-stat-value"
        title={typeof widget.value === 'number' ? widget.value.toLocaleString('en-US') : undefined}
      >
        {formatValue(widget.value, widget.unit)}
      </strong>
      {widget.change && (
        <span className="dash-stat-change" title={widget.change}>
          {arrow}
          {widget.change}
        </span>
      )}
      {widget.note && (
        <span className="dash-stat-note" title={widget.note}>
          {widget.note}
        </span>
      )}
    </div>
  );
}

function Card({
  title,
  actions,
  wide = false,
  children
}: {
  title?: string;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`dash-widget${wide ? ' wide' : ''}`}>
      {(title || actions) && (
        <header className="dash-widget-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="dash-widget-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Chart or table: the same numbers either way. */
function ViewToggle({ table, onChange }: { table: boolean; onChange: (table: boolean) => void }) {
  return (
    <button className="dash-small-button" aria-pressed={table} onClick={() => onChange(!table)}>
      {table ? 'Chart' : 'Table'}
    </button>
  );
}

function DataTable({
  columns,
  rows,
  label
}: {
  columns: string[];
  rows: (string | number)[][];
  label: string;
}) {
  const numeric = columns.map(
    (_, j) =>
      rows.some((row) => typeof row[j] === 'number') &&
      rows.every((row) => typeof row[j] === 'number' || row[j] === '')
  );
  return (
    <div className="dash-table-scroll" tabIndex={0} role="region" aria-label={label}>
      <table className="dash-table">
        <thead>
          <tr>
            {columns.map((column, j) => (
              <th key={j} scope="col" className={numeric[j] ? 'num' : undefined}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={numeric[j] ? 'num' : undefined}>
                  {typeof cell === 'number' ? cell.toLocaleString('en-US') : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bars from one zero line; the value sits at the end of each row. */
function BarChart({ widget }: { widget: BarWidget }) {
  const [table, setTable] = useState(false);
  const values = widget.data.map((d) => d.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const zero = (-lo / span) * 100;
  return (
    <Card title={widget.title} actions={<ViewToggle table={table} onChange={setTable} />}>
      {table ? (
        <DataTable
          label={widget.title}
          columns={['', widget.unit ? `Value (${widget.unit})` : 'Value']}
          rows={widget.data.map((d) => [d.label, d.value])}
        />
      ) : (
        <ul className="dash-bars" aria-label={widget.title}>
          {widget.data.map((d, i) => {
            const value = formatValue(d.value, widget.unit);
            return (
              <li className="dash-bar-row" key={i} title={`${d.label}: ${value}`}>
                <span className="dash-bar-label">{d.label}</span>
                <span className="dash-bar-track" aria-hidden="true">
                  {lo < 0 && <span className="dash-bar-zero" style={{ left: `${zero}%` }} />}
                  <span
                    className={`dash-bar${d.value < 0 ? ' negative' : ''}`}
                    style={{
                      left: `${d.value < 0 ? zero - (-d.value / span) * 100 : zero}%`,
                      width: `${(Math.abs(d.value) / span) * 100}%`
                    }}
                  />
                </span>
                <span className="dash-bar-value">{value}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The width an element is drawn at, kept up to date. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const HEIGHT = 220;
const TOP = 12;
const BOTTOM = 26;

/** Lines over shared x labels, with a crosshair that reads every series at the x you point at. */
function LineChart({ widget }: { widget: LineWidget }) {
  const [table, setTable] = useState(false);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const all = widget.series.flatMap((s) => s.values);
  const min = Math.min(...all);
  const max = Math.max(...all);
  // Counts start at zero; a measure that never comes near it (a price, a rate) keeps its own range.
  const ticks = niceTicks(min < 0 ? min : min <= max / 2 ? 0 : min, max < 0 ? 0 : max, 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tickText = ticks.map((t) => compactNumber(t));
  const left = Math.max(...tickText.map((t) => t.length)) * 7 + 12;
  const endText = widget.series.map((s) => compactNumber(s.values[s.values.length - 1]));
  const right = Math.max(...endText.map((t) => t.length)) * 7 + 14;
  const plotW = Math.max(40, width - left - right);
  const plotH = HEIGHT - TOP - BOTTOM;
  const n = widget.x.length;
  const x = (i: number) => left + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2);
  const y = (v: number) => TOP + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  // As many x labels as fit, evenly spaced.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 72))));
  // End labels, left out where they would sit on top of one already placed.
  const placed: number[] = [];
  const ends = widget.series.map((s, i) => {
    const top = y(s.values[n - 1]);
    if (widget.series.length > 4 || placed.some((p) => Math.abs(p - top) < 14)) return null;
    placed.push(top);
    return { top, text: endText[i] };
  });

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.round(((event.clientX - box.left - left) / plotW) * (n - 1));
    setAt(Math.min(n - 1, Math.max(0, i)));
  };
  const step = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setAt((current) =>
      Math.min(n - 1, Math.max(0, (current ?? n - 1) + (event.key === 'ArrowLeft' ? -1 : 1)))
    );
  };
  // Beside the crosshair, on whichever side has room, and never past the chart's edges.
  const tipLeft = at === null ? 0 : Math.max(0, x(at) + 12 + 190 > width ? x(at) - 12 - 190 : x(at) + 12);

  return (
    <Card title={widget.title} actions={<ViewToggle table={table} onChange={setTable} />}>
      {table ? (
        <DataTable
          label={widget.title}
          columns={['', ...widget.series.map((s) => (widget.unit ? `${s.name} (${widget.unit})` : s.name))]}
          rows={widget.x.map((label, i) => [label, ...widget.series.map((s) => s.values[i])])}
        />
      ) : (
        <>
          {widget.series.length > 1 && (
            <ul className="dash-legend" aria-label="Series">
              {widget.series.map((s, i) => (
                <li key={i}>
                  <span className="dash-key" style={{ background: seriesColor(i) }} aria-hidden="true" />
                  {s.name}
                </li>
              ))}
            </ul>
          )}
          <div className="dash-plot" ref={ref}>
            {width > 0 && (
              <svg
                width={width}
                height={HEIGHT}
                role="img"
                tabIndex={0}
                aria-label={`${widget.title}: ${widget.series.length === 1 ? 'one line' : `${widget.series.length} lines`} over ${n} points. Left and right arrows read each point; Table shows every value.`}
                onPointerMove={pick}
                onPointerLeave={() => setAt(null)}
                onFocus={() => setAt(n - 1)}
                onBlur={() => setAt(null)}
                onKeyDown={step}
              >
                {ticks.map((t, i) => (
                  <g key={i}>
                    <line
                      className={t === 0 ? 'dash-axis' : 'dash-gridline'}
                      x1={left}
                      x2={left + plotW}
                      y1={y(t)}
                      y2={y(t)}
                    />
                    <text className="dash-tick" x={left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                      {tickText[i]}
                    </text>
                  </g>
                ))}
                {widget.x.map((label, i) =>
                  i % every === 0 ? (
                    <text
                      key={i}
                      className="dash-tick"
                      x={x(i)}
                      y={HEIGHT - 8}
                      textAnchor={n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                    >
                      {label}
                    </text>
                  ) : null
                )}
                {at !== null && (
                  <line className="dash-crosshair" x1={x(at)} x2={x(at)} y1={TOP} y2={TOP + plotH} />
                )}
                {widget.series.map((s, i) => (
                  <path
                    key={i}
                    className="dash-line"
                    stroke={seriesColor(i)}
                    d={s.values
                      .map((v, j) => `${j ? 'L' : 'M'}${x(j).toFixed(1)} ${y(v).toFixed(1)}`)
                      .join(' ')}
                  />
                ))}
                {widget.series.map((s, i) => (
                  <circle
                    key={i}
                    className="dash-dot"
                    cx={x(at ?? n - 1)}
                    cy={y(s.values[at ?? n - 1])}
                    r={4}
                    fill={seriesColor(i)}
                  />
                ))}
                {at === null &&
                  ends.map((end, i) =>
                    end ? (
                      <text key={i} className="dash-end" x={x(n - 1) + 9} y={end.top} dy="0.32em">
                        {end.text}
                      </text>
                    ) : null
                  )}
              </svg>
            )}
            {at !== null && (
              <div className="dash-tooltip" style={{ left: tipLeft }} role="status">
                <span className="dash-tooltip-x">{widget.x[at]}</span>
                {widget.series.map((s, i) => (
                  <span className="dash-tooltip-row" key={i}>
                    <span className="dash-key" style={{ background: seriesColor(i) }} aria-hidden="true" />
                    <strong>{formatValue(s.values[at], widget.unit)}</strong>
                    <span>{s.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function Table({ widget }: { widget: TableWidget }) {
  const copy = () =>
    void navigator.clipboard
      .writeText(tableCsv(widget.columns, widget.rows))
      .then(() => useApp.getState().pushToast('Table copied as CSV'))
      .catch(() => useApp.getState().pushToast("Couldn't copy the table", 'error'));
  return (
    <Card
      title={widget.title}
      wide
      actions={
        <button className="dash-small-button" onClick={copy}>
          <IconCopy size={13} aria-hidden="true" />
          Copy as CSV
        </button>
      }
    >
      <DataTable label={widget.title} columns={widget.columns} rows={widget.rows} />
      <small className="dash-widget-foot">
        {widget.rows.length === 1 ? '1 row' : `${widget.rows.length} rows`}
      </small>
    </Card>
  );
}

function List({ widget }: { widget: ListWidget }) {
  return (
    <Card title={widget.title}>
      <ul className="dash-list">
        {widget.items.map((item, i) => (
          <li key={i}>
            <div>
              <span className="dash-list-text">{item.text}</span>
              {item.detail && <span className="dash-list-detail">{item.detail}</span>}
            </div>
            {item.url && (
              <button className="dash-small-button" title={item.url} onClick={() => openLink(item.url!)}>
                <IconExternalLink size={13} aria-hidden="true" />
                Open link
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Note({ widget }: { widget: TextWidget }) {
  return (
    <Card title={widget.title} wide>
      <div className="dash-note">
        <MessageMarkdown>{widget.body}</MessageMarkdown>
      </div>
    </Card>
  );
}

/** One block of a dashboard. Stat tiles are drawn in rows by the dashboard itself. */
export function WidgetView({ widget }: { widget: DashboardWidget }) {
  switch (widget.type) {
    case 'stat':
      return (
        <div className="dash-stats">
          <StatTile widget={widget} />
        </div>
      );
    case 'bar':
      return <BarChart widget={widget} />;
    case 'line':
      return <LineChart widget={widget} />;
    case 'table':
      return <Table widget={widget} />;
    case 'list':
      return <List widget={widget} />;
    case 'text':
      return <Note widget={widget} />;
  }
}

export { openLink };
