import type { ProviderConfig } from '../../shared/types';
import { ProviderError } from '../providers';
export class ProviderRuntimeManager {
  private active = new Map<string, number>();
  private queues = new Map<string, (() => void)[]>();
  private backgroundQueues = new Map<string, (() => void)[]>();
  private unavailable = new Set<string>();
  async call<T>(
    provider: ProviderConfig,
    model: string,
    signal: AbortSignal | undefined,
    limit: number,
    execute: () => Promise<T>,
    queued?: () => void,
    started?: () => void,
    background = false
  ): Promise<T> {
    const key = `${provider.id}:${model}`;
    if (!provider.enabled || !provider.models.some((m) => m.id === model) || this.unavailable.has(key))
      throw new Error(`${model} is unavailable. Choose another model in the model picker.`);
    const max = Math.max(1, Math.min(8, Math.floor(limit) || 2));
    await new Promise<void>((resolve, reject) => {
      const queues = background ? this.backgroundQueues : this.queues;
      const queue = queues.get(provider.id) ?? [];
      queues.set(provider.id, queue);
      const abort = () => {
        const i = queue.indexOf(enter);
        if (i >= 0) queue.splice(i, 1);
        reject(new Error('Provider request canceled.'));
      };
      const enter = () => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) return abort();
        this.active.set(provider.id, (this.active.get(provider.id) ?? 0) + 1);
        started?.();
        resolve();
      };
      if (signal?.aborted) return abort();
      if ((this.active.get(provider.id) ?? 0) < max) enter();
      else {
        queued?.();
        queue.push(enter);
        signal?.addEventListener('abort', abort, { once: true });
      }
    });
    try {
      return await execute();
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.status === 404 ||
          (error.status === 400 &&
            /model.*(invalid|not found|does not exist|unavailable)/i.test(error.detail)))
      )
        this.unavailable.add(key);
      throw error;
    } finally {
      this.active.set(provider.id, (this.active.get(provider.id) ?? 1) - 1);
      const next = this.queues.get(provider.id)?.shift() ?? this.backgroundQueues.get(provider.id)?.shift();
      next?.();
    }
  }
  reset(providerId: string) {
    for (const k of this.unavailable) if (k.startsWith(providerId + ':')) this.unavailable.delete(k);
  }
}
export function providerProblem(error: unknown): string {
  if (error instanceof ProviderError) {
    if (error.status === 402)
      return 'This provider has insufficient available credits. This task stopped; other work may continue. Add credits or choose a lower-cost model, then retry.';
    if (error.status === 404)
      return 'The provider endpoint or model is unavailable. This task stopped. Choose another model or check the provider address, then retry.';
    if (error.status === 401 || error.status === 403)
      return 'The provider refused access. Check its API key in Settings, then retry.';
    if (error.status === 429)
      return 'The provider is at its request limit. This task stopped after bounded retries. Try again when capacity is available.';
  }
  return error instanceof Error ? error.message : 'Generation failed.';
}
