import { ChevronDown } from 'lucide-react';
import { useApp } from '../state';
import { Icon } from '../ui';

export function ModelSelect({
  value,
  onChange,
  disabled = false,
  size = 'md',
  title
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  title?: string;
}) {
  const data = useApp((s) => s.data)!;
  const isDeepSeek = value.toLowerCase().includes('deepseek');

  return (
    <div className="model-select-pill-container" title={title}>
      <span className={`model-select-dot ${isDeepSeek ? 'dot-deepseek' : 'dot-accent'}`} />
      <select
        className={`model-select-pill ${size === 'sm' ? 'pill-sm' : ''}`}
        aria-label="AI model"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
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
      </select>
      <Icon icon={ChevronDown} size="sm" className="model-select-arrow" />
    </div>
  );
}
