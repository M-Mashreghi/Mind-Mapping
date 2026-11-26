// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {Editor} from '../src/editor';
import {approxMeasure} from '../src/layout/measure';
import {MapDoc} from '../src/model/doc';

function setup(){
  const e=new Editor(approxMeasure),root=e.doc.addRoot('Conclusion');
  const {groupId,premiseId}=e.doc.addGroup(root,'reason','A')!;
  const second=e.doc.addPremise(groupId,undefined,'B')!;
  return {e,groupId,premiseId,second};
}
it('drops a co-premise as a root with its subtree and shrinks the original bracket',()=>{
  const {e,groupId,second}=setup();
  const child=e.doc.addGroup(second,'reason','Evidence')!;
  e.doc.setPremiseStance(second,'objection');
  const before=e.layout.boxes.get(groupId)!.w,box=e.layout.boxes.get(second)!;
  e.drop([second],null,120,90,true);
  expect(e.doc.get(second)).toMatchObject({parent:null,x:Math.round(box.x+box.w/2+120),y:Math.round(box.y+90)});
  expect(e.doc.get(second)?.stance).toBeUndefined();
  expect(e.layout.boxes.get(groupId)!.w).toBeLessThan(before);
  expect(e.doc.get(child.groupId)?.parent).toBe(second);
  const copy=new MapDoc();copy.load(e.doc.toFile());expect(copy.get(second)?.parent).toBeNull();
  e.undo();expect(e.doc.get(second)?.parent).toBe(groupId);expect(e.doc.get(second)?.stance).toBe('objection');
});
it('cleans up the last bracket and restores both premises in one undo step',()=>{
  const {e,groupId,premiseId,second}=setup();e.drop([premiseId,second],null,100,100,true);
  expect(e.layout.boxes.has(groupId)).toBe(false);e.undo();expect(e.doc.children(groupId)).toHaveLength(2);
});
it('keeps the argument attached during a nudge or drop inside its own bracket',()=>{
  const {e,groupId,second}=setup();e.drop([second],null,12,6,false);
  expect(e.doc.get(second)?.parent).toBe(groupId);e.drop([second],groupId,0,8,false);
  expect(e.doc.get(second)).toMatchObject({parent:groupId,dx:12,dy:14});
});
