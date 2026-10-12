import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WAKE_TASK, wakeTaskXml } from './lifecycle';

/** The time the task is set for, as far as this run knows; undefined until the first sync. */
let applied: number | null | undefined;
let queue: Promise<void> = Promise.resolve();

const schtasks = (args: string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile('schtasks.exe', args, { windowsHide: true }, (error) => (error ? reject(error) : resolve()))
  );

/**
 * Moves the recurring-work task to `at`, or removes it for null. Changes run one at a time; a failed
 * change is retried at the next sync. schtasks reads task XML as UTF-16.
 */
export function syncWakeTask(at: number | null, execPath: string): Promise<void> {
  queue = queue
    .then(async () => {
      if (at === applied) return;
      if (at === null) await schtasks(['/Delete', '/TN', WAKE_TASK, '/F']).catch(() => {}); // none there is fine
      else {
        const dir = await mkdtemp(join(tmpdir(), 'axon-wake-'));
        const file = join(dir, 'task.xml');
        try {
          await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(wakeTaskXml(at, execPath), 'utf16le')]));
          await schtasks(['/Create', '/TN', WAKE_TASK, '/XML', file, '/F']);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
      applied = at;
    })
    .catch((error) => console.warn('Could not update the recurring-work task:', error));
  return queue;
}
