import { MapNode, Theme, isConclusion, isGroup, lineLabel } from '../model/types';

export interface Size {
  w: number;
  h: number;
}

export type Measure = (node: MapNode) => Size;

export interface Box {
  id: string;
  kind: MapNode['kind'];
  x: number;
  y: number;
  w: number;
  h: number;
  /** Number of nodes hidden under a collapsed claim. */
  hidden?: number;
}

export interface Edge {
  /** The group that gives the reason or objection. */
  from: string;
  /** The claim it supports or opposes. */
  to: string;
  kind: 'reason' | 'objection';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LayoutResult {
  boxes: Map<string, Box>;
  edges: Edge[];
  bounds: { x: number; y: number; w: number; h: number };
}

export const LAYOUT = {
  vGap: 44,
  premiseGap: 20,
  groupGap: 36,
  groupPad: 8,
  groupLabel: 16,
  groupMinWidth: 96,
};

/**
 * Top-down tidy tree layout for argument maps.
 *
 * Each claim sits centred above its reasons and objections. A group is drawn as a
 * box around its co-premises, and each premise's own sub-argument hangs below the
 * group box. Widths are computed bottom-up, positions top-down, then manual
 * nudges (dx/dy) are applied to whole subtrees.
 */
export function layoutMap(nodes: MapNode[], measure: Measure, density: 'compact' | 'comfortable' = 'compact', lineLabels = false): LayoutResult {
  const k = density === 'comfortable' ? 1.5 : 1;
  // Words on the lines need a little more room between a claim and its reasons.
  const vGap = LAYOUT.vGap * k + (lineLabels ? 18 : 0);
  const premiseGap = LAYOUT.premiseGap * k;
  const groupGap = LAYOUT.groupGap * k;
  const { groupPad, groupLabel, groupMinWidth } = LAYOUT;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string | null, MapNode[]>();
  for (const n of nodes) {
    const list = kids.get(n.parent) ?? [];
    list.push(n);
    kids.set(n.parent, list);
  }
  for (const list of kids.values()) list.sort((a, b) => a.order - b.order);
  const childrenOf = (id: string | null) => kids.get(id) ?? [];

  const sizes = new Map<string, Size>();
  const sizeOf = (n: MapNode): Size => {
    let s = sizes.get(n.id);
    if (!s) {
      s = measure(n);
      sizes.set(n.id, s);
    }
    return s;
  };

  const visibleGroups = (claim: MapNode) => (claim.collapsed ? [] : childrenOf(claim.id).filter(isGroup));

  const countDescendants = (id: string): number =>
    childrenOf(id).reduce((sum, c) => sum + 1 + countDescendants(c.id), 0);

  // ---- widths (bottom-up, memoised)
  const widthMemo = new Map<string, number>();
  const claimWidth = (c: MapNode): number => {
    const cached = widthMemo.get(c.id);
    if (cached !== undefined) return cached;
    const groups = visibleGroups(c);
    const row = groups.reduce((s, g) => s + groupWidth(g), 0) + Math.max(0, groups.length - 1) * groupGap;
    const w = Math.max(sizeOf(c).w, row);
    widthMemo.set(c.id, w);
    return w;
  };
  const groupWidth = (g: MapNode): number => {
    const cached = widthMemo.get(g.id);
    if (cached !== undefined) return cached;
    const premises = childrenOf(g.id);
    const row = premises.reduce((s, p) => s + claimWidth(p), 0) + Math.max(0, premises.length - 1) * premiseGap;
    const w = Math.max(groupMinWidth, row + 2 * groupPad);
    widthMemo.set(g.id, w);
    return w;
  };

  // ---- positions (top-down)
  const boxes = new Map<string, Box>();
  const edges: Edge[] = [];

  const placeClaim = (c: MapNode, left: number, top: number, childTop?: number) => {
    const size = sizeOf(c);
    const sw = claimWidth(c);
    const box: Box = { id: c.id, kind: 'claim', x: left + (sw - size.w) / 2, y: top, w: size.w, h: size.h };
    if (c.collapsed) {
      const hidden = countDescendants(c.id);
      if (hidden) box.hidden = hidden;
    }
    boxes.set(c.id, box);
    const groups = visibleGroups(c);
    if (!groups.length) return;
    const row = groups.reduce((s, g) => s + groupWidth(g), 0) + (groups.length - 1) * groupGap;
    let x = left + (sw - row) / 2;
    const gy = (childTop ?? top + size.h) + vGap;
    for (const g of groups) {
      placeGroup(g, x, gy);
      x += groupWidth(g) + groupGap;
    }
  };

  const placeGroup = (g: MapNode, left: number, top: number) => {
    const premises = childrenOf(g.id);
    const gw = groupWidth(g);
    const rowH = premises.reduce((m, p) => Math.max(m, sizeOf(p).h), 0);
    const h = groupLabel + rowH + 2 * groupPad;
    const row = premises.reduce((s, p) => s + claimWidth(p), 0) + Math.max(0, premises.length - 1) * premiseGap;
    let x = left + (gw - row) / 2;
    const py = top + groupPad + groupLabel;
    for (const p of premises) {
      placeClaim(p, x, py, top + h);
      x += claimWidth(p) + premiseGap;
    }
    // Shrink the group box to hug its premises.
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of premises) {
      const b = boxes.get(p.id)!;
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.w);
    }
    if (!premises.length) {
      minX = left + groupPad;
      maxX = left + gw - groupPad;
    }
    let bx = minX - groupPad;
    let bw = maxX - minX + 2 * groupPad;
    if (bw < groupMinWidth) {
      bx -= (groupMinWidth - bw) / 2;
      bw = groupMinWidth;
    }
    boxes.set(g.id, { id: g.id, kind: g.kind, x: bx, y: top, w: bw, h });
  };

  for (const r of childrenOf(null)) {
    if (r.kind === 'sticky') {
      const size = sizeOf(r);
      boxes.set(r.id, { id: r.id, kind: 'sticky', x: (r.x ?? 0) - size.w / 2, y: r.y ?? 0, w: size.w, h: size.h });
      continue;
    }
    if (r.kind !== 'claim') continue;
    const sw = claimWidth(r);
    placeClaim(r, (r.x ?? 0) - sw / 2, r.y ?? 0);
  }

  // ---- manual nudges, inherited by the whole subtree
  const shift = (id: string, dx: number, dy: number) => {
    const b = boxes.get(id);
    if (!b) return;
    const n = byId.get(id)!;
    const tdx = dx + (n.parent !== null ? n.dx ?? 0 : 0);
    const tdy = dy + (n.parent !== null ? n.dy ?? 0 : 0);
    b.x += tdx;
    b.y += tdy;
    for (const c of childrenOf(id)) shift(c.id, tdx, tdy);
  };
  for (const r of childrenOf(null)) shift(r.id, 0, 0);

  // A premise dragged away takes its group's bracket with it, rather than leaving the
  // bracket (and the line to the claim) behind where the premise used to be.
  for (const b of boxes.values()) {
    if (b.kind !== 'reason' && b.kind !== 'objection') continue;
    const premises = childrenOf(b.id).filter((p) => boxes.has(p.id));
    if (!premises.some((p) => p.dx || p.dy)) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of premises) {
      const pb = boxes.get(p.id)!;
      minX = Math.min(minX, pb.x);
      maxX = Math.max(maxX, pb.x + pb.w);
      minY = Math.min(minY, pb.y);
      maxY = Math.max(maxY, pb.y + pb.h);
    }
    let bx = minX - groupPad;
    let bw = maxX - minX + 2 * groupPad;
    if (bw < groupMinWidth) {
      bx -= (groupMinWidth - bw) / 2;
      bw = groupMinWidth;
    }
    const top = minY - groupPad - groupLabel;
    Object.assign(b, { x: bx, y: top, w: bw, h: maxY - top + groupPad });
  }

  // ---- edges: from the top of each group to the bottom of its claim
  for (const b of boxes.values()) {
    if (b.kind !== 'reason' && b.kind !== 'objection') continue;
    const g = byId.get(b.id)!;
    const target = boxes.get(g.parent!);
    if (!target) continue;
    edges.push({
      from: b.id,
      to: target.id,
      kind: b.kind as Edge['kind'],
      x1: b.x + b.w / 2,
      y1: b.y,
      x2: target.x + target.w / 2,
      y2: target.y + target.h,
    });
  }

  // Spread arrows that land on the same claim so their heads don't overlap.
  const byTarget = new Map<string, Edge[]>();
  for (const e of edges) byTarget.set(e.to, [...(byTarget.get(e.to) ?? []), e]);
  for (const list of byTarget.values()) {
    if (list.length < 2) continue;
    const t = boxes.get(list[0].to)!;
    list.sort((a, b) => a.x1 - b.x1);
    const span = Math.min(t.w * 0.6, (list.length - 1) * 22);
    list.forEach((e, i) => {
      e.x2 = t.x + t.w / 2 - span / 2 + (span * i) / (list.length - 1);
    });
  }

  // Leave the group's bracket straight below the claim where it can, so lines run vertically.
  for (const e of edges) {
    const g = boxes.get(e.from)!;
    e.x1 = Math.max(g.x + 14, Math.min(g.x + g.w - 14, e.x2));
    e.y1 = g.y + 4;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const bounds = boxes.size
    ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    : { x: 0, y: 0, w: 0, h: 0 };

  return { boxes, edges, bounds };
}

