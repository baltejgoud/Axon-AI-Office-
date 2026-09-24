import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Users } from 'lucide-react';
import type { ToolCall } from '../../../../../shared/types';
import { AgentPortrait } from '../AgentPortrait';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { parseColleagueCall } from '../tasks';

/** Long enough that the clamped question or answer hides something. */
const LONG_QUESTION = 140;
const LONG_ANSWER = 420;

/** A coworker asked a colleague: who, what, and what they said. */
export function ColleagueCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const info = parseColleagueCall(call);
  const wanted = info.colleague.toLowerCase();
  const agent =
    OFFICE_AGENTS.find((a) => a.id === info.colleague) ??
    OFFICE_AGENTS.find((a) => a.name.toLowerCase() === wanted);
  const name = info.name ?? agent?.name ?? (info.colleague || 'a colleague');
  const long = info.question.length > LONG_QUESTION || (info.answer ?? '').length > LONG_ANSWER;
  return (
    <div className={`colleague-card${info.error ? ' failed' : ''}${open ? ' open' : ''}`}>
      <header>
        {agent ? (
          <AgentPortrait agent={agent} className="colleague-portrait" />
        ) : (
          <span className="colleague-portrait fallback">
            <Users size={14} />
          </span>
        )}
        <span className="colleague-who">
          <small>Asked</small>
          <strong>{name}</strong>
        </span>
        {info.pending && (
          <span className="colleague-status">
            <span className="thinking-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Thinking…
          </span>
        )}
      </header>
      {info.question && <p className="colleague-question">{info.question}</p>}
      {info.error ? (
        <p className="colleague-error">{info.error}</p>
      ) : (
        info.answer !== undefined && (
          <div className="colleague-answer">
            <Markdown remarkPlugins={[remarkGfm]}>{info.answer}</Markdown>
          </div>
        )
      )}
      {long && !info.pending && (
        <button className="colleague-more" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}
