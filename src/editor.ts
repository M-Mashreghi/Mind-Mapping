import { ClipNode, MapDoc, newMapFile } from './model/doc';
import { MapFile, MapNode, NodeStyle, Theme, FontSize, isClaim, isGroup, isTextNode } from './model/types';
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
  }

  // ------------------------------------------------------------ store plumbing

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private attach(): void {
    this.doc.ydoc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin !== 'load') this.markDirty();
      this.layoutVersion = -1;
      // Drop selection entries that no longer exist (e.g. after undo).
      this.selection = this.selection.filter((id) => this.doc.has(id));
      if (this.selectedConnection && !this.doc.connections.has(this.selectedConnection)) this.selectedConnection = null;
      if (this.find) this.runFind(this.find.query, false);
      if (this.editing && !this.doc.has(this.editing.id)) this.editing = null;
      this.emit();
    });
  }

  get layout(): LayoutResult {
    if (!this.layoutCache || this.layoutVersion === -1) {
      const theme = this.doc.theme;
      this.layoutCache = layoutMap(this.doc.all(), (n) => this.measure(n, theme), theme.density);
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
    if (platform.kind !== 'desktop' || !this.file.path) return;
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
    this.doc.load(file);
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
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.commitEditing();
    const content = serialize(this.doc.toFile());
    try {
      const saved = asNew || !this.file.path
        ? await platform.saveAs(content, this.file.path ? this.file.name : this.suggestedName())
        : await platform.save(content, this.file.name, this.file.path);
      if (!saved) return false;
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
    const target = id ?? this.primary;
    if (!target || !isTextNode(this.doc.get(target))) return;
    this.selection = [target];
    this.editing = { id: target, initial };
    this.scrollIntoView(target);
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
    this.withPrimary((id) => {
      const n = this.doc.get(id);
      const claim = isGroup(n) ? n!.parent! : id;
      return this.doc.addGroup(claim, 'reason')?.premiseId ?? null;
    });
  }

  addObjection(): void {
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
    this.commitEditing();
    const p = at ?? this.screenToMap(this.viewport.w / 2, this.viewport.h / 3);
    const id = this.doc.addRoot('', p.x, p.y);
    this.afterInsert(id);
  }

  toggleImplicit(): void {
    this.commitEditing();
    this.doc.toggleImplicit(this.selection);
  }

  convertGroup(kind: 'reason' | 'objection'): void {
    this.doc.transact(() => {
      for (const id of this.selection) {
        const n = this.doc.get(id);
        const g = isGroup(n) ? n : this.doc.get(n?.parent);
        if (g && isGroup(g)) this.doc.setGroupKind(g.id, kind);
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
    this.commitEditing();
    this.doc.undo.undo();
  }

  redo(): void {
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
    const text = this.copyText();
    if (text) this.deleteSelection();
    return text;
  }

  pasteText(text: string | null, asRoot = false): void {
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
}
