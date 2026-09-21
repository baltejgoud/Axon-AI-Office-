import React, { useMemo } from 'react';
import { Check, X, ArrowLeftRight } from 'lucide-react';
import { Button } from './index';

interface DiffLine {
  type: 'keep' | 'del' | 'add';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export function DiffViewer({
  oldText,
  newText,
  fileName,
  onAccept,
  onReject
}: {
  oldText: string;
  newText: string;
  fileName: string;
  onAccept?: () => void;
  onReject?: () => void;
}) {
  const lines = useMemo(() => {
    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText ? newText.split('\n') : [];
    const diff: DiffLine[] = [];

    // Simple line alignment
    let i = 0,
      j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length) {
        if (oldLines[i] === newLines[j]) {
          diff.push({ type: 'keep', oldLine: i + 1, newLine: j + 1, text: oldLines[i] });
          i++;
          j++;
        } else {
          // Lookahead for match
          let matchJ = -1;
          for (let k = j; k < Math.min(newLines.length, j + 5); k++) {
            if (oldLines[i] === newLines[k]) {
              matchJ = k;
              break;
            }
          }
          if (matchJ !== -1) {
            while (j < matchJ) {
              diff.push({ type: 'add', newLine: j + 1, text: newLines[j] });
              j++;
            }
          } else {
            diff.push({ type: 'del', oldLine: i + 1, text: oldLines[i] });
            i++;
          }
        }
      } else if (i < oldLines.length) {
        diff.push({ type: 'del', oldLine: i + 1, text: oldLines[i] });
        i++;
      } else {
        diff.push({ type: 'add', newLine: j + 1, text: newLines[j] });
        j++;
      }
    }
    return diff;
  }, [oldText, newText]);

  const adds = lines.filter((l) => l.type === 'add').length;
  const dels = lines.filter((l) => l.type === 'del').length;

  return (
    <div className="diff-viewer">
      <header className="diff-header">
        <div className="diff-header-info">
          <strong>{fileName}</strong>
          <span className="diff-stat-add">+{adds}</span>
          <span className="diff-stat-del">-{dels}</span>
        </div>
        <div className="diff-header-actions">
          {onReject && (
            <Button size="sm" variant="ghost" icon={X} onClick={onReject}>
              Discard
            </Button>
          )}
          {onAccept && (
            <Button size="sm" variant="primary" icon={Check} onClick={onAccept}>
              Apply Changes
            </Button>
          )}
        </div>
      </header>

      <div className="diff-body">
        {lines.map((l, idx) => (
          <div key={idx} className={`diff-line ${l.type === 'add' ? 'add' : l.type === 'del' ? 'del' : ''}`}>
            <span className="diff-gutter">{l.oldLine || ''}</span>
            <span className="diff-gutter">{l.newLine || ''}</span>
            <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
            <span className="diff-content">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
