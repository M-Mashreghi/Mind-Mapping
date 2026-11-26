// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '../src/editor';
import { approxMeasure } from '../src/layout/measure';
import { ArgumentWorkspace } from '../src/ui/ArgumentWorkspace';

let editor:Editor, host:HTMLDivElement, root:ReturnType<typeof createRoot>, claim:string, premise:string, group:string;
function Wrapper(){useSyncExternalStore(editor.subscribe,editor.getVersion);return <ArgumentWorkspace editor={editor} close={()=>{}}/>;}
async function click(label:string) {
  const b=Array.from(host.querySelectorAll('button')).find(v=>v.textContent?.trim()===label);
  expect(b,label).toBeDefined();await act(async()=>b!.click());
}
async function select(id:string){await act(async()=>editor.select([id]));}
async function change(el:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string) {
  const proto=Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);
  await act(async()=>el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true})));
}
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('CSS',{escape:(v:string)=>v});
  editor=new Editor(approxMeasure);editor.loadFile({format:'argument-mapper',version:1,title:'Test',nodes:[]});
  claim=editor.doc.addRoot('Conclusion');const g=editor.doc.addGroup(claim,'reason','First premise')!;
  premise=g.premiseId;group=g.groupId;editor.select([premise]);
  host=document.body.appendChild(document.createElement('div'));root=createRoot(host);
  await act(async()=>root.render(<Wrapper/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('offers the correct contextual reply and joint/independent controls',async()=>{
  await click('Add a joint premise');expect(editor.doc.children(group)).toHaveLength(2);
  await select(premise);await click('Add independent argument');expect(editor.doc.children(claim)).toHaveLength(2);
  await select(claim);await click('Raise objection');await click('Reply to objection');expect(editor.doc.all().filter(n=>n.kind==='objection')).toHaveLength(2);
});
it('edits an outline row without losing the original box',async()=>{
  await click('Outline');await change(host.querySelector<HTMLInputElement>('#outline-'+premise)!,'Revised');expect(editor.doc.get(premise)?.text).toBe('Revised');
});
it('attaches evidence from fields and extracts the selected source range',async()=>{
  await click('Evidence');const inputs=host.querySelectorAll<HTMLInputElement>('fieldset input');
  await change(inputs[0],'Journal');await change(inputs[1],'p4');await change(host.querySelector('fieldset textarea')!,'A quotation');await click('Attach evidence');
  expect(editor.doc.get(premise)?.evidence?.[0]).toEqual({source:'Journal',page:'p4',quote:'A quotation'});
  const area=host.querySelector<HTMLTextAreaElement>('[aria-label="Source passage"]')!;await change(area,'One. Two.');area.setSelectionRange(5,9);await click('Create claim from selection');expect(editor.doc.all().find(n=>n.passage)?.text).toBe('Two.');
});
it('toggles focus and assumption analysis without changing document contents',async()=>{
  const before=editor.doc.toFile();await click('Review');await click('Focus this branch');expect(host.querySelector('style')?.textContent).toContain('visibility:hidden');await click('Show full map');await click('Set assumption aside');expect(host.querySelector('style')?.textContent).toContain('opacity:.22');await click('Restore assumption');expect(editor.doc.toFile()).toEqual(before);
});
it('adds and answers a question and converts it to an objection',async()=>{
  await click('Review');const ask=vi.spyOn(window,'prompt').mockReturnValue('Why?');await click('Ask a question');ask.mockReturnValue('Because');await click('Answer');expect(editor.doc.get(premise)?.questions?.[0].answer).toBe('Because');await click('Convert to objection');expect(editor.doc.get(premise)?.questions).toEqual([]);expect(editor.doc.all().some(n=>n.text==='Why?')).toBe(true);
});
it('filters objections by their manually selected review state',async()=>{
  await select(claim);await click('Raise objection');await click('Review');await change(host.querySelector<HTMLSelectElement>('[aria-label="Objection status"]')!,'resolved');await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());expect(host.querySelector('[aria-label="Objection status"]')).toBeNull();
});
it('splits at the chosen cursor and keeps the selected relationship',async()=>{
  const area=host.querySelector<HTMLTextAreaElement>('[aria-label="Place split cursor"]')!;area.setSelectionRange(5,5);await click('Split here');expect(editor.doc.get(premise)?.text).toBe('First');expect(editor.doc.children(premise)[0].kind).toBe('reason');
});
it('reuses the selected claim at another location',async()=>{
  const picker=host.querySelector<HTMLSelectElement>('select:has(option[value="'+claim+'"])')!;await change(picker,claim);await click('Use as a reason there');expect(editor.doc.all().filter(n=>n.sharedClaim)).toHaveLength(2);
});
it('captures an idea and places it on a selected claim',async()=>{
  await change(host.querySelector<HTMLInputElement>('[aria-label="New idea"]')!,'A new idea');await click('Capture idea');expect(editor.doc.all().some(n=>n.tray)).toBe(true);await click('Place on selected claim');expect(editor.doc.all().find(n=>n.text==='A new idea')?.kind).toBe('claim');
});
it('challenges an inference and targets its group rather than the conclusion',async()=>{
  await select(group);vi.spyOn(window,'prompt').mockReturnValue('Confounding factor');await click('Challenge this inference');expect(editor.doc.allConnections()[0].to).toBe(group);
});
it('navigates to a pasted internal box link',async()=>{
  await click('Review');vi.spyOn(window,'prompt').mockReturnValue('#node='+claim);await click('Go to box link');expect(editor.primary).toBe(claim);
});
it('renders before and after entries for saved versions',async()=>{
  editor.history=[{savedAt:'yesterday',title:'Test',nodes:editor.doc.all()}];await act(async()=>editor.doc.setText(premise,'After'));await click('Review');expect(host.querySelector('tbody')?.textContent).toContain('First premiseAfter');
});
it('lets a teacher select claims for a downloadable worksheet',async()=>{
  await click('Exercise');const download=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Download worksheet')!;expect(download.disabled).toBe(true);await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());expect(download.disabled).toBe(false);
});
