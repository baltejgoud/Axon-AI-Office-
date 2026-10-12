import { app, BrowserWindow, ipcMain, session, dialog, screen, nativeImage, type Tray } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PathService } from './infra/paths';
import { ipcPayloadTooLarge } from './ipc-limits';
import { Vault } from './infra/vault';
import { Repository } from './repository';
import { Service } from './service';
import { loadWindowState, saveWindowState } from './windowState';
import type { PlatformAPI } from '../shared/platform';
import type { FocusTarget } from '../shared/types';
import { RECEPTIONIST_ID } from '../shared/coworkers';
import {
  afterLastWindow,
  appUserModelId,
  launchedForJobs,
  loginItem,
  secondLaunchOpens,
  startedInBackground,
  wakesForJobs
} from './shell/lifecycle';
import { syncWakeTask } from './shell/wake';
import { showNotice } from './shell/notify';
import { createTray } from './shell/tray';
import { WINDOW_ICON } from './shell/icon';
import { startBrowserBridge } from './browserBridge';
let browserBridge: Awaited<ReturnType<typeof startBrowserBridge>> | undefined;
let window: BrowserWindow | null = null;
let service: Service;
let quitting = false;
/** Opened by the recurring-work task: a slot that began this long ago still runs (Axon starting, or the PC just waking). */
const JOB_CATCH_UP_MS = 15 * 60_000;
/** Kept for the life of the app, so the icon isn't garbage-collected away. */
let tray: Tray | null = null;
const TODAY: FocusTarget = { agentId: RECEPTIONIST_ID, planner: true };
const methods: (keyof Omit<PlatformAPI, 'onStream'>)[] = [
  'runtimeRuns',
  'conversationClose',
  'projectClose',
  'terminalList',
  'terminalOpen',
  'terminalWrite',
  'terminalResize',
  'terminalKill',
  'snapshot',
  'providerSave',
  'providerTest',
  'providerModels',
  'providerConnect',
  'providerDelete',
  'workspaceSave',
  'workspaceDelete',
  'agentSave',
  'agentDelete',
  'agentExport',
  'agentImport',
  'settingsSave',
  'mcpServerSave',
  'mcpServerDelete',
  'connectorAdd',
  'connectorReconnect',
  'connectorSignInCancel',
  'connectorSignOut',
  'connectorAppSave',
  'webKeySave',
  'chatCreate',
  'getConversationCost',
  'chatHistoryPage',
  'chatRename',
  'chatModelSet',
  'chatMemoryCorrect',
  'getContextInspector',
  'readToolArtifact',
  'chatSelectionSet',
  'chatDelete',
  'dashboardDelete',
  'chatSearch',
  'chatSend',
  'chatRetry',
  'chatEdit',
  'chatStop',
  'chatNotifyWhenDone',
  'getContextUsage',
  'usageReport',
  'listBackups',
  'restoreBackup',
  'auditList',
  'auditExport',
  'documentSave',
  'jobRun',
  'revertChange',
  'revertChanges',
  'toolApprove',
  'attach',
  'attachData',
  'speechTranscribe',
  'knowledgeImport',
  'knowledgeImportFolder',
  'knowledgeDelete',
  'knowledgeSearch',
  'projectChoose',
  'projectRecent',
  'projectOpen',
  'projectForget',
  'projectList',
  'projectRead',
  'projectWrite',
  'projectSearch',
  'taskAdd',
  'taskUpdate',
  'taskDelete',
  'officeStart',
  'teamStart',
  'teamReviewer',
  'teamStop',
  'teamDiscard',
  'teamRetry',
  'accountsGet',
  'chatgptSignIn',
  'chatgptCancel',
  'chatgptSignOut',
  'chatgptRefreshModels',
  'claudeConnect',
  'claudeCancel',
  'claudeRefreshModels',
  'claudeDisconnect',
  'claudeLimits',
  'githubSignInStart',
  'githubSignInFinish',
  'githubSignInCancel',
  'githubSignOut',
  'googleSignIn',
  'googleSignInCancel',
  'googleSignOut',
  'accountAppSave',
  'githubRepos',
  'gitCheck',
  'scmStatus',
  'scmDiff',
  'scmStage',
  'scmUnstage',
  'scmCommit',
  'scmSync',
  'scmBranches',
  'scmCheckout',
  'scmCreateBranch',
  'scmClone',
  'scmPublish',
  'openLink',
  'processStop',
  'processOpen'
];
const rendererFile = join(__dirname, '../renderer/index.html');
function createWindow(): void {
  // Axon is one big office: open maximized unless the user last left it restored.
  const stateFile = join(app.getPath('userData'), 'window-state.json');
  const saved = loadWindowState(
    stateFile,
    screen.getAllDisplays().map((d) => d.workArea)
  );
  window = new BrowserWindow({
    ...(saved.bounds ?? { width: 1380, height: 900 }),
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'Axon — AI Studio',
    backgroundColor: '#f7f8fa',
    autoHideMenuBar: true,
    icon: nativeImage.createFromDataURL(WINDOW_ICON),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  // A coworker's development server shows in a frame on their work surface; that frame may only go
  // to pages on this machine (the page's own Content-Security-Policy frame-src says the same).
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(event.url))
      event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => {
    if (saved.maximized) window?.maximize();
    window?.show();
  });
  window.on('close', () => {
    if (window)
      saveWindowState(stateFile, { maximized: window.isMaximized(), bounds: window.getNormalBounds() });
    // Closing to the tray for the first time: say that Axon is still there.
    if (
      !quitting &&
      service &&
      afterLastWindow({ keepInTray: service.settings.keepInTray, platform: process.platform }) === 'tray' &&
      service.firstTrayClose()
    )
      showNotice(
        {
          title: 'Axon is still running',
          body: 'Reminders will still arrive. Quit from the Axon icon in the tray.',
          target: TODAY
        },
        showWindow
      );
  });
  window.on('closed', () => {
    window = null;
  });
  // A notice flashed the taskbar button; coming back to Axon stops it.
  window.on('focus', () => window?.flashFrame(false));
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(rendererFile);
}
/**
 * Brings the office forward, creating the window if it was closed to the tray, and points it at
 * `target` (a notification's coworker, or the receptionist's planner).
 */
