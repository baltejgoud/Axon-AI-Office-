import { useEffect, useState } from 'react';
import type { BackupSummary } from '../../../shared/platform';
import { timeAgo } from '../format';
import { useApp } from '../state';
import { Button, IconRotateCcw } from '../ui';
import { SettingsGroup } from './controls';

const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(err);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const counts = (c: { conversations: number; providers: number; workspaces: number }) =>
  [
    plural(c.conversations, 'conversation', 'conversations'),
    plural(c.providers, 'provider', 'providers'),
    plural(c.workspaces, 'workspace', 'workspaces')
  ].join(' · ');
const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** "just now", "12m ago", or a date for older ones. */
const ago = (at: number) => {
  const short = timeAgo(at);
  return short === 'now' ? 'just now' : /^\d/.test(short) ? `${short} ago` : short;
};

/**
 * Settings → Privacy & security → Restore points: the rolling snapshots of everything Axon saves, and
 * a way back to one. Restoring asks first (a native dialog), backs up what is here now, and restarts.
 */
export function RestorePoints() {
  const data = useApp((s) => s.data!);
  const [points, setPoints] = useState<BackupSummary[] | null>(null);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  const load = () => window.axon.listBackups().then(setPoints, (err) => setError(errorText(err)));
  useEffect(() => {
    void load();
  }, []);

  const restore = async (file: string) => {
    setError('');
    setRestoring(file);
    try {
      await window.axon.restoreBackup(file); // Axon restarts from here.
    } catch (err) {
      const message = errorText(err);
      if (!/cancelled/i.test(message)) setError(message);
      void load();
    } finally {
      setRestoring(null);
    }
  };

  return (
    <SettingsGroup title="Restore points">
      <div className="settings-prose">
        <p>
          Axon saves a snapshot of everything (conversations, providers, workspaces and settings) when it
          starts and every 10 minutes while you work, and keeps the last 10. Restoring one replaces everything
          with it: what you have now is backed up first, so you can come back the same way, and Axon restarts.
        </p>
      </div>
      <div className="settings-item restore-now">
        <div className="settings-item-main">
          <div className="settings-item-title">Now</div>
          <div className="settings-item-meta">
            {counts({
              conversations: data.conversations.length,
              providers: data.providers.length,
              workspaces: data.workspaces.length
            })}
          </div>
        </div>
      </div>
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {points === null ? (
        !error && <p className="usage-empty">Looking for snapshots…</p>
      ) : points.length === 0 ? (
        <p className="usage-empty">No snapshots yet. The first is saved the next time Axon starts.</p>
      ) : (
        <ul className="restore-points" aria-label="Snapshots">
          {points.map((point) => (
            <li key={point.file} className="settings-item restore-point">
              <div className="settings-item-main">
                <div className="settings-item-title">
                  {when(point.timestamp)}
                  <span className="usage-muted">{ago(point.timestamp)}</span>
                </div>
                <div className="settings-item-meta">
                  {counts(point)}
                  {point.lastMessageAt !== null && ` · last message ${when(point.lastMessageAt)}`}
                </div>
              </div>
              <div className="settings-item-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={IconRotateCcw}
                  disabled={restoring !== null}
                  onClick={() => void restore(point.file)}
                >
                  {restoring === point.file ? 'Restoring…' : 'Restore…'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsGroup>
  );
}
