import { useEffect, useState } from 'react';
import type { UsageReport, UsageRow, UsageTotals } from '../../../shared/platform';
import { formatTokens, formatUsd, hasPrice } from '../../../shared/cost';
import { dayLabel } from '../../../shared/planner';
import { Button, IconRefresh } from '../ui';
import { perform, useApp } from '../state';
import { NumberSetting, SettingRow, SettingsGroup, Switch } from './controls';

/** Where a new limit starts, in dollars. */
const DEFAULT_TASK_LIMIT = 1;

/**
 * A spending limit for one task: when a run has cost this much, it pauses before its next step and
 * shows Continue. Only replies on priced models can be measured, so it says when none are.
 */
function SpendLimit() {
  const settings = useApp((s) => s.data!.settings);
  const priced = useApp((s) => s.data!.providers.some((p) => p.enabled && p.models.some(hasPrice)));
  const save = (taskSpendLimit: number) =>
    void perform(() => window.axon.settingsSave({ ...settings, taskSpendLimit }));
  const limit = settings.taskSpendLimit ?? 0;
  return (
    <SettingsGroup title="Spending limit">
      <SettingRow
        label="Pause a task at a spending limit"
        hint="When one task you give a coworker has cost this much, it pauses before its next step and asks you to continue."
      >
        <Switch
          checked={limit > 0}
          label="Pause a task at a spending limit"
          onChange={(on) => save(on ? DEFAULT_TASK_LIMIT : 0)}
        />
      </SettingRow>
      {limit > 0 && (
        <SettingRow
          label="Limit per task (US dollars)"
          id="task-spend-limit"
          hint={
            priced
              ? "Counts replies on models with a price. Questions to colleagues and sub-agents' work aren't counted."
              : 'None of your models has a price yet, so nothing can be measured. Add prices in Models & API keys.'
          }
        >
          <NumberSetting
            id="task-spend-limit"
            value={limit}
            min={0.01}
            max={1000}
            step={0.25}
            onCommit={save}
            width={100}
          />
        </SettingRow>
      )}
    </SettingsGroup>
  );
}

const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(err);
const replies = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'reply' : 'replies'}`;

/** Dollars for the priced replies, with the unpriced ones said apart: an unknown cost never reads $0.00. */
function Cost({ totals }: { totals: UsageTotals }) {
  if (totals.cost === null) return <span className="usage-muted">{totals.turns ? 'No price set' : '—'}</span>;
  return (
    <>
      {formatUsd(totals.cost)}
      {totals.unpricedTurns > 0 && (
        <span className="usage-muted"> + {replies(totals.unpricedTurns)} without a price</span>
      )}
    </>
  );
}

function Stat({ label, totals }: { label: string; totals: UsageTotals }) {
  const tokens = `${formatTokens(totals.promptTokens + totals.completionTokens)} tokens`;
  return (
    <div className="settings-card settings-stat">
      <div className="settings-stat-value">{totals.cost === null ? tokens : formatUsd(totals.cost)}</div>
      <div className="settings-stat-label">
        {label}{' '}
        <span>{totals.cost === null ? replies(totals.turns) : `${tokens} · ${replies(totals.turns)}`}</span>
      </div>
      {totals.cost !== null && totals.unpricedTurns > 0 && (
        <div className="usage-muted">{replies(totals.unpricedTurns)} without a price</div>
      )}
    </div>
  );
}

function UsageTable({ title, column, rows }: { title: string; column: string; rows: UsageRow[] }) {
  if (!rows.length) return null;
  return (
    <SettingsGroup title={title}>
      <div className="usage-table-wrap">
        <table className="usage-table">
          <thead>
            <tr>
              <th scope="col">{column}</th>
              <th scope="col">Replies</th>
              <th scope="col">Input tokens</th>
              <th scope="col">Output tokens</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {row.label}
                  {row.detail && <span className="usage-detail">{row.detail}</span>}
                </th>
                <td>{row.totals.turns.toLocaleString()}</td>
                <td>{formatTokens(row.totals.promptTokens)}</td>
                <td>{formatTokens(row.totals.completionTokens)}</td>
                <td>
                  <Cost totals={row.totals} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SettingsGroup>
  );
}

/**
 * Settings → Usage: the tokens every reply reported, and what they cost for models you gave a
 * price, added up now from the conversations themselves.
 */
export function UsageSection() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    window.axon.usageReport().then(setReport, (err) => setError(errorText(err)));
  };
  useEffect(load, []);
  const now = new Date();

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h3>Usage</h3>
          <p>
            The tokens every reply reported, and what they cost for models you've given a price. Axon doesn't
            know prices: add them to each model in Models.
          </p>
        </div>
        <Button icon={IconRefresh} onClick={load}>
          Refresh
        </Button>
      </header>
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <SpendLimit />
      {report && (
        <>
          <div className="settings-stats usage-stats">
            <Stat label="Today" totals={report.today} />
            <Stat label="Last 7 days" totals={report.week} />
            <Stat label="All time" totals={report.allTime} />
          </div>
          {report.allTime.turns === 0 && <p className="usage-empty">No replies have reported usage yet.</p>}
          <UsageTable title="By model" column="Model" rows={report.byModel} />
          <UsageTable title="By provider" column="Provider" rows={report.byProvider} />
          <UsageTable title="Recent conversations" column="Conversation" rows={report.conversations} />
          <UsageTable
            title="By day"
            column="Day"
            rows={report.byDay.slice(0, 14).map((row) => ({ ...row, label: dayLabel(row.key, now) }))}
          />
          <p className="settings-footnote">
            Counts replies in conversations, at the prices set now. Questions coworkers put to colleagues, and
            sub-agents' work, aren't counted.
            {report.unreportedTurns > 0 &&
              ` ${replies(report.unreportedTurns)} didn't report usage, so they aren't counted either.`}
          </p>
        </>
      )}
    </div>
  );
}