function showWindow(target?: FocusTarget): void {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (target) window.webContents.send('platform:stream', { channel: 'focus', ...target });
    return;
  }
  service.setPendingFocus(target ?? null);
  createWindow();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId(appUserModelId(app.isPackaged, process.execPath));
  // The recurring-work task launching Axon while it already runs: the running one does the job, unseen,
  // with the same grace a fresh launch gets (the computer may have just woken past the time).
  app.on('second-instance', (_event, argv) => {
    if (secondLaunchOpens(argv)) showWindow();
    if (launchedForJobs(argv)) void service?.runScheduledJobs(Date.now(), JOB_CATCH_UP_MS).catch(() => {});
  });
  void app
    .whenReady()
    .then(async () => {
      const paths = new PathService();
      paths.ensure();
      const repo = new Repository(paths.db, paths.backups);
      service = new Service(
        repo,
        new Vault(paths.secrets),
        paths.root,
        (event) => {
          browserBridge?.emit(event);
          if (window && !window.isDestroyed()) window.webContents.send('platform:stream', event);
        },
        join(__dirname, 'parse-worker.js')
      );
      // Copy buttons need clipboard writes, and voice typing the microphone (never the camera, and only
      // for Axon's own window); every other web permission stays denied.
      const allowed = new Set(['clipboard-sanitized-write']);
      const ownWindow = (contents: Electron.WebContents | null) =>
        !!window && contents === window.webContents;
      session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
        const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
        const microphone =
          permission === 'media' &&
          ownWindow(contents) &&
          mediaTypes.length > 0 &&
          mediaTypes.every((type) => type === 'audio');
        callback(allowed.has(permission) || microphone);
      });
      session.defaultSession.setPermissionCheckHandler(
        (contents, permission, _origin, details) =>
          allowed.has(permission) ||
          (permission === 'media' && details.mediaType === 'audio' && ownWindow(contents))
      );
      for (const method of methods)
        ipcMain.handle(`platform:${method}`, (event, ...args: unknown[]) => {
          const expected =
            !app.isPackaged && process.env.ELECTRON_RENDERER_URL
              ? process.env.ELECTRON_RENDERER_URL
              : pathToFileURL(rendererFile).href;
          if (
            !window ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            (event.senderFrame.url.split('#')[0] !== expected.replace(/\/$/, '') &&
              event.senderFrame.url.split('#')[0] !== `${expected.replace(/\/$/, '')}/`)
          )
            throw new Error('Untrusted IPC sender.');
          if (ipcPayloadTooLarge(method, args)) throw new Error('IPC payload too large.');
          const fn = service[method] as (...values: unknown[]) => unknown;
          return fn.apply(service, args);
        });
      if (!app.isPackaged && process.env.AXON_BROWSER_CONTROL === '1') {
        browserBridge = await startBrowserBridge((method, args) => {
          const fn = service[method as keyof Service] as (...values: unknown[]) => unknown;
          return fn.apply(service, args);
        }, methods);
      }
      service.attachShell({
        notify: (notice) => {
          showNotice(notice, showWindow);
          // Open behind another app or minimized: the taskbar button flashes until Axon is in front again.
          if (window && !window.isDestroyed() && !window.isFocused()) window.flashFrame(true);
        },
        windowFocused: () =>
          !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused(),
        applySettings: (settings) => {
          const item = loginItem(settings, app.isPackaged, process.platform);
          if (item) app.setLoginItemSettings(item);
        },
        // Only the installed app touches the task; a dev build sharing this profile leaves it alone.
        scheduleWake:
          app.isPackaged && process.platform === 'win32'
            ? (at) => void syncWakeTask(wakesForJobs(service.settings, true, process.platform) ? at : null, process.execPath)
            : undefined
      }, { catchUpMs: launchedForJobs(process.argv) ? JOB_CATCH_UP_MS : 0 });
      tray = createTray({ open: () => showWindow(), today: () => showWindow(TODAY), quit: () => app.quit() });
      // Started by Windows at sign-in: wait in the tray until needed.
      if (!startedInBackground(process.argv)) createWindow();
      app.on('activate', () => {
        if (!window) createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox('Axon could not start', error instanceof Error ? error.message : 'Startup failed');
      app.quit();
    });
  // With Keep running in the tray on, closing the window leaves Axon waiting in the tray.
  app.on('window-all-closed', () => {
    if (
      !service ||
      afterLastWindow({ keepInTray: service.settings.keepInTray, platform: process.platform }) === 'quit'
    )
      app.quit();
  });
  app.on('before-quit', (event) => {
    if (!service || quitting) return;
    event.preventDefault();
    service.stopAll();
    browserBridge?.close();
    service.shutdown();
    tray?.destroy();
    tray = null;
    void service.repo.store
      .flushAll()
      .then(() => {
        quitting = true;
        app.quit();
      })
      .catch(() => {
        dialog.showErrorBox(
          'Storage error',
          'Could not save data. Free disk space and try closing Axon again.'
        );
      });
  });
}
