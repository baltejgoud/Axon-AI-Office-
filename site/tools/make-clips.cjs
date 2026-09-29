// Encodes the site's clips from the brag footage (brag-output/work/footage) with WebCodecs.
//   node_modules\.bin\electron site\tools\make-clips.cjs [clip names...]
// Writes site/media/*.mp4 (H.264, video only, faststart) and the posters beside them.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT', error);
  process.exit(1);
});
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
  });
  ipcMain.on('log', (_, message) => console.log(message));
  ipcMain.on('done', (_, error) => {
    if (error) console.error('FAILED', error);
    app.exit(error ? 1 : 0);
  });
  await win.loadFile(path.join(__dirname, 'clip-encoder.html'));
  win.webContents.send('run', {
    footage: path.resolve(__dirname, '../../brag-output/work/footage'),
    out: path.resolve(__dirname, '../media'),
    only: process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.cjs'))
  });
});
