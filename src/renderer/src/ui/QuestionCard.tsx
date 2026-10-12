import './askCard.css';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ToolApprovalRequest } from '../../../shared/types';
import { Button } from './index';

/** A small question mark in a circle: the one thing the shared icons don't have. */
function QuestionMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.4 9.3a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 3.9" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

/**
 * A coworker's question to you: the words, one button for each choice they offered, and (when they
 * allow it) a box for your own answer. The run waits for you. Enter in the box sends it. Skipping
 * hands the decision back to them.
 */
export function QuestionCard({
  request,
  askerName,
  onAnswer,
  onSkip
}: {
  request: ToolApprovalRequest;
  /** Who is asking ("Backend Developer"); empty for your own chat. */
  askerName?: string;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
}) {
  const question = request.question!;
  const id = useId();
  const [typed, setTyped] = useState('');
  const [sent, setSent] = useState(false);
  const card = useRef<HTMLElement>(null);
  // A card that appears below the fold comes into view; focus stays where you were typing.
  useEffect(() => {
    card.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const send = (answer: string) => {
    if (sent || !answer.trim()) return;
    setSent(true);
    onAnswer(answer.trim());
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(typed);
  };

  return (
    <section
      ref={card}
      className="approval-card question-card"
      aria-labelledby={`${id}-title`}
      data-request={request.id}
    >
      <div className="approval-header">
        <div className="approval-title">
          <span className="approval-icon question-icon">
            <QuestionMark />
          </span>
          <strong id={`${id}-title`}>{askerName ? `${askerName} has a question` : 'A question for you'}</strong>
        </div>
      </div>
      {/* Read out as soon as it appears: the run is stopped until you answer. */}
      <p className="question-text" role="alert">
        {question.text}
      </p>

      {question.options.length > 0 && (
        <div className="question-options" role="group" aria-label="Choices">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              className="question-option"
              disabled={sent}
              onClick={() => send(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {question.allowOther && (
        <form className="question-other" onSubmit={submit}>
          <label className="question-sr" htmlFor={`${id}-own`}>
            {question.options.length ? 'Or write your own answer' : 'Your answer'}
          </label>
          <input
            id={`${id}-own`}
            type="text"
            value={typed}
            disabled={sent}
            maxLength={2000}
            autoComplete="off"
            placeholder={question.options.length ? 'Or write your own answer' : 'Type your answer'}
            onChange={(event) => setTyped(event.target.value)}
          />
          <Button type="submit" variant="primary" size="sm" disabled={sent || !typed.trim()}>
            Send answer
          </Button>
        </form>
      )}

      <div className="question-foot">
        <button
          type="button"
          className="approval-session"
          disabled={sent}
          title="They carry on and make the call themselves"
          onClick={() => {
            setSent(true);
            onSkip();
          }}
        >
          Let them decide
        </button>
      </div>
    </section>
  );
}
