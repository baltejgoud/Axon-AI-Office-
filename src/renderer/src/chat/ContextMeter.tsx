import { useEffect, useMemo, useState } from 'react';
import type { Conversation } from '../../../shared/types';
import { meterTone } from '../../../shared/context-usage';
import { conversationCost, formatTokens, formatUsd, hasPrice, modelOf } from '../../../shared/cost';
import { useApp } from '../state';
import './contextMeter.css';

const replies = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'reply' : 'replies'}`;

/**
 * The conversation's header: how full its context is and what it has cost, always in view, so a
 * full context is never a surprise. Opens to the numbers behind both, and says which are estimates.
 */
export function ContextMeter({ conversation }: { conversation: Conversation }) {
  const usage = useApp((s) => s.contextUsage[conversation.id]);
  const allMessages = useApp((s) => s.data?.messages);
  const providers = useApp((s) => s.data?.providers);
  const estimates = useApp((s) => s.estimates);
  const [open, setOpen] = useState(false);

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
  }, [conversation.id]);

  const messages = useMemo(
    () => (allMessages ?? []).filter((m) => m.conversationId === conversation.id),
    [allMessages, conversation.id]
  );
  const cost = useMemo(
    () => conversationCost(messages, providers ?? [], estimates),
    [messages, providers, estimates]
  );
  const model = modelOf(providers ?? [], conversation.providerId, conversation.modelId);
  const live = messages.find((m) => m.streaming);
  const estimate = live ? estimates[live.id] : undefined;
  const pct = usage?.pct ?? 0;
  const percent = Math.round(pct * 100);
  const trimming = !!usage && usage.usedChars > usage.budgetChars;
  const tokens = cost.promptTokens + cost.completionTokens;
  const summaryCost = cost.priced
    ? `${cost.estimating > 0 ? '~' : ''}${formatUsd(cost.actual + cost.estimating)}`
    : tokens > 0
      ? `${formatTokens(tokens)} tokens`
      : null;
  const detailsId = `context-meter-${conversation.id}`;

  return (
    <div className={`context-meter tone-${meterTone(pct)}`}>
      <button
        type="button"
        className="context-meter-summary"
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
          {!usage ? 'Measuring context…' : trimming ? 'Full · older turns left out' : `${percent}% context`}
        </span>
        {summaryCost && (
          <span className="context-meter-cost">
            {summaryCost}
            {live && cost.priced && <span className="context-meter-live"> · estimating…</span>}
          </span>
        )}
      </button>
      {open && (
        <div className="context-meter-details" id={detailsId}>
          <section>
            <h5>Context</h5>
            {usage ? (
              <>
                <p>
                  {usage.usedChars.toLocaleString()} of {usage.budgetChars.toLocaleString()} characters Axon
                  can send.
                </p>
                {usage.tokenBasis && (
                  <p>
                    {usage.tokenBasis.usedTokens.toLocaleString()} of{' '}
                    {usage.tokenBasis.windowTokens.toLocaleString()} tokens in the model's window, as the
                    provider last reported.
                  </p>
                )}
                {trimming && (
                  <p className="context-meter-warn">Older messages are left out so the rest fits.</p>
                )}
                <p className="context-meter-note">
                  {!usage.estimated
                    ? 'Measured in tokens the provider reported.'
                    : model?.contextWindow
                      ? 'Estimated from characters until the model reports its tokens.'
                      : 'Estimated from characters. Give this model its context window in Settings → Models to measure tokens.'}
                </p>
              </>
            ) : (
              <p>Measuring…</p>
            )}
          </section>
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
