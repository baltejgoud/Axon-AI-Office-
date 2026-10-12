import { create } from 'zustand';

/**
 * Counts, by conversation, how often its saved history was cut back (a retry or an edit). A thread
 * that loaded older pages of history reads them again when its count changes, so it never keeps
 * showing messages that are gone.
 */
export const useRewrites = create<{
  epochs: Record<string, number>;
  bump(conversationId: string): void;
}>((set, get) => ({
  epochs: {},
  bump: (conversationId) =>
    set({ epochs: { ...get().epochs, [conversationId]: (get().epochs[conversationId] ?? 0) + 1 } })
}));
