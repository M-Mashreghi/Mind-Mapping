import { describe, expect, it } from 'vitest';
import { MapDoc, newMapFile } from '../src/model/doc';
import { layoutMap, hitTest } from '../src/layout/layout';
import { approxMeasure } from '../src/layout/measure';

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function buildDoc() {
  const doc = new MapDoc();
  const file = newMapFile();
  doc.load(file);
  const root = file.nodes[0].id;
  const r1 = doc.addGroup(root, 'reason', 'First reason with quite a lot of words in it')!;
  doc.addSibling(r1.premiseId);
  doc.addGroup(r1.premiseId, 'objection', 'An objection to the first reason');
  doc.addGroup(r1.premiseId, 'reason', 'Support');
  const o = doc.addGroup(root, 'objection', 'Main objection')!;
  doc.addGroup(o.premiseId, 'reason', 'rebuttal');
  return { doc, root };
}

describe('moving and mixing premises', () => {
  it('takes the bracket and its line along when a premise is dragged away', () => {
    const { doc, root } = buildDoc();
    const o = doc.all().find((n) => n.kind === 'objection' && n.parent === root)!;
    const premise = doc.all().find((n) => n.parent === o.id)!;
    doc.nudge(premise.id, 300, 200);
    const { boxes, edges } = layoutMap(doc.all(), approxMeasure);
    const g = boxes.get(o.id)!;
    const p = boxes.get(premise.id)!;
    expect(p.x).toBeGreaterThanOrEqual(g.x);
    expect(p.x + p.w).toBeLessThanOrEqual(g.x + g.w);
    expect(p.y - g.y).toBeGreaterThan(0);
    expect(p.y - g.y).toBeLessThan(40);
    const e = edges.find((x) => x.from === o.id)!;
    expect(e.y1).toBeCloseTo(g.y + 4);
  });

  it('lets one premise argue the other way from its group', () => {
    const { doc, root } = buildDoc();
    const o = doc.all().find((n) => n.kind === 'objection' && n.parent === root)!;
    const first = doc.all().find((n) => n.parent === o.id)!;
    // Alone in its group, the whole group changes.
    doc.setPremiseStance(first.id, 'reason');
    expect(doc.get(o.id)!.kind).toBe('reason');
    doc.setGroupKind(o.id, 'objection');
    const second = doc.addPremise(o.id, first.id, 'beside it')!;
    doc.setPremiseStance(second, 'reason');
    expect(doc.get(o.id)!.kind).toBe('objection');
    expect(doc.get(second)!.stance).toBe('reason');
    // Turning the group into reasons makes the stance redundant.
    doc.setGroupKind(o.id, 'reason');
    expect(doc.get(second)!.stance).toBeUndefined();
  });

  it('keeps a reason a reason when it is dropped among the premises of an objection', () => {
    const { doc, root } = buildDoc();
    const r = doc.all().find((n) => n.kind === 'reason' && n.parent === root)!;
    const o = doc.all().find((n) => n.kind === 'objection' && n.parent === root)!;
    const reasonPremise = doc.all().find((n) => n.parent === r.id)!;
    doc.move(reasonPremise.id, o.id);
    expect(doc.get(reasonPremise.id)!.parent).toBe(o.id);
    expect(doc.get(reasonPremise.id)!.stance).toBe('reason');
  });
});

describe('layout', () => {
  it('places claims without overlap and groups around their premises', () => {
    const { doc } = buildDoc();
    const { boxes, edges } = layoutMap(doc.all(), approxMeasure);
    const claims = [...boxes.values()].filter((b) => b.kind === 'claim');
    for (let i = 0; i < claims.length; i++)
      for (let j = i + 1; j < claims.length; j++) expect(overlaps(claims[i], claims[j])).toBe(false);

    for (const n of doc.all()) {
      if (n.kind === 'claim' && n.parent) {
        const g = boxes.get(n.parent)!;
        const b = boxes.get(n.id)!;
        expect(b.x).toBeGreaterThanOrEqual(g.x);
        expect(b.x + b.w).toBeLessThanOrEqual(g.x + g.w);
        expect(b.y).toBeGreaterThan(g.y);
      }
    }
    const groups = [...boxes.values()].filter((b) => b.kind !== 'claim');
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) expect(overlaps(groups[i], groups[j])).toBe(false);
    expect(edges).toHaveLength(groups.length);
    for (const e of edges) expect(e.y1).toBeGreaterThan(e.y2); // arrows point up to the claim
  });

  it('hides folded subtrees and reports how many are hidden', () => {
    const { doc, root } = buildDoc();
    doc.setCollapsed([root], true);
    const { boxes } = layoutMap(doc.all(), approxMeasure);
    expect(boxes.size).toBe(1);
    expect(boxes.get(root)!.hidden).toBe(doc.all().length - 1);
  });

  it('applies manual nudges to whole subtrees', () => {
    const { doc, root } = buildDoc();
    const before = layoutMap(doc.all(), approxMeasure);
    const group = doc.children(root)[0];
    doc.update(group.id, { dx: 30, dy: 10 });
    const after = layoutMap(doc.all(), approxMeasure);
    for (const id of doc.subtreeIds(group.id)) {
      expect(after.boxes.get(id)!.x - before.boxes.get(id)!.x).toBeCloseTo(30);
      expect(after.boxes.get(id)!.y - before.boxes.get(id)!.y).toBeCloseTo(10);
    }
    expect(after.boxes.get(root)!.x).toBe(before.boxes.get(root)!.x);
  });

  it('hit-tests claims before the group boxes behind them', () => {
    const { doc, root } = buildDoc();
    const layout = layoutMap(doc.all(), approxMeasure);
    const g = layout.boxes.get(doc.children(root)[0].id)!;
    const p = layout.boxes.get(doc.children(g.id)[0].id)!;
    expect(hitTest(layout, p.x + 2, p.y + 2)!.id).toBe(p.id);
    expect(hitTest(layout, g.x + 2, g.y + 2)!.id).toBe(g.id);
    expect(hitTest(layout, -99999, -99999)).toBeUndefined();
  });
});
