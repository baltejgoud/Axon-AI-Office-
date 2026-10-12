import { useState } from 'react';
import { useApp } from '../../../state';
import { Button } from '../../../ui';
export function CoworkerPreferences({ agentId }: { agentId: string }) {
  const original = useApp((s) => s.data?.settings.coworkerPreferences?.[agentId] ?? '');
  const [draft, setDraft] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className="coworker-preferences" onSubmit={(e) => {
    e.preventDefault(); setBusy(true); setError('');
    const settings = useApp.getState().data!.settings;
    void window.axon.settingsSave({ ...settings, coworkerPreferences: { ...settings.coworkerPreferences, [agentId]: draft } })
      .then(() => useApp.getState().refresh()).catch((e) => setError(String(e))).finally(() => setBusy(false));
  }}>
    <label>Remembered preferences<textarea className="input" aria-label="Remembered preferences" rows={3} maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="For example: short posts, no emojis, British English" /></label>
    <small>Used in this coworker’s conversations and team tasks. Clear the box to forget them.</small>
    <Button type="submit" size="sm" disabled={busy || draft === original}>{busy ? 'Saving…' : 'Save preferences'}</Button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
