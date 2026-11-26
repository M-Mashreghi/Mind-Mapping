import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../editor';
import { ReasoningTools } from './ReasoningTools';
import { promoteSticky } from '../model/reasoning';
import { affected, attach, breadcrumb, changes, challenge, exercise, addExcerpt, jump, reuse, splitClaim, type Relation } from '../model/workspace';
import { isGroup, stanceOf } from '../model/types';
import './argument-workspace.css';

export function ArgumentWorkspace({editor:e, close}:{editor:Editor;close:()=>void}) {
  const d=e.doc, nodes=d.all(), n=d.get(e.primary), write=!e.readOnly;
  const [tab,setTab]=useState('Build'), [target,setTarget]=useState(''), [text,setText]=useState('');
  const [source,setSource]=useState(''), [page,setPage]=useState(''), [quote,setQuote]=useState('');
  const [relation,setRelation]=useState<Relation>('reason'), [passage,setPassage]=useState('');
  const [focus,setFocus]=useState(''), [off,setOff]=useState(''), [version,setVersion]=useState(0);
  const [otherVersion,setOtherVersion]=useState(-1);
  const [hidden,setHidden]=useState<Set<string>>(new Set()), [openOnly,setOpenOnly]=useState(false);
  const split=useRef<HTMLTextAreaElement>(null), article=useRef<HTMLTextAreaElement>(null);
  const name=(id:string)=>{const v=d.get(id); return v?.text || v?.kind || 'Removed';};
  function go(id:string) {
    jump(d,id,k=>{e.select([k]);e.scrollIntoView(k);});
  }
  function edit(id:string|null|undefined){ if(id){go(id);e.startEditing(id);} }
  const visible=focus && d.has(focus) ? new Set(d.subtreeIds(focus)) : null;
  const dim=off && d.has(off) ? affected(d,off) : new Set<string>();
  const hideCss=(!visible && !dim.size ? [] : nodes).flatMap(v=>{
    const escaped=CSS.escape(v.id);
    const sel=['data-node-id','data-edge','data-from','data-to'].map(key=>'.canvas ['+key+'="'+escaped+'"]').join(',');
    return visible&&!visible.has(v.id) ? [sel+'{visibility:hidden}'] : dim.has(v.id) ? [sel+'{opacity:.22}'] : [];
  }).join('');
  const targetPicker=(allow:(id:string)=>boolean)=> <label>Target box<select aria-label="Target box" value={target} onChange={ev=>setTarget(ev.target.value)}><option value="">Choose a box…</option>{nodes.filter(v=>allow(v.id)).map(v=><option key={v.id} value={v.id}>{name(v.id)}</option>)}</select></label>;
  const relationPicker=<label>Relationship<select value={relation} onChange={ev=>setRelation(ev.target.value as Relation)}><option value="reason">Supports this claim</option><option value="objection">Challenges this claim</option>{n?.parent && <><option value="independent">Another independent argument for the same conclusion</option><option value="together">Works only with this premise</option></>}</select></label>;
  const openLink=(value:string)=>{
    const id=new URLSearchParams(value.slice(value.indexOf('#')+1)).get('node');
    if (!id || !jump(d,id,go)) e.flash('Open the shared map containing this box first.');
  };
  useEffect(()=>{
    const onHash=()=>{if(location.hash.startsWith('#node=')) openLink(location.hash);};
    window.addEventListener('hashchange',onHash);
    return ()=>window.removeEventListener('hashchange',onHash);
  },[d]);
  return <aside className="argument-workspace" aria-label="Argument workspace">
    {hideCss && <style>{hideCss}</style>}
    <header><strong>Argument workspace</strong><button onClick={close} aria-label="Close workspace">×</button></header>
    <nav>{['Build','Outline','Evidence','Review','Exercise','Output'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</nav>
    {(tab==='Build'||tab==='Review'||tab==='Output')&&<ReasoningTools key={tab} section={tab} editor={e}/>}
    {focus && <div>Branch: {breadcrumb(d,focus).map(v=>v.text||v.kind).join(' › ')} <button onClick={()=>setFocus('')}>Show full map</button></div>}
    {off && <button onClick={()=>setOff('')}>Restore assumption</button>}
    {tab==='Build' && <>
      <h3>{n ? name(n.id) : 'Select a claim or sticky note on the map'}</h3>
      {!n&&write&&<button onClick={()=>e.addRoot()}>Start a claim</button>}
      <fieldset disabled={!write}>
      {n?.kind==='claim' && <>
        {!n.parent && !n.stance && <button onClick={()=>d.setPremiseStance(n.id,'reason')}>Make unlinked reason</button>}
        <button onClick={()=>edit(attach(d,n.id,'reason',''))}>Give a reason</button>
        <button onClick={()=>edit(attach(d,n.id,'objection',''))}>{stanceOf(n,d.get(n.parent))==='objection'?'Reply to objection':'Raise objection'}</button>
        {n.parent && <><button onClick={()=>edit(attach(d,n.id,'together',''))}>Add a joint premise</button><button onClick={()=>edit(attach(d,n.id,'independent',''))}>Add independent argument</button></>}
        <details><summary>Split claim at cursor</summary><textarea ref={split} key={n.id+n.text} defaultValue={n.text} readOnly aria-label="Place split cursor"/>{relationPicker}<button onClick={()=>splitClaim(d,n.id,split.current?.selectionStart??0,relation)}>Split here</button></details>
        <details><summary>Reuse claim elsewhere</summary>{targetPicker(id=>id!==n.id&&d.get(id)?.kind==='claim')}<button disabled={!target} onClick={()=>reuse(d,n.id,target)}>Use as a reason there</button>{n.sharedClaim && nodes.filter(v=>v.sharedClaim===n.sharedClaim).map(v=><button key={v.id} onClick={()=>go(v.id)}>{breadcrumb(d,v.id).map(x=>x.text||x.kind).join(' › ')}</button>)}</details>
      </>}
      {isGroup(n) && <><button onClick={()=>edit(d.addPremise(n!.id))}>Add a joint premise</button><button onClick={()=>{const q=window.prompt('What challenges this inference?');if(q)challenge(d,n!.id,q);}}>Challenge this inference</button></>}
      {n?.kind==='sticky' && <><h3>Link sticky note</h3>{targetPicker(id=>id!==n.id)}<button disabled={!target} onClick={()=>e.connectTo(target)}>Attach with dashed line</button><button disabled={d.get(target)?.kind!=='claim'} onClick={()=>{if(promoteSticky(d,n.id,target))go(n.id);}}>Convert note to a reason</button></>}
      </fieldset>
      <h3>Idea tray</h3><form onSubmit={ev=>{ev.preventDefault();if(write&&text.trim()){const id=d.addSticky(text);d.update(id,{tray:true});setText('');}}}><input aria-label="New idea" value={text} onChange={ev=>setText(ev.target.value)}/><button disabled={!write||!text.trim()}>Capture idea</button></form>
      {nodes.filter(v=>v.tray).map(v=><div key={v.id} draggable={write} onDragStart={ev=>ev.dataTransfer.setData('application/x-argument-idea',v.id)}>{v.text} <button disabled={!write||n?.kind!=='claim'} onClick={()=>{if(n&&attach(d,n.id,relation,v.text))d.remove([v.id]);}}>Place on selected claim</button></div>)}
      {nodes.some(v=>v.tray)&&relationPicker}
    </>}
    {tab==='Outline' && <>
      {d.roots().flatMap(root=>d.subtreeIds(root.id)).map(id=>{const v=d.get(id)!;return <div className="outline-row" key={id} style={{marginInlineStart:Math.min(d.depth(id),8)*8}}>
        <button onClick={()=>go(id)} aria-label={'Locate '+name(id)}>{v.kind}</button><input dir="auto" aria-label={'Edit '+v.kind} readOnly={!write} value={v.text} onChange={ev=>d.setText(id,ev.target.value)} onKeyDown={ev=>{if(write&&ev.key==='Enter'){const child=v.kind==='claim'?attach(d,id,'reason',''):isGroup(v)?d.addPremise(id):null;if(child){go(child);requestAnimationFrame(()=>document.getElementById('outline-'+child)?.focus());}}}} id={'outline-'+id}/></div>;})}
    </>}
    {tab==='Evidence' && <>
      <fieldset disabled={!write||!n}><legend>Source for selected box</legend>
      <label>Source or URL<input value={source} onChange={ev=>setSource(ev.target.value)}/></label><label>Page<input value={page} onChange={ev=>setPage(ev.target.value)}/></label><label>Quotation<textarea value={quote} onChange={ev=>setQuote(ev.target.value)}/></label>
      <button disabled={!source.trim()} onClick={()=>{if(n){d.update(n.id,{evidence:[...(n.evidence??[]),{source,page,quote}]});setSource('');setPage('');setQuote('');}}}>Attach evidence</button></fieldset>
      {n?.evidence?.map((v,i)=><blockquote key={i}>{v.quote}<cite>{v.source} {v.page}</cite></blockquote>)}
      <h3>Extract from a passage</h3><textarea aria-label="Source passage" ref={article} value={passage} onChange={ev=>setPassage(ev.target.value)}/><button disabled={!write} onClick={()=>{const el=article.current;if(el)addExcerpt(d,passage,el.selectionStart,el.selectionEnd,n?.kind==='claim'?n.id:undefined);}}>Create claim from selection</button>
      {n?.passage && n.excerpt && <details><summary>Original passage</summary>{n.passage.slice(0,n.excerpt[0])}<mark>{n.passage.slice(...n.excerpt)}</mark>{n.passage.slice(n.excerpt[1])}</details>}
    </>}
    {tab==='Review' && <>
      {n && <><button onClick={()=>setFocus(n.id)}>Focus this branch</button>{n.kind==='claim'&&<button onClick={()=>setOff(n.id)}>Set assumption aside</button>}
      <button onClick={async()=>{const link=(location.protocol==='file:'?'':location.href.split('#')[0])+'#node='+encodeURIComponent(n.id);try{await navigator.clipboard.writeText(link);e.flash('Box link copied');}catch{window.prompt('Copy box link',link);}}}>Copy box link</button>
      <fieldset disabled={!write}><button onClick={()=>{const q=window.prompt('Open question');if(q?.trim())d.update(n.id,{questions:[...(n.questions??[]),{text:q,answer:''}]});}}>Ask a question</button>
      {n.questions?.map((q,i)=><div key={i}>{q.text} {q.answer}<button onClick={()=>{const answer=window.prompt('Answer',q.answer);if(answer!==null)d.update(n.id,{questions:n.questions!.map((v,k)=>k===i?{...v,answer}:v)});}}>Answer</button>{n.kind==='claim'&&<button onClick={()=>{if(attach(d,n.id,'objection',q.text))d.update(n.id,{questions:n.questions!.filter((_,k)=>k!==i)});}}>Convert to objection</button>}</div>)}</fieldset></>}
      <button onClick={()=>{const s=window.prompt('Paste box link');if(s)openLink(s);}}>Go to box link</button>
      <h3>Objections</h3><label><input type="checkbox" checked={openOnly} onChange={ev=>setOpenOnly(ev.target.checked)}/> Open only</label>
      {nodes.filter(v=>v.kind==='objection'&&(!openOnly||!v.review||v.review==='open')).map(v=><div key={v.id}><button onClick={()=>go(v.id)}>{d.children(v.id).map(p=>p.text).join(' + ')||'Objection'}</button><select aria-label="Objection status" disabled={!write} value={v.review??'open'} onChange={ev=>d.update(v.id,{review:ev.target.value as 'open'|'partial'|'resolved'})}><option>open</option><option>partial</option><option>resolved</option></select></div>)}
      <h3>Compare saved version</h3>{!e.history.length?'Save a version to compare.':<><select aria-label="Earlier version" value={version} onChange={ev=>setVersion(Number(ev.target.value))}>{e.history.map((v,i)=><option key={i} value={i}>{v.savedAt}</option>)}</select><select aria-label="Compare against" value={otherVersion} onChange={ev=>setOtherVersion(Number(ev.target.value))}><option value={-1}>Current map</option>{e.history.map((h,i)=><option key={i} value={i}>{h.savedAt}</option>)}</select>
      <table><thead><tr><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>{changes(e.history[version]?.nodes??[],e.history[otherVersion]?.nodes??nodes).map((c,i)=>{
        const display=(list:typeof nodes)=>{const v=list.find(s=>s.id===c.node.id);if(!v)return '—';if(c.change==='Position changed')return [v.x??0,v.y??0,v.dx??0,v.dy??0].join(', ');if(c.change==='Argument changed'){const parent=list.find(s=>s.id===v.parent);return [v.kind,parent?.text||parent?.kind||'root'].join(' → ');}return v.text||v.kind;};
        return <tr key={i}><td>{c.change}</td><td>{display(e.history[version]?.nodes??[])}</td><td>{display(e.history[otherVersion]?.nodes??nodes)}</td></tr>;
      })}</tbody></table></>}
    </>}
    {tab==='Exercise' && <><p>Select claims or relationships to leave blank on the printable worksheet.</p>{nodes.map(v=><label key={v.id}><input type="checkbox" checked={hidden.has(v.id)} onChange={()=>{const next=new Set(hidden);if(next.has(v.id))next.delete(v.id);else next.add(v.id);setHidden(next);}}/>{name(v.id)}</label>)}<button disabled={!hidden.size} onClick={()=>{const url=URL.createObjectURL(new Blob([exercise(d.toFile(),hidden)],{type:'text/html'}));const a=document.createElement('a');a.href=url;a.download='argument-exercise.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download worksheet</button></>}
  </aside>;
}
