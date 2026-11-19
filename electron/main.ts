import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const FILE_FILTERS = [{ name: 'Argument maps', extensions: ['amap'] }];
const MAX_RECENT = 10;

let win: BrowserWindow | null = null;
let dirty = false;
let forceClose = false;

/** For automated tests only: write exports here instead of asking with a dialog. */
const TEST_EXPORT_DIR = process.env.ARGMAP_TEST_EXPORT_DIR;

async function askSavePath(name: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (TEST_EXPORT_DIR) return path.join(TEST_EXPORT_DIR, path.basename(name));
  if (!win) return null;
  const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters });
  return res.canceled || !res.filePath ? null : res.filePath;
}

const recentPath = () => path.join(app.getPath('userData'), 'recent.json');

async function readRecent(): Promise<string[]> {
  try {
    const list = JSON.parse(await fs.readFile(recentPath(), 'utf8'));
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

async function addRecent(file: string): Promise<void> {
  const list = (await readRecent()).filter((p) => p !== file);
  list.unshift(file);
  await fs.mkdir(path.dirname(recentPath()), { recursive: true });
  await fs.writeFile(recentPath(), JSON.stringify(list.slice(0, MAX_RECENT)));
  app.addRecentDocument(file);
}

async function readMap(file: string) {
  const content = await fs.readFile(file, 'utf8');
  await addRecent(file);
  return { name: path.basename(file), path: file, content };
}

async function writeMap(file: string, content: string) {
  // Write to a temp file first so a crash never leaves a half-written map.
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
  await addRecent(file);
  return { name: path.basename(file), path: file };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    title: 'Argument Mapper',
    autoHideMenuBar: true,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.setMenu(null);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (!dirty || forceClose || !win) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes to this map before closing?',
      detail: 'Your changes will be lost if you don\'t save them.',
    });
    if (choice === 0) win.webContents.send('app:close-request');
    else if (choice === 1) {
      forceClose = true;
      win.close();
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

ipcMain.handle('file:open', async () => {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: FILE_FILTERS });
  if (res.canceled || !res.filePaths[0]) return null;
  return readMap(res.filePaths[0]);
});

ipcMain.handle('file:openPath', async (_e, file: string) => readMap(String(file)));

ipcMain.handle('file:save', async (_e, file: string, content: string) => writeMap(String(file), String(content)));

ipcMain.handle('file:saveAs', async (_e, suggestedName: string, content: string) => {
  if (!win) return null;
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), String(suggestedName)),
    filters: FILE_FILTERS,
  });
  if (res.canceled || !res.filePath) return null;
  const file = res.filePath.endsWith('.amap') ? res.filePath : `${res.filePath}.amap`;
  return writeMap(file, String(content));
});

ipcMain.handle('file:recent', () => readRecent());

ipcMain.handle('file:export', async (_e, name: string, data: Uint8Array | string, filter: { name: string; extensions: string[] }) => {
  const file = await askSavePath(String(name), [{ name: String(filter?.name ?? 'File'), extensions: (filter?.extensions ?? []).map(String) }]);
  if (!file) return null;
  await fs.writeFile(file, typeof data === 'string' ? data : Buffer.from(data));
  return { name: path.basename(file), path: file };
});

ipcMain.handle('file:exportPdf', async (_e, svg: string, width: number, height: number, name: string) => {
  const file = await askSavePath(String(name), [{ name: 'PDF', extensions: ['pdf'] }]);
  if (!file) return null;
  // Render the SVG in a hidden, script-free window and print it to a single PDF page.
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    const html = `<!doctype html><meta charset="utf-8"><style>@page{margin:0}html,body{margin:0}svg{display:block}</style>${String(svg)}`;
    await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: Math.max(1, Number(width)) / 96, height: Math.max(1, Number(height)) / 96 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    await fs.writeFile(file, pdf);
    return { name: path.basename(file), path: file };
  } finally {
    pdfWin.destroy();
  }
});

ipcMain.on('app:dirty', (_e, value: boolean) => {
  dirty = !!value;
  win?.setDocumentEdited(dirty);
});

ipcMain.on('app:title', (_e, title: string) => win?.setTitle(String(title)));

ipcMain.on('app:fullscreen', () => win?.setFullScreen(!win.isFullScreen()));

ipcMain.on('app:close-confirmed', () => {
  forceClose = true;
  win?.close();
});

ipcMain.on('app:open-external', (_e, url: string) => {
  if (/^https?:\/\//.test(String(url))) void shell.openExternal(String(url));
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
