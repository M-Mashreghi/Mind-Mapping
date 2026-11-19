import { MapNode, isGroup } from '../model/types';

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
  groupPad: 10,
  groupLabel: 18,
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
export function layoutMap(nodes: MapNode[], measure: Measure, density: 'compact' | 'comfortable' = 'compact'): LayoutResult {
  const k = density === 'comfortable' ? 1.5 : 1;
  const vGap = LAYOUT.vGap * k;
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

  // ---- edges: from the top of each group to the bottom of its claim
  for (const b of boxes.values()) {
    if (b.kind === 'claim') continue;
    const g = byId.get(b.id)!;
    const target = boxes.get(g.parent!);
    if (!target) continue;
    edges.push({
      from: b.id,
      to: target.id,
      kind: b.kind,
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

/** Topmost box under a point (claims win over the group boxes behind them). */
export function hitTest(layout: LayoutResult, x: number, y: number, exclude?: Set<string>): Box | undefined {
  let hitGroup: Box | undefined;
  for (const b of layout.boxes.values()) {
    if (exclude?.has(b.id)) continue;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      if (b.kind === 'claim') return b;
      hitGroup = b;
    }
  }
  return hitGroup;
}
