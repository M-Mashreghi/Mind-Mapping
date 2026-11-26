import { MapDoc, newId } from './doc';
import { isGroup, type MapNode, type MapFile, type GroupKind } from './types';

export type Relation = GroupKind | 'together' | 'independent';
export function attach(doc: MapDoc, target: string, relation: Relation, text: string) {
  const node = doc.get(target);
  if (!node) return null;
  if (relation === 'together') return doc.addPremise(isGroup(node) ? target : node.parent ?? '', undefined, text);
  if (relation === 'independent') {
    const group = isGroup(node) ? node : doc.get(node.parent);
    return group?.parent && isGroup(group) ? doc.addGroup(group.parent, group.kind as GroupKind, text)?.premiseId : null;
  }
  return doc.addGroup(target, relation, text)?.premiseId;
}
export function splitClaim(doc: MapDoc, id: string, cursor: number, relation: Relation) {
  const node = doc.get(id);
  if (node?.kind !== 'claim') return;
  const left = node.text.slice(0, cursor).trim(), right = node.text.slice(cursor).trim();
  if (!left || !right) return;
  doc.ydoc.transact(() => {
    if (attach(doc, id, relation, right)) doc.setText(id, left);
  }, doc);
}
export function reuse(doc: MapDoc, source: string, target: string) {
  const node = doc.get(source);
  if (node?.kind !== 'claim' || source === target || doc.get(target)?.kind !== 'claim') return;
  doc.ydoc.transact(() => {
    const id = attach(doc, target, 'reason', node.text);
    if (!id) return;
    const sharedClaim = node.sharedClaim ?? newId();
    doc.update(source, { sharedClaim });
    doc.update(id, { sharedClaim });
  }, doc);
}
export function challenge(doc: MapDoc, id: string, text: string) {
  if (!isGroup(doc.get(id)) || !text.trim()) return;
  doc.ydoc.transact(() => {
    const note = doc.addSticky(text);
    doc.update(note, { challengesInference: id });
    doc.addConnection(note, id);
  }, doc);
}
export function addExcerpt(doc: MapDoc, passage: string, start: number, end: number, target?: string) {
  const quote = passage.slice(start, end);
  if (!quote.trim()) return;
  doc.ydoc.transact(() => {
    const id = target ? attach(doc, target, 'reason', quote) : doc.addRoot(quote);
    if (id) doc.update(id, { passage, excerpt: [start, end] });
  }, doc);
}
export function breadcrumb(doc: MapDoc, id: string) {
  const path: MapNode[] = [], seen = new Set<string>();
  let node = doc.get(id);
  while (node && !seen.has(node.id)) {
    path.unshift(node); seen.add(node.id); node = doc.get(node.parent);
  }
  return path;
}
/** Trace affected inference groups; another support group preserves an independent route. */
export function affected(doc: MapDoc, id: string) {
  const ids = new Set([id]);
  for (const node of breadcrumb(doc, id).reverse()) {
    if (!node.parent) break;
    const parent = doc.get(node.parent);
    if (!parent) break;
    if (node.kind === 'objection') break;
    if (node.kind === 'reason' && doc.children(parent.id).some(g => g.kind === 'reason' && g.id !== node.id)) break;
    ids.add(parent.id);
  }
  return ids;
}
export function changes(before: MapNode[], after: MapNode[]) {
  const old = new Map(before.map(n => [n.id,n])), now = new Set(after.map(n => n.id));
  const rows: {node: MapNode; change: string}[] = [];
  for (const n of after) {
    const p = old.get(n.id);
    if (!p) rows.push({node:n,change:'Added'});
    else {
      if (p.text !== n.text) rows.push({node:n,change:'Text edited'});
      if (p.parent !== n.parent || p.kind !== n.kind || p.stance !== n.stance) rows.push({node:n,change:'Argument changed'});
      if (['x','y','dx','dy'].some(k => p[k as keyof MapNode] !== n[k as keyof MapNode])) rows.push({node:n,change:'Position changed'});
    }
  }
  for (const n of before) if (!now.has(n.id)) rows.push({node:n,change:'Removed'});
  return rows;
}
export function exercise(file: MapFile, hidden: Set<string>) {
  const escape = (s:string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const rows: string[] = [], seen = new Set<string>();
  function visit(n: MapNode, depth: number) {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    const value = hidden.has(n.id) ? (isGroup(n) ? 'Relationship: __________' : 'Claim: ____________________') : escape(n.text || n.kind);
    rows.push('<p style="margin-inline-start:'+ depth*1.4 +'em" dir="auto">'+value+'</p>');
    file.nodes.filter(c=>c.parent===n.id).sort((a,b)=>a.order-b.order).forEach(c=>visit(c,depth+1));
  }
  file.nodes.filter(n=>!n.parent).forEach(n=>visit(n,0));
  return '<!doctype html><meta charset="utf-8"><title>Argument exercise</title><h1>'+escape(file.title)+'</h1>'+rows.join('');
}
export function jump(doc: MapDoc, id: string, reveal: (id:string)=>void) {
  if (!doc.has(id)) return false;
  reveal(id); return true;
}
export function dropLabel(node:MapNode, moving?:MapNode) {
  return isGroup(node) ? 'Add premise to '+node.kind : (moving?.kind === 'objection' ? 'Object to: ' : 'Support: ')+node.text;
}
