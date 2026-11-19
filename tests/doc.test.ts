import { describe, expect, it } from 'vitest';
import { MapDoc, newMapFile } from '../src/model/doc';
import { parseMapFile, serialize } from '../src/model/file';

function fresh() {
  const doc = new MapDoc();
  const file = newMapFile('Test');
  doc.load(file);
  return { doc, root: file.nodes[0].id };
}

describe('MapDoc structure', () => {
  it('adds reasons and objections as groups with one premise', () => {
    const { doc, root } = fresh();
    const r = doc.addGroup(root, 'reason')!;
    const o = doc.addGroup(root, 'objection')!;
    expect(doc.children(root).map((n) => n.kind)).toEqual(['reason', 'objection']);
    expect(doc.get(r.premiseId)!.parent).toBe(r.groupId);
    expect(doc.get(o.premiseId)!.kind).toBe('claim');
  });

  it('adds co-premises with Tab and keeps their order', () => {
    const { doc, root } = fresh();
    const r = doc.addGroup(root, 'reason')!;
    const second = doc.addSibling(r.premiseId)!;
    const between = doc.addPremise(r.groupId, r.premiseId)!;
    expect(doc.children(r.groupId).map((n) => n.id)).toEqual([r.premiseId, between, second]);
  });

  it('Enter on a claim adds a reason, Enter on a group adds a co-premise', () => {
    const { doc, root } = fresh();
    const p = doc.addChild(root)!;
    const group = doc.get(p)!.parent!;
    expect(doc.get(group)!.kind).toBe('reason');
    const p2 = doc.addChild(group)!;
    expect(doc.get(p2)!.parent).toBe(group);
  });

  it('inserts a parent above a root and above a premise', () => {
    const { doc, root } = fresh();
    const top = doc.addParent(root)!;
    expect(doc.get(top)!.parent).toBeNull();
    expect(doc.parentClaim(root)!.id).toBe(top);

    const { premiseId, groupId } = doc.addGroup(root, 'objection')!;
    const mid = doc.addParent(premiseId)!;
    expect(doc.get(mid)!.parent).toBe(groupId);
    expect(doc.parentClaim(premiseId)!.id).toBe(mid);
  });

  it('removes subtrees and drops groups left empty', () => {
    const { doc, root } = fresh();
    const r = doc.addGroup(root, 'reason')!;
    const deep = doc.addGroup(r.premiseId, 'objection')!;
    doc.remove([r.premiseId]);
    expect(doc.has(r.groupId)).toBe(false);
    expect(doc.has(deep.premiseId)).toBe(false);
    expect(doc.all()).toHaveLength(1);
  });

  it('keeps a group that still has a co-premise', () => {
    const { doc, root } = fresh();
    const r = doc.addGroup(root, 'reason')!;
    const other = doc.addSibling(r.premiseId)!;
    doc.remove([r.premiseId]);
    expect(doc.has(r.groupId)).toBe(true);
    expect(doc.children(r.groupId).map((n) => n.id)).toEqual([other]);
  });

  it('detaches a premise into a root', () => {
    const { doc, root } = fresh();
    const r = doc.addGroup(root, 'reason')!;
    expect(doc.detach(r.premiseId, 100, 50)).toBe(true);
    const n = doc.get(r.premiseId)!;
    expect(n.parent).toBeNull();
    expect([n.x, n.y]).toEqual([100, 50]);
    expect(doc.has(r.groupId)).toBe(false);
    expect(doc.detach(root, 0, 0)).toBe(false);
  });

  it('moves claims and groups by drag and drop rules', () => {
    const { doc, root } = fresh();
    const a = doc.addGroup(root, 'reason')!;
    const b = doc.addGroup(root, 'objection')!;
    // claim onto group -> co-premise
    expect(doc.move(a.premiseId, b.groupId)).toBe(true);
    expect(doc.get(a.premiseId)!.parent).toBe(b.groupId);
    expect(doc.has(a.groupId)).toBe(false);
    // claim onto claim -> new reason
    const free = doc.addRoot('free', 400, 0);
    expect(doc.move(free, b.premiseId)).toBe(true);
    expect(doc.parentClaim(free)!.id).toBe(b.premiseId);
    // never into its own subtree
    expect(doc.canMove(root, free)).toBe(false);
    // group onto another claim
    expect(doc.move(b.groupId, free)).toBe(false); // free is inside b's subtree
  });

  it('toggles implicit claims and folding', () => {
    const { doc, root } = fresh();
    doc.toggleImplicit([root]);
    expect(doc.get(root)!.implicit).toBe(true);
    doc.toggleImplicit([root]);
    expect(doc.get(root)!.implicit).toBeUndefined();
    doc.setCollapsed([root], true);
    expect(doc.get(root)!.collapsed).toBeUndefined(); // nothing to fold
    doc.addGroup(root, 'reason');
    doc.setCollapsed([root], true);
    expect(doc.get(root)!.collapsed).toBe(true);
  });

  it('copies and pastes subtrees under claims, groups and as roots', () => {
    const { doc, root } = fresh();
    const r = doc.addGroup(root, 'reason', 'premise A')!;
    doc.addGroup(r.premiseId, 'objection', 'but B');
    const clip = doc.copy([r.premiseId]);
    expect(clip[0].text).toBe('premise A');

    const [asCo] = doc.paste(clip, r.groupId);
    expect(doc.get(asCo)!.parent).toBe(r.groupId);
    expect(doc.subtreeIds(asCo)).toHaveLength(3);

    const [asRoot] = doc.paste(clip, null, 10, 20);
    expect(doc.get(asRoot)!.parent).toBeNull();

    const groupClip = doc.copy([r.groupId]);
    const [g] = doc.paste(groupClip, asRoot);
    expect(doc.get(g)!.kind).toBe('reason');
    expect(doc.get(g)!.parent).toBe(asRoot);
  });

  it('undoes and redoes edits but not loading', () => {
    const { doc, root } = fresh();
    expect(doc.undo.canUndo()).toBe(false);
    doc.setText(root, 'Changed');
    doc.undo.stopCapturing();
    doc.addGroup(root, 'reason');
    doc.undo.undo();
    expect(doc.children(root)).toHaveLength(0);
    doc.undo.undo();
    expect(doc.get(root)!.text).toBe('Main claim');
    doc.undo.redo();
    expect(doc.get(root)!.text).toBe('Changed');
  });
});

describe('file format', () => {
  it('round-trips through JSON', () => {
    const { doc, root } = fresh();
    doc.addGroup(root, 'objection', 'نه، چون…');
    const text = serialize(doc.toFile());
    const copy = new MapDoc();
    copy.load(parseMapFile(text));
    expect(copy.all().sort((a, b) => a.id.localeCompare(b.id))).toEqual(doc.all().sort((a, b) => a.id.localeCompare(b.id)));
    expect(copy.title).toBe('Test');
  });

  it('rejects other files and repairs orphans', () => {
    expect(() => parseMapFile('nope')).toThrow(/not JSON/);
    expect(() => parseMapFile('{"a":1}')).toThrow(/not an Argument Mapper/);
    const f = parseMapFile(JSON.stringify({
      format: 'argument-mapper', version: 1, title: 'x',
      nodes: [
        { id: 'a', kind: 'claim', parent: 'missing', order: 1, text: 'orphan' },
        { id: 'g', kind: 'reason', parent: 'missing', order: 1, text: '' },
      ],
    }));
    expect(f.nodes.map((n) => [n.id, n.parent])).toEqual([['a', null]]);
  });
});
