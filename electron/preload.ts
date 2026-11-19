import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('argmapDesktop', {
  openFile: () => ipcRenderer.invoke('file:open'),
  openPath: (p: string) => ipcRenderer.invoke('file:openPath', p),
  saveFile: (p: string, content: string) => ipcRenderer.invoke('file:save', p, content),
  saveFileAs: (name: string, content: string) => ipcRenderer.invoke('file:saveAs', name, content),
  recentFiles: () => ipcRenderer.invoke('file:recent'),
  setDirty: (dirty: boolean) => ipcRenderer.send('app:dirty', dirty),
  setTitle: (title: string) => ipcRenderer.send('app:title', title),
  toggleFullScreen: () => ipcRenderer.send('app:fullscreen'),
  setFullScreen: (on: boolean) => ipcRenderer.send('app:set-fullscreen', !!on),
  onCloseRequest: (handler: () => void) => {
    ipcRenderer.removeAllListeners('app:close-request');
    ipcRenderer.on('app:close-request', () => handler());
  },
  onMenuEdit: (handler: (action: string) => void) => {
    ipcRenderer.removeAllListeners('menu:edit');
    ipcRenderer.on('menu:edit', (_e, action: string) => handler(action));
  },
  onOpenPath: (handler: (path: string) => void) => {
    ipcRenderer.removeAllListeners('app:open-path');
    ipcRenderer.on('app:open-path', (_e, p: string) => handler(p));
  },
  hostStart: (title: string, hostName?: string) => ipcRenderer.invoke('collab:host', title, hostName),
  lanSetMe: (me: unknown) => ipcRenderer.invoke('lan:setMe', me),
  lanNearby: () => ipcRenderer.invoke('lan:nearby'),
  lanInvite: (deviceId: string, role: string, from: unknown) => ipcRenderer.invoke('lan:invite', deviceId, role, from),
  onNearby: (handler: (n: unknown) => void) => {
    ipcRenderer.removeAllListeners('lan:nearby');
    ipcRenderer.on('lan:nearby', (_e, n) => handler(n));
  },
  onInvitation: (handler: (inv: unknown) => void) => {
    ipcRenderer.removeAllListeners('lan:invitation');
    ipcRenderer.on('lan:invitation', (_e, inv) => handler(inv));
  },
  hostStop: () => ipcRenderer.invoke('collab:stop'),
  hostStatus: () => ipcRenderer.invoke('collab:status'),
  discoverHosts: () => ipcRenderer.invoke('collab:discover'),
  hostAction: (method: string, ...args: unknown[]) => {
    const allowed = ['approve', 'deny', 'setRole', 'remove', 'forget'];
    if (!allowed.includes(method)) return Promise.reject(new Error('Unknown sharing call'));
    return ipcRenderer.invoke(`collab:${method}`, ...args);
  },
  onHostState: (handler: (s: unknown) => void) => {
    ipcRenderer.removeAllListeners('collab:state');
    ipcRenderer.on('collab:state', (_e, s) => handler(s));
  },
  drive: (method: string, ...args: unknown[]) => {
    const allowed = ['status', 'signIn', 'cancelSignIn', 'signOut', 'list', 'open', 'save'];
    if (!allowed.includes(method)) return Promise.reject(new Error('Unknown Drive call'));
    return ipcRenderer.invoke(`drive:${method}`, ...args);
  },
  confirmClose: () => ipcRenderer.send('app:close-confirmed'),
  openExternal: (url: string) => ipcRenderer.send('app:open-external', url),
  exportFile: (name: string, data: Uint8Array | string, filter: { name: string; extensions: string[] }) =>
    ipcRenderer.invoke('file:export', name, data, filter),
  exportPdf: (svg: string, width: number, height: number, name: string) =>
    ipcRenderer.invoke('file:exportPdf', svg, width, height, name),
});
