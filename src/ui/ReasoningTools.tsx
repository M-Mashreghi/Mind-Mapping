import {useState} from 'react';
import {createPortal} from 'react-dom';
import type {Editor} from '../editor';
import {branchProse,critiqueCards,decide,suggest,supportCycles} from '../model/reasoning';
import {isGroup} from '../model/types';

export function ReasoningTools({editor:e,section}:{editor:Editor;section:'Build'|'Review'|'Output'}){
  const d=e.doc,n=d.get(e.primary),write=!e.readOnly,world=document.querySelector('.world');
  const [tidy,setTidy]=useState(''),[scheme,setScheme]=useState<keyof typeof critiqueCards>('Causation');
  const [paths,setPaths]=useState<string[][]|null>(null),[active,setActive]=useState(-1);
  const [proposal,setProposal]=useState('wording'),[draft,setDraft]=useState(''),[group,setGroup]=useState('');
  const [prose,setProse]=useState(''),[ends,setEnds]=useState(false),[format,setFormat]=useState<'png'|'svg'>('png');
  const [preview,setPreview]=useState('');
  const mark=(id:string,label:string)=>{
    const b=e.layout.boxes.get(id);
    return b&&<div key={id} className="reason-highlight" style={{left:b.x,top:b.y,width:b.w,height:b.h}}>{label&&<span>{label}</span>}</div>;
  };
  function copy(text:string){void navigator.clipboard.writeText(text).then(()=>e.flash('Copied.'),()=>e.flash('Select the text and copy it manually.'));}
  if(section==='Build')return <>{n&&<details><summary>Box direction and layout</summary>
    <label>Writing direction<select disabled={!write} value={n.style?.direction??'auto'} onChange={ev=>d.setStyle([n.id],{direction:ev.target.value==='auto'?undefined:ev.target.value as 'rtl'|'ltr'})}><option value="auto">Automatic</option><option value="rtl">Right to left</option><option value="ltr">Left to right</option></select></label>
    {n.kind==='claim'&&<button disabled={!write} onClick={()=>{if(!e.tidyPreview(n.id).length)e.flash('This branch is already arranged.');else setTidy(n.id);}}>Preview tidy branch</button>}
    {tidy===n.id&&<><p>Dashed outlines show the new positions.</p>{world&&createPortal(e.tidyPreview(n.id).map(b=><div key={b.id} className="tidy-preview" style={{left:b.x,top:b.y,width:b.w,height:b.h}}/>),world)}
      <button disabled={!write} onClick={()=>{d.resetPosition(d.subtreeIds(n.id).filter(id=>id!==n.id));setTidy('');}}>Apply layout</button><button onClick={()=>setTidy('')}>Cancel preview</button></>}
  </details>}</>;
  if(section==='Output')return <>
    <h3>Branch to prose</h3><button disabled={n?.kind!=='claim'} onClick={()=>setProse(branchProse(d,n!.id))}>Draft from selected claim</button>
    <textarea dir="auto" aria-label="Editable argument draft" value={prose} onChange={ev=>setProse(ev.target.value)}/><button disabled={!prose} onClick={()=>copy(prose)}>Copy draft</button>
    <h3>Selection image</h3><p>{e.selection.length} selected. Shift-click boxes to add them.</p>
    <label>Crossing connections<select value={ends?'include':'omit'} onChange={ev=>setEnds(ev.target.value==='include')}><option value="omit">Omit crossing lines</option><option value="include">Include their endpoints</option></select></label>
    <label>Format<select value={format} onChange={ev=>setFormat(ev.target.value as 'png'|'svg')}><option value="png">Transparent PNG</option><option value="svg">SVG</option></select></label>
    <button disabled={!e.selection.length} onClick={()=>void e.exportSelection(format,ends,true)}>Copy image</button><button disabled={!e.selection.length} onClick={()=>void e.exportSelection(format,ends,false)}>Save image</button>
  </>;
  const pending=d.liveComments().filter(c=>c.proposal);
  const current=pending.find(c=>c.id===preview);
  return <>
    <details><summary>Critique cards</summary><label>Argument type<select value={scheme} onChange={ev=>setScheme(ev.target.value as keyof typeof critiqueCards)}>{Object.keys(critiqueCards).map(k=><option key={k}>{k}</option>)}</select></label>
    {critiqueCards[scheme].map(q=><button key={q} disabled={!write||!n} onClick={()=>{if(n)d.update(n.id,{questions:[...(n.questions??[]),{text:q,answer:''}]});}}>{q}</button>)}</details>
    <details><summary>Circular reasoning</summary><button onClick={()=>{const found=supportCycles(d.all());setPaths(found);setActive(found.length?0:-1);}}>Trace support cycles</button>
    {paths?.length===0&&<p>No circular support found.</p>}{paths?.map((path,i)=><button key={i} onClick={()=>{setActive(i);e.scrollIntoView(path[0]);}}>{path.filter((_,j)=>j%3!==1).map(id=>d.get(id)?.text||'Claim').join(' → ')}</button>)}
    {paths&&active>=0&&world&&createPortal([...new Set(paths[active])].map(id=>mark(id,'')),world)}
    {active>=0&&<button onClick={()=>setActive(-1)}>Clear highlight</button>}</details>
    <details><summary>Suggestions ({pending.length})</summary>
    <fieldset disabled={!write||n?.kind!=='claim'}><label>Suggest a change<select value={proposal} onChange={ev=>setProposal(ev.target.value)}><option value="wording">Replace wording</option><option value="joint">Move into a premise group</option></select></label>
    {proposal==='wording'?<textarea aria-label="Suggested wording" value={draft} onChange={ev=>setDraft(ev.target.value)}/>:<select aria-label="Proposed premise group" value={group} onChange={ev=>setGroup(ev.target.value)}><option value="">Choose a group…</option>{d.all().filter(v=>isGroup(v)&&n&&n.parent!==v.id&&d.canMove(n.id,v.id)).map(v=><option key={v.id} value={v.id}>{v.kind} · {d.children(v.id).map(p=>p.text).join(' + ')}</option>)}</select>}
    <button disabled={proposal==='wording'?!draft.trim():!group} onClick={()=>{if(!n)return;suggest(d,n.id,e.user?.name||'Editor',proposal==='wording'?{kind:'wording',before:n.text,after:draft.trim()}:{kind:'joint',before:n.parent,group});setDraft('');}}>Submit suggestion</button></fieldset>
    {pending.map(c=><div key={c.id}><p>{c.author} · {c.text}</p><button onClick={()=>{e.scrollIntoView(c.node);setPreview(c.id);}}>Preview on map</button>
    {write&&e.collab?.role!=='guest'&&<><button onClick={()=>{if(!decide(d,c.id,true))e.flash('The box changed. Review the suggestion again.');}}>Accept</button><button onClick={()=>decide(d,c.id,false)}>Reject</button></>}</div>)}
    {current&&world&&createPortal(<>{mark(current.node,current.text)}{current.proposal?.kind==='joint'&&mark(current.proposal.group,'Proposed group')}</>,world)}
    {current&&<button onClick={()=>setPreview('')}>Close preview</button>}</details>
  </>;
}
