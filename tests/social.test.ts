import { describe, expect, it } from 'vitest';
import { MapDoc, newMapFile } from '../src/model/doc';
import { parseMapFile, serialize } from '../src/model/file';
import { parseAddress } from '../src/editor';

function fresh() {
  const doc = new MapDoc();
  const file = newMapFile('T');
  doc.load(file);
  return { doc, root: file.nodes[0].id };
}

describe('comments and reactions', () => {
  it('adds, lists and removes comments without touching undo', () => {
    const { doc, root } = fresh();
    const id = doc.addComment(root, 'Sara', '  Is this source reliable?  ', '#1c7ed6')!;
    doc.addComment(root, 'Ali', 'Yes, peer reviewed.');
    expect(doc.commentsFor(root).map((c) => c.text)).toEqual(['Is this source reliable?', 'Yes, peer reviewed.']);
    expect(doc.commentCounts().get(root)).toBe(2);
    expect(doc.undo.canUndo()).toBe(false);
    doc.removeComment(id);
    expect(doc.commentsFor(root)).toHaveLength(1);
    expect(doc.addComment(root, 'Sara', '   ')).toBeNull();
    expect(doc.addComment('missing', 'Sara', 'x')).toBeNull();
  });

  it('toggles one reaction per person and emoji', () => {
    const { doc, root } = fresh();
    doc.toggleReaction(root, '👍', 'Sara');
    doc.toggleReaction(root, '👍', 'Ali');
    doc.toggleReaction(root, '🤔', 'Ali');
    expect(doc.reactionsByNode().get(root)?.get('👍')).toEqual(['Sara', 'Ali']);
    doc.toggleReaction(root, '👍', 'Sara');
    expect(doc.reactionsByNode().get(root)?.get('👍')).toEqual(['Ali']);
  });

  it('saves comments and reactions in the file and drops ones for deleted boxes', () => {
    const { doc, root } = fresh();
    const { premiseId } = doc.addGroup(root, 'reason', 'because')!;
    doc.addComment(root, 'Sara', 'on the root');
    doc.addComment(premiseId, 'Sara', 'on the premise');
    doc.toggleReaction(premiseId, '❤️', 'Ali');
    const again = new MapDoc();
    again.load(parseMapFile(serialize(doc.toFile())));
    expect(again.commentsFor(root)).toHaveLength(1);
    expect(again.reactionsByNode().get(premiseId)?.get('❤️')).toEqual(['Ali']);
    doc.remove([premiseId]);
    const file = doc.toFile();
    expect(file.comments?.map((c) => c.text)).toEqual(['on the root']);
    expect(file.reactions ?? []).toHaveLength(0);
  });
});

describe('parseAddress', () => {
  it('accepts bare addresses, host:port and share links', () => {
    expect(parseAddress('192.168.1.5')).toEqual({ httpBase: 'http://192.168.1.5:47821', wsBase: 'ws://192.168.1.5:47821', code: undefined });
    expect(parseAddress('10.0.0.2:5000').httpBase).toBe('http://10.0.0.2:5000');
    expect(parseAddress('http://10.0.0.2:47822/?join=ABC123')).toEqual({ httpBase: 'http://10.0.0.2:47822', wsBase: 'ws://10.0.0.2:47822', code: 'ABC123' });
  });
});
