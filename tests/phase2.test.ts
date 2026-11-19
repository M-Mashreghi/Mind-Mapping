import { describe, expect, it } from 'vitest';
import { MapDoc, newMapFile } from '../src/model/doc';
import { parseMapFile, serialize } from '../src/model/file';
import { computeLabels, layoutMap } from '../src/layout/layout';
import { approxMeasure } from '../src/layout/measure';

function fresh() {
  const doc = new MapDoc();
  const file = newMapFile('T');
  doc.load(file);
  return { doc, root: file.nodes[0].id };
}

describe('styles, notes, links', () => {
  it('merges and clears node styles', () => {
    const { doc, root } = fresh();
    doc.setStyle([root], { bold: true, fill: '#ffeeee' });
    doc.setStyle([root], { bold: false, size: 'l' });
    expect(doc.get(root)!.style).toEqual({ fill: '#ffeeee', size: 'l' });
    doc.replaceStyle([root], undefined);
    expect(doc.get(root)!.style).toBeUndefined();
  });

  it('stores notes and links and keeps them through copy/paste', () => {
    const { doc, root } = fresh();
    doc.setNote(root, 'why this matters');
    doc.setLink(root, 'https://example.org');
    const [copy] = doc.paste(doc.copy([root]), null, 0, 0);
    expect(doc.get(copy)!.note).toBe('why this matters');
    expect(doc.get(copy)!.link).toBe('https://example.org');
    doc.setNote(root, '');
    expect(doc.get(root)!.note).toBeUndefined();
  });

  it('keeps the theme in the file', () => {
    const { doc } = fresh();
    doc.setTheme({ numbering: 'hierarchical', reason: { fill: '#e0ffe0', border: '', text: '' } });
    const copy = new MapDoc();
    copy.load(parseMapFile(serialize(doc.toFile())));
    expect(copy.theme.numbering).toBe('hierarchical');
    expect(copy.theme.reason.fill).toBe('#e0ffe0');
    expect(copy.theme.lineStyle).toBe('elbow');
  });
});

describe('sticky notes and connections', () => {
  it('adds stickies that never join the argument structure', () => {
    const { doc, root } = fresh();
    const s = doc.addSticky('remember', 300, 0);
    expect(doc.canMove(s, root)).toBe(false);
    expect(doc.canMove(root, s)).toBe(false);
    const { boxes } = layoutMap(doc.all(), approxMeasure);
    expect(boxes.get(s)!.kind).toBe('sticky');
  });

  it('connects nodes once and drops connections with deleted nodes', () => {
    const { doc, root } = fresh();
    const s = doc.addSticky('note', 300, 0);
    const c = doc.addConnection(s, root);
    expect(c).toBeTruthy();
    expect(doc.addConnection(root, s)).toBeNull();
    expect(doc.addConnection(root, root)).toBeNull();
    doc.remove([s]);
    expect(doc.allConnections()).toHaveLength(0);
    doc.undo.undo();
    expect(doc.allConnections()).toHaveLength(1);
  });

  it('round-trips connections through the file', () => {
    const { doc, root } = fresh();
    const s = doc.addSticky('note', 300, 0);
    doc.addConnection(s, root);
    const f = parseMapFile(serialize(doc.toFile()));
    expect(f.connections).toHaveLength(1);
  });
});

describe('labels', () => {
  it('numbers claims three ways', () => {
    const { doc, root } = fresh();
    const a = doc.addGroup(root, 'reason')!;
    const b = doc.addSibling(a.premiseId)!;
    const o = doc.addGroup(root, 'objection')!;
    const deep = doc.addGroup(a.premiseId, 'reason')!;
    const layout = layoutMap(doc.all(), approxMeasure);
    const h = computeLabels(doc.all(), layout, 'hierarchical');
    expect(h.get(root)).toBe('1');
    expect(h.get(a.premiseId)).toBe('1.1');
    expect(h.get(b)).toBe('1.2');
    expect(h.get(o.premiseId)).toBe('1.3');
    expect(h.get(deep.premiseId)).toBe('1.1.1');
    const lv = computeLabels(doc.all(), layout, 'level');
    expect(lv.get(root)).toBe('1.1');
    expect(lv.get(a.premiseId)).toBe('2.1');
    expect(lv.get(deep.premiseId)).toBe('3.1');
    const seq = computeLabels(doc.all(), layout, 'sequential');
    expect(seq.get(root)).toBe('1');
    expect(new Set(seq.values()).size).toBe(5);
    expect(computeLabels(doc.all(), layout, 'none').size).toBe(0);
  });
});
