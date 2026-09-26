import { create } from 'zustand';
import type { AccountsState } from '../../shared/scm';

/** Who is signed in, shared by Settings, the office's avatar and the Files room. */
export const useAccounts = create<{ accounts: AccountsState | null; refresh: () => Promise<void> }>(
  (set) => ({
    accounts: null,
    refresh: async () => set({ accounts: await window.axon.accountsGet() })
  })
);

/** The message of an error from the main process, without Electron's "Error invoking remote method" wrapper. */
export const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(err);
