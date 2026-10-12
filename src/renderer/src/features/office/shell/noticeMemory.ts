import { create } from 'zustand';
import { loadMemory, markRead, saveMemory, type NoticeMemory } from '../notices';

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

interface NoticeMemoryState {
  memory: NoticeMemory;
  /** These notices have been looked at. */
  read: (ids: readonly string[]) => void;
}

/** What the bell remembers between sessions: what you have already looked at. Kept in this window's storage. */
export const useNoticeMemory = create<NoticeMemoryState>((set, get) => ({
  // A first start begins now; the saved copy makes "since" stick across reloads.
  memory: saveMemory(storage(), loadMemory(storage(), Date.now())),
  read: (ids) => {
    if (!ids.length) return;
    set({ memory: saveMemory(storage(), markRead(get().memory, ids, Date.now())) });
  }
}));
