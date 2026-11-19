import { newId } from './doc';
import { MapFile, MapNode } from './types';

interface MupIdea {
  id?: string | number;
  title?: string;
  attr?: {
    group?: string;
    note?: { text?: string } | string;
    style?: { background?: string };
    [k: string]: unknown;
  };
  ideas?: Record<string, MupIdea>;
}

const sortedIdeas = (ideas?: Record<string, MupIdea>) =>
  Object.entries(ideas ?? {})
    .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
    .map(([, v]) => v);

const noteOf = (i: MupIdea) => {
  const n = i.attr?.note;
  return typeof n === 'string' ? n : n?.text;
};

/**
 * Import a MindMup (.mup) file. Argument maps mark reason and objection boxes with
 * attr.group = "supporting" / "opposing"; any other child is treated as a reason.
 * This is a best-effort conversion of the public JSON format.
 */
export function importMindMup(text: string): MapFile {
  let data: MupIdea & { formatVersion?: number };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a MindMup file (it is not JSON).');
  }
  const roots: MupIdea[] = data.formatVersion && data.formatVersion >= 3 ? sortedIdeas(data.ideas) : [data];
  if (!roots.length || roots.every((r) => typeof r.title !== 'string' && !r.ideas)) {
    throw new Error('This file has no MindMup map in it.');
  }
  const nodes: MapNode[] = [];
  const groupKind = (i: MupIdea): 'reason' | 'objection' | null => {
    const g = String(i.attr?.group ?? '').toLowerCase();
    if (/(oppos|object|con|rebut)/.test(g)) return 'objection';
    if (/(support|reason|pro)/.test(g)) return 'reason';
    return null;
  };
  const addClaim = (i: MupIdea, parent: string | null, order: number, pos?: { x: number; y: number }) => {
    const id = newId();
    const note = noteOf(i);
    const fill = i.attr?.style?.background;
    nodes.push({
      id, kind: 'claim', parent, order, text: (i.title ?? '').trim(),
      ...(note ? { note } : {}),
      ...(fill && /^#[0-9a-f]{6}$/i.test(fill) ? { style: { fill } } : {}),
      ...(pos ?? {}),
    });
    let o = 1;
    for (const child of sortedIdeas(i.ideas)) {
      const kind = groupKind(child);
      const gid = newId();
      if (kind) {
        nodes.push({ id: gid, kind, parent: id, order: o++, text: '' });
        const premises = sortedIdeas(child.ideas);
        if (premises.length) premises.forEach((p, k) => addClaim(p, gid, k + 1));
        else if (child.title) addClaim({ title: child.title }, gid, 1);
        else nodes.pop();
      } else {
        nodes.push({ id: gid, kind: 'reason', parent: id, order: o++, text: '' });
        addClaim(child, gid, 1);
      }
    }
  };
  roots.forEach((r, i) => addClaim(r, null, i + 1, { x: i * 600, y: 0 }));
  return {
    format: 'argument-mapper',
    version: 1,
    title: (roots[0]?.title ?? 'Imported map').slice(0, 120) || 'Imported map',
    nodes,
  };
}
