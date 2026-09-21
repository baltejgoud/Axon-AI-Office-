import { create } from 'zustand';
import type { Snapshot } from '../../shared/platform';
import type { Selection, ToolApprovalRequest } from '../../shared/types';
export interface Toast {
  id: string;
  message: string;
  tone: 'success' | 'error';
}
interface UIState {
  data: Snapshot | null;
  page: string;
  chatId: string | null;
  workspaceId: string | null;
  model: string;
  error: string;
  pendingApprovals: Record<string, ToolApprovalRequest>;
  /** Selection for a conversation that doesn't exist yet. */
  pendingSelection: Selection;
  toasts: Toast[];
  refresh(): Promise<void>;
  patch(value: Partial<UIState>): void;
  pushToast(message: string, tone?: Toast['tone']): void;
  dismissToast(id: string): void;
}
export const useApp = create<UIState>((set, get) => ({
  data: null,
  page: 'chat',
  chatId: null,
  workspaceId: null,
  model: '',
  error: '',
  pendingApprovals: {},
  pendingSelection: { skillIds: [], roleIds: [] },
  toasts: [],
  patch: (value) => set(value),
  refresh: async () => {
    const data = await window.axon.snapshot();
    const models = data.providers
      .filter((p) => p.enabled)
      .flatMap((p) => p.models.map((m) => `${p.id}::${m.id}`));
    set({ data, model: models.includes(get().model) ? get().model : models[0] || '' });
  },
  pushToast: (message, tone = 'success') => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismissToast(id), 3200);
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
