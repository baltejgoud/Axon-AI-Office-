import type { PlatformAPI } from '../../shared/platform';
import type { StreamEvent } from '../../shared/types';

export async function connectBrowserPlatform(): Promise<void> {
  if (window.axon) return;
  const invoke = async (method: string, args: unknown[]) => {
    const response = await fetch('/__axon/invoke', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args.map(value =>
        value === undefined ? { __axonUndefined: true } : value
      ) })
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'Axon connection failed.');
    return payload.result;
  };
  // Do not render the desktop UI until its real service is reachable.
  await invoke('runtimeRuns', []);
  const listeners = new Set<(event: StreamEvent) => void>();
  const events = new EventSource('/__axon/events');
  events.onmessage = (event) => {
    const value = JSON.parse(event.data) as StreamEvent;
    for (const listener of listeners) listener(value);
  };
  window.addEventListener('beforeunload', () => events.close(), { once: true });
  window.axon = new Proxy({
    onStream(listener: (event: StreamEvent) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  } as PlatformAPI, {
    get(target, name) {
      if (name === 'onStream') return target.onStream;
      if (name === 'projectChoose') return async () => {
        const folder = window.prompt('Open a local project folder. Enter its full path:');
        return folder?.trim() ? invoke('projectOpen', [folder.trim()]) : null;
      };
      if (typeof name !== 'string' || name === 'then') return undefined;
      return (...args: unknown[]) => invoke(name, args);
    }
  }) as PlatformAPI;
}
