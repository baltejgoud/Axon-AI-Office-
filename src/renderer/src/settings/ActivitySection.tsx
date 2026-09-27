import { useEffect, useState } from 'react';
import type { AuditEntry, AuditGroup } from '../../../shared/audit';
import { DECISION_WORDS } from '../../../shared/audit';
import { COWORKERS } from '../../../shared/coworkers';
import { useApp } from '../state';
import { useOfficeStore } from '../features/office/store/officeStore';
import { Button, IconDownload, IconRefresh } from '../ui';
import { SettingsGroup } from './controls';

const PAGE = 100;
const GROUPS: { value: AuditGroup; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'asked', label: 'Asked you' },
  { value: 'refused', label: 'Refused or not run' },
  { value: 'changes', label: 'File changes' }
];
const TONE: Record<AuditEntry['decision'], string> = {
  allowed: 'ok',
  approved: 'ok',
  'approved-session': 'ok',
  reverted: 'you',
  rejected: 'bad',
  denied: 'bad',
  'timed-out': 'warn',
  withdrawn: 'warn',
  skipped: 'warn'
};
const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(err);
const toolWords = (tool: string) => tool.replace(/^mcp_/, '').replace(/_/g, ' ');
const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const byName = [...COWORKERS].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Settings → Activity log: every tool call any agent made (coworkers, the colleagues they asked,
 * sub-agents), what was decided and by whom. Kept on this computer; exportable.
 */
export function ActivitySection() {
  const conversations = useApp((s) => s.data?.conversations ?? []);
  const [group, setGroup] = useState<AuditGroup>('all');
  const [actorId, setActorId] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const load = async (after?: AuditEntry) => {
    setError('');
    try {
      const page = await window.axon.auditList({
        group,
        actorId: actorId || undefined,
        afterId: after?.id,
        limit: PAGE
      });
      setEntries((current) => (after ? [...(current ?? []), ...page] : page));
      setMore(page.length === PAGE);
    } catch (err) {
      setError(errorText(err));
    }
  };
  useEffect(() => {
    void load();
  }, [group, actorId]);

  const show = (entry: AuditEntry) => {
    const chat = conversations.find((c) => c.id === entry.conversationId);
    if (!chat?.agentId || !entry.toolCallId) return;
    const office = useOfficeStore.getState();
    office.openOverlay(null);
    office.focusOn({ agentId: chat.agentId, conversationId: chat.id });
    office.focusWork(chat.id, entry.toolCallId);
  };
  const exportLog = async () => {
    try {
      if (await window.axon.auditExport()) useApp.getState().pushToast('Activity log saved');
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h3>Activity log</h3>
          <p>
            Every tool your coworkers used, including the colleagues they asked and the sub-agents they sent,
            and what was decided: allowed, asked you, refused.
          </p>
        </div>
        <Button icon={IconDownload} onClick={() => void exportLog()}>
          Export…
        </Button>
      </header>
      <div className="activity-log-filters">
        <select
          className="select"
          aria-label="Show"
          value={group}
          onChange={(e) => setGroup(e.target.value as AuditGroup)}
        >
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Who"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
        >
          <option value="">Everyone</option>
          {byName.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button variant="ghost" icon={IconRefresh} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {entries && (
        <SettingsGroup>
          {entries.length === 0 ? (
            <p className="usage-empty">Nothing here yet.</p>
          ) : (
            <ul className="activity-log" aria-label="Activity">
              {entries.map((entry) => {
                const chat = conversations.find((c) => c.id === entry.conversationId);
                return (
                  <li key={entry.id} className="activity-log-row">
                    <time>{when(entry.at)}</time>
                    <div className="activity-log-main">
                      <div>
                        <strong>{entry.actor.name}</strong>
                        {entry.actor.onBehalfOf && (
                          <span className="usage-muted"> for {entry.actor.onBehalfOf}</span>
                        )}{' '}
                        {toolWords(entry.tool)}
                        {entry.subject && <code className="activity-log-subject">{entry.subject}</code>}
                      </div>
                      {(entry.result === 'error' || entry.detail) && (
                        <div className="usage-muted">
                          {entry.result === 'error' ? 'Failed: ' : ''}
                          {entry.detail}
                        </div>
                      )}
                    </div>
                    <span className={`audit-badge tone-${TONE[entry.decision]}`}>
                      {DECISION_WORDS[entry.decision]}
                    </span>
                    {chat?.agentId && entry.toolCallId ? (
                      <Button size="sm" variant="ghost" onClick={() => show(entry)}>
                        Show
                      </Button>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsGroup>
      )}
      {more && entries && (
        <Button variant="ghost" onClick={() => void load(entries[entries.length - 1])}>
          Load more
        </Button>
      )}
      <p className="settings-footnote">
        Kept on this computer, newest 20,000 entries. It holds what each call was about (a path, a command),
        never what was in a file.
      </p>
    </div>
  );
}
