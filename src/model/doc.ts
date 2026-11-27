import * as Y from 'yjs';
import { Comment, Reaction, Connection, DEFAULT_THEME, MapFile, MapNode, GroupKind, NodeStyle, Theme, isClaim, isGroup, STICKY, stanceOf, stickyW } from './types';

type YNode = Y.Map<unknown>;

let idCounter = 0;
export function newId(): string {
  idCounter = (idCounter + 1) % 1e6;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

const NODE_FIELDS: (keyof MapNode)[] = [
  'id', 'kind', 'parent', 'order', 'text', 'implicit', 'collapsed', 'x', 'y', 'dx', 'dy', 'connector', 'style', 'note', 'link', 'w', 'h', 'stance', 'evidence', 'questions', 'review', 'sharedClaim', 'tray', 'passage', 'excerpt', 'challengesInference',
];

/**
 * The argument map document. All state lives in a Yjs document so the same
 * model serves single-user editing, undo/redo and (later) live collaboration.
 */
export class MapDoc {
  readonly ydoc: Y.Doc;
  readonly nodes: Y.Map<YNode>;
  readonly meta: Y.Map<unknown>;
  readonly connections: Y.Map<Connection>;
  /** Comments and reactions are social, so they are kept out of undo. */
  readonly comments: Y.Map<Comment>;
  readonly reactions: Y.Map<Reaction>;
  readonly undo: Y.UndoManager;

  constructor(ydoc: Y.Doc = new Y.Doc()) {
    this.ydoc = ydoc;
    this.nodes = ydoc.getMap<YNode>('nodes');
    this.meta = ydoc.getMap('meta');
    this.connections = ydoc.getMap<Connection>('connections');
    this.comments = ydoc.getMap<Comment>('comments');
    this.reactions = ydoc.getMap<Reaction>('reactions');
    this.undo = new Y.UndoManager([this.nodes, this.meta, this.connections], { captureTimeout: 0 });
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

  get theme(): Theme {
    const t = (this.meta.get('theme') as Partial<Theme> | undefined) ?? {};
    return {
      ...DEFAULT_THEME,
      ...t,
      reason: { ...DEFAULT_THEME.reason, ...t.reason },
      objection: { ...DEFAULT_THEME.objection, ...t.objection },
      root: { ...DEFAULT_THEME.root, ...t.root },
    };
  }

  setTheme(patch: Partial<Theme>): void {
    const cur = (this.meta.get('theme') as Partial<Theme> | undefined) ?? {};
    this.transact(() => this.meta.set('theme', { ...cur, ...patch }));
  }

  resetTheme(): void {
    this.transact(() => this.meta.delete('theme'));
  }

  allConnections(): Connection[] {
    const out: Connection[] = [];
    this.connections.forEach((c) => out.push(c));
    return out;
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

  addSticky(text = '', x = 0, y = 0): string {
    const id = newId();
    this.transact(() => this.put({ id, kind: 'sticky', parent: null, order: this.orderAfter(null), text, x: Math.round(x), y: Math.round(y) }));
    return id;
  }

  /** Merge style changes into nodes; `undefined` values clear that property. */
  setStyle(ids: string[], patch: NodeStyle): void {
    this.transact(() => {
      for (const id of ids) {
        const n = this.get(id);
        if (!n) continue;
        const next: Record<string, unknown> = { ...(n.style ?? {}) };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === false || v === '') delete next[k];
          else next[k] = v;
        }
        this.update(id, { style: Object.keys(next).length ? (next as NodeStyle) : undefined });
      }
    });
  }

  replaceStyle(ids: string[], style: NodeStyle | undefined): void {
    this.transact(() => {
      for (const id of ids) if (this.has(id)) this.update(id, { style: style && Object.keys(style).length ? { ...style } : undefined });
    });
  }

  resetAllStyles(): void {
    this.transact(() => {
      for (const n of this.all()) if (n.style) this.update(n.id, { style: undefined });
      this.meta.delete('theme');
    });
  }

  setNote(id: string, note: string): void {
    if ((this.get(id)?.note ?? '') !== note) this.update(id, { note: note || undefined });
  }

  setLink(id: string, link: string): void {
    this.update(id, { link: link.trim() || undefined });
  }

  addConnection(from: string, to: string, connector?: Connection['connector']): string | null {
    if (from === to || !this.has(from) || !this.has(to)) return null;
    if (this.allConnections().some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from))) return null;
    const id = newId();
    this.transact(() => this.connections.set(id, { id, from, to, ...(connector && {connector}) }));
    return id;
  }

  removeConnection(id: string): void {
    this.transact(() => this.connections.delete(id));
  }

  commentsFor(nodeId: string): Comment[] {
    const out: Comment[] = [];
    this.comments.forEach((c) => c.node === nodeId && out.push(c));
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }

  commentCounts(): Map<string, number> {
    const m = new Map<string, number>();
    this.comments.forEach((c) => m.set(c.node, (m.get(c.node) ?? 0) + 1));
    return m;
  }

  addComment(nodeId: string, author: string, text: string, color?: string): string | null {
    if (!this.has(nodeId) || !text.trim()) return null;
    const id = newId();
    this.ydoc.transact(() => {
      this.comments.set(id, { id, node: nodeId, author: author || 'Someone', color, text: text.trim().slice(0, 4000), at: new Date().toISOString() });
    }, 'social');
    return id;
  }

  removeComment(id: string): void {
    this.ydoc.transact(() => this.comments.delete(id), 'social');
  }

  /** Reactions grouped per node: emoji -> authors. */
  reactionsByNode(): Map<string, Map<string, string[]>> {
    const out = new Map<string, Map<string, string[]>>();
    this.reactions.forEach((r) => {
      const m = out.get(r.node) ?? new Map<string, string[]>();
      m.set(r.emoji, [...(m.get(r.emoji) ?? []), r.author]);
      out.set(r.node, m);
    });
    return out;
  }

  toggleReaction(nodeId: string, emoji: string, author: string): void {
    if (!this.has(nodeId)) return;
    const key = `${nodeId}|${emoji}|${author}`;
    this.ydoc.transact(() => {
      if (this.reactions.has(key)) this.reactions.delete(key);
      else this.reactions.set(key, { node: nodeId, emoji, author });
    }, 'social');
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
    if (n.kind === 'sticky') return this.addSticky('', (n.x ?? 0) + 260, n.y ?? 0);
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
        this.put({ id: group, kind: n!.stance ?? 'reason', parent: newClaim, order: 1, text: '' });
        this.update(n!.id, { parent: group, order: 1, stance: undefined, x: undefined, y: undefined, dx: undefined, dy: undefined });
      } else {
        this.put({ id: newClaim, kind: 'claim', parent: n!.parent, order: n!.order, text: '' });
        this.put({ id: group, kind: 'reason', parent: newClaim, order: 1, text: '' });
        this.update(n!.id, { parent: group, order: 1, dx: undefined, dy: undefined });
      }
    });
    return newClaim;
  }

  setText(id: string, text: string): void {
    const node = this.get(id);
    if (!node || node.text === text) return;
    this.transact(() => {
      this.update(id, { text });
      if (node.sharedClaim) for (const other of this.all()) {
        if (other.id !== id && other.sharedClaim === node.sharedClaim) this.update(other.id, { text });
      }
    });
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
    if (!isGroup(this.get(id))) return;
    this.transact(() => {
      this.update(id, { kind });
      // A premise that already argued this way now simply agrees with its group.
      for (const p of this.all()) if (p.parent === id && p.stance === kind) this.update(p.id, { stance: undefined });
    });
  }

  /**
   * Make one premise a reason or an objection. On its own in its group the whole group
   * changes; beside other premises only this one does, keeping the group as it is.
   */
  setPremiseStance(id: string, kind: GroupKind): void {
    const p = this.get(id);
    const g = this.get(p?.parent ?? '');
    if (p?.kind === 'claim' && p.parent === null) {
      this.update(id, { stance: kind });
      return;
    }
    if (!p || !g || !isGroup(g)) return;
    const siblings = this.all().filter((n) => n.parent === g.id);
    if (siblings.length < 2) this.setGroupKind(g.id, kind);
    else this.update(id, { stance: kind === g.kind ? undefined : kind });
  }

  /** Resize a sticky note, keeping its top-left corner where it is. */
  resizeSticky(id: string, w: number, h: number): void {
    const n = this.get(id);
    if (!n || n.kind !== 'sticky') return;
    const oldW = stickyW(n);
    const nw = Math.min(STICKY.max, Math.max(STICKY.min, Math.round(w)));
    const nh = Math.min(STICKY.max, Math.max(STICKY.min, Math.round(h)));
    this.update(id, { w: nw, h: nh, x: Math.round((n.x ?? 0) + (nw - oldW) / 2) });
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
      this.dropDanglingConnections();
    });
  }

  private dropDanglingConnections(): void {
    for (const c of this.allConnections()) {
      if (!this.has(c.from) || !this.has(c.to)) this.connections.delete(c.id);
    }
  }

  /** Comments and reactions on deleted nodes are hidden, not deleted, so undo brings them back. */
  liveComments(): Comment[] {
    const out: Comment[] = [];
    this.comments.forEach((c) => this.has(c.node) && out.push(c));
    return out;
  }

  private dropEmptyGroup(groupId: string): void {
    if (this.has(groupId) && this.children(groupId).length === 0) this.nodes.delete(groupId);
  }

  /** Detach a premise so it becomes a free-standing root at (x, y). */
  detach(id: string, x: number, y: number): boolean {
    const n = this.get(id);
    if (!isClaim(n) || n!.parent === null) return false;
    const oldGroup = n!.parent;
    const stance = stanceOf(n, this.get(oldGroup));
    this.transact(() => {
      this.update(id, { parent: null, order: this.orderAfter(null), x: Math.round(x), y: Math.round(y), dx: undefined, dy: undefined, stance });
      this.dropEmptyGroup(oldGroup);
    });
    return true;
  }

  canMove(id: string, targetId: string): boolean {
    const n = this.get(id);
    const t = this.get(targetId);
    if (!n || !t || id === targetId) return false;
    if (n.kind === 'sticky' || t.kind === 'sticky') return false;
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
        // Keep what it argued: a reason dropped among an objection's premises stays a reason.
        const was = stanceOf(n, oldParent ? this.get(oldParent) : undefined);
        this.update(id, { parent: targetId, order: this.orderAfter(targetId), ...reset, stance: was && was !== t.kind ? was : undefined });
      } else {
        const group = newId();
        this.put({ id: group, kind: stanceOf(n, this.get(oldParent)) ?? 'reason', parent: targetId, order: this.orderAfter(targetId), text: '' });
        this.update(id, { parent: group, order: 1, ...reset, stance: undefined });
      }
      if (t.collapsed) this.update(targetId, { collapsed: undefined });
      if (oldParent && isGroup(this.get(oldParent))) this.dropEmptyGroup(oldParent);
    });
    return true;
  }

  // ------------------------------------------------------------- clipboard

  /** Serialise the selected subtrees (dropping any selected node already inside another). */
  selectionRoots(ids: string[]): string[] {
    const chosen = new Set(ids);
    return [...chosen].filter(id => {
      const node = this.get(id);
      if (!node) return false;
      let parent = node.parent;
      const visited = new Set<string>();
      while (parent && !visited.has(parent)) {
        if (chosen.has(parent)) return false;
        visited.add(parent);
        parent = this.get(parent)?.parent ?? null;
      }
      return true;
    });
  }

  copy(ids: string[]): ClipNode[] {
    const top = this.selectionRoots(ids);
    const byParent = this.indexByParent();
    const siblingCounts = new Map<string,number>();
    for (const id of top) {
      const parent = this.get(id)?.parent;
      if (parent) siblingCounts.set(parent,(siblingCounts.get(parent) ?? 0)+1);
    }
    const joint = (n: MapNode): ClipNode['joint'] => {
      if (!n.parent || !top.includes(n.id) || (siblingCounts.get(n.parent) ?? 0) < 2) return;
      const group = this.get(n.parent);
      if (group?.kind === 'reason' || group?.kind === 'objection') return {id:group.id,kind:group.kind,text:group.text};
    };
    const included = new Set(top.flatMap(id => this.subtreeIds(id)));
    const links = new Map<string,string[]>();
    const linkStyles = new Map<string,Record<string,NonNullable<Connection['connector']>>>();
    for (const c of this.allConnections()) if (included.has(c.from) && included.has(c.to)) {
      const targets = links.get(c.from) ?? [];
      if (c.connector) linkStyles.set(c.from,{...linkStyles.get(c.from), [c.to]:c.connector});
      targets.push(c.to);
      links.set(c.from,targets);
    }
    const build = (n: MapNode): ClipNode => ({
      sourceId: n.id,
      joint: joint(n),
      linkedTargets: links.get(n.id),
      linkedStyles: linkStyles.get(n.id),
      kind: n.kind,
      text: n.text,
      implicit: n.implicit,
      collapsed: n.collapsed,
      connector: n.connector, style: n.style,
      evidence: n.evidence, questions: n.questions, review: n.review, passage: n.passage, excerpt: n.excerpt,
      note: n.note,
      link: n.link,
      w: n.w,
      h: n.h,
      stance: n.kind === 'claim' && top.includes(n.id) ? stanceOf(n,this.get(n.parent)) : n.stance,
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
    const pastedIds = new Map<string,string>();
    const jointGroups = new Map<string,string>();
    const connections: [string,string,Connection['connector']][] = [];
    const insert = (c: ClipNode, parent: string | null, extra: Partial<MapNode> = {}): string => {
      const id = newId();
      if (c.sourceId) pastedIds.set(c.sourceId,id);
      if (Array.isArray(c.linkedTargets)) for (const target of c.linkedTargets) connections.push([id,target,c.linkedStyles?.[target]]);
      this.put({
        id, kind: c.kind, parent, order: this.orderAfter(parent), text: c.text ?? '',
        implicit: c.implicit || undefined, collapsed: c.collapsed || undefined,
        connector: c.connector, style: c.style, note: c.note, link: c.link, evidence:c.evidence, questions:c.questions, review:c.review, passage:c.passage, excerpt:c.excerpt,
        ...(c.kind === 'sticky' && c.w ? { w: c.w, h: c.h } : {}),
        ...(c.stance && (!parent || (isGroup(this.get(parent)) && this.get(parent)!.kind !== c.stance)) ? { stance: c.stance } : {}),
        ...extra,
      });
      for (const ch of c.children ?? []) insert(ch, id);
      return id;
    };
    this.transact(() => {
      let offset = 0;
      for (const c of clip) {
        if (c.kind === 'sticky') {
          out.push(insert({ ...c, children: [] }, null, { x: Math.round(x + offset), y: Math.round(y) }));
          offset += 260;
        } else if (c.kind === 'claim') {
          if (isGroup(target)) out.push(insert(c, target!.id));
          else if (isClaim(target)) {
            let g = c.joint && jointGroups.get(c.joint.id);
            if (!g) {
              g = newId();
              this.put({id:g,kind:c.joint?.kind ?? c.stance ?? 'reason',parent:target!.id,order:this.orderAfter(target!.id),text:c.joint?.text ?? ''});
              if (c.joint) jointGroups.set(c.joint.id,g);
            }
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
      for (const [from,originalTarget,style] of connections) {
        const to = pastedIds.get(originalTarget);
        if (to) this.addConnection(from,to,style);
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
      connections: this.allConnections(),
      comments: this.liveComments(),
      reactions: (() => {
        const out: Reaction[] = [];
        this.reactions.forEach((r) => this.has(r.node) && out.push(r));
        return out;
      })(),
      theme: (this.meta.get('theme') as Partial<Theme> | undefined) ?? undefined,
    };
  }

  /** Replace the content with an earlier version, as one undoable step. */
  restore(snapshot: { title: string; nodes: MapNode[]; connections?: Connection[]; theme?: Partial<Theme> }): void {
    this.transact(() => {
      this.nodes.clear();
      this.connections.clear();
      for (const n of snapshot.nodes) this.put(n);
      for (const c of snapshot.connections ?? []) if (this.has(c.from) && this.has(c.to)) this.connections.set(c.id, c);
      if (snapshot.theme) this.meta.set('theme', snapshot.theme);
      else this.meta.delete('theme');
      this.meta.set('title', snapshot.title);
    });
  }

  /** Replace the whole document with the contents of a file (not undoable). */
  load(file: MapFile): void {
    this.ydoc.transact(() => {
      this.nodes.clear();
      this.meta.clear();
      this.connections.clear();
      this.comments.clear();
      this.reactions.clear();
      this.meta.set('title', file.title || 'Untitled argument');
      for (const c of file.comments ?? []) this.comments.set(c.id, c);
      for (const r of file.reactions ?? []) this.reactions.set(`${r.node}|${r.emoji}|${r.author}`, r);
      if (file.theme) this.meta.set('theme', file.theme);
      for (const n of file.nodes) this.put(n);
      for (const c of file.connections ?? []) {
        if (this.has(c.from) && this.has(c.to)) this.connections.set(c.id, c);
      }
    }, 'load');
    this.undo.clear();
  }
}

export interface ClipNode extends Pick<MapNode, 'connector'|'evidence'|'questions'|'review'|'passage'|'excerpt'> {
  kind: MapNode['kind'];
  text: string;
  implicit?: boolean;
  collapsed?: boolean;
  style?: NodeStyle;
  note?: string;
  link?: string;
  w?: number;
  h?: number;
  stance?: GroupKind;
  joint?: {id:string; kind:GroupKind; text:string};
  sourceId?: string;
  linkedTargets?: string[];
  linkedStyles?: Record<string,NonNullable<Connection['connector']>>;
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
