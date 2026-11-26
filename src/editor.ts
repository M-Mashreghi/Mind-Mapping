import { ClipNode, MapDoc, newMapFile } from './model/doc';
import { MapFile, MapNode, NodeStyle, Snapshot, Theme, FontSize, isClaim, isGroup, isTextNode } from './model/types';
import { importMindMup } from './model/mindmup';
import { selectedLayout } from './model/reasoning';
import { buildSvg, readColors, svgToPng } from './export/svg';
import { toMarkdown, toPlainText } from './export/outline';
import { CollabSession, ControlMessage, Peer, PeerUser, Role, deviceIdentity, loadUser, requestAccess, saveUser } from './collab/session';
import type { HostInfo, HostState, Invitation, Nearby } from './platform/platform';

export interface CollabState {
  role: 'host' | 'guest';
  readOnly: boolean;
  session: CollabSession;
  /** Where people join from (host) or the host we joined (guest). */
  httpBase: string;
  host?: HostInfo;
}

/** Turn "192.168.1.5:47821", "http://…" or a share link into base URLs. */
export function parseAddress(input: string): { httpBase: string; wsBase: string; code?: string } {
  let raw = input.trim();
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `http://${raw}`;
  const u = new URL(raw);
  // A bare address like "192.168.1.5" means the app's default port.
  if (!u.port && !/:\d+/.test(input)) u.port = '47821';
  const code = u.searchParams.get('join') ?? undefined;
  const httpBase = `${u.protocol}//${u.host}`;
  const wsBase = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`;
  return { httpBase, wsBase, code };
}
import { parseMapFile, serialize, FILE_EXTENSION } from './model/file';
import { layoutMap, LayoutResult, Size, computeLabels } from './layout/layout';
import { platform } from './platform/platform';

export interface View {
  zoom: number;
  /** Screen position of map origin. */
  x: number;
  y: number;
}

export interface FileState {
  name: string;
  path?: string;
  dirty: boolean;
  /** Set when the map lives in Google Drive. */
  drive?: { id: string; modifiedTime: string };
}

const CLIP_PREFIX = 'argument-mapper/clip:';
const DRAFT_KEY = 'argument-mapper:draft';

/**
 * Editor state outside React: the document, selection, view and file. React
 * components subscribe with useSyncExternalStore and call the command methods.
 */
export class Editor {
  doc: MapDoc;
  selection: string[] = [];
  editing: { id: string; initial?: string } | null = null;
  /** Presentation mode: the claims in speaking order, and the one on screen. */
  presentation: { steps: string[]; index: number; fullScreen: boolean } | null = null;
  /** The reason or objection whose line label is being written. */
  labelEditing: string | null = null;
  view: View = { zoom: 1, x: 0, y: 0 };
  viewport = { w: 1000, h: 700 };
  showGrid = true;
  /** Id of the selected free-form connection, if any. */
  selectedConnection: string | null = null;
  notesOpen = false;
  find: { query: string; matches: string[]; index: number } | null = null;
  appearance: 'system' | 'light' | 'dark' = 'system';
  file: FileState = { name: 'Untitled argument.amap', dirty: false };
  message: { text: string; kind: 'info' | 'error' } | null = null;
  recent: string[] = [];
  /** Saved versions of this map, newest first. */
  history: Snapshot[] = [];
  collab: CollabState | null = null;
  /** Select tool, or the hand tool that only pans. */
  tool: 'select' | 'pan' = 'select';
  user: PeerUser | null = loadUser();
  showComments = true;
  /** Set when the page was opened from a share link (browser guests). */
  pendingJoin: { address: string } | null = null;
  /** A join request waiting for the host's answer. */
  joining: { address: string; want: Role; waiting: boolean; abort: AbortController } | null = null;
  /** While hosting: who is asking to join, who is in, and who is always allowed. */
  hostState: HostState | null = null;
  /** Shared maps and people found on the local network (desktop only). */
  nearby: Nearby = { hosts: [], people: [] };
  /** Invitations to join someone's map, newest last. */
  invitations: Invitation[] = [];
  /** Whether others on the network can see this app and invite us. */
  lanVisible = true;

  private measure: (node: MapNode, theme: Theme) => Size;
  private styleClip: NodeStyle | undefined;
  private labelCache: { version: number; labels: Map<string, string> } | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private layoutVersion = -1;
  private layoutCache: LayoutResult | null = null;
  private clip: ClipNode[] = [];
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private onDocUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin !== 'load' && this.collab?.role !== 'guest') this.markDirty();
    this.layoutVersion = -1;
    // Drop selection entries that no longer exist (e.g. after undo or a remote delete).
    this.selection = this.selection.filter((id) => this.doc.has(id));
    if (this.selectedConnection && !this.doc.connections.has(this.selectedConnection)) this.selectedConnection = null;
    if (this.editing && !this.doc.has(this.editing.id)) this.editing = null;
    if (this.find) this.runFind(this.find.query, false);
    this.emit();
  };

  constructor(measure: (node: MapNode, theme: Theme) => Size) {
    this.measure = measure;
    try {
      const a = localStorage.getItem('argument-mapper:appearance');
      if (a === 'light' || a === 'dark') this.appearance = a;
    } catch {
      /* ignore */
    }
    this.doc = new MapDoc();
    this.attach();
    const draft = this.readDraft();
    this.loadFile(draft ?? newMapFile(), draft ? { name: 'Recovered draft.amap', dirty: true } : undefined);
    void platform.recentFiles().then((r) => {
      this.recent = r;
      this.emit();
    });
    // Opened from a share link: http://host:port/?join
    if (platform.kind === 'web' && typeof location !== 'undefined') {
      if (new URLSearchParams(location.search).has('join')) this.pendingJoin = { address: location.host };
    }
    platform.host?.onState((s) => {
      this.hostState = s;
      this.emit();
    });
    if (platform.lan) {
      try {
        this.lanVisible = localStorage.getItem('argument-mapper:lan-visible') !== 'off';
      } catch {
        /* ignore */
      }
      platform.lan.onNearby((n) => {
        this.nearby = n;
        this.emit();
      });
      platform.lan.onInvitation((inv) => {
        this.invitations = [...this.invitations.filter((i) => `${i.address}:${i.port}` !== `${inv.address}:${inv.port}`), inv].slice(-5);
        this.emit();
      });
      this.announce();
      void platform.lan.nearby().then((n) => {
        this.nearby = n;
        this.emit();
      }).catch(() => {});
    }
  }

  // ------------------------------------------------------------ store plumbing

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  emit(): void {
    this.version++;
    this.collab?.session.setPresence({ selection: this.selection, editing: this.editing?.id ?? null });
    for (const fn of this.listeners) fn();
  }

  private attach(): void {
    this.doc.ydoc.on('update', this.onDocUpdate);
  }

  /** Swap in another document (joining a shared map). */
  private replaceDoc(doc: MapDoc): void {
    this.doc.ydoc.off('update', this.onDocUpdate);
    this.doc = doc;
    this.attach();
    this.selection = [];
    this.editing = null;
    this.selectedConnection = null;
    this.history = [];
    this.layoutVersion = -1;
  }

  get layout(): LayoutResult {
    if (!this.layoutCache || this.layoutVersion === -1) {
      const theme = this.doc.theme;
      this.layoutCache = layoutMap(this.doc.all(), (n) => this.measure(n, theme), theme.density, theme.lineLabels || this.doc.all().some((n) => (n.kind === 'reason' || n.kind === 'objection') && !!n.text.trim()));
      this.layoutVersion = this.version;
    }
    return this.layoutCache;
  }

  /** Number labels for claims, per the theme's numbering mode. */
  get labels(): Map<string, string> {
    if (!this.labelCache || this.labelCache.version !== this.version) {
      const layout = this.layout;
      this.labelCache = { version: this.version, labels: computeLabels(this.doc.all(), layout, this.doc.theme.numbering) };
    }
    return this.labelCache.labels;
  }

  /** Call when fonts or styles change so sizes are measured again. */
  relayout(): void {
    this.layoutVersion = -1;
    this.emit();
  }

  get primary(): string | null {
    return this.selection.length ? this.selection[this.selection.length - 1] : null;
  }

  flash(text: string, kind: 'info' | 'error' = 'info'): void {
    this.message = { text, kind };
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.message = null;
      this.emit();
    }, kind === 'error' ? 6000 : 2500);
    this.emit();
  }

  // ------------------------------------------------------------------ file

  private markDirty(): void {
    if (!this.file.dirty) {
      this.file = { ...this.file, dirty: true };
      platform.setDirty(true);
      this.updateWindowTitle();
    }
    this.writeDraft();
    this.scheduleAutosave();
  }

  private updateWindowTitle(): void {
    platform.setTitle(`${this.file.dirty ? '• ' : ''}${this.doc.title} — Argument Mapper`);
  }

  private scheduleAutosave(): void {
    if (platform.kind !== 'desktop' || !(this.file.path || this.file.drive) || this.driveConflict) return;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.save(), 1500);
  }

  private writeDraft(): void {
    if (platform.kind !== 'web') return;
    try {
      localStorage.setItem(DRAFT_KEY, serialize(this.doc.toFile()));
    } catch {
      /* storage may be unavailable */
    }
  }

  private readDraft(): MapFile | null {
    if (platform.kind !== 'web') return null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? parseMapFile(raw) : null;
    } catch {
      return null;
    }
  }

  private clearDraft(): void {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  loadFile(file: MapFile, state?: Partial<FileState>): void {
    // Opening another map ends any sharing, so it never overwrites the shared one.
    if (this.collab) {
      const guest = this.collab.role === 'guest';
      void this.leave(false);
      if (guest) this.replaceDoc(new MapDoc());
    }
    this.doc.load(file);
    this.history = file.history ?? [];
    this.selection = [];
    this.editing = null;
    this.file = { name: `${file.title}.${FILE_EXTENSION}`, dirty: false, ...state };
    platform.setDirty(this.file.dirty);
    this.layoutVersion = -1;
    this.updateWindowTitle();
    this.emit();
    // Fit once the new layout exists.
    queueMicrotask(() => this.zoomToFit(true));
  }

  async confirmDiscard(): Promise<boolean> {
    if (!this.file.dirty) return true;
    return window.confirm('This map has unsaved changes. Discard them?');
  }

  async newMap(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.clearDraft();
    const file = newMapFile();
    this.loadFile(file);
    this.select([file.nodes[0].id]);
  }

  async open(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const opened = await platform.openFile();
    if (opened) this.openContent(opened.content, opened.name, opened.path);
  }

  async openRecent(path: string): Promise<void> {
    if (!platform.openPath || !(await this.confirmDiscard())) return;
    try {
      const opened = await platform.openPath(path);
      if (opened) this.openContent(opened.content, opened.name, opened.path);
    } catch (e) {
      this.flash(`Could not open ${path}: ${(e as Error).message}`, 'error');
    }
  }

  openContent(content: string, name: string, path?: string): void {
    try {
      const file = parseMapFile(content);
      this.clearDraft();
      this.loadFile(file, { name, path, dirty: false });
      void platform.recentFiles().then((r) => {
        this.recent = r;
        this.emit();
      });
    } catch (e) {
      this.flash((e as Error).message, 'error');
    }
  }

  private suggestedName(): string {
    const safe = this.doc.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled argument';
    return `${safe}.${FILE_EXTENSION}`;
  }

  async save(asNew = false): Promise<boolean> {
    if (this.file.drive && !asNew) return this.saveToDrive();
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.commitEditing();
    const { content, history } = this.fileContent();
    try {
      const saved = asNew || !this.file.path
        ? await platform.saveAs(content, this.file.path ? this.file.name : this.suggestedName())
        : await platform.save(content, this.file.name, this.file.path);
      if (!saved) return false;
      this.history = history;
      this.file = { name: saved.name, path: saved.path, dirty: false };
      platform.setDirty(false);
      this.clearDraft();
      this.updateWindowTitle();
      if (platform.kind === 'desktop') {
        this.recent = await platform.recentFiles();
      }
      this.emit();
      return true;
    } catch (e) {
      this.flash(`Could not save: ${(e as Error).message}`, 'error');
      return false;
    }
  }

  /** The map as file text, with a version snapshot added to its history. */
  private fileContent(): { content: string; history: Snapshot[] } {
    const current = this.doc.toFile();
    const snapshot: Snapshot = {
      savedAt: new Date().toISOString(), title: current.title, nodes: current.nodes,
      connections: current.connections, theme: current.theme,
    };
    // Keep one version per 10 minutes of work, so autosave doesn't flood the history.
    const last = this.history[0];
    const same = last && JSON.stringify([last.nodes, last.connections, last.theme, last.title]) ===
      JSON.stringify([snapshot.nodes, snapshot.connections, snapshot.theme, snapshot.title]);
    const recent = last && Date.now() - Date.parse(last.savedAt) < 10 * 60 * 1000;
    const history = same ? this.history : recent ? [snapshot, ...this.history.slice(1)] : [snapshot, ...this.history].slice(0, 25);
    return { content: serialize({ ...current, history }), history };
  }

  // ------------------------------------------------------------ Google Drive

  /** Set when Drive has a newer version than ours; autosave pauses until the user decides. */
  driveConflict = false;
  private driveSaving = false;

  /** Save to Google Drive: the current Drive file, or a new one. */
  async saveToDrive(asNew = false): Promise<boolean> {
    const drive = platform.drive;
    if (!drive) return false;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.driveSaving) {
      this.scheduleAutosave();
      return false;
    }
    this.commitEditing();
    const { content, history } = this.fileContent();
    const target = asNew ? undefined : this.file.drive;
    const name = target ? this.file.name : this.suggestedName();
    this.driveSaving = true;
    try {
      let res = await drive.save({ id: target?.id, name, content, expectedModified: target?.modifiedTime });
      if ('conflict' in res) {
        const when = new Date(res.conflict.modifiedTime).toLocaleString();
        const replace = window.confirm(
          `“${res.conflict.name}” was changed in Google Drive at ${when}, maybe on another computer.\n\n` +
            'OK: replace it with your version.\nCancel: keep both, and save your version as a new file.',
        );
        res = replace
          ? await drive.save({ id: target!.id, name, content, force: true })
          : await drive.save({ name: name.replace(/(\.amap)?$/, ' (my copy).amap'), content });
        if ('conflict' in res) throw new Error('The file keeps changing in Drive. Try again.');
      }
      this.history = history;
      this.file = { name: res.file.name, dirty: false, drive: { id: res.file.id, modifiedTime: res.file.modifiedTime } };
      this.driveConflict = false;
      platform.setDirty(false);
      this.clearDraft();
      this.updateWindowTitle();
      this.emit();
      return true;
    } catch (e) {
      this.flash(`Could not save to Google Drive: ${(e as Error).message}`, 'error');
      return false;
    } finally {
      this.driveSaving = false;
    }
  }

  /** Open a map from Google Drive. */
  async openFromDrive(id: string): Promise<boolean> {
    const drive = platform.drive;
    if (!drive || !(await this.confirmDiscard())) return false;
    try {
      const { file, content } = await drive.open(id);
      const parsed = file.name.toLowerCase().endsWith('.mup') ? importMindMup(content) : parseMapFile(content);
      this.clearDraft();
      this.loadFile(parsed, { name: file.name, drive: { id: file.id, modifiedTime: file.modifiedTime } });
      this.driveConflict = false;
      return true;
    } catch (e) {
      this.flash(`Could not open from Google Drive: ${(e as Error).message}`, 'error');
      return false;
    }
  }

  rename(title: string): void {
    const t = title.trim() || 'Untitled argument';
    if (t !== this.doc.title) {
      this.doc.title = t;
      this.updateWindowTitle();
    }
  }

  // ------------------------------------------------------------- selection

  selectConnection(id: string | null): void {
    this.commitEditing();
    this.selectedConnection = id;
    if (id) this.selection = [];
    this.emit();
  }

  select(ids: string[], additive = false): void {
    this.selectedConnection = null;
    if (additive) {
      const set = new Set(this.selection);
      for (const id of ids) {
        if (set.has(id)) set.delete(id);
        else set.add(id);
      }
      this.selection = [...set];
    } else {
      this.selection = ids.filter((id) => this.doc.has(id));
    }
    if (this.editing && !this.selection.includes(this.editing.id)) this.commitEditing();
    this.emit();
  }

  selectAll(): void {
    this.select(this.visibleIds());
  }

  clearSelection(): void {
    this.select([]);
  }

  selectSubtree(): void {
    const ids = new Set<string>();
    for (const id of this.selection) for (const s of this.doc.subtreeIds(id)) ids.add(s);
    this.select([...ids].filter((id) => this.layout.boxes.has(id)));
  }

  selectChildren(): void {
    const ids: string[] = [];
    for (const id of this.selection) {
      const n = this.doc.get(id);
      if (isClaim(n) && n!.collapsed) continue;
      ids.push(...this.doc.children(id).map((c) => c.id));
    }
    if (ids.length) this.select(ids);
  }

  selectSiblings(): void {
    const ids = new Set<string>();
    for (const id of this.selection) {
      const n = this.doc.get(id);
      if (n) for (const s of this.doc.children(n.parent)) ids.add(s.id);
    }
    this.select([...ids]);
  }

  private visibleIds(): string[] {
    return [...this.layout.boxes.keys()];
  }

  /** Move the selection to the nearest visible node in a direction. */
  navigate(dir: 'up' | 'down' | 'left' | 'right'): void {
    const boxes = this.layout.boxes;
    const cur = this.primary ? boxes.get(this.primary) : undefined;
    if (!cur) {
      const first = this.doc.roots()[0];
      if (first) this.select([first.id]);
      return;
    }
    const cx = cur.x + cur.w / 2;
    const cy = cur.y + cur.h / 2;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const b of boxes.values()) {
      if (b.id === cur.id) continue;
      const bx = b.x + b.w / 2;
      const by = b.y + b.h / 2;
      const dx = bx - cx;
      const dy = by - cy;
      let primaryDist: number;
      let cross: number;
      if (dir === 'up') {
        // Strictly above, so a premise skips the group box around it and reaches its claim.
        if (b.y + b.h > cur.y + 1) continue;
        primaryDist = -dy;
        cross = Math.abs(dx);
      } else if (dir === 'down') {
        if (b.y < cur.y + cur.h - 1) continue;
        primaryDist = dy;
        cross = Math.abs(dx);
      } else if (dir === 'left') {
        if (b.x + b.w > cur.x + 1) continue;
        primaryDist = -dx;
        cross = Math.abs(dy);
      } else {
        if (b.x < cur.x + cur.w - 1) continue;
        primaryDist = dx;
        cross = Math.abs(dy);
      }
      if (primaryDist <= 0) continue;
      const score = primaryDist + cross * 2;
      if (score < bestScore) {
        bestScore = score;
        best = b.id;
      }
    }
    if (best) {
      this.select([best]);
      this.scrollIntoView(best);
    }
  }

  // --------------------------------------------------------------- editing

  startEditing(id?: string, initial?: string): void {
    if (this.readOnly) return this.flashReadOnly();
    const target = id ?? this.primary;
    if (!target || !isTextNode(this.doc.get(target))) return;
    this.selection = [target];
    this.editing = { id: target, initial };
    this.scrollIntoView(target);
    this.emit();
  }

  /** Write on the line between a reason or objection and its claim (a premise picks its group). */
  editLineLabel(id?: string): void {
    if (this.readOnly) return this.flashReadOnly();
    let target = this.doc.get(id ?? this.primary ?? '');
    if (target?.kind === 'claim' && target.parent) target = this.doc.get(target.parent);
    if (!target || !isGroup(target)) return;
    this.commitEditing();
    this.selection = [target.id];
    this.labelEditing = target.id;
    this.emit();
  }

  finishLineLabel(text: string | null): void {
    const id = this.labelEditing;
    if (!id) return;
    this.labelEditing = null;
    if (text !== null && this.doc.has(id)) this.doc.setText(id, text.replace(/\s+/g, ' ').trim().slice(0, 60));
    this.doc.undo.stopCapturing();
    this.emit();
  }

  /** Called by the node editor with its final text. */
  finishEditing(text: string | null): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    if (text !== null && this.doc.has(ed.id)) this.doc.setText(ed.id, text.replace(/\s+$/g, ''));
    // Each edit is its own undo step.
    this.doc.undo.stopCapturing();
    this.emit();
  }

  /** Ask the open node editor (if any) to commit; the NodeView listens for this. */
  commitEditing(): void {
    if (this.editing) window.dispatchEvent(new CustomEvent('argmap:commit-edit'));
  }

  private afterInsert(id: string | null): void {
    this.doc.undo.stopCapturing();
    if (!id) return;
    this.layoutVersion = -1;
    this.startEditing(id);
  }

  private withPrimary(fn: (id: string) => string | null | void): void {
    this.commitEditing();
    const id = this.primary;
    if (!id) {
      this.flash('Select a box first.');
      return;
    }
    const result = fn(id);
    if (typeof result === 'string') this.afterInsert(result);
  }

  addReason(): void {
    if (this.readOnly) return this.flashReadOnly();
    this.withPrimary((id) => {
      const n = this.doc.get(id);
      const claim = isGroup(n) ? n!.parent! : id;
      return this.doc.addGroup(claim, 'reason')?.premiseId ?? null;
    });
  }

  addObjection(): void {
    if (this.readOnly) return this.flashReadOnly();
    this.withPrimary((id) => {
      const n = this.doc.get(id);
      const claim = isGroup(n) ? n!.parent! : id;
      return this.doc.addGroup(claim, 'objection')?.premiseId ?? null;
    });
  }

  addChild(): void {
    this.withPrimary((id) => this.doc.addChild(id));
  }

  addSibling(): void {
    this.withPrimary((id) => this.doc.addSibling(id));
  }

  addParent(): void {
    this.withPrimary((id) => {
      if (!isClaim(this.doc.get(id))) {
        this.flash('Select a claim to add a parent to.');
        return null;
      }
      return this.doc.addParent(id);
    });
  }

  addRoot(at?: { x: number; y: number }): void {
    if (this.readOnly) return this.flashReadOnly();
    this.commitEditing();
    const p = at ?? this.screenToMap(this.viewport.w / 2, this.viewport.h / 3);
    const id = this.doc.addRoot('', p.x, p.y);
    this.afterInsert(id);
  }

  toggleImplicit(): void {
    this.commitEditing();
    this.doc.toggleImplicit(this.selection);
  }

  /**
   * Make the selection a reason or an objection. A selected group changes as a whole; a
   * selected premise beside co-premises changes alone (e.g. a reason next to an objection).
   */
  convertGroup(kind: 'reason' | 'objection'): void {
    if (this.readOnly) return this.flashReadOnly();
    this.doc.transact(() => {
      for (const id of this.selection) {
        const n = this.doc.get(id);
        if (isGroup(n)) this.doc.setGroupKind(n!.id, kind);
        else if (n && isGroup(this.doc.get(n.parent))) this.doc.setPremiseStance(n.id, kind);
      }
    });
  }

  detach(): void {
    this.commitEditing();
    this.doc.transact(() => {
      for (const id of this.selection) {
        const b = this.layout.boxes.get(id);
        if (!b) continue;
        this.doc.detach(id, b.x + b.w / 2 + 40, b.y + 40);
      }
    });
  }

  resetPosition(): void {
    this.doc.resetPosition(this.selection);
  }

  deleteSelection(): void {
    if (this.selectedConnection) {
      this.doc.removeConnection(this.selectedConnection);
      this.selectedConnection = null;
      this.emit();
      return;
    }
    if (!this.selection.length) return;
    this.commitEditing();
    // Pick something sensible to select afterwards: the parent claim of the first deleted node.
    const first = this.doc.get(this.selection[0]);
    const next = first ? this.doc.parentClaim(first.id)?.id : undefined;
    this.doc.remove(this.selection);
    this.select(next && this.doc.has(next) ? [next] : []);
  }

  undo(): void {
    if (this.readOnly) return this.flashReadOnly();
    this.commitEditing();
    this.doc.undo.undo();
  }

  redo(): void {
    if (this.readOnly) return this.flashReadOnly();
    this.commitEditing();
    this.doc.undo.redo();
  }

  // -------------------------------------------------------------- folding

  toggleFold(): void {
    const claims = this.selection.filter((id) => isClaim(this.doc.get(id)) && this.doc.children(id).length);
    if (!claims.length) return;
    const anyOpen = claims.some((id) => !this.doc.get(id)!.collapsed);
    this.doc.setCollapsed(claims, anyOpen);
  }

  private foldScope(): string[] {
    const ids = new Set<string>();
    const starts = this.selection.length ? this.selection : this.doc.roots().map((r) => r.id);
    for (const id of starts) for (const s of this.doc.subtreeIds(id)) ids.add(s);
    return [...ids].filter((id) => isClaim(this.doc.get(id)) && this.doc.children(id).length > 0);
  }

  /** Fold the deepest level that is still open. */
  foldOneLevel(): void {
    const open = this.foldScope().filter((id) => this.layout.boxes.has(id) && !this.doc.get(id)!.collapsed);
    if (!open.length) return;
    const depth = Math.max(...open.map((id) => this.doc.depth(id)));
    this.doc.setCollapsed(open.filter((id) => this.doc.depth(id) === depth), true);
  }

  /** Unfold the shallowest folded level. */
  unfoldOneLevel(): void {
    const closed = this.foldScope().filter((id) => this.layout.boxes.has(id) && this.doc.get(id)!.collapsed);
    if (!closed.length) return;
    const depth = Math.min(...closed.map((id) => this.doc.depth(id)));
    this.doc.setCollapsed(closed.filter((id) => this.doc.depth(id) === depth), false);
  }

  foldAll(collapsed: boolean): void {
    const ids = this.doc.all().filter((n) => isClaim(n) && this.doc.children(n.id).length).map((n) => n.id);
    this.doc.setCollapsed(ids, collapsed);
  }

  // ------------------------------------------------------------- clipboard

  copyText(): string | null {
    if (!this.selection.length) return null;
    this.clip = this.doc.copy(this.selection);
    return CLIP_PREFIX + JSON.stringify(this.clip);
  }

  /** Plain-text outline of the copied nodes, for pasting into other apps. */
  copyPlain(): string {
    const lines: string[] = [];
    const walk = (c: ClipNode, depth: number) => {
      const label = c.kind === 'claim' ? c.text || '(empty)' : c.kind === 'reason' ? '[reason]' : '[objection]';
      lines.push(`${'  '.repeat(depth)}${label}`);
      for (const ch of c.children) walk(ch, depth + 1);
    };
    for (const c of this.clip) walk(c, 0);
    return lines.join('\n');
  }

  cut(): string | null {
    if (this.readOnly) return this.copyText();
    const text = this.copyText();
    if (text) this.deleteSelection();
    return text;
  }

  pasteText(text: string | null, asRoot = false): void {
    if (this.readOnly) return this.flashReadOnly();
    let clip: ClipNode[] | null = null;
    if (text && text.startsWith(CLIP_PREFIX)) {
      try {
        clip = JSON.parse(text.slice(CLIP_PREFIX.length));
      } catch {
        clip = null;
      }
    } else if (text && text.trim()) {
      clip = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 200)
        .map((l) => ({ kind: 'claim' as const, text: l, children: [] }));
    }
    if (!clip) clip = this.clip;
    if (!clip.length) return;
    const target = asRoot ? null : this.primary;
    const at = this.screenToMap(this.viewport.w / 2, this.viewport.h / 3);
    const ids = this.doc.paste(clip, target, at.x, at.y);
    this.select(ids);
  }

  async pasteFromMenu(asRoot = false): Promise<void> {
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = null;
    }
    this.pasteText(text, asRoot);
  }

  // ------------------------------------------------------------ drag & drop

  /** Drop `ids` at a map point: onto a target node, or nudge them by (ddx, ddy). */
  drop(ids: string[], targetId: string | null, ddx: number, ddy: number): void {
    if (this.readOnly) return this.flashReadOnly();
    if (targetId) {
      const movable = ids.filter((id) => this.doc.canMove(id, targetId));
      if (movable.length) {
        this.doc.transact(() => movable.forEach((id) => this.doc.move(id, targetId)));
        return;
      }
    }
    this.doc.transact(() => {
      for (const id of ids) {
        // Skip nodes whose ancestor is also being dragged; they move with it.
        if (ids.some((o) => o !== id && this.doc.isAncestor(o, id))) continue;
        this.doc.nudge(id, ddx, ddy);
      }
    });
  }

  // ------------------------------------------------------------------ view

  screenToMap(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.view.x) / this.view.zoom, y: (sy - this.view.y) / this.view.zoom };
  }

  setView(v: Partial<View>): void {
    this.view = { ...this.view, ...v };
    this.emit();
  }

  zoomAt(factor: number, sx = this.viewport.w / 2, sy = this.viewport.h / 2): void {
    const zoom = Math.min(4, Math.max(0.1, this.view.zoom * factor));
    const p = this.screenToMap(sx, sy);
    this.setView({ zoom, x: sx - p.x * zoom, y: sy - p.y * zoom });
  }

  zoomToFit(onlyShrink = false): void {
    const b = this.layout.bounds;
    if (!b.w) {
      this.setView({ zoom: 1, x: this.viewport.w / 2, y: 80 });
      return;
    }
    const pad = 60;
    let zoom = Math.min((this.viewport.w - pad * 2) / b.w, (this.viewport.h - pad * 2) / b.h, 2);
    if (onlyShrink) zoom = Math.min(zoom, 1);
    zoom = Math.max(0.1, zoom);
    this.setView({
      zoom,
      x: this.viewport.w / 2 - (b.x + b.w / 2) * zoom,
      y: Math.max(pad, this.viewport.h / 2 - (b.y + b.h / 2) * zoom),
    });
  }

  // ------------------------------------------------------------ presenting

  /** Claims in the order you would talk through them: each claim, then its reasons and objections, depth first. */
  private presentationSteps(): string[] {
    const kids = new Map<string | null, MapNode[]>();
    for (const n of this.doc.all()) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
    for (const l of kids.values()) l.sort((a, b) => a.order - b.order);
    const out: string[] = [];
    const visit = (c: MapNode) => {
      out.push(c.id);
      if (c.collapsed) return;
      for (const g of kids.get(c.id) ?? []) if (isGroup(g)) for (const p of kids.get(g.id) ?? []) visit(p);
    };
    const boxes = this.layout.boxes;
    const roots = (kids.get(null) ?? []).filter((n) => isClaim(n) && boxes.has(n.id));
    roots.sort((a, b) => boxes.get(a.id)!.y - boxes.get(b.id)!.y || boxes.get(a.id)!.x - boxes.get(b.id)!.x);
    roots.forEach(visit);
    return out;
  }

  /** Full screen, one claim at a time; starts at the selected claim if there is one. */
  startPresentation(): void {
    this.commitEditing();
    this.finishLineLabel(null);
    const steps = this.presentationSteps();
    if (!steps.length) return this.flash('Add a claim to present.');
    const at = this.primary ? steps.indexOf(this.primary) : -1;
    this.selection = [];
    this.find = null;
    this.presentation = { steps, index: Math.max(0, at), fullScreen: true };
    platform.setFullScreen(true);
    this.emit();
    // Let the window go full screen before framing the first claim.
    setTimeout(() => this.presentFocus(), 120);
  }

  stopPresentation(leaveFullScreen = true): void {
    const p = this.presentation;
    if (!p) return;
    this.presentation = null;
    if (p.fullScreen && leaveFullScreen) platform.setFullScreen(false);
    this.emit();
    setTimeout(() => this.zoomToFit(), 120);
  }

  presentGo(index: number): void {
    const p = this.presentation;
    if (!p) return;
    // The map may have changed meanwhile (a collaborator, an unfold): count again.
    p.steps = this.presentationSteps();
    p.index = Math.min(p.steps.length - 1, Math.max(0, index));
    this.presentFocus();
  }

  /** Jump to a claim (clicked on screen). */
  presentAt(id: string): void {
    const p = this.presentation;
    if (!p) return;
    p.steps = this.presentationSteps();
    const i = p.steps.indexOf(id);
    if (i >= 0) this.presentGo(i);
  }

  presentNext(): void {
    if (this.presentation) this.presentGo(this.presentation.index + 1);
  }

  presentPrev(): void {
    if (this.presentation) this.presentGo(this.presentation.index - 1);
  }

  /** Ids not reached yet in the presentation; they stay faint until their turn. */
  presentFuture(): Set<string> {
    const p = this.presentation;
    const out = new Set<string>();
    if (!p) return out;
    const shown = new Set(p.steps.slice(0, p.index + 1));
    for (const n of this.doc.all()) {
      if (isClaim(n) && !shown.has(n.id)) out.add(n.id);
    }
    for (const n of this.doc.all()) {
      if (!isGroup(n)) continue;
      const premises = this.doc.all().filter((c) => c.parent === n.id);
      if (!premises.some((c) => shown.has(c.id))) out.add(n.id);
    }
    return out;
  }

  /** Frame the current claim with the claim it answers and its co-premises. */
  presentFocus(): void {
    const p = this.presentation;
    if (!p) return;
    const id = p.steps[p.index];
    const boxes = this.layout.boxes;
    const n = this.doc.get(id);
    const region = [boxes.get(id)];
    const group = n?.parent ? this.doc.get(n.parent) : undefined;
    if (group) {
      region.push(boxes.get(group.id));
      if (group.parent) region.push(boxes.get(group.parent));
    }
    const bs = region.filter((b): b is NonNullable<typeof b> => !!b);
    if (!bs.length) return this.emit();
    const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y));
    const x2 = Math.max(...bs.map((b) => b.x + b.w)), y2 = Math.max(...bs.map((b) => b.y + b.h));
    const pad = 80, bar = 70;
    const zoom = Math.max(0.2, Math.min((this.viewport.w - pad * 2) / (x2 - x1), (this.viewport.h - pad * 2 - bar) / (y2 - y1), 1.5));
    this.setView({
      zoom,
      x: this.viewport.w / 2 - ((x1 + x2) / 2) * zoom,
      y: (this.viewport.h - bar) / 2 - ((y1 + y2) / 2) * zoom,
    });
  }

  recenter(): void {
    const root = this.doc.roots()[0];
    const b = root ? this.layout.boxes.get(root.id) : undefined;
    const zoom = 1;
    if (!b) return this.setView({ zoom, x: this.viewport.w / 2, y: 80 });
    this.setView({ zoom, x: this.viewport.w / 2 - (b.x + b.w / 2), y: 80 - b.y });
  }

  scrollIntoView(id: string): void {
    const b = this.layout.boxes.get(id);
    if (!b) return;
    const { zoom, x, y } = this.view;
    const sx1 = b.x * zoom + x, sy1 = b.y * zoom + y;
    const sx2 = (b.x + b.w) * zoom + x, sy2 = (b.y + b.h) * zoom + y;
    const m = 40;
    let nx = x, ny = y;
    if (sx1 < m) nx += m - sx1;
    else if (sx2 > this.viewport.w - m) nx -= sx2 - (this.viewport.w - m);
    if (sy1 < m) ny += m - sy1;
    else if (sy2 > this.viewport.h - m) ny -= sy2 - (this.viewport.h - m);
    if (nx !== x || ny !== y) this.setView({ x: nx, y: ny });
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.emit();
  }

  setDensity(d: 'compact' | 'comfortable'): void {
    this.setTheme({ density: d });
  }

  setTheme(patch: Partial<Theme>): void {
    this.doc.setTheme(patch);
    this.relayout();
  }

  setAppearance(a: 'system' | 'light' | 'dark'): void {
    this.appearance = a;
    try {
      localStorage.setItem('argument-mapper:appearance', a);
    } catch {
      /* ignore */
    }
    this.emit();
  }

  // ----------------------------------------------------------------- styles

  private styleTargets(): string[] {
    return this.selection.filter((id) => this.doc.has(id));
  }

  setStyle(patch: NodeStyle): void {
    const ids = this.styleTargets();
    if (!ids.length) return this.flash('Select a box first.');
    this.doc.setStyle(ids, patch);
    this.relayout();
  }

  /** Toggle a boolean text style on the selection, based on the primary node. */
  toggleStyle(key: 'bold' | 'italic' | 'underline' | 'strike'): void {
    const cur = this.doc.get(this.primary)?.style?.[key];
    this.setStyle({ [key]: !cur });
  }

  stepSize(dir: 1 | -1): void {
    const order: FontSize[] = ['xs', 's', 'm', 'l', 'xl'];
    const ids = this.styleTargets().filter((id) => isTextNode(this.doc.get(id)));
    this.doc.transact(() => {
      for (const id of ids) {
        const cur = this.doc.get(id)?.style?.size ?? this.doc.theme.fontSize;
        const next = order[Math.max(0, Math.min(order.length - 1, order.indexOf(cur) + dir))];
        this.doc.setStyle([id], { size: next });
      }
    });
    this.relayout();
  }

  copyStyle(): void {
    const n = this.doc.get(this.primary);
    if (!n) return;
    this.styleClip = n.style ? { ...n.style } : undefined;
    this.flash('Style copied.');
  }

  pasteStyle(): void {
    this.doc.replaceStyle(this.styleTargets(), this.styleClip);
    this.relayout();
  }

  resetStyle(): void {
    this.doc.replaceStyle(this.styleTargets(), undefined);
    this.relayout();
  }

  resetAllStyling(): void {
    this.doc.resetAllStyles();
    this.relayout();
  }

  /** Turn each line of the text into a bulleted or numbered list item (or back). */
  toggleList(kind: 'bullet' | 'number'): void {
    const ids = this.styleTargets().filter((id) => isTextNode(this.doc.get(id)));
    const strip = (l: string) => l.replace(/^\s*(•|\d+[.)])\s+/, '');
    this.doc.transact(() => {
      for (const id of ids) {
        const lines = (this.doc.get(id)!.text || '').split('\n');
        const isBullet = lines.every((l) => /^\s*•\s/.test(l));
        const isNumber = lines.every((l) => /^\s*\d+[.)]\s/.test(l));
        let next: string[];
        if ((kind === 'bullet' && isBullet) || (kind === 'number' && isNumber)) next = lines.map(strip);
        else next = lines.map((l, i) => `${kind === 'bullet' ? '•' : `${i + 1}.`} ${strip(l)}`);
        this.doc.setText(id, next.join('\n'));
      }
    });
  }

  // ---------------------------------------------------- notes, links, stickies

  toggleNotes(open = !this.notesOpen): void {
    this.notesOpen = open;
    this.emit();
    if (open) queueMicrotask(() => window.dispatchEvent(new CustomEvent('argmap:focus-note')));
  }

  editLink(): void {
    const id = this.primary;
    if (!id) return this.flash('Select a box first.');
    const cur = this.doc.get(id)?.link ?? '';
    const url = window.prompt('Link (leave empty to remove)', cur || 'https://');
    if (url === null) return;
    const clean = url.trim() === 'https://' ? '' : url.trim();
    if (clean && !/^(https?:|mailto:)/i.test(clean)) return this.flash('Links must start with http://, https:// or mailto:', 'error');
    this.doc.setLink(id, clean);
  }

  addSticky(at?: { x: number; y: number }): void {
    this.commitEditing();
    let p = at;
    if (!p) {
      const b = this.primary ? this.layout.boxes.get(this.primary) : undefined;
      p = b ? { x: b.x + b.w + 140, y: b.y } : this.screenToMap(this.viewport.w / 2, this.viewport.h / 3);
    }
    const id = this.doc.addSticky('', p.x, p.y);
    this.afterInsert(id);
  }

  /** Alt+Click: connect the selected node to another node. */
  connectTo(targetId: string): void {
    if (this.readOnly) return this.flashReadOnly();
    const from = this.primary;
    if (!from || from === targetId) return this.flash('Select a box, then Alt+Click another box to connect them.');
    const id = this.doc.addConnection(from, targetId);
    if (!id) return this.flash('These boxes are already connected.');
    this.selectConnection(id);
  }

  // ------------------------------------------------------------------- find

  openFind(): void {
    this.find = this.find ?? { query: '', matches: [], index: 0 };
    this.emit();
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('argmap:focus-find')));
  }

  closeFind(): void {
    this.find = null;
    this.emit();
  }

  runFind(query: string, jump = true): void {
    const q = query.trim().toLocaleLowerCase();
    const matches = q
      ? this.doc.all()
          .filter((n) => isTextNode(n) && `${n.text}\n${n.note ?? ''}`.toLocaleLowerCase().includes(q))
          .sort((a, b) => {
            const ba = this.layout.boxes.get(a.id), bb = this.layout.boxes.get(b.id);
            return (ba?.y ?? 0) - (bb?.y ?? 0) || (ba?.x ?? 0) - (bb?.x ?? 0);
          })
          .map((n) => n.id)
      : [];
    this.find = { query, matches, index: 0 };
    if (jump && matches.length) this.revealMatch(0);
    else this.emit();
  }

  findStep(dir: 1 | -1): void {
    if (!this.find || !this.find.matches.length) return;
    const n = this.find.matches.length;
    this.revealMatch((this.find.index + dir + n) % n);
  }

  private revealMatch(i: number): void {
    if (!this.find) return;
    this.find.index = i;
    const id = this.find.matches[i];
    // Unfold collapsed ancestors so the match is visible.
    const fold: string[] = [];
    let cur = this.doc.get(this.doc.get(id)?.parent);
    while (cur) {
      if (cur.collapsed) fold.push(cur.id);
      cur = this.doc.get(cur.parent);
    }
    if (fold.length) this.doc.setCollapsed(fold, false);
    this.selection = [id];
    this.scrollIntoView(id);
    this.emit();
  }

  // ------------------------------------------------------- import / export

  restoreVersion(index: number): void {
    const snap = this.history[index];
    if (!snap) return;
    this.commitEditing();
    this.doc.restore(snap);
    this.selection = [];
    this.relayout();
    this.flash(`Restored the version from ${new Date(snap.savedAt).toLocaleString()}. Undo to go back.`);
  }

  async importMindMupFile(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mup,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const file = importMindMup(await f.text());
        this.loadFile(file, { name: `${file.title}.amap`, dirty: true });
        this.flash(`Imported ${f.name}.`);
      } catch (e) {
        this.flash((e as Error).message, 'error');
      }
    };
    input.click();
  }

  private baseName(): string {
    return this.doc.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Argument map';
  }

  tidyPreview(id:string) {
    const ids=new Set(this.doc.subtreeIds(id).filter(k=>k!==id));
    const nodes=this.doc.all().map(n=>ids.has(n.id)?{...n,dx:undefined,dy:undefined}:n);
    const t=this.doc.theme;
    const plan=layoutMap(nodes,n=>this.measure(n,t),t.density,t.lineLabels||nodes.some(n=>(n.kind==='reason'||n.kind==='objection')&&!!n.text.trim()));
    return [...plan.boxes.values()].filter(b=>ids.has(b.id)).filter(b=>{const old=this.layout.boxes.get(b.id);return old&&(b.x!==old.x||b.y!==old.y);});
  }

  async exportSelection(kind:'svg'|'png',includeEnds:boolean,copy:boolean) {
    try {
      const layout=selectedLayout(this.layout,this.selection,this.doc.allConnections(),includeEnds);
      const {svg,width,height}=await this.svg(true,layout,false);
      const bytes=kind==='svg'?new TextEncoder().encode(svg):await svgToPng(svg,width,height);
      const type=kind==='svg'?'image/svg+xml':'image/png';
      const blob=new Blob([new Uint8Array(bytes)],{type});
      if(copy){
        if(!navigator.clipboard?.write || typeof ClipboardItem==='undefined')throw Error('Clipboard unavailable. Choose Save image.');
        await navigator.clipboard.write([new ClipboardItem({[type]:blob})]);
        this.flash('Selection copied.');
      }else await platform.exportFile(this.baseName()+'-selection.'+kind,bytes,{name:kind.toUpperCase()+' image',extensions:[kind]});
    }catch(error){this.flash((error as Error).message,'error');}
  }

  private async svg(embedFonts: boolean,layout=this.layout,background=true) {
    const canvas = document.querySelector('.canvas') ?? document.documentElement;
    return buildSvg({
      nodes: this.doc.all(),
      layout,
      background,
      theme: this.doc.theme,
      labels: this.labels,
      connections: this.doc.allConnections(),
      colors: readColors(canvas),
      title: this.doc.title,
      embedFonts,
    });
  }

  async exportAs(kind: 'png' | 'svg' | 'pdf' | 'md' | 'txt'): Promise<void> {
    this.commitEditing();
    try {
      let saved: { name: string } | null = null;
      const base = this.baseName();
      if (kind === 'png') {
        const { svg, width, height } = await this.svg(true);
        const png = await svgToPng(svg, width, height, 2);
        saved = await platform.exportFile(`${base}.png`, png, { name: 'PNG image', extensions: ['png'] });
      } else if (kind === 'svg') {
        const { svg } = await this.svg(true);
        saved = await platform.exportFile(`${base}.svg`, svg, { name: 'SVG image', extensions: ['svg'] });
      } else if (kind === 'pdf') {
        const { svg, width, height } = await this.svg(true);
        saved = await platform.exportPdf(svg, width, height, `${base}.pdf`);
      } else if (kind === 'md') {
        saved = await platform.exportFile(`${base}.md`, toMarkdown(this.doc.title, this.doc.all()), { name: 'Markdown', extensions: ['md'] });
      } else {
        saved = await platform.exportFile(`${base}.txt`, toPlainText(this.doc.title, this.doc.all()), { name: 'Text', extensions: ['txt'] });
      }
      if (saved && platform.kind === 'desktop') this.flash(`Exported ${saved.name}.`);
    } catch (e) {
      this.flash(`Export failed: ${(e as Error).message}`, 'error');
    }
  }

  async exportNotes(): Promise<void> {
    const md = [`# Notes: ${this.doc.title}`, ''];
    for (const n of this.doc.all().filter((x) => x.note)) md.push(`## ${n.text || '(untitled box)'}`, '', n.note!, '');
    await platform.exportFile(`${this.baseName()} notes.md`, md.join('\n'), { name: 'Markdown', extensions: ['md'] });
  }

  // ------------------------------------------------------------ collaboration

  /** Resize a sticky note (from its bottom-right corner). */
  resizeSticky(id: string, w: number, h: number): void {
    if (this.readOnly) return this.flashReadOnly();
    this.doc.undo.stopCapturing();
    this.doc.resizeSticky(id, w, h);
    this.doc.undo.stopCapturing();
  }

  setTool(tool: 'select' | 'pan'): void {
    this.tool = tool;
    this.emit();
  }

  get readOnly(): boolean {
    return !!this.collab?.readOnly;
  }

  private flashReadOnly(): void {
    this.flash('This map is shared with you as view only.');
  }

  get peers(): Peer[] {
    return this.collab?.session.peers() ?? [];
  }

  setUser(user: PeerUser): void {
    this.user = { name: user.name.trim().slice(0, 40) || 'Guest', color: user.color };
    saveUser(this.user);
    this.collab?.session.setPresence({ user: this.user });
    this.announce();
    this.emit();
  }

  /** Tell the network who we are (or that we'd rather not be seen). */
  private announce(): void {
    if (!platform.lan) return;
    void platform.lan
      .setMe({
        name: this.user?.name ?? '',
        color: this.user?.color ?? '',
        deviceId: deviceIdentity().deviceId,
        visible: this.lanVisible && !!this.user,
      })
      .catch(() => {});
  }

  setLanVisible(visible: boolean): void {
    this.lanVisible = visible;
    try {
      localStorage.setItem('argument-mapper:lan-visible', visible ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    this.announce();
    this.emit();
  }

  /** The host invites someone they can see on the network. */
  async inviteNearby(deviceId: string, role: Role): Promise<void> {
    if (!platform.lan || !this.user) return;
    const who = this.nearby.people.find((p) => p.deviceId === deviceId);
    await platform.lan.invite(deviceId, role, { name: this.user.name, color: this.user.color });
    this.flash(`Invitation sent${who ? ` to ${who.name}` : ''}.`);
  }

  /** Accept an invitation: join straight away, no waiting for the host. */
  async acceptInvitation(id: string): Promise<boolean> {
    const inv = this.invitations.find((i) => i.id === id);
    if (!inv) return false;
    this.dismissInvitation(id);
    try {
      return await this.join(`${inv.address}:${inv.port}`, inv.role, inv.invite);
    } catch (e) {
      this.flash((e as Error).message, 'error');
      return false;
    }
  }

  dismissInvitation(id: string): void {
    this.invitations = this.invitations.filter((i) => i.id !== id);
    this.emit();
  }

  private cursorSent = 0;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  /** Share the mouse position (map units) with collaborators, at most 20 times a second. */
  setCursor(p: { x: number; y: number } | null): void {
    if (!this.collab) return;
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = null;
    const send = () => {
      this.cursorSent = Date.now();
      this.collab?.session.setPresence({ cursor: p ? { x: Math.round(p.x), y: Math.round(p.y) } : null });
    };
    const wait = 50 - (Date.now() - this.cursorSent);
    if (!p || wait <= 0) send();
    else this.cursorTimer = setTimeout(send, wait);
  }

  /** Start sharing this map on the local network (desktop only). */
  async startHosting(): Promise<void> {
    if (!this.user) throw new Error('Enter your name first.');
    if (this.collab) return;
    const host = await platform.hostStart(this.doc.title, this.user.name);
    const session = new CollabSession(`ws://127.0.0.1:${host.port}`, host.hostTicket, this.doc.ydoc, this.user, () => this.emit());
    const addr = host.addresses[0] ?? '127.0.0.1';
    this.collab = { role: 'host', readOnly: false, session, host, httpBase: `http://${addr}:${host.port}` };
    this.emit();
  }

  /** The host lets someone in (for this sharing session, or always), or turns them away. */
  async answerRequest(id: string, answer: 'once' | 'always' | 'deny', role: Role): Promise<void> {
    const h = platform.host;
    if (!h) return;
    if (answer === 'deny') await h.deny(id);
    else await h.approve(id, role, answer === 'always');
  }

  /**
   * Ask to join a map someone is sharing, as an editor or a viewer, and wait until
   * the host lets us in. Resolves false if we stopped waiting.
   */
  async join(address: string, want: Role = 'edit', invite?: string): Promise<boolean> {
    if (!this.user) throw new Error('Enter your name first.');
    if (this.joining) return false;
    const { httpBase, wsBase } = parseAddress(address);
    const abort = new AbortController();
    this.joining = { address, want, waiting: false, abort };
    this.emit();
    let admitted;
    try {
      admitted = await requestAccess(httpBase, { ...this.user, want }, {
        signal: abort.signal,
        invite,
        onWaiting: () => {
          if (this.joining) this.joining.waiting = true;
          this.emit();
        },
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
      throw e;
    } finally {
      this.joining = null;
      this.emit();
    }
    if (!(await this.confirmDiscard())) return false;
    await this.leave(false);
    this.clearDraft();
    const doc = new MapDoc();
    this.replaceDoc(doc);
    // The host may give us another colour so everyone's cursor looks different.
    const me = { ...this.user, color: admitted.color };
    let wasConnected = false;
    const session: CollabSession = new CollabSession(
      wsBase,
      admitted.ticket,
      doc.ydoc,
      me,
      () => {
        if (session.status === 'connected' && !wasConnected) {
          wasConnected = true;
        } else if (session.status !== 'connected' && wasConnected && this.collab?.session === session) {
          wasConnected = false;
          this.flash('Lost the connection to the host. Your changes are kept and will sync when it is back.', 'error');
        }
        this.emit();
      },
      (msg) => this.onHostMessage(session, msg),
    );
    this.collab = { role: 'guest', readOnly: admitted.role === 'view', session, httpBase };
    this.file = { name: 'Shared map', dirty: false };
    platform.setDirty(false);
    this.pendingJoin = null;
    this.emit();
    // Fit the map once the first sync arrives.
    const fit = (synced: boolean) => {
      if (!synced) return;
      session.provider.off('sync', fit);
      this.layoutVersion = -1;
      this.zoomToFit(true);
      this.updateWindowTitle();
    };
    session.provider.on('sync', fit);
    return true;
  }

  /** Stop waiting for the host to answer a join request. */
  cancelJoin(): void {
    this.joining?.abort.abort();
  }

  private onHostMessage(session: CollabSession, msg: ControlMessage): void {
    const c = this.collab;
    if (!c || c.session !== session) return;
    if (msg.type === 'removed') {
      void this.leave(false).then(() => this.flash('The host removed you from the shared map. Your copy is still here.', 'error'));
    } else if (msg.type === 'role') {
      const readOnly = msg.role === 'view';
      if (readOnly === c.readOnly) return;
      c.readOnly = readOnly;
      if (readOnly) this.commitEditing();
      this.flash(readOnly ? 'The host changed your access to view only.' : 'The host lets you edit this map now.');
      this.emit();
    }
  }

  /** Stop sharing (host) or leave (guest). A guest keeps a local, unsaved copy. */
  async leave(notify = true): Promise<void> {
    const c = this.collab;
    if (!c) return;
    this.collab = null;
    c.session.destroy();
    if (c.role === 'host') {
      this.hostState = null;
      await platform.hostStop();
      if (notify) this.flash('Stopped sharing.');
    } else {
      this.file = { name: `${this.doc.title}.amap`, dirty: true };
      platform.setDirty(true);
      if (notify) this.flash('You left the shared map. Your copy is still here; save it to keep it.');
    }
    this.emit();
  }

  // ----------------------------------------------------- comments, reactions

  private get authorName(): string {
    return this.user?.name ?? 'Me';
  }

  addComment(nodeId: string, text: string): void {
    this.doc.addComment(nodeId, this.authorName, text, this.user?.color);
  }

  toggleReaction(nodeId: string, emoji: string): void {
    this.doc.toggleReaction(nodeId, emoji, this.authorName);
  }

  toggleComments(): void {
    this.showComments = !this.showComments;
    this.emit();
  }
}
