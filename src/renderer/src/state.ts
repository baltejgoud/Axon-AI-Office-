import { create } from 'zustand';
import type { Snapshot } from '../../shared/platform';
import type { Selection, ToolApprovalRequest } from '../../shared/types';
import type { ContextUsage } from '../../shared/context-usage';
import type { RunEstimate } from '../../shared/cost';
export interface ToastAction {
  label: string;
  run: () => void;
}
export interface ToastOptions {
  /** One button on the notice; it runs, then the notice closes. */
  action?: ToastAction;
  /** How long the notice stays, in ms. Errors otherwise stay until closed. */
  durationMs?: number;
}
export interface Toast {
  id: string;
  message: string;
  tone: 'success' | 'error';
  action?: ToastAction;
}
interface UIState {
  data: Snapshot | null;
  chatId: string | null;
  workspaceId: string | null;
  model: string;
  error: string;
  pendingApprovals: Record<string, ToolApprovalRequest>;
  /** Selection for a conversation that doesn't exist yet. */
  pendingSelection: Selection;
  /** Each conversation's context meter: asked for when it opens, then kept current by its runs' events. */
  contextUsage: Record<string, ContextUsage>;
  /** What each call still generating should cost, by its reply's message id (priced models only). */
  estimates: Record<string, RunEstimate>;
  toasts: Toast[];
  refresh(): Promise<void>;
  patch(value: Partial<UIState>): void;
  pushToast(message: string, tone?: Toast['tone'], options?: ToastOptions): void;
  dismissToast(id: string): void;
}
export const useApp = create<UIState>((set, get) => ({
  data: null,
  chatId: null,
  workspaceId: null,
  model: '',
  error: '',
  pendingApprovals: {},
  pendingSelection: { skillIds: [], roleIds: [] },
  contextUsage: {},
  estimates: {},
  toasts: [],
  patch: (value) => set(value),
  refresh: async () => {
    const data = await window.axon.snapshot();
    const models = data.providers
      .filter((p) => p.enabled)
      .flatMap((p) => p.models.map((m) => `${p.id}::${m.id}`));
    set({
      data,
      model: models.includes(get().model) ? get().model : models[0] || '',
      // Main keeps the approvals, so a window opened later can still answer them.
      pendingApprovals: Object.fromEntries(data.pendingApprovals.map((request) => [request.id, request]))
    });
  },
  pushToast: (message, tone = 'success', options) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, message, tone, action: options?.action }] });
    // Errors wait to be closed; a notice with an action waits long enough to read it and press the button.
    let wait = options?.durationMs;
    if (wait === undefined && tone !== 'error') wait = options?.action ? 8000 : 4000;
    if (wait !== undefined) setTimeout(() => get().dismissToast(id), wait);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}));
export async function perform(task: () => Promise<unknown>, successMessage?: string): Promise<void> {
  try {
    await task();
    await useApp.getState().refresh();
    if (successMessage) useApp.getState().pushToast(successMessage);
  } catch (error) {
    useApp.getState().patch({
      error:
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : 'Something went wrong.'
    });
  }
}
