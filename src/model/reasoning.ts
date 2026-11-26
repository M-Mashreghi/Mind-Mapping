import { MapDoc, newId } from './doc';
import { isGroup, stanceOf, type MapNode, type Proposal } from './types';
import type { LayoutResult } from '../layout/layout';

export const critiqueCards = {
  Causation: ['Could another factor explain the outcome?', 'Did the cause precede the effect?', 'What comparison isolates this effect?'],
  Analogy: ['Which difference matters most here?', 'Do the relevant similarities support this conclusion?'],
  Authority: ['What qualifies this source on this question?', 'Is there independent evidence for the claim?'],
  Generalization: ['How representative is the sample?', 'Which cases would limit this conclusion?'],
};

export function promoteSticky(doc: MapDoc, id: string, target: string) {
  if (doc.get(id)?.kind !== 'sticky' || doc.get(target)?.kind !== 'claim') return false;
  doc.ydoc.transact(() => {
    const group = doc.addGroup(target, 'reason')!;
    doc.update(id, {kind:'claim', parent:group.groupId, order:1, tray:undefined, challengesInference:undefined,
      x:undefined,y:undefined,w:undefined,h:undefined,dx:undefined,dy:undefined});
    doc.remove([group.premiseId]);
  },doc);
  return true;
}

/** Each edge is a supporting premise occurrence and the conclusion it supports. */
export function supportCycles(nodes:MapNode[]): string[][] {
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const key=(n:MapNode)=>n.sharedClaim ? 'shared:'+n.sharedClaim : 'node:'+n.id;
  const edges=new Map<string,{to:string;path:string[]}[]>();
  for(const premise of nodes){
    const group=byId.get(premise.parent??''), conclusion=byId.get(group?.parent??'');
    if(premise.kind!=='claim'||group?.kind!=='reason'||!conclusion||stanceOf(premise,group)!=='reason')continue;
    const k=key(premise), list=edges.get(k)??[];
    list.push({to:key(conclusion),path:[premise.id,group.id,conclusion.id]});edges.set(k,list);
  }
  const done=new Set<string>(), active=new Map<string,number>(), trail:string[][]=[], cycles:string[][]=[];
  function walk(k:string){
    active.set(k,trail.length);
    for(const edge of edges.get(k)??[]){
      const index=active.get(edge.to);
      if(index!==undefined)cycles.push([...trail.slice(index),edge.path].flat());
      else if(!done.has(edge.to)){trail.push(edge.path);walk(edge.to);trail.pop();}
    }
    active.delete(k);done.add(k);
  }
  for(const k of edges.keys())if(!done.has(k))walk(k);
  return cycles;
}

export function branchProse(doc:MapDoc,root:string){
  const paragraphs:string[]=[],seen=new Set<string>();
  function visit(id:string,opening:string){
    const node=doc.get(id);if(!node||seen.has(id))return;seen.add(id);
    paragraphs.push(opening+node.text);
    for(const group of doc.children(id).filter(isGroup)){
      const premises=doc.children(group.id);
      const label=group.kind==='reason'?'Supporting reason':'Objection';
      paragraphs.push(label+(premises.length>1?' (these premises work together)':'')+' — '+premises.map(p=>p.text).join(' + '));
      for(const p of premises)if(doc.children(p.id).length)visit(p.id,group.kind==='objection'?'Discussion of the objection — ':'Further support or objections to — ');
    }
  }
  visit(root,'Conclusion — ');return paragraphs.join('\n\n');
}

export function suggest(doc:MapDoc,id:string,author:string,proposal:Proposal){
  if(!doc.has(id))return;
  const key=newId();
  doc.comments.set(key,{id:key,node:id,author,at:new Date().toISOString(),text:proposal.kind==='wording'?proposal.after:'Use as a joint premise',proposal});
}
export function decide(doc:MapDoc,id:string,accept:boolean){
  const comment=doc.comments.get(id),p=comment?.proposal;if(!comment||!p)return false;
  if(!accept){doc.removeComment(id);return true;}
  const node=doc.get(comment.node);
  if(!node || (p.kind==='wording'?node.text!==p.before:node.parent!==p.before||!isGroup(doc.get(p.group))||!doc.canMove(node.id,p.group)))return false;
  doc.ydoc.transact(()=>{if(p.kind==='wording')doc.setText(node.id,p.after);else doc.move(node.id,p.group);doc.removeComment(id);},doc);
  return true;
}
export function selectedLayout(layout:LayoutResult,selection:string[],links:{from:string;to:string}[],includeEnds:boolean):LayoutResult {
  const ids=new Set(selection);
  if(includeEnds)for(const edge of [...layout.edges,...links])if(selection.includes(edge.from)||selection.includes(edge.to)){ids.add(edge.from);ids.add(edge.to);}
  const boxes=new Map([...layout.boxes].filter(([id])=>ids.has(id)));
  if(!boxes.size)throw Error('Select a visible box first.');
  const list=[...boxes.values()],x=Math.min(...list.map(b=>b.x)),y=Math.min(...list.map(b=>b.y));
  return {boxes,edges:layout.edges.filter(e=>boxes.has(e.from)&&boxes.has(e.to)),bounds:{x,y,w:Math.max(...list.map(b=>b.x+b.w))-x,h:Math.max(...list.map(b=>b.y+b.h))-y}};
}