/** Where the words on a line go: a quarter of the way up from the group, so neighbours don't collide. */
export function labelPoint(x1: number, y1: number, x2: number, y2: number, style: 'curved' | 'straight' | 'elbow', t = 0.3): { x: number; y: number } {
  const my = (y1 + y2) / 2;
  if (style === 'straight') return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
  if (style === 'elbow') return { x: x1, y: y1 + (my - y1) * Math.min(1, t * 2) };
  // Cubic from (x1,y1) via (x1,my), (x2,my) to (x2,y2)
  const u = 1 - t;
  const b = (a0: number, a1: number, a2: number, a3: number) => u * u * u * a0 + 3 * u * u * t * a1 + 3 * u * t * t * a2 + t * t * t * a3;
  return { x: b(x1, x1, x2, x2), y: b(y1, my, my, y2) };
}

export interface LineLabel {
  /** The reason or objection the line comes from. */
  id: string;
  kind: Edge['kind'];
  text: string;
  /** Written by someone, rather than the automatic Because / But. */
  own: boolean;
  x: number;
  y: number;
}

/**
 * The words on every line, placed near the group end and pushed apart where lines to the
 * same claim run close together. `width` measures text; `offset` moves dragged boxes.
 */
export function placeLineLabels(
  layout: LayoutResult,
  nodes: Map<string, MapNode>,
  theme: Pick<Theme, 'lineLabels' | 'lineStyle'>,
  width: (text: string) => number,
  offset: (id: string) => { dx: number; dy: number } = () => ({ dx: 0, dy: 0 }),
  include?: string,
): LineLabel[] {
  const byTarget = new Map<string, (LineLabel & { w: number })[]>();
  for (const e of layout.edges) {
    const g = nodes.get(e.from);
    if (!g) continue;
    const text = lineLabel(g, theme);
    if (!text && e.from !== include) continue;
    const a = offset(e.from), z = offset(e.to);
    const p = labelPoint(e.x1 + a.dx, e.y1 + a.dy, e.x2 + z.dx, e.y2 + z.dy, theme.lineStyle);
    const list = byTarget.get(e.to) ?? [];
    list.push({ id: e.from, kind: e.kind, text, own: !!g.text.trim(), x: p.x, y: p.y, w: Math.max(width(text || 'Because'), 40) + 8 });
    byTarget.set(e.to, list);
  }
  const out: LineLabel[] = [];
  for (const list of byTarget.values()) {
    list.sort((a, b) => a.x - b.x);
    // Push right, then centre the whole row back over where it started.
    const before = list.reduce((s, l) => s + l.x, 0);
    for (let i = 1; i < list.length; i++) {
      const min = list[i - 1].x + (list[i - 1].w + list[i].w) / 2;
      if (list[i].x < min) list[i].x = min;
    }
    const shift = (before - list.reduce((sum, l) => sum + l.x, 0)) / list.length;
    for (const { w: _w, ...l } of list) out.push({ ...l, x: l.x + shift });
  }
  return out;
}

