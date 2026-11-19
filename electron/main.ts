import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Bonjour, Service } from 'bonjour-service';
import { CollabServer, TrustStore, TrustedPerson } from './collab-server';
import { LanPresence, Mdns } from './lan-presence';
import { GoogleDrive } from './google-drive';
import googleClient from './google-client.json';

/** Filled in at build time from the GOOGLE_CLIENT_SECRET environment variable (see scripts/build-electron.mjs). */
declare const __GOOGLE_CLIENT_SECRET__: string;

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

/** The first .amap file named on a command line (double-click on a file, "Open with"). */
function fileFromArgs(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-') || !arg.toLowerCase().endsWith('.amap')) continue;
    const full = path.resolve(arg);
    if (existsSync(full)) return full;
  }
  return null;
}

let pendingOpen: string | null = fileFromArgs(process.argv);

function sendOpen(file: string) {
  if (!win) {
    pendingOpen = file;
    return;
  }
  win.webContents.send('app:open-path', file);
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
  if (process.platform === 'darwin') setMacMenu();

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
  win.webContents.on('did-finish-load', () => {
    if (pendingOpen) {
      sendOpen(pendingOpen);
      pendingOpen = null;
    }
  });
  win.on('focus', () => win?.flashFrame(false));
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

/**
 * macOS always has an app menu. Keep it small, and let undo, redo and select all reach
 * the map (the page decides whether they apply to a text field or to the map).
 */
function setMacMenu() {
  const send = (action: string) => () => win?.webContents.send('menu:edit', action);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'Cmd+Z', click: send('undo') },
          { label: 'Redo', accelerator: 'Shift+Cmd+Z', click: send('redo') },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { label: 'Select All', accelerator: 'Cmd+A', click: send('selectAll') },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

// ------------------------------------------------------------ LAN sharing

let server: CollabServer | null = null;
let hostService: Service | null = null;
let sharedBy = '';

/** People the host chose to "always allow", kept between runs. */
const trustFile = () => path.join(app.getPath('userData'), 'lan-allowed.json');
const trustStore: TrustStore = {
  async load() {
    try {
      return JSON.parse(await fs.readFile(trustFile(), 'utf8')) as TrustedPerson[];
    } catch {
      return [];
    }
  },
  async save(list) {
    await fs.writeFile(trustFile(), JSON.stringify(list, null, 2), 'utf8');
  },
};
let bonjour: Bonjour | null = null;

function getBonjour(): Bonjour {
  bonjour = bonjour ?? new Bonjour();
  return bonjour;
}

ipcMain.handle('collab:host', async (_e, title: string, hostName?: string) => {
  if (server?.info) return server.info;
  server = new CollabServer();
  sharedBy = String(hostName ?? '').slice(0, 40);
  server.on('change', (state) => win?.webContents.send('collab:state', state));
  server.on('request', () => {
    // Someone is waiting at the door: get the host's attention.
    if (win && !win.isFocused()) win.flashFrame(true);
  });
  const info = await server.start({ staticDir: path.join(__dirname, '..', 'dist'), trust: trustStore, title: String(title).slice(0, 100) });
  if (presence) presence.ownHost = { port: info.port, addresses: info.addresses };
  try {
    hostService = getBonjour().publish({
      name: `${String(title).slice(0, 40) || 'Argument map'} (${os.hostname()})`.slice(0, 63),
      type: 'argmap',
      port: info.port,
      txt: { title: String(title).slice(0, 100), host: os.hostname(), by: sharedBy },
    });
  } catch {
    // Discovery is a convenience; joining by address still works.
  }
  return info;
});

ipcMain.handle('collab:stop', async () => {
  try {
    hostService?.stop?.();
  } catch {
    /* ignore */
  }
  hostService = null;
  if (presence) presence.ownHost = null;
  await server?.stop();
  server = null;
});

const role = (r: unknown) => (r === 'view' ? 'view' : 'edit');
ipcMain.handle('collab:approve', (_e, id: string, r: string, always: boolean) => server?.approve(String(id), role(r), !!always));
ipcMain.handle('collab:deny', (_e, id: string) => server?.deny(String(id)));
ipcMain.handle('collab:setRole', (_e, id: string, r: string) => server?.setRole(String(id), role(r)));
ipcMain.handle('collab:remove', (_e, id: string) => server?.remove(String(id)));
ipcMain.handle('collab:forget', (_e, deviceId: string) => server?.forget(String(deviceId)));

ipcMain.handle('collab:status', () => (server?.info ? { ...server.info, peers: server.peerCount } : null));

/** Shared maps found on the network right now. */
ipcMain.handle('collab:discover', async () => {
  const p = await getPresence();
  if (!p.nearby().hosts.length) await new Promise((r) => setTimeout(r, 2000));
  return p.nearby().hosts;
});

// ------------------------------------------------------ people on the network

let presence: LanPresence | null = null;
let presenceStarting: Promise<LanPresence> | null = null;

function getPresence(): Promise<LanPresence> {
  presenceStarting =
    presenceStarting ??
    (async () => {
      const p = new LanPresence(getBonjour() as unknown as Mdns);
      p.on('change', (n) => win?.webContents.send('lan:nearby', n));
      p.on('invitation', (inv) => {
        win?.webContents.send('lan:invitation', inv);
        if (win && !win.isFocused()) win.flashFrame(true);
      });
      await p.start();
      if (server?.info) p.ownHost = { port: server.info.port, addresses: server.info.addresses };
      presence = p;
      return p;
    })();
  return presenceStarting;
}

ipcMain.handle('lan:setMe', async (_e, me: { name: string; color: string; deviceId: string; visible: boolean }) => {
  (await getPresence()).setMe(me);
});

ipcMain.handle('lan:nearby', async () => (await getPresence()).nearby());

/** The host invites someone they can see on the network. */
ipcMain.handle('lan:invite', async (_e, deviceId: string, role: string, from: { name: string; color: string }) => {
  const p = await getPresence();
  const person = p.nearby().people.find((x) => x.deviceId === deviceId);
  if (!person) throw new Error('They are no longer on the network.');
  if (!server?.info) throw new Error('Start sharing first.');
  const r = role === 'view' ? 'view' : 'edit';
  const invite = server.createInvite(person.deviceId, person.name, r);
  await p.invite(person, {
    from: String(from?.name ?? '').slice(0, 40),
    fromColor: String(from?.color ?? ''),
    title: server.title,
    port: server.info.port,
    role: r,
    invite,
  });
});

app.on('before-quit', () => {
  void server?.stop();
  void presence?.stop();
  try {
    bonjour?.destroy();
  } catch {
    /* ignore */
  }
});

// ------------------------------------------------------------ Google Drive

const TEST_GOOGLE = process.env.ARGMAP_TEST_GOOGLE_ENDPOINT;

/** The OAuth client comes from electron/google-client.json, or the environment for testing. */
const drive = new GoogleDrive(
  {
    clientId: process.env.ARGMAP_GOOGLE_CLIENT_ID ?? googleClient.clientId,
    clientSecret: process.env.ARGMAP_GOOGLE_CLIENT_SECRET ?? (googleClient.clientSecret || __GOOGLE_CLIENT_SECRET__),
    // End-to-end tests point the app at a fake Google.
    ...(TEST_GOOGLE
      ? { authUrl: `${TEST_GOOGLE}/auth`, tokenUrl: `${TEST_GOOGLE}/token`, apiBase: `${TEST_GOOGLE}/drive`, uploadBase: `${TEST_GOOGLE}/upload` }
      : {}),
  },
  {
    // The refresh token is encrypted with the OS keychain when one is available.
    async load() {
      const file = path.join(app.getPath('userData'), 'google-token');
      try {
        const buf = await fs.readFile(file);
        return buf[0] === 0x7b ? buf.toString('utf8') : safeStorage.decryptString(buf);
      } catch {
        return null;
      }
    },
    async save(value) {
      const file = path.join(app.getPath('userData'), 'google-token');
      if (value === null) {
        await fs.rm(file, { force: true });
        return;
      }
      const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8');
      await fs.writeFile(file, data, { mode: 0o600 });
    },
  },
  // In tests the fake consent page approves at once, so just follow its redirect.
  (url) => void (TEST_GOOGLE ? fetch(url).catch(() => {}) : shell.openExternal(url)),
);

const driveCall = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
  async (_e: unknown, ...args: A) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };

ipcMain.handle('drive:status', driveCall(() => drive.status()));
ipcMain.handle('drive:signIn', driveCall(async () => {
  const status = await drive.signIn();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  return status;
}));
ipcMain.handle('drive:cancelSignIn', driveCall(async () => drive.cancelSignIn()));
ipcMain.handle('drive:signOut', driveCall(() => drive.signOut()));
ipcMain.handle('drive:list', driveCall(() => drive.list()));
ipcMain.handle('drive:open', driveCall((id: string) => drive.open(String(id))));
ipcMain.handle('drive:save', driveCall((opts: { id?: string; name: string; content: string; expectedModified?: string; force?: boolean }) =>
  drive.save({
    id: opts.id ? String(opts.id) : undefined,
    name: String(opts.name),
    content: String(opts.content),
    expectedModified: opts.expectedModified ? String(opts.expectedModified) : undefined,
    force: !!opts.force,
  })));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = fileFromArgs(argv);
    if (file) sendOpen(file);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // macOS sends files through this event instead of argv.
  app.on('open-file', (e, file) => {
    e.preventDefault();
    sendOpen(file);
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
