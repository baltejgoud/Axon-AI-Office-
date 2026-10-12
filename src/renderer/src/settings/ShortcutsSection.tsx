import { useState } from 'react';
import { useApp } from '../state';
import { checkedSavedPrompts, BUILTIN_PROMPTS, type SavedPrompt } from '../../../shared/savedPrompts';
import { SettingsGroup } from './controls';
import { Button } from '../ui';
import './shortcuts.css';

function ShortcutRow({
  prompt,
  onSave,
  onDelete,
  busy
}: {
  prompt: SavedPrompt;
  onSave: (next: SavedPrompt) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(prompt.name);
  const [text, setText] = useState(prompt.text);
  return (
    <form
      className="settings-card shortcut-settings-row"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, text });
      }}
    >
      <label>
        Shortcut name
        <input
          aria-label={`Name for /${prompt.name}`}
          className="input"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Prompt
        <textarea
          aria-label={`Prompt for /${prompt.name}`}
          className="input"
          value={text}
          maxLength={4000}
          rows={3}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div>
        <Button type="submit" size="sm" disabled={busy || (name === prompt.name && text === prompt.text)}>
          Save changes
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
          Delete shortcut
        </Button>
      </div>
    </form>
  );
}

export function ShortcutsSection() {
  const settings = useApp((s) => s.data?.settings);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!settings) return null;
  const prompts = settings.savedPrompts ?? [];
  const save = async (next: SavedPrompt[]) => {
    setBusy(true);
    setError('');
    try {
      await window.axon.settingsSave({
        ...useApp.getState().data!.settings,
        savedPrompts: checkedSavedPrompts(next)
      });
      await useApp.getState().refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save shortcuts.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SettingsGroup title="Prompt shortcuts">
        <div className="shortcut-settings-info">
          <p>
            Type / at the start of a message to insert a prompt. Save your own from the chat box; up to 30
            shortcuts.
          </p>
          <p>
            Built in: {BUILTIN_PROMPTS.map((p) => `/${p.name}`).join(', ')}. A saved prompt with the same name
            takes its place.
          </p>
          {!prompts.length && <p>No saved shortcuts yet.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      </SettingsGroup>
      {prompts.map((prompt, i) => (
        <ShortcutRow
          key={`${prompt.name}:${prompt.text}`}
          prompt={prompt}
          busy={busy}
          onSave={(next) => void save(prompts.map((p, j) => (i === j ? next : p)))}
          onDelete={() => void save(prompts.filter((_, j) => i !== j))}
        />
      ))}
    </>
  );
}
