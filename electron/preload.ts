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
  onCloseRequest: (handler: () => void) => {
    ipcRenderer.removeAllListeners('app:close-request');
    ipcRenderer.on('app:close-request', () => handler());
  },
  confirmClose: () => ipcRenderer.send('app:close-confirmed'),
  openExternal: (url: string) => ipcRenderer.send('app:open-external', url),
  exportFile: (name: string, data: Uint8Array | string, filter: { name: string; extensions: string[] }) =>
    ipcRenderer.invoke('file:export', name, data, filter),
  exportPdf: (svg: string, width: number, height: number, name: string) =>
    ipcRenderer.invoke('file:exportPdf', svg, width, height, name),
});
