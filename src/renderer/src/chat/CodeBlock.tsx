import { useState, type ReactNode } from 'react';
import { useApp } from '../state';
import { IconCheck, IconCopy } from '../ui';

/** Flattens the highlighted element tree back into the raw source for copying. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node)
    return textOf((node as { props?: { children?: ReactNode } }).props?.children);
  return '';
}

/** Fenced code block with a language label and a copy button. */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const className = (children as { props?: { className?: string } } | undefined)?.props?.className ?? '';
  const language = /language-([\w+#-]+)/.exec(className)?.[1];
  return (
    <div className="code-block">
      <div className="code-block-bar">
        {language && <span className="code-block-lang">{language}</span>}
        <button
          type="button"
          className="code-block-copy"
          onClick={() => {
            navigator.clipboard.writeText(textOf(children)).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              },
              () => useApp.getState().pushToast('Could not copy to clipboard', 'error')
            );
          }}
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
