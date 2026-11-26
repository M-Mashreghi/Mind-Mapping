// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {MapDoc} from '../src/model/doc';
import {branchProse,critiqueCards,decide,promoteSticky,selectedLayout,suggest,supportCycles} from '../src/model/reasoning';
import {layoutMap} from '../src/layout/layout';
import {approxMeasure} from '../src/layout/measure';
import {textStyle} from '../src/theme';
import {Editor} from '../src/editor';

it('promotes a linked sticky in place, retaining comments and evidence through undo',()=>{
 const d=new MapDoc(),c=d.addRoot('Claim'),s=d.addSticky('Note');d.addComment(s,'A','Source?');d.update(s,{evidence:[{source:'Report',page:'4',quote:'Fact'}]});d.addConnection(s,c);
 expect(promoteSticky(d,s,c)).toBe(true);expect(d.get(s)?.kind).toBe('claim');expect(d.children(c)[0].kind).toBe('reason');expect(d.commentsFor(s)).toHaveLength(1);expect(d.get(s)?.evidence).toHaveLength(1);expect(d.allConnections()).toHaveLength(1);d.undo.undo();expect(d.get(s)?.kind).toBe('sticky');
});
it('reports the exact structural support cycle across reused claims and ignores note links',()=>{
 const d=new MapDoc(),a=d.addRoot('A'),b=d.addGroup(a,'reason','B')!,again=d.addGroup(b.premiseId,'reason','A')!;d.addConnection(d.addSticky('Tip'),a);expect(supportCycles(d.all())).toEqual([]);
 d.update(a,{sharedClaim:'a'});d.update(again.premiseId,{sharedClaim:'a'});const paths=supportCycles(d.all());expect(paths).toHaveLength(1);expect(new Set(paths[0])).toEqual(new Set([a,b.groupId,b.premiseId,again.groupId,again.premiseId]));d.setGroupKind(again.groupId,'objection');expect(supportCycles(d.all())).toEqual([]);
});
it('suggestions leave the original alone and detect a stale proposal',()=>{
 const d=new MapDoc(),id=d.addRoot('Old');suggest(d,id,'A',{kind:'wording',before:'Old',after:'New'});const c=d.liveComments()[0];expect(d.get(id)?.text).toBe('Old');d.setText(id,'Concurrent');expect(decide(d,c.id,true)).toBe(false);expect(decide(d,c.id,false)).toBe(true);expect(d.get(id)?.text).toBe('Concurrent');
});
it('accepts a proposed joint premise at its chosen group',()=>{
 const d=new MapDoc(),root=d.addRoot('C'),g=d.addGroup(root,'reason')!,id=d.addRoot('Second');suggest(d,id,'A',{kind:'joint',before:null,group:g.groupId});expect(decide(d,d.liveComments()[0].id,true)).toBe(true);expect(d.get(id)?.parent).toBe(g.groupId);
});
it('drafts joint reasons, an objection and its reply in branch order',()=>{
 const d=new MapDoc(),id=d.addRoot('C'),r=d.addGroup(id,'reason','one')!;d.addPremise(r.groupId,undefined,'two');const o=d.addGroup(id,'objection','cost')!;d.addGroup(o.premiseId,'objection','grant');d.addRoot('unrelated');const t=branchProse(d,id);expect(t).toContain('together) — one + two');expect(t.indexOf('cost')).toBeLessThan(t.indexOf('grant'));expect(t).not.toContain('unrelated');
});
it('attaches a critique card as an ordinary persistent question',()=>{
 const d=new MapDoc(),id=d.addRoot('C');for(const cards of Object.values(critiqueCards))expect(cards.length).toBeGreaterThan(1);
 d.update(id,{questions:[{text:critiqueCards.Causation[0],answer:''}]});const restored=new MapDoc();restored.load(d.toFile());expect(restored.get(id)?.questions?.[0].text).toMatch(/factor/);
});
it('persists per-box direction and leaves other boxes automatic',()=>{
 const d=new MapDoc(),a=d.addRoot('نمونه'),b=d.addRoot('Example');d.setStyle([a],{direction:'rtl'});const copy=new MapDoc();copy.load(d.toFile());expect(textStyle(copy.get(a)!,copy.theme)).toMatchObject({direction:'rtl',textAlign:'right'});expect(copy.get(b)?.style?.direction).toBeUndefined();d.setStyle([a],{direction:undefined});expect(d.get(a)?.style?.direction).toBeUndefined();
});
it('crops selection bounds and includes only immediate crossing endpoints on request',()=>{
 const d=new MapDoc(),a=d.addRoot('A',0,0),b=d.addSticky('B',400,0),c=d.addRoot('C',1000,0);d.addConnection(a,b);d.addConnection(b,c);const layout=layoutMap(d.all(),approxMeasure);
 expect([...selectedLayout(layout,[a],d.allConnections(),false).boxes.keys()]).toEqual([a]);const region=selectedLayout(layout,[a],d.allConnections(),true);expect(new Set(region.boxes.keys())).toEqual(new Set([a,b]));expect(region.bounds.w).toBeLessThan(layout.bounds.w);
});
it('previews tidy positions without editing and preserves the anchor and other roots',()=>{
 const e=new Editor(approxMeasure),d=e.doc,root=d.addRoot('Root'),other=d.addRoot('Other',500),g=d.addGroup(root,'reason','R')!;d.nudge(g.groupId,30,50);const before=d.toFile(),proposed=e.tidyPreview(root);expect(proposed.some(b=>b.id===g.groupId)).toBe(true);expect(d.toFile()).toEqual(before);d.resetPosition(d.subtreeIds(root).filter(x=>x!==root));expect(e.tidyPreview(root)).toEqual([]);expect(d.get(other)?.x).toBe(500);
});