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
  onOpenPath(handler: (path: string) => void): void;
  hostStart(title: string, hostName?: string): Promise<HostInfo>;
  hostStop(): Promise<void>;
  lanSetMe(me: LanMe): Promise<void>;
  lanNearby(): Promise<Nearby>;
  lanInvite(deviceId: string, role: Role, from: { name: string; color: string }): Promise<void>;
  onNearby(handler: (n: Nearby) => void): void;
  onInvitation(handler: (inv: Invitation) => void): void;
  hostStatus(): Promise<(HostInfo & { peers: number }) | null>;
  discoverHosts(): Promise<FoundHost[]>;
  hostAction(method: string, ...args: unknown[]): Promise<void>;
  onHostState(handler: (s: HostState) => void): void;
  drive(method: string, ...args: unknown[]): Promise<{ ok: boolean; value?: unknown; error?: string }>;
  confirmClose(): void;
  openExternal(url: string): void;
  exportFile(suggestedName: string, data: Uint8Array | string, filter: FileFilter): Promise<SavedFile | null>;
  exportPdf(svg: string, width: number, height: number, suggestedName: string): Promise<SavedFile | null>;
}

export interface HostInfo {
  port: number;
  addresses: string[];
  /** The host's own pass to its server. */
  hostTicket: string;
}

export type Role = 'edit' | 'view';

/** Someone asking to join the map the host is sharing. */
export interface JoinRequest {
  id: string;
  deviceId: string;
  name: string;
  color: string;
  want: Role;
  at: number;
}

export interface Guest {
  id: string;
  deviceId: string;
  name: string;
  color: string;
  role: Role;
  online: boolean;
  trusted: boolean;
}

export interface HostState {
  requests: JoinRequest[];
  guests: Guest[];
  invited: Array<{ deviceId: string; name: string; role: Role }>;
  trusted: Array<{ deviceId: string; name: string; role: Role; since: string }>;
}

/** What the host can do about the people asking to join or already in. */
export interface HostControls {
  approve(requestId: string, role: Role, always: boolean): Promise<void>;
  deny(requestId: string): Promise<void>;
  setRole(guestId: string, role: Role): Promise<void>;
  remove(guestId: string): Promise<void>;
  forget(deviceId: string): Promise<void>;
  onState(handler: (s: HostState) => void): void;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export interface DriveStatus {
  configured: boolean;
  signedIn: boolean;
  email?: string;
  name?: string;
}

/** Google Drive, through the desktop app (web builds don't have it). */
export interface DriveApi {
  status(): Promise<DriveStatus>;
  signIn(): Promise<DriveStatus>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  list(): Promise<DriveFile[]>;
  open(id: string): Promise<{ file: DriveFile; content: string }>;
  save(opts: { id?: string; name: string; content: string; expectedModified?: string; force?: boolean }): Promise<{ file: DriveFile } | { conflict: DriveFile }>;
}

function driveApi(bridge: DesktopBridge): DriveApi {
  const call = async <T,>(method: string, ...args: unknown[]): Promise<T> => {
    const r = await bridge.drive(method, ...args);
    if (!r.ok) throw new Error(r.error ?? 'Google Drive request failed.');
    return r.value as T;
  };
  return {
    status: () => call('status'),
    signIn: () => call('signIn'),
    cancelSignIn: () => call('cancelSignIn'),
    signOut: () => call('signOut'),
    list: () => call('list'),
    open: (id) => call('open', id),
    save: (opts) => call('save', opts),
  };
}

export interface FoundHost {
  name: string;
  title: string;
  address: string;
  port: number;
  /** Who is sharing it. */
  hostName?: string;
  /** People in it right now, the host included; null when unknown. */
  people?: number | null;
}

export interface NearbyPerson {
  deviceId: string;
  name: string;
  color: string;
  address: string;
  port: number;
}

export interface Nearby {
  hosts: FoundHost[];
  people: NearbyPerson[];
}

export interface Invitation {
  id: string;
  from: string;
  fromColor: string;
  title: string;
  address: string;
  port: number;
  role: Role;
  invite: string;
  at: number;
}

export interface LanMe {
  name: string;
  color: string;
  deviceId: string;
  visible: boolean;
}

/** Seeing who is around on the local network, and inviting them (desktop only). */
export interface LanApi {
  setMe(me: LanMe): Promise<void>;
  nearby(): Promise<Nearby>;
  invite(deviceId: string, role: Role, from: { name: string; color: string }): Promise<void>;
  onNearby(handler: (n: Nearby) => void): void;
  onInvitation(handler: (inv: Invitation) => void): void;
}

export interface FileFilter {
  name: string;
  extensions: string[];
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
  /** Save an exported file (image, text…) where the user chooses. */
  exportFile(suggestedName: string, data: Uint8Array | string, filter: FileFilter): Promise<SavedFile | null>;
  exportPdf(svg: string, width: number, height: number, suggestedName: string): Promise<SavedFile | null>;
  /** LAN sharing. Only the desktop app can host. */
  canHost: boolean;
  hostStart(title: string, hostName?: string): Promise<HostInfo>;
  hostStop(): Promise<void>;
  discoverHosts(): Promise<FoundHost[]>;
  host?: HostControls;
  lan?: LanApi;
  drive?: DriveApi;
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
    exportFile: (name, data, filter) => bridge.exportFile(name, data, filter),
    exportPdf: (svg, w, h, name) => bridge.exportPdf(svg, w, h, name),
    canHost: true,
    hostStart: (title, hostName) => bridge.hostStart(title, hostName),
    hostStop: () => bridge.hostStop(),
    discoverHosts: () => bridge.discoverHosts(),
    lan: {
      setMe: (me) => bridge.lanSetMe(me),
      nearby: () => bridge.lanNearby(),
      invite: (id, role, from) => bridge.lanInvite(id, role, from),
      onNearby: (h) => bridge.onNearby(h),
      onInvitation: (h) => bridge.onInvitation(h),
    },
    host: {
      approve: (id, role, always) => bridge.hostAction('approve', id, role, always),
      deny: (id) => bridge.hostAction('deny', id),
      setRole: (id, role) => bridge.hostAction('setRole', id, role),
      remove: (id) => bridge.hostAction('remove', id),
      forget: (deviceId) => bridge.hostAction('forget', deviceId),
      onState: (h) => bridge.onHostState(h),
    },
    drive: driveApi(bridge),
  };
}

function webPlatform(): Platform {
  const download = (content: string | Uint8Array, name: string, type = 'application/json'): SavedFile => {
    const blob = new Blob([content as BlobPart], { type });
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
    exportFile: async (name, data, filter) => {
      const ext = filter.extensions[0];
      const type = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'text/plain';
      return download(data, name, type);
    },
    exportPdf: async (svg, _w, _h, name) => {
      // Browsers: print the drawing; the print dialog offers "Save as PDF".
      const win = window.open('', '_blank');
      if (!win) throw new Error('Allow pop-ups to export a PDF.');
      win.document.write(`<!doctype html><title>${name}</title><style>@page{margin:10mm}body{margin:0}svg{max-width:100%;height:auto}</style>${svg}`);
      win.document.close();
      win.onload = () => win.print();
      setTimeout(() => win.print(), 500);
      return { name };
    },
    canHost: false,
    hostStart: async () => {
      throw new Error('Hosting needs the desktop app. You can still join a map someone else is sharing.');
    },
    hostStop: async () => {},
    discoverHosts: async () => [],
  };
}

export const platform: Platform =
  typeof window !== 'undefined' && window.argmapDesktop ? desktopPlatform(window.argmapDesktop) : webPlatform();
