import { describe, expect, it } from 'vitest';
import { MapDoc, newMapFile } from '../src/model/doc';
import { importMindMup } from '../src/model/mindmup';
import { toMarkdown, toPlainText } from '../src/export/outline';
import { DEFAULT_THEME, lineLabel } from '../src/model/types';

function sample() {
  const doc = new MapDoc();
  const file = newMapFile('Cars');
  doc.load(file);
  const root = file.nodes[0].id;
  doc.setText(root, 'Ban cars');
  const r = doc.addGroup(root, 'reason', 'Pollution')!;
  doc.addPremise(r.groupId, r.premiseId, 'Health matters');
  doc.addGroup(root, 'objection', 'Shops lose');
  doc.setNote(root, 'Main thesis');
  return { doc, root };
}

describe('outline export', () => {
  it('writes reasons, objections and co-premises as Markdown', () => {
    const { doc } = sample();
    const md = toMarkdown('Cars', doc.all());
    expect(md).toContain('# Cars');
    expect(md).toContain('- **Ban cars**');
    expect(md).toContain('> Main thesis');
    expect(md).toContain('✔ Reason (co-premises):');
    expect(md).toContain('✘ Objection:');
    expect(md.indexOf('Pollution')).toBeLessThan(md.indexOf('Health matters'));
  });

  it('writes plain text without Markdown marks', () => {
    const { doc } = sample();
    const txt = toPlainText('Cars', doc.all());
    expect(txt.startsWith('Cars')).toBe(true);
    expect(txt).not.toContain('**');
    expect(txt).not.toContain('Main thesis');
  });
});

describe('words on lines', () => {
  it('uses the words written on the line, or Because / But when that is turned on', () => {
    const { doc, root } = sample();
    const [reason, objection] = doc.all().filter((n) => n.parent === root);
    expect(lineLabel(reason, DEFAULT_THEME)).toBe('');
    expect(lineLabel(objection, { lineLabels: true })).toBe('But');
    expect(lineLabel(reason, { lineLabels: true })).toBe('Because');
    doc.setText(reason.id, 'since');
    expect(lineLabel(doc.get(reason.id)!, { lineLabels: true })).toBe('since');
    expect(toMarkdown('Cars', doc.all())).toContain('✔ Reason (co-premises) "since":');
  });
});

describe('MindMup import', () => {
  it('converts supporting and opposing groups', () => {
    const mup = {
      formatVersion: 3,
      id: 'root',
      ideas: {
        1: {
          id: 1, title: 'We should plant trees', attr: { note: { text: 'thesis' } },
          ideas: {
            1: { id: 2, title: '', attr: { group: 'supporting' }, ideas: { 1: { id: 3, title: 'Shade' }, 2: { id: 4, title: 'Cooler streets' } } },
            2: { id: 5, title: '', attr: { group: 'opposing' }, ideas: { 1: { id: 6, title: 'Cost' } } },
            3: { id: 7, title: 'Plain child' },
          },
        },
      },
    };
    const f = importMindMup(JSON.stringify(mup));
    const doc = new MapDoc();
    doc.load(f);
    const root = doc.roots()[0];
    expect(root.text).toBe('We should plant trees');
    expect(root.note).toBe('thesis');
    const groups = doc.children(root.id);
    expect(groups.map((g) => g.kind)).toEqual(['reason', 'objection', 'reason']);
    expect(doc.children(groups[0].id).map((p) => p.text)).toEqual(['Shade', 'Cooler streets']);
    expect(doc.children(groups[2].id)[0].text).toBe('Plain child');
  });

  it('rejects files that are not MindMup maps', () => {
    expect(() => importMindMup('nope')).toThrow();
    expect(() => importMindMup('{"formatVersion":3,"ideas":{}}')).toThrow();
  });
});

describe('version restore', () => {
  it('restores an earlier snapshot as one undoable step', () => {
    const { doc, root } = sample();
    const snap = doc.toFile();
    doc.remove(doc.children(root).map((g) => g.id));
    doc.setText(root, 'Changed');
    doc.restore(snap);
    expect(doc.get(root)!.text).toBe('Ban cars');
    expect(doc.children(root)).toHaveLength(2);
    doc.undo.undo();
    expect(doc.get(root)!.text).toBe('Changed');
  });
});
