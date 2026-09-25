import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** OS-backed protection; no plaintext fallback. Keys never cross into the UI. */
export class Vault {
  private file: string;
  private entries: Record<string, string>;
  constructor(dir: string) {
    this.file = join(dir, 'os-vault.json');
    this.entries = this.load();
  }
  /** The saved entries. An unreadable file is set aside (keys must be entered again) rather than stopping start-up. */
  private load(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    try {
      const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string'))
        return value as Record<string, string>;
    } catch { /* Set aside below. */ }
    try { renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* Overwritten on the next save. */ }
    return {};
  }
  private available(): void {
    if (!safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('Secure OS key storage is unavailable. Configure your system keyring first.');
    }
  }
  set(id: string, secret: string): void {
    if (!secret) return this.remove(id);
    this.available();
    this.entries[id] = safeStorage.encryptString(secret).toString('base64');
    this.persist();
  }
  get(id: string): string | null {
    if (!this.entries[id]) return null;
    this.available();
    return safeStorage.decryptString(Buffer.from(this.entries[id], 'base64'));
  }
  has(id: string): boolean { return Object.hasOwn(this.entries, id); }
  remove(id: string): void { delete this.entries[id]; this.persist(); }
  private persist(): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.entries), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
