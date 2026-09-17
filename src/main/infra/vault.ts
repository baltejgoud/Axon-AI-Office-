import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** OS-backed protection; no plaintext fallback. Keys never cross into the UI. */
export class Vault {
  private file: string;
  private entries: Record<string, string>;
  constructor(dir: string) {
    this.file = join(dir, 'os-vault.json');
    this.entries = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
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
