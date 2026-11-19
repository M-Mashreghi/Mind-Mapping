export interface OpenedFile {
  name: string;
  path?: string;
  content: string;
}

export interface SavedFile {
  name: string;
  path?: string;
}

/** Bridge exposed by the Electron preload script as window.argmapDesktop. */
export interface DesktopBridge {
  openFile(): Promise<OpenedFile | null>;
  openPath(path: string): Promise<OpenedFile | null>;
  saveFile(path: string, content: string): Promise<SavedFile>;
  saveFileAs(suggestedName: string, content: string): Promise<SavedFile | null>;
  recentFiles(): Promise<string[]>;
  setDirty(dirty: boolean): void;
  setTitle(title: string): void;
  toggleFullScreen(): void;
  onCloseRequest(handler: () => void): void;
  confirmClose(): void;
  openExternal(url: string): void;
}

declare global {
  interface Window {
    argmapDesktop?: DesktopBridge;
  }
}

export interface Platform {
  kind: 'desktop' | 'web';
  openFile(): Promise<OpenedFile | null>;
  openPath?(path: string): Promise<OpenedFile | null>;
  /** Save to the known location; returns null if the user cancelled a Save As. */
  save(content: string, name: string, path?: string): Promise<SavedFile | null>;
  saveAs(content: string, name: string): Promise<SavedFile | null>;
  recentFiles(): Promise<string[]>;
  setDirty(dirty: boolean): void;
  setTitle(title: string): void;
  toggleFullScreen(): void;
  openExternal(url: string): void;
}

function desktopPlatform(bridge: DesktopBridge): Platform {
  return {
    kind: 'desktop',
    openFile: () => bridge.openFile(),
    openPath: (p) => bridge.openPath(p),
    save: (content, name, path) => (path ? bridge.saveFile(path, content) : bridge.saveFileAs(name, content)),
    saveAs: (content, name) => bridge.saveFileAs(name, content),
    recentFiles: () => bridge.recentFiles(),
    setDirty: (d) => bridge.setDirty(d),
    setTitle: (t) => bridge.setTitle(t),
    toggleFullScreen: () => bridge.toggleFullScreen(),
    openExternal: (url) => bridge.openExternal(url),
  };
}

function webPlatform(): Platform {
  const download = (content: string, name: string): SavedFile => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { name };
  };
  return {
    kind: 'web',
    openFile: () =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.amap,application/json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          resolve({ name: file.name, content: await file.text() });
        };
        input.click();
      }),
    save: async (content, name) => download(content, name),
    saveAs: async (content, name) => download(content, name),
    recentFiles: async () => [],
    setDirty: () => {},
    setTitle: (t) => {
      document.title = t;
    },
    toggleFullScreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    },
    openExternal: (url) => window.open(url, '_blank', 'noopener'),
  };
}

export const platform: Platform =
  typeof window !== 'undefined' && window.argmapDesktop ? desktopPlatform(window.argmapDesktop) : webPlatform();
