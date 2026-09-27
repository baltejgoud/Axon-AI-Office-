import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { baseName, languageOf, type DiffRow } from '../features/office/workspace/work';

/** Diffs longer than this are shown without highlighting, to stay quick. */
const HIGHLIGHT_ROWS = 3000;

export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "Lines 16–21", from a hunk header's new side. */
function hunkLabel(header: string): string {
  const [, start, count = '1'] = /\+(\d+)(?:,(\d+))?/.exec(header) ?? [];
  const from = Number(start);
  const to = from + Number(count) - 1;
  return to > from ? `Lines ${from}–${to}` : `Line ${from}`;
}

/**
 * A file's changes: each hunk with its old and new line numbers, scrolled to the first change. With
 * `limit`, longer diffs show their first rows and a button for the rest.
 */
export function DiffLines({ rows: all, path, limit }: { rows: DiffRow[]; path: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const rows = limit && !expanded && all.length > limit ? all.slice(0, limit) : all;
  const scroller = useRef<HTMLDivElement>(null);
  const language = languageOf(path);
  const markup = useMemo(
    () =>
      rows.map((row) =>
        row.kind === 'hunk'
          ? ''
          : rows.length <= HIGHLIGHT_ROWS && language && hljs.getLanguage(language)
            ? hljs.highlight(row.text, { language, ignoreIllegals: true }).value
            : escapeHtml(row.text)
      ),
    [rows, language]
  );
  const first = rows.findIndex((row) => row.kind === 'add' || row.kind === 'del');
  useLayoutEffect(() => {
    const el = scroller.current;
    const row = el?.querySelector<HTMLElement>(`[data-row="${first}"]`);
    if (el && row) el.scrollTop = Math.max(0, row.offsetTop - el.clientHeight / 3);
  }, [first]);
  return (
    <div
      className="work-code-scroll work-diff"
      ref={scroller}
      tabIndex={0}
      aria-label={`Changes to ${baseName(path)}`}
    >
      <table className="work-diff-table">
        <tbody>
          {rows.map((row, i) =>
            row.kind === 'hunk' ? (
              <tr key={i} className="work-diff-hunk">
                <td colSpan={3}>{hunkLabel(row.text)}</td>
              </tr>
            ) : (
              <tr key={i} className={`work-diff-${row.kind}`} data-row={i}>
                <td className="work-diff-num">{row.oldLine ?? ''}</td>
                <td className="work-diff-num">{row.newLine ?? ''}</td>
                <td className="work-diff-code">
                  <span className="work-diff-mark" aria-hidden="true">
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                  </span>
                  <code className="hljs" dangerouslySetInnerHTML={{ __html: markup[i] }} />
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
      {rows.length < all.length && (
        <button type="button" className="work-diff-more" onClick={() => setExpanded(true)}>
          Show all {all.length} lines
        </button>
      )}
    </div>
  );
}
