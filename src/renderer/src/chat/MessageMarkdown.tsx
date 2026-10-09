import { isValidElement, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { perform } from '../state';
import { CodeBlock } from './CodeBlock';
import { remarkMergeFields } from './remarkMergeFields';
import { headingId } from './reading';

/** The words inside rendered Markdown. */
const textOf = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : isValidElement<{ children?: ReactNode }>(node)
        ? textOf(node.props.children)
        : '';

/**
 * A message's Markdown, the same in the thread and the reading view: tables, highlighted code with
 * Copy, links that open in the browser, and merge fields kept as written. `headingIds` gives each
 * heading the id the reading view's contents jump to.
 */
export function MessageMarkdown({ children, headingIds = false }: { children: string; headingIds?: boolean }) {
  const seen = new Map<string, number>();
  const heading =
    (Tag: 'h1' | 'h2' | 'h3') =>
    ({ children: inner }: { children?: ReactNode }) => (
      <Tag id={headingId(textOf(inner), seen)}>{inner}</Tag>
    );
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMergeFields]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        img: ({ alt }) => <span>[Image: {alt}]</span>,
        a: ({ href, children: label }) =>
          href && /^https?:\/\//i.test(href) ? (
            <a
              className="message-link"
              href={href}
              title={href}
              onClick={(event) => {
                event.preventDefault();
                void perform(() => window.axon.openLink(href));
              }}
            >
              {label}
            </a>
          ) : (
            <span className="message-link">{label}</span>
          ),
        pre: ({ children: code }) => <CodeBlock>{code}</CodeBlock>,
        ...(headingIds ? { h1: heading('h1'), h2: heading('h2'), h3: heading('h3') } : {})
      }}
    >
      {children}
    </Markdown>
  );
}
