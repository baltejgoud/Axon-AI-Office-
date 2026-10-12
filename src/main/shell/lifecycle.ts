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

/** Started by Windows at sign-in, or for recurring work: wait in the tray without opening a window. */
export const startedInBackground = (argv: readonly string[]): boolean => argv.includes('--background');

/** Opened by the recurring-work task: a job is due, so this launch may catch a slot that began moments ago. */
export const launchedForJobs = (argv: readonly string[]): boolean => argv.includes('--scheduled');

/** A second launch brings the window forward, unless Windows started it to wait in the tray. */
export const secondLaunchOpens = (argv: readonly string[]): boolean => !startedInBackground(argv);

/** Whether Windows should open Axon when a recurring job is due. Only the installed app can: a dev build would register electron.exe. */
export const wakesForJobs = (settings: Pick<Settings, 'wakeForJobs'>, packaged: boolean, platform: string): boolean =>
  packaged && platform === 'win32' && settings.wakeForJobs !== false;

/** The Task Scheduler task that opens Axon for recurring work; one per user, moved to each next due time. */
export const WAKE_TASK = 'Axon recurring work';

const xmlText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const two = (n: number) => String(n).padStart(2, '0');

/**
 * The task's definition: once, at `at` in this computer's local time, open Axon in the tray for
 * recurring work. It runs as the signed-in user without elevation, on battery too, and is never
 * stopped by Task Scheduler, since the Axon it opens stays in the tray afterwards.
 */
export function wakeTaskXml(at: number, execPath: string): string {
  const d = new Date(at);
  const start = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:00`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Opens Axon in the tray when a recurring job is due. Axon moves or removes this task itself; turn it off in Axon under Settings, System.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${start}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlText(execPath)}</Command>
      <Arguments>--background --scheduled</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

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