/** Topmost box under a point (claims win over the group boxes behind them). */
export function hitTest(layout: LayoutResult, x: number, y: number, exclude?: Set<string>): Box | undefined {
  let hitGroup: Box | undefined;
  for (const b of layout.boxes.values()) {
    if (exclude?.has(b.id)) continue;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      if (b.kind === 'claim' || b.kind === 'sticky') return b;
      hitGroup = b;
    }
  }
  return hitGroup;
}

/**
 * Number labels for claims.
 *  - level: "depth.index", counted left to right on each level (1.1, 2.1, 2.2 …)
 *  - hierarchical: outline numbers (1, 1.1, 1.2, 1.1.1 …)
 *  - sequential: 1, 2, 3 … top to bottom, left to right
 */
export function computeLabels(
  nodes: MapNode[],
  layout: LayoutResult,
  mode: 'none' | 'level' | 'hierarchical' | 'sequential',
): Map<string, string> {
  const out = new Map<string, string>();
  if (mode === 'none') return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // A floating premise and its branch have no place in a conclusion's numbering yet.
  const floating = new Set<string>();
  const children = new Map<string, string[]>();
  for (const node of nodes) if (node.parent) {
    const siblings = children.get(node.parent) ?? [];
    siblings.push(node.id);
    children.set(node.parent, siblings);
  }
  const pending = nodes.filter(n => n.kind === 'claim' && !n.parent && n.stance).map(n => n.id);
  while (pending.length) {
    const id = pending.pop()!;
    if (floating.has(id)) continue;
    floating.add(id);
    for (const child of children.get(id) ?? []) pending.push(child);
  }
  const visibleClaims = nodes.filter((n) => n.kind === 'claim' && !floating.has(n.id) && layout.boxes.has(n.id));
  const claimDepth = (n: MapNode): number => {
    let d = 1;
    let cur = n;
    while (cur.parent) {
      const g = byId.get(cur.parent);
      const c = g && byId.get(g.parent ?? '');
      if (!c) break;
      cur = c;
      d++;
    }
    return d;
  };
  const pos = (n: MapNode) => layout.boxes.get(n.id)!;
  if (mode === 'sequential') {
    [...visibleClaims]
      .sort((a, b) => pos(a).y - pos(b).y || pos(a).x - pos(b).x)
      .forEach((n, i) => out.set(n.id, String(i + 1)));
    return out;
  }
  if (mode === 'level') {
    const levels = new Map<number, MapNode[]>();
    for (const n of visibleClaims) {
      const d = claimDepth(n);
      levels.set(d, [...(levels.get(d) ?? []), n]);
    }
    for (const [d, list] of levels) {
      list.sort((a, b) => pos(a).x - pos(b).x).forEach((n, i) => out.set(n.id, `${d}.${i + 1}`));
    }
    return out;
  }
  // hierarchical
  const kids = new Map<string | null, MapNode[]>();
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  for (const l of kids.values()) l.sort((a, b) => a.order - b.order);
  const claimChildren = (id: string) =>
    (kids.get(id) ?? []).flatMap((g) => (g.kind === 'reason' || g.kind === 'objection' ? kids.get(g.id) ?? [] : []));
  const walk = (n: MapNode, prefix: string) => {
    if (!layout.boxes.has(n.id)) return;
    out.set(n.id, prefix);
    claimChildren(n.id).forEach((c, i) => walk(c, `${prefix}.${i + 1}`));
  };
  (kids.get(null) ?? []).filter(isConclusion).forEach((r, i) => walk(r, String(i + 1)));
  return out;
}
