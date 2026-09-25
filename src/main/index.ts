import { app, BrowserWindow, ipcMain, session, dialog, screen, type Tray } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PathService } from './infra/paths';
import { Vault } from './infra/vault';
import { Repository } from './repository';
import { Service } from './service';
import { loadWindowState, saveWindowState } from './windowState';
import type { PlatformAPI } from '../shared/platform';
import type { FocusTarget } from '../shared/types';
import { RECEPTIONIST_ID } from '../shared/coworkers';
import { afterLastWindow, appUserModelId, loginItem, startedInBackground } from './shell/lifecycle';
import { showNotice } from './shell/notify';
import { createTray } from './shell/tray';
let window: BrowserWindow | null = null;
let service: Service;
let quitting = false;
/** Kept for the life of the app, so the icon isn't garbage-collected away. */
let tray: Tray | null = null;
const TODAY: FocusTarget = { agentId: RECEPTIONIST_ID, planner: true };
const methods: (keyof Omit<PlatformAPI, 'onStream'>)[] = [
  'snapshot', 'providerSave', 'providerTest', 'providerDelete', 'workspaceSave', 'workspaceDelete', 'agentSave', 'agentDelete', 'agentExport', 'agentImport',
  'settingsSave', 'mcpServerSave', 'mcpServerDelete', 'chatCreate', 'chatRename', 'chatSelectionSet', 'chatDelete', 'chatSend', 'chatStop', 'toolApprove', 'attach', 'knowledgeImport', 'knowledgeDelete', 'knowledgeSearch',
  'projectChoose', 'projectRecent', 'projectOpen', 'projectForget', 'projectList', 'projectRead', 'projectWrite', 'projectSearch',
  'taskAdd', 'taskUpdate', 'taskDelete', 'officeStart'
];
const rendererFile = join(__dirname, '../renderer/index.html');
function createWindow(): void {
  // Axon is one big office: open maximized unless the user last left it restored.
  const stateFile = join(app.getPath('userData'), 'window-state.json');
  const saved = loadWindowState(stateFile, screen.getAllDisplays().map(d => d.workArea));
  window = new BrowserWindow({ ...(saved.bounds ?? { width: 1380, height: 900 }), minWidth: 980, minHeight: 680, show: false,
    title: 'Axon — AI Studio', backgroundColor: '#f7f8fa', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => {
    if (saved.maximized) window?.maximize();
    window?.show();
  });
  window.on('close', () => {
    if (window) saveWindowState(stateFile, { maximized: window.isMaximized(), bounds: window.getNormalBounds() });
    // Closing to the tray for the first time: say that Axon is still there.
    if (!quitting && service && afterLastWindow({ keepInTray: service.settings.keepInTray, platform: process.platform }) === 'tray' && service.firstTrayClose())
      showNotice({ title: 'Axon is still running', body: 'Reminders will still arrive. Quit from the Axon icon in the tray.', target: TODAY }, showWindow);
  });
  window.on('closed', () => { window = null; });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
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
  app.on('second-instance', () => showWindow());
  void app.whenReady().then(() => {
    const paths = new PathService(); paths.ensure();
    const repo = new Repository(paths.db, paths.backups);
    service = new Service(repo, new Vault(paths.secrets), paths.root, event => {
      if (window && !window.isDestroyed()) window.webContents.send('platform:stream', event);
    }, join(__dirname, 'parse-worker.js'));
    // Copy buttons need clipboard writes; every other web permission stays denied.
    const allowed = new Set(['clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
    for (const method of methods) ipcMain.handle(`platform:${method}`, (event, ...args: unknown[]) => {
      const expected = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : pathToFileURL(rendererFile).href;
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== expected.replace(/\/$/, '') && event.senderFrame.url.split('#')[0] !== `${expected.replace(/\/$/, '')}/`) throw new Error('Untrusted IPC sender.');
      if (JSON.stringify(args).length > 2200000) throw new Error('IPC payload too large.');
      const fn = service[method] as (...values: unknown[]) => unknown;
      return fn.apply(service, args);
    });
    service.attachShell({
      notify: notice => showNotice(notice, showWindow),
      windowVisible: () => !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized(),
      applySettings: settings => {
        const item = loginItem(settings, app.isPackaged, process.platform);
        if (item) app.setLoginItemSettings(item);
      }
    });
    tray = createTray({ open: () => showWindow(), today: () => showWindow(TODAY), quit: () => app.quit() });
    // Started by Windows at sign-in: wait in the tray until needed.
    if (!startedInBackground(process.argv)) createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Axon could not start', error instanceof Error ? error.message : 'Startup failed'); app.quit(); });
  // With Keep running in the tray on, closing the window leaves Axon waiting in the tray.
  app.on('window-all-closed', () => {
    if (!service || afterLastWindow({ keepInTray: service.settings.keepInTray, platform: process.platform }) === 'quit') app.quit();
  });
  app.on('before-quit', event => {
    if (!service || quitting) return;
    event.preventDefault(); service.stopAll(); service.shutdown(); tray?.destroy(); tray = null;
    void service.repo.store.flushAll().then(() => { quitting = true; app.quit(); }).catch(() => {
      dialog.showErrorBox('Storage error', 'Could not save data. Free disk space and try closing Axon again.');
    });
  });
}
