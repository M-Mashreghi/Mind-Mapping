import { MapNode } from '../model/types';

/** Markdown outline: claims as bullets, reasons and objections as labelled sub-lists. */
export function toMarkdown(title: string, nodes: MapNode[], withNotes = true): string {
  const kids = new Map<string | null, MapNode[]>();
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  for (const l of kids.values()) l.sort((a, b) => a.order - b.order);
  const lines: string[] = [`# ${title}`, ''];
  const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
  const claim = (n: MapNode, depth: number) => {
    const pad = '  '.repeat(depth);
    const text = oneLine(n.text) || '(empty)';
    lines.push(`${pad}- ${depth === 0 ? `**${text}**` : text}${n.implicit ? ' _(implicit)_' : ''}`);
    if (withNotes && n.note) lines.push(`${pad}  > ${oneLine(n.note)}`);
    for (const g of kids.get(n.id) ?? []) {
      lines.push(`${pad}  - ${g.kind === 'reason' ? '✔ Reason' : '✘ Objection'}${(kids.get(g.id) ?? []).length > 1 ? ' (co-premises)' : ''}:`);
      for (const p of kids.get(g.id) ?? []) claim(p, depth + 2);
    }
  };
  for (const r of kids.get(null) ?? []) {
    if (r.kind === 'claim') claim(r, 0);
  }
  const stickies = (kids.get(null) ?? []).filter((n) => n.kind === 'sticky');
  if (stickies.length) {
    lines.push('', '## Sticky notes', '');
    for (const s of stickies) lines.push(`- ${oneLine(s.text)}`);
  }
  return lines.join('\n') + '\n';
}

/** Plain indented text outline. */
export function toPlainText(title: string, nodes: MapNode[]): string {
  return toMarkdown(title, nodes, false)
    .replace(/^# /, '')
    .replace(/\*\*/g, '')
    .replace(/_\(implicit\)_/g, '(implicit)')
    .replace(/^(\s*)- /gm, '$1');
}
