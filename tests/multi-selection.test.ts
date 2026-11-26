// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Editor } from '../src/editor';
import { approxMeasure } from '../src/layout/measure';
import { cmd } from '../src/commands';

function fixture(){
  const e=new Editor(approxMeasure);
  const a=e.doc.addRoot('Conclusion',200,50);
  const g=e.doc.addGroup(a,'objection','First')!;
  const second=e.doc.addPremise(g.groupId,undefined,'Second')!;
  return {e,a,...g,second};
}

it('moves a selected ancestor and child by the delta only once',()=>{
  const {e,a,premiseId}=fixture();
  const before=e.layout.boxes.get(premiseId)!;
  e.drop([a,premiseId],null,40,-30);
  expect(e.layout.boxes.get(premiseId)?.x).toBe(before.x+40);
  expect(e.doc.get(premiseId)?.dy).toBeUndefined();
});
it('detaches selected branches in one undo step and preserves a nested selection',()=>{
  const {e,groupId,premiseId,second}=fixture();
  const child=e.doc.addGroup(second,'reason','Detail')!;
  e.select([premiseId,second,child.premiseId]);e.detach();
  for(const id of [premiseId,second])expect(e.doc.get(id)).toMatchObject({parent:null,stance:'objection'});
  expect(e.doc.get(child.premiseId)?.parent).toBe(child.groupId);
  e.undo();expect(e.doc.children(groupId)).toHaveLength(2);
});
it('joins a group as joint objections and rejects an invalid mixed drop atomically',()=>{
  const {e,a,groupId,premiseId,second}=fixture();
  const target=e.doc.addRoot('Target');
  const sticky=e.doc.addSticky('Annotation');
  expect(e.joinBranches([premiseId,sticky],target)).toBe(false);
  expect(e.doc.get(groupId)?.parent).toBe(a);
  expect(e.joinBranches([premiseId,second],target)).toBe(true);
  expect(e.doc.get(groupId)).toMatchObject({parent:target,kind:'objection'});
  expect(e.doc.children(groupId)).toHaveLength(2);
  e.undo();expect(e.doc.get(groupId)?.parent).toBe(a);
});
it('preserves a subset of linked premises when attaching only part of a group',()=>{
  const {e,groupId,premiseId,second}=fixture();
  const third=e.doc.addPremise(groupId,undefined,'Third')!,target=e.doc.addRoot('Destination');
  e.joinBranches([premiseId,second],target);
  const newGroup=e.doc.children(target)[0];
  expect(newGroup.kind).toBe('objection');expect(e.doc.children(newGroup.id)).toHaveLength(2);
  expect(e.doc.get(third)?.parent).toBe(groupId);
});
it('copies internal sticky links into a fresh selection, then deletes and undoes as a unit',()=>{
  const {e,premiseId,a}=fixture();const sticky=e.doc.addSticky('Check');
  e.doc.addConnection(sticky,premiseId);e.doc.addConnection(sticky,a);
  e.select([sticky,premiseId]);e.pasteText(e.copyText(),true);
  const [newSticky,newClaim]=e.selection;
  expect(e.doc.get(newClaim)?.stance).toBe('objection');
  expect(e.doc.allConnections().filter(c=>c.from===newSticky).map(c=>c.to)).toEqual([newClaim]);
  e.deleteSelection();expect(e.doc.has(newSticky)||e.doc.has(newClaim)).toBe(false);
  e.undo();expect(e.doc.has(newSticky)&&e.doc.has(newClaim)).toBe(true);
});
it('converts attached and unlinked colored boxes into conclusions and keeps descendants',()=>{
  const {e,premiseId,groupId}=fixture();const sub=e.doc.addGroup(premiseId,'reason','Data')!;
  e.select([premiseId]);cmd('edit.conclusion').run(e);
  expect(e.doc.get(premiseId)?.parent).toBeNull();expect(e.doc.get(premiseId)?.stance).toBeUndefined();
  expect(e.doc.get(sub.groupId)?.parent).toBe(premiseId);e.undo();
  expect(e.doc.get(premiseId)?.parent).toBe(groupId);
  e.select([premiseId]);e.detach();cmd('edit.conclusion').run(e);expect(e.doc.get(premiseId)?.stance).toBeUndefined();
});
it('keeps linked premises together when promoting their entire bracket',()=>{
  const {e,groupId}=fixture();e.select([groupId]);e.makeConclusion();
  expect(e.doc.get(groupId)?.parent).toBe(e.primary);expect(e.doc.children(groupId)).toHaveLength(2);
  expect(e.doc.get(e.primary)?.parent).toBeNull();
});

it('pastes jointly selected co-premises under a single fresh group on the destination',()=>{
  const {e,groupId,premiseId,second}=fixture(),target=e.doc.addRoot('Target');
  e.doc.setText(groupId,'Because of cost');e.doc.setPremiseStance(second,'reason');
  e.select([premiseId,second]);const clipboard=e.copyText();e.select([target]);e.pasteText(clipboard);
  const groups=e.doc.children(target);expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({kind:'objection',text:'Because of cost'});
  expect(e.doc.children(groups[0].id)).toHaveLength(2);expect(e.doc.get(e.selection[1])?.stance).toBe('reason');
});
