import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation } from '../../../shared/types';
import { meterTone } from '../../../shared/context-usage';
import { conversationCost, formatTokens, formatUsd, hasPrice, modelOf } from '../../../shared/cost';
import { useApp, perform } from '../state';
import { useEscape } from '../ui/escape';
import './contextMeter.css';

const replies = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'reply' : 'replies'}`;

/**
 * A chip beside the message box: how full the conversation's context is and what it has cost,
 * always in view, so a full context is never a surprise. Opens to the numbers behind both, and
 * says which are estimates.
 */
export function ContextMeter({ conversation }: { conversation: Conversation }) {
  const usage = useApp((s) => s.contextUsage[conversation.id]);
  const allMessages = useApp((s) => s.data?.messages);
  const providers = useApp((s) => s.data?.providers);
  const estimates = useApp((s) => s.estimates);
  const [inspection, setInspection] = useState<{ sections: Record<string, number>; system: string; messages: string; tools: string } | null>(null);
  const [editing, setEditing] = useState<{ original: string; replacement: string } | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Filled in as the conversation opens, before anything is sent; its runs keep it current after that.
  useEffect(() => {
    let current = true;
    window.axon.getContextUsage(conversation.id).then(
      (next) => {
        const state = useApp.getState();
        if (current && next)
          state.patch({ contextUsage: { ...state.contextUsage, [conversation.id]: next } });
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [conversation.id, conversation.modelId, conversation.providerId]);

  const messages = useMemo(
    () => (allMessages ?? []).filter((m) => m.conversationId === conversation.id),
    [allMessages, conversation.id]
  );
  const [recordedCost, setRecordedCost] = useState<ReturnType<typeof conversationCost> | null>(null);
  const completedKey = messages.filter(m => m.role === 'assistant' && !m.streaming).map(m => `${m.id}:${m.usage?.promptTokens}:${m.usage?.completionTokens}`).join('|');
  useEffect(() => {
    let current = true;
    setRecordedCost(null);
    void window.axon.getConversationCost(conversation.id).then(cost => { if (current) setRecordedCost(cost); }).catch(() => {});
    return () => { current = false; };
  }, [conversation.id, completedKey, providers]);
  const cost = useMemo(
    () => {
      if (!recordedCost) return conversationCost(messages, providers ?? [], estimates);
      const liveCost = conversationCost(messages.filter(m => m.streaming), providers ?? [], estimates);
      return { ...recordedCost, estimating: liveCost.estimating, priced: recordedCost.priced || liveCost.priced };
    },
    [messages, providers, estimates, recordedCost]
  );
  const model = modelOf(providers ?? [], conversation.providerId, conversation.modelId);
  const live = messages.find((m) => m.streaming);
  const estimate = live ? estimates[live.id] : undefined;
  const pct = usage?.pct ?? 0;
  const percent = Math.round(pct * 100);
  const tokens = cost.promptTokens + cost.completionTokens;
  const summaryCost = cost.priced
    ? `${cost.estimating > 0 ? '~' : ''}${formatUsd(cost.actual + cost.estimating)}`
    : tokens > 0
      ? `${formatTokens(tokens)} tokens`
      : null;
  const detailsId = `context-meter-${conversation.id}`;

  return (
    <div className={`context-meter tone-${meterTone(pct)}`} ref={root}>
      <button
        type="button"
        className="context-meter-summary"
        title="Context and cost"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen(!open)}
      >
        <span
          className="context-meter-bar"
          role="meter"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </span>
        <span className="context-meter-pct">
          {!usage ? 'Measuring' : usage.tokenBasis ? `${formatTokens(usage.tokenBasis.usedTokens)} / ${formatTokens(usage.tokenBasis.windowTokens)}` : `${percent}%`}
          <span className="context-meter-word"> context</span>
        </span>
        {summaryCost && (
          <span className={`context-meter-cost${live && cost.priced ? ' is-live' : ''}`}>{summaryCost}</span>
        )}
      </button>
      {open && (
        <div className="context-meter-details" id={detailsId}>
          <section>
            <h5>Context</h5>
            {usage ? (
              <>
                <p>{usage.state === 'recovery-required' ? 'Recovery required' : pct < .5 ? 'Healthy' : pct < .75 ? 'Optimizing' : 'Near limit'}</p>
                {usage.sections && Object.entries(usage.sections).map(([section, tokens]) => (
                  <p key={section}>{section}: {formatTokens(tokens)} tokens</p>
                ))}
                <p>Reserved response: {formatTokens(usage.outputReserve ?? 0)} tokens</p>
                <p>Safety margin: {formatTokens(usage.safetyMargin ?? 0)} tokens</p>
                {!!usage.archivedTokens && <p>Older history: {formatTokens(usage.archivedTokens)} estimated tokens retained locally.</p>}
                <p className="context-meter-note">Model tokenizer counts where available, with conservative estimates for other models. Full conversation history remains available.</p>
              </>
            ) : (
              <p>Measuring…</p>
            )}
          </section>
          {!!conversation.memory?.facts.length && <section>
            <h5>What Axon remembers</h5>
            {conversation.memory.facts.map((fact, index) => {
              const displayed = conversation.memoryCorrections?.[fact.text] ?? fact.text;
              return <p key={index}>{fact.kind}: {displayed || '(removed)'} <button onClick={() => setEditing({ original: fact.text, replacement: displayed })}>Edit</button></p>;
            })}
            {editing && <div>
              <textarea aria-label="Correct remembered fact" value={editing.replacement} onChange={e => setEditing({...editing, replacement: e.target.value})} />
              <button onClick={() => void perform(async () => { await window.axon.chatMemoryCorrect(conversation.id, editing.original, editing.replacement); setEditing(null); })}>Save correction</button>
              <button onClick={() => setEditing(null)}>Cancel</button>
            </div>}
            <p className="context-meter-note">Corrections change working memory. Original messages remain in your history.</p>
          </section>}
          {import.meta.env.DEV && <section>
            <button onClick={() => void window.axon.getContextInspector(conversation.id).then(setInspection)}>Context Inspector</button>
            {inspection && <details open><summary>Compiled request · credentials redacted</summary>
              <pre>{JSON.stringify(inspection.sections, null, 2)}</pre>
              <h5>System and memory</h5><pre>{inspection.system}</pre>
              <h5>Recent chat and current task</h5><pre>{inspection.messages}</pre>
              <h5>Tools</h5><pre>{inspection.tools}</pre>
            </details>}
          </section>}
          <section>
            <h5>Cost</h5>
            {cost.priced && (
              <p>This conversation: {formatUsd(cost.actual)}, from the usage providers reported.</p>
            )}
            {live && estimate && (
              <p>
                This reply: ~{formatUsd(cost.estimating)} so far, at most{' '}
                {formatUsd(estimate.inputCost + estimate.maxOutputCost)}. Estimating…
              </p>
            )}
            {tokens > 0 && (
              <p>
                {formatTokens(cost.promptTokens)} tokens in, {formatTokens(cost.completionTokens)} out.
              </p>
            )}
            {!hasPrice(model) && (
              <p className="context-meter-note">
                No price set for {model?.displayName ?? conversation.modelId}, so tokens only. Add its prices
                in Settings → Models.
              </p>
            )}
            {cost.unpriced > 0 && hasPrice(model) && (
              <p className="context-meter-note">{replies(cost.unpriced)} used a model without a price.</p>
            )}
            {cost.unreported > 0 && (
              <p className="context-meter-note">{replies(cost.unreported)} didn't report usage.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
