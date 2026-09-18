import { create } from 'zustand';
import type { Snapshot } from '../../shared/platform';
import type { Selection } from '../../shared/types';
interface UIState {
  data: Snapshot | null;
  page: string;
  chatId: string | null;
  workspaceId: string | null;
  model: string;
  error: string;
  /** Selection for a conversation that doesn't exist yet. */
  pendingSelection: Selection;
  refresh(): Promise<void>;
  patch(value: Partial<UIState>): void;
}
export const useApp = create<UIState>((set, get) => ({
  data: null,
  page: 'chat',
  chatId: null,
  workspaceId: null,
  model: '',
  error: '',
  pendingSelection: { skillIds: [], roleIds: [] },
  patch: (value) => set(value),
  refresh: async () => {
    const data = await window.axon.snapshot();
    const models = data.providers
      .filter((p) => p.enabled)
      .flatMap((p) => p.models.map((m) => `${p.id}::${m.id}`));
    set({ data, model: models.includes(get().model) ? get().model : models[0] || '' });
  }
}));
export async function perform(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
    await useApp.getState().refresh();
  } catch (error) {
    useApp.getState().patch({
      error:
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : 'Something went wrong.'
    });
  }
}
