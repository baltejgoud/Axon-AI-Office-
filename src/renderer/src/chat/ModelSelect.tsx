import { ChevronDown } from 'lucide-react';
import { shortModelName } from '../../../shared/models';
import { useApp } from '../state';
import { Icon } from '../ui';

export function ModelSelect({
  value,
  onChange,
  disabled = false,
  size = 'md',
  title,
  compact = false
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  title?: string;
  /** A small chip showing a short model name; the full name is on hover and in the list. */
  compact?: boolean;
}) {
  const data = useApp((s) => s.data)!;
  const isDeepSeek = value.toLowerCase().includes('deepseek');
  const dot = <span className={`model-select-dot ${isDeepSeek ? 'dot-deepseek' : 'dot-accent'}`} />;
  const options = (
    <>
      <option value="">Select a model</option>
      {data.providers
        .filter((p) => p.enabled)
        .map((p) => (
          <optgroup label={p.name} key={p.id}>
            {p.models.map((m) => (
              <option value={`${p.id}::${m.id}`} key={m.id}>
                {m.displayName || m.id}
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );

  if (compact) {
    const [providerId, modelId] = value.split('::');
    const provider = data.providers.find((p) => p.id === providerId);
    const model = provider?.models.find((m) => m.id === modelId);
    const full = provider && model ? `${provider.name} · ${model.displayName || model.id}` : 'Choose a model';
    return (
      <div
        className={`model-chip ${disabled ? 'is-locked' : ''}`}
        title={title ? `${full} — ${title}` : full}
      >
        {dot}
        <span className="model-chip-label" aria-hidden="true">
          {model ? shortModelName(model.id, model.displayName) : 'Choose model'}
        </span>
        <Icon icon={ChevronDown} size="sm" className="model-chip-arrow" />
        <select
          className="model-chip-select"
          aria-label="AI model"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {options}
        </select>
      </div>
    );
  }

  return (
    <div className="model-select-pill-container" title={title}>
      {dot}
      <select
        className={`model-select-pill ${size === 'sm' ? 'pill-sm' : ''}`}
        aria-label="AI model"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options}
      </select>
      <Icon icon={ChevronDown} size="sm" className="model-select-arrow" />
    </div>
  );
}
