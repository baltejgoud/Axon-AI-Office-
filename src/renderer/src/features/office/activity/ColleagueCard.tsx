import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ToolCall } from '../../../../../shared/types';
import { IconUsers } from '../../../ui';
import { AgentPortrait } from '../AgentPortrait';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { parseColleagueCall } from '../tasks';
import { useOfficeStore } from '../store/officeStore';

/** Long enough that the clamped question or answer hides something. */
const LONG_QUESTION = 140;
const LONG_ANSWER = 420;

/** A coworker asked a colleague: who, what, and what they said. */
export function ColleagueCard({ call, history = [], askerId }: { call: ToolCall; history?: ToolCall[]; askerId?: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const info = parseColleagueCall(call);
  const wanted = info.colleague.toLowerCase();
  const agent =
    OFFICE_AGENTS.find((a) => a.id === info.colleague) ??
    OFFICE_AGENTS.find((a) => a.name.toLowerCase() === wanted);
  const name = info.name ?? agent?.name ?? (info.colleague || 'a colleague');
  const long = info.question.length > LONG_QUESTION || (info.answer ?? '').length > LONG_ANSWER;
  const turns = history.filter(c=>c.name==='ask_colleague').map(parseColleagueCall).filter(t=>t.colleague.toLowerCase()===wanted || (t.name&&t.name===name));
  return (
    <div className={`colleague-card${info.error ? ' failed' : ''}${open ? ' open' : ''}`}>
      <header>
        {agent ? (
          <AgentPortrait agent={agent} className="colleague-portrait" />
        ) : (
          <span className="colleague-portrait fallback">
            <IconUsers size={14} />
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
      {turns.length>1&&<button className="colleague-more" aria-expanded={chatOpen} onClick={()=>setChatOpen(!chatOpen)}>{chatOpen?'Hide conversation':`View conversation (${turns.length} questions)`}</button>}
      {chatOpen&&<ol className="consult-chat" aria-label={`Conversation with ${name}`}>{turns.map((turn,i)=><li key={i}><p><strong>Asked</strong> {turn.question}</p><div><strong>{name}</strong><Markdown remarkPlugins={[remarkGfm]}>{turn.answer??turn.error??'Waiting for a reply…'}</Markdown></div></li>)}</ol>}
      {askerId&&!info.pending&&<form className="consult-follow-up" onSubmit={e=>{e.preventDefault();if(!question.trim())return;useOfficeStore.getState().compose(askerId,`Please ask @${name}: ${question.trim()}`,true);setQuestion('');}}>
        <label>Follow-up for {name}<input className="input" aria-label={`Follow-up for ${name}`} value={question} maxLength={2000} onChange={e=>setQuestion(e.target.value)}/></label><button type="submit" disabled={!question.trim()}>Ask colleague</button>
      </form>}
    </div>
  );
}
