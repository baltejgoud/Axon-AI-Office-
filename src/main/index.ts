import { app, BrowserWindow, ipcMain, session, dialog } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PathService } from './infra/paths';
import { Vault } from './infra/vault';
import { Repository } from './repository';
import { Service } from './service';
import type { PlatformAPI } from '../shared/platform';
let window: BrowserWindow | null = null;
let service: Service;
let quitting = false;
const methods: (keyof Omit<PlatformAPI, 'onStream'>)[] = [
  'snapshot', 'providerSave', 'providerDelete', 'workspaceSave', 'workspaceDelete', 'agentSave', 'agentDelete', 'agentExport', 'agentImport',
  'settingsSave', 'chatCreate', 'chatRename', 'chatDelete', 'chatSend', 'chatStop', 'attach', 'knowledgeImport', 'knowledgeDelete', 'knowledgeSearch',
  'projectChoose', 'projectList', 'projectRead', 'projectWrite', 'projectSearch'
];
const rendererFile = join(__dirname, '../renderer/index.html');
function createWindow(): void {
  window = new BrowserWindow({ width: 1380, height: 900, minWidth: 980, minHeight: 680, show: false,
    title: 'Axon — AI Studio', backgroundColor: '#0f172a', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(rendererFile);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.restore(); window?.focus(); });
  void app.whenReady().then(() => {
    const paths = new PathService(); paths.ensure();
    const repo = new Repository(paths.db, paths.backups);
    service = new Service(repo, new Vault(paths.secrets), paths.root, event => {
      if (window && !window.isDestroyed()) window.webContents.send('platform:stream', event);
    }, join(__dirname, 'parse-worker.js'));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    for (const method of methods) ipcMain.handle(`platform:${method}`, (event, ...args: unknown[]) => {
      const expected = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : pathToFileURL(rendererFile).href;
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== expected.replace(/\/$/, '') && event.senderFrame.url.split('#')[0] !== `${expected.replace(/\/$/, '')}/`) throw new Error('Untrusted IPC sender.');
      if (JSON.stringify(args).length > 2200000) throw new Error('IPC payload too large.');
      const fn = service[method] as (...values: unknown[]) => unknown;
      return fn.apply(service, args);
    });
    createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Axon could not start', error instanceof Error ? error.message : 'Startup failed'); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (!service || quitting) return;
    event.preventDefault(); service.stopAll(); service.shutdown();
    void service.repo.store.flushAll().then(() => { quitting = true; app.quit(); }).catch(() => {
      dialog.showErrorBox('Storage error', 'Could not save data. Free disk space and try closing Axon again.');
    });
  });
}
