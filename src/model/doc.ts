import * as Y from 'yjs';
import { MapFile, MapNode, GroupKind, isClaim, isGroup } from './types';

type YNode = Y.Map<unknown>;

let idCounter = 0;
export function newId(): string {
  idCounter = (idCounter + 1) % 1e6;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

const NODE_FIELDS: (keyof MapNode)[] = [
  'id', 'kind', 'parent', 'order', 'text', 'implicit', 'collapsed', 'x', 'y', 'dx', 'dy',
];

/**
 * The argument map document. All state lives in a Yjs document so the same
 * model serves single-user editing, undo/redo and (later) live collaboration.
 */
export class MapDoc {
  readonly ydoc: Y.Doc;
  readonly nodes: Y.Map<YNode>;
  readonly meta: Y.Map<unknown>;
  readonly undo: Y.UndoManager;

  constructor(ydoc: Y.Doc = new Y.Doc()) {
    this.ydoc = ydoc;
    this.nodes = ydoc.getMap<YNode>('nodes');
    this.meta = ydoc.getMap('meta');
    this.undo = new Y.UndoManager([this.nodes, this.meta], { captureTimeout: 0 });
    this.undo.addTrackedOrigin(this);
  }

  // ---------------------------------------------------------------- reading

  get(id: string | null | undefined): MapNode | undefined {
    if (!id) return undefined;
    const y = this.nodes.get(id);
    return y ? (y.toJSON() as MapNode) : undefined;
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  all(): MapNode[] {
    const out: MapNode[] = [];
    this.nodes.forEach((y) => out.push(y.toJSON() as MapNode));
    return out;
  }

  get title(): string {
    return (this.meta.get('title') as string) ?? 'Untitled argument';
  }

  set title(value: string) {
    this.meta.set('title', value);
  }

  children(id: string | null): MapNode[] {
    return this.all()
      .filter((n) => n.parent === id)
      .sort((a, b) => a.order - b.order);
  }

  roots(): MapNode[] {
    return this.children(null);
  }

  /** The id and every descendant id. */
  subtreeIds(id: string): string[] {
    const byParent = this.indexByParent();
    const out: string[] = [];
    const walk = (nid: string) => {
      out.push(nid);
      for (const c of byParent.get(nid) ?? []) walk(c.id);
    };
    if (this.has(id)) walk(id);
    return out;
  }

  isAncestor(ancestor: string, id: string): boolean {
    let cur = this.get(id);
    while (cur) {
      if (cur.id === ancestor) return true;
      cur = this.get(cur.parent);
    }
    return false;
  }

  /** The claim a node supports or opposes (for a claim, the claim above its group). */
  parentClaim(id: string): MapNode | undefined {
    const n = this.get(id);
    if (!n) return undefined;
    if (isGroup(n)) return this.get(n.parent);
    const g = this.get(n.parent);
    return g ? this.get(g.parent) : undefined;
  }

  depth(id: string): number {
    let d = 0;
    let cur = this.get(id);
    while (cur && cur.parent) {
      cur = this.get(cur.parent);
      d++;
    }
    return d;
  }

  indexByParent(): Map<string | null, MapNode[]> {
    const map = new Map<string | null, MapNode[]>();
    for (const n of this.all()) {
      const list = map.get(n.parent) ?? [];
      list.push(n);
      map.set(n.parent, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }

  // ---------------------------------------------------------------- writing

  transact<T>(fn: () => T): T {
    let result!: T;
    this.ydoc.transact(() => {
      result = fn();
    }, this);
    return result;
  }

  private put(node: MapNode): void {
    const y = new Y.Map<unknown>();
    for (const key of NODE_FIELDS) {
      const v = node[key];
      if (v !== undefined) y.set(key, v);
    }
    this.nodes.set(node.id, y);
  }

  update(id: string, patch: Partial<Omit<MapNode, 'id'>>): void {
    const y = this.nodes.get(id);
    if (!y) return;
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) y.delete(k);
        else if (y.get(k) !== v) y.set(k, v);
      }
    });
  }

  private orderAfter(parent: string | null, afterId?: string | null): number {
    const sibs = this.children(parent);
    if (!sibs.length) return 1;
    if (!afterId) return sibs[sibs.length - 1].order + 1;
    const i = sibs.findIndex((s) => s.id === afterId);
    if (i < 0 || i === sibs.length - 1) return sibs[sibs.length - 1].order + 1;
    return (sibs[i].order + sibs[i + 1].order) / 2;
  }

  addRoot(text = '', x = 0, y = 0): string {
    const id = newId();
    this.transact(() => this.put({ id, kind: 'claim', parent: null, order: this.orderAfter(null), text, x, y }));
    return id;
  }

  /** Add a reason or objection to a claim, with one empty premise. */
  addGroup(claimId: string, kind: GroupKind, text = ''): { groupId: string; premiseId: string } | null {
    const claim = this.get(claimId);
    if (!isClaim(claim)) return null;
    const groupId = newId();
    const premiseId = newId();
    this.transact(() => {
      this.put({ id: groupId, kind, parent: claimId, order: this.orderAfter(claimId), text: '' });
      this.put({ id: premiseId, kind: 'claim', parent: groupId, order: 1, text });
      if (claim!.collapsed) this.update(claimId, { collapsed: undefined });
    });
    return { groupId, premiseId };
  }

  /** Add a co-premise to a group (after `afterId` if given). */
  addPremise(groupId: string, afterId?: string, text = ''): string | null {
    if (!isGroup(this.get(groupId))) return null;
    const id = newId();
    this.transact(() => this.put({ id, kind: 'claim', parent: groupId, order: this.orderAfter(groupId, afterId), text }));
    return id;
  }

  /**
   * "Child claim" (Enter): on a claim adds a supporting reason, on a group adds a co-premise.
   * Returns the id of the claim to edit.
   */
  addChild(id: string): string | null {
    const n = this.get(id);
    if (isGroup(n)) return this.addPremise(id);
    if (isClaim(n)) return this.addGroup(id, 'reason')?.premiseId ?? null;
    return null;
  }

  /** "Sibling claim" (Tab): a co-premise next to a premise, or a new root next to a root. */
  addSibling(id: string): string | null {
    const n = this.get(id);
    if (!n) return null;
    if (isGroup(n)) {
      const claimId = n.parent!;
      return this.addGroup(claimId, n.kind as GroupKind)?.premiseId ?? null;
    }
    if (n.parent === null) {
      return this.addRoot('', (n.x ?? 0) + 320, n.y ?? 0);
    }
    return this.addPremise(n.parent, n.id);
  }

  /** "Parent node" (Shift+Enter): insert a new claim that the selected claim supports. */
  addParent(id: string): string | null {
    const n = this.get(id);
    if (!isClaim(n)) return null;
    const newClaim = newId();
    const group = newId();
    this.transact(() => {
      if (n!.parent === null) {
        this.put({ id: newClaim, kind: 'claim', parent: null, order: n!.order, text: '', x: n!.x, y: n!.y });
        this.put({ id: group, kind: 'reason', parent: newClaim, order: 1, text: '' });
        this.update(n!.id, { parent: group, order: 1, x: undefined, y: undefined, dx: undefined, dy: undefined });
      } else {
        this.put({ id: newClaim, kind: 'claim', parent: n!.parent, order: n!.order, text: '' });
        this.put({ id: group, kind: 'reason', parent: newClaim, order: 1, text: '' });
        this.update(n!.id, { parent: group, order: 1, dx: undefined, dy: undefined });
      }
    });
    return newClaim;
  }

  setText(id: string, text: string): void {
    if (this.get(id)?.text !== text) this.update(id, { text });
  }

  toggleImplicit(ids: string[]): void {
    this.transact(() => {
      for (const id of ids) {
        const n = this.get(id);
        if (isClaim(n)) this.update(id, { implicit: n!.implicit ? undefined : true });
      }
    });
  }

  setCollapsed(ids: string[], collapsed: boolean): void {
    this.transact(() => {
      for (const id of ids) {
        const n = this.get(id);
        if (isClaim(n) && this.children(id).length) this.update(id, { collapsed: collapsed || undefined });
      }
    });
  }

  /** Switch a group between reason and objection. */
  setGroupKind(id: string, kind: GroupKind): void {
    if (isGroup(this.get(id))) this.update(id, { kind });
  }

  setRootPosition(id: string, x: number, y: number): void {
    this.update(id, { x: Math.round(x), y: Math.round(y) });
  }

  nudge(id: string, ddx: number, ddy: number): void {
    const n = this.get(id);
    if (!n) return;
    if (n.parent === null) {
      this.setRootPosition(id, (n.x ?? 0) + ddx, (n.y ?? 0) + ddy);
    } else {
      this.update(id, { dx: Math.round((n.dx ?? 0) + ddx), dy: Math.round((n.dy ?? 0) + ddy) });
    }
  }

  resetPosition(ids: string[]): void {
    this.transact(() => {
      for (const id of ids) this.update(id, { dx: undefined, dy: undefined });
    });
  }

  /** Remove the nodes and everything below them; empty groups left behind go too. */
  remove(ids: string[]): void {
    this.transact(() => {
      const touchedGroups = new Set<string>();
      for (const id of ids) {
        const n = this.get(id);
        if (!n) continue;
        if (n.parent && isGroup(this.get(n.parent))) touchedGroups.add(n.parent);
        for (const sid of this.subtreeIds(id)) this.nodes.delete(sid);
      }
      for (const g of touchedGroups) this.dropEmptyGroup(g);
    });
  }

  private dropEmptyGroup(groupId: string): void {
    if (this.has(groupId) && this.children(groupId).length === 0) this.nodes.delete(groupId);
  }

  /** Detach a premise so it becomes a free-standing root at (x, y). */
  detach(id: string, x: number, y: number): boolean {
    const n = this.get(id);
    if (!isClaim(n) || n!.parent === null) return false;
    const oldGroup = n!.parent;
    this.transact(() => {
      this.update(id, { parent: null, order: this.orderAfter(null), x: Math.round(x), y: Math.round(y), dx: undefined, dy: undefined });
      this.dropEmptyGroup(oldGroup);
    });
    return true;
  }

  canMove(id: string, targetId: string): boolean {
    const n = this.get(id);
    const t = this.get(targetId);
    if (!n || !t || id === targetId) return false;
    if (this.isAncestor(id, targetId)) return false;
    if (isClaim(n)) return isClaim(t) || isGroup(t);
    if (isGroup(n)) return isClaim(t) && n.parent !== targetId;
    return false;
  }

  /**
   * Move a node onto a target: a claim dropped on a claim becomes a new reason for it,
   * a claim dropped on a group becomes a co-premise, a group dropped on a claim moves there.
   */
  move(id: string, targetId: string): boolean {
    if (!this.canMove(id, targetId)) return false;
    const n = this.get(id)!;
    const t = this.get(targetId)!;
    const oldParent = n.parent;
    this.transact(() => {
      const reset = { x: undefined, y: undefined, dx: undefined, dy: undefined };
      if (isGroup(n)) {
        this.update(id, { parent: targetId, order: this.orderAfter(targetId), ...reset });
      } else if (isGroup(t)) {
        this.update(id, { parent: targetId, order: this.orderAfter(targetId), ...reset });
      } else {
        const group = newId();
        this.put({ id: group, kind: 'reason', parent: targetId, order: this.orderAfter(targetId), text: '' });
        this.update(id, { parent: group, order: 1, ...reset });
      }
      if (t.collapsed) this.update(targetId, { collapsed: undefined });
      if (oldParent && isGroup(this.get(oldParent))) this.dropEmptyGroup(oldParent);
    });
    return true;
  }

  // ------------------------------------------------------------- clipboard

  /** Serialise the selected subtrees (dropping any selected node already inside another). */
  copy(ids: string[]): ClipNode[] {
    const top = ids.filter((id) => !ids.some((o) => o !== id && this.isAncestor(o, id)));
    const byParent = this.indexByParent();
    const build = (n: MapNode): ClipNode => ({
      kind: n.kind,
      text: n.text,
      implicit: n.implicit,
      collapsed: n.collapsed,
      children: (byParent.get(n.id) ?? []).map(build),
    });
    return top.map((id) => this.get(id)).filter((n): n is MapNode => !!n).map(build);
  }

  /**
   * Paste clipboard nodes. With a target, claims are added as reasons of a target
   * claim (or co-premises of a target group) and groups go under a target claim.
   * Without a target, claims become roots around (x, y).
   * Returns the ids of the pasted top-level nodes.
   */
  paste(clip: ClipNode[], targetId: string | null, x = 0, y = 0): string[] {
    const out: string[] = [];
    const target = this.get(targetId);
    const insert = (c: ClipNode, parent: string | null, extra: Partial<MapNode> = {}): string => {
      const id = newId();
      this.put({
        id, kind: c.kind, parent, order: this.orderAfter(parent), text: c.text ?? '',
        implicit: c.implicit || undefined, collapsed: c.collapsed || undefined, ...extra,
      });
      for (const ch of c.children ?? []) insert(ch, id);
      return id;
    };
    this.transact(() => {
      let offset = 0;
      for (const c of clip) {
        if (c.kind === 'claim') {
          if (isGroup(target)) out.push(insert(c, target!.id));
          else if (isClaim(target)) {
            const g = newId();
            this.put({ id: g, kind: 'reason', parent: target!.id, order: this.orderAfter(target!.id), text: '' });
            out.push(insert(c, g));
          } else {
            out.push(insert(c, null, { x: Math.round(x + offset), y: Math.round(y) }));
            offset += 320;
          }
        } else {
          // A group needs a claim above it.
          let claimId: string | null = null;
          if (isClaim(target)) claimId = target!.id;
          else if (isGroup(target)) claimId = target!.parent;
          if (!claimId) {
            claimId = insert({ kind: 'claim', text: '', children: [] }, null, { x: Math.round(x + offset), y: Math.round(y) });
            offset += 320;
          }
          out.push(insert(c, claimId));
        }
      }
      if (isClaim(target) && target!.collapsed) this.update(target!.id, { collapsed: undefined });
    });
    return out;
  }

  // --------------------------------------------------------- serialisation

  toFile(): MapFile {
    return {
      format: 'argument-mapper',
      version: 1,
      title: this.title,
      nodes: this.all().sort((a, b) => (a.parent ?? '').localeCompare(b.parent ?? '') || a.order - b.order),
    };
  }

  /** Replace the whole document with the contents of a file (not undoable). */
  load(file: MapFile): void {
    this.ydoc.transact(() => {
      this.nodes.clear();
      this.meta.clear();
      this.meta.set('title', file.title || 'Untitled argument');
      for (const n of file.nodes) this.put(n);
    }, 'load');
    this.undo.clear();
  }
}

export interface ClipNode {
  kind: MapNode['kind'];
  text: string;
  implicit?: boolean;
  collapsed?: boolean;
  children: ClipNode[];
}

export function newMapFile(title = 'Untitled argument'): MapFile {
  return {
    format: 'argument-mapper',
    version: 1,
    title,
    nodes: [{ id: newId(), kind: 'claim', parent: null, order: 1, text: 'Main claim', x: 0, y: 0 }],
  };
}
