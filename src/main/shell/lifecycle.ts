import type { Settings } from '../../shared/types';

/**
 * The rules for Axon's window and tray, kept apart from Electron so they can be tested: whether
 * closing the last window quits, whether this launch should open a window, and what to register
 * with Windows to start at sign-in.
 */

/** Closing the last window leaves Axon in the tray, unless the user turned that off. */
export function afterLastWindow(input: { keepInTray: boolean; platform: string }): 'tray' | 'quit' {
  // macOS apps stay running without windows anyway.
  if (input.platform === 'darwin') return 'tray';
  return input.keepInTray ? 'tray' : 'quit';
}

/** Started by Windows at sign-in: wait in the tray without opening a window. */
export const startedInBackground = (argv: readonly string[]): boolean => argv.includes('--background');

/** What to register to start with Windows. Only the installed app can: a dev build would register electron.exe. */
export function loginItem(
  settings: Pick<Settings, 'startWithWindows'>,
  packaged: boolean,
  platform: string
): { openAtLogin: boolean; args: string[] } | null {
  if (!packaged || platform !== 'win32') return null;
  return { openAtLogin: settings.startWithWindows, args: settings.startWithWindows ? ['--background'] : [] };
}

/** Notifications need an app id Windows can match to a shortcut; a dev build uses electron.exe's own. */
export const appUserModelId = (packaged: boolean, execPath: string): string =>
  packaged ? 'com.axon.studio' : execPath;
