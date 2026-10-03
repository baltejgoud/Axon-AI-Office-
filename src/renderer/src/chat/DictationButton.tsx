import './dictation.css';
import type { RefObject } from 'react';
import { IconLoader, IconMic, IconStop } from '../ui';
import { clock, type DictationPhase } from './useDictation';

interface DictationButtonProps {
  phase: DictationPhase;
  elapsed: number;
  /** Gets the live loudness as `--mic-level`. */
  meter: RefObject<HTMLElement | null>;
  onClick: () => void;
}

/** The composer's microphone: start speaking, then click again (or press Enter) to put the words in the box. */
export function DictationButton({ phase, elapsed, meter, onClick }: DictationButtonProps) {
  const recording = phase === 'recording';
  const title =
    phase === 'transcribing'
      ? 'Writing down what you said…'
      : recording
        ? 'Finish and type it out (Enter or Ctrl+M) · Esc cancels'
        : 'Voice typing (Ctrl+M)';
  return (
    <span className={`dictation dictation-${phase}`} ref={meter as RefObject<HTMLSpanElement>}>
      <button
        type="button"
        className="dictation-btn"
        title={title}
        aria-label={
          recording ? 'Finish voice typing' : phase === 'transcribing' ? 'Transcribing' : 'Start voice typing'
        }
        aria-pressed={recording}
        disabled={phase === 'transcribing' || phase === 'starting'}
        onClick={onClick}
      >
        {phase === 'transcribing' || phase === 'starting' ? (
          <IconLoader size={15} className="spin" />
        ) : recording ? (
          <IconStop size={13} />
        ) : (
          <IconMic size={16} />
        )}
      </button>
      {recording && (
        <span className="dictation-clock" aria-live="off">
          {clock(elapsed)}
        </span>
      )}
      {phase === 'transcribing' && <span className="dictation-status">Transcribing…</span>}
    </span>
  );
}
