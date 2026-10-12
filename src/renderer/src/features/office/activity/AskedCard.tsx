import '../../../ui/askCard.css';
import type { ToolCall } from '../../../../../shared/types';
import { answerFromResult, questionOf } from '../../../../../shared/askUser';

/**
 * A question a coworker put to you, kept in the thread: what they asked, and what you said (or that
 * you let them decide). While it waits, the card to answer it is below the thread.
 */
export function AskedCard({ call }: { call: ToolCall }) {
  const question = questionOf(call.arguments);
  const { answer, skipped } = answerFromResult(call.result);
  const waiting = call.result === undefined && call.error === undefined;
  return (
    <div className={`asked-card${waiting ? ' is-waiting' : ''}`}>
      <p className="asked-question">
        <strong>Asked you:</strong> {question || '…'}
      </p>
      {call.error ? (
        <p className="asked-answer is-error">{call.error}</p>
      ) : waiting ? (
        <p className="asked-answer">Waiting for your answer…</p>
      ) : skipped ? (
        <p className="asked-answer">You let them decide.</p>
      ) : (
        <p className="asked-answer">
          <strong>You said:</strong> {answer}
        </p>
      )}
    </div>
  );
}
