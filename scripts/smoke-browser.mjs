import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { preview } from 'vite';
import WebSocket from 'ws';

const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
const profile = await mkdtemp(join(tmpdir(), 'argmap-chrome-'));
const browser = spawn('google-chrome', ['--headless', '--no-first-run', '--disable-background-networking', '--disable-dev-shm-usage', '--remote-debugging-port=9222',
  '--user-data-dir=' + profile, 'http://127.0.0.1:4173'], { stdio: 'inherit' });
let socket;
async function until(check) {
  for (let i = 0; i < 400; i++) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw Error('Timed out waiting for browser state');
}
try {
  console.log('Connecting to Chrome');
  const page = await until(async () => {
    try {
      const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
      return pages.find(p => p.type === 'page' && p.url.includes('4173'));
    } catch { return false; }
  });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let seq = 0;
  function send(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      function onMessage(data) {
        const response = JSON.parse(data.toString());
        if (response.id !== id) return;
        socket.off('message', onMessage);
        if (response.error) reject(Error(response.error.message));
        else resolve(response.result);
      }
      socket.on('message', onMessage);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description ?? expression);
    return reply.result.value;
  }
  const add = 'document.querySelector(\'button[aria-label="Add to map"]\')';
  console.log('Waiting for Add');
  await until(() => evaluate('!!' + add));
  await evaluate('window.argmapEditor.finishEditing(null)');
  await until(() => evaluate('(' + add + '.focus(), document.activeElement === ' + add + ')'));

  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : '' });
  }
  console.log('Checking keyboard-opened menu');
  await until(() => evaluate(add + '.getAttribute("aria-expanded") === "true"'));
  const items = 'Array.from(document.querySelectorAll(\'.dock [role="menuitem"]\'))';
  await evaluate(items + '.find(b => b.textContent.includes("Independent claim")).click()');
  for (const [label, kind] of [['supports the claim', 'reason'], ['challenges the claim', 'objection']]) {
    const count = 'window.argmapEditor.doc.all().filter(n => n.kind === ' + JSON.stringify(kind) + ').length';
    console.log('Inserting', kind);
    const before = await evaluate(count);
    await evaluate(add + '.click()');
    await evaluate(items + '.find(b => b.textContent.includes(' + JSON.stringify(label) + ')).click()');
    await until(() => evaluate(count + ' === ' + (before + 1)));
  }
  await evaluate('window.argmapEditor.finishEditing(null)');
  const beforeCut = await evaluate('window.argmapEditor.doc.all().length');
  await evaluate('document.dispatchEvent(new ClipboardEvent("cut", { bubbles: true, cancelable: true }))');
  assert.equal(await evaluate('window.argmapEditor.doc.all().length'), beforeCut);
  const clickLabel = async label => evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==='+JSON.stringify(label)+').click()');
  await clickLabel('Workspace');
  for (const tab of ['Outline','Evidence','Review','Exercise','Output','Build']) {
    await clickLabel(tab);
    await until(()=>evaluate('document.querySelector(".argument-workspace nav button[aria-pressed=true]").textContent === '+JSON.stringify(tab)));
  }
  await evaluate('window.argmapEditor.addSticky(); window.argmapEditor.finishEditing("Review note")');
  await until(()=>evaluate('!!document.querySelector(\'select[aria-label="Target box"]\')'));
  await evaluate(`const picker=document.querySelector(\'select[aria-label="Target box"]\');picker.value=window.argmapEditor.doc.all().find(n=>n.kind==='claim').id;picker.dispatchEvent(new Event('change',{bubbles:true}));`);
  await clickLabel('Attach with dashed line');
  await until(()=>evaluate('!!document.querySelector(\'.connection-line[stroke-dasharray="6 5"]\')'));
  await evaluate(`document.querySelector('[aria-label="Close workspace"]').click()`);
  const fixture=await evaluate(`(() => {
    const e=window.argmapEditor;
    const root=e.doc.addRoot('Drop target',120,85), note=e.doc.addSticky('Drag me',420,80);
    e.select([note]); e.setView({x:0,y:0,zoom:1});
    return {root,note};
  })()`);
  const point = async(selector)=>evaluate('(() => {const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
  const from=await point('[data-wire="'+fixture.note+'"]'), to=await point('.claim[data-node-id="'+fixture.root+'"]');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...from});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...to,buttons:1});
  await until(()=>evaluate('!!document.querySelector(".wire-preview")'));
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',clickCount:1});
  await until(()=>evaluate('window.argmapEditor.doc.allConnections().some(c=>c.from==='+JSON.stringify(fixture.note)+'&&c.to==='+JSON.stringify(fixture.root)+')'));
  const premises=await evaluate(`(() => {
    const e=window.argmapEditor;
    e.loadFile({format:'argument-mapper',version:1,title:'Detach check',nodes:[]});
    const root=e.doc.addRoot('Conclusion',225,30);
    const g=e.doc.addGroup(root,'reason','First');
    const second=e.doc.addPremise(g.groupId,undefined,'Second');
    e.setView({x:0,y:0,zoom:1});return {...g,second};
  })()`);
  const box='[data-node-id="'+premises.second+'"]';
  const bracket='.group[data-node-id="'+premises.groupId+'"]';
  const width=await evaluate('document.querySelector('+JSON.stringify(bracket)+').getBoundingClientRect().width');
  const start=await point('.claim'+box);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...start});
  const toggle=await point('.claim'+box+' > .stance-switch');
  for(const expected of ['in-objection','in-reason']){
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...toggle,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...toggle,button:'left',clickCount:1});
    await until(()=>evaluate('document.querySelector('+JSON.stringify('.claim'+box)+').classList.contains('+JSON.stringify(expected)+')'));
  }
  const end={x:start.x+120,y:start.y+90};
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...start});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...end,buttons:1});
  await until(()=>evaluate('!!document.querySelector(".detach-hint")'));
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1});
  await until(()=>evaluate('document.querySelector('+JSON.stringify('.claim.in-reason:not(.root)'+box)+') !== null && window.argmapEditor.doc.get('+JSON.stringify(premises.second)+').parent === null'));
  assert.equal(await evaluate('document.querySelector('+JSON.stringify('.claim'+box+' .node-label')+')'),null);
  assert.equal(await evaluate('!!document.querySelector('+JSON.stringify('.claim'+box+' .stance-bar')+')'),false);
  assert.ok(await evaluate('document.querySelector('+JSON.stringify(bracket)+').getBoundingClientRect().width')<width);
  const floatingPoint = await point('.claim'+box);
  const parentPoint = await point('.claim.root[data-node-id="'+(await evaluate('window.argmapEditor.doc.get('+JSON.stringify(premises.groupId)+').parent'))+'"]');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...floatingPoint});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...floatingPoint,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...parentPoint,buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...parentPoint,button:'left',clickCount:1});
  await until(()=>evaluate('window.argmapEditor.doc.get(window.argmapEditor.doc.get('+JSON.stringify(premises.second)+').parent)?.kind === "reason"'));
  const multi=await evaluate(`(() => {
    const e=window.argmapEditor;
    e.loadFile({format:'argument-mapper',version:1,title:'Selection',nodes:[]});
    const a=e.doc.addRoot('Piece A',120,100),b=e.doc.addRoot('Piece B',360,100);
    e.setView({x:0,y:0,zoom:1});return {a,b};
  })()`);
  const region=await evaluate(`(() => {
    const boxes=Array.from(document.querySelectorAll('.canvas .claim'),el=>el.getBoundingClientRect());
    return {x:Math.min(...boxes.map(b=>b.left))-6,y:Math.min(...boxes.map(b=>b.top))-6,
      right:Math.max(...boxes.map(b=>b.right))+6,bottom:Math.max(...boxes.map(b=>b.bottom))+6};
  })()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:region.x,y:region.y,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:region.right,y:region.bottom,buttons:1});
  await until(()=>evaluate('document.querySelectorAll(".canvas .claim.selected").length===2'));
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:region.right,y:region.bottom,button:'left',clickCount:1});
  await until(()=>evaluate('window.argmapEditor.selection.length===2'));
  const pa=await point('.claim[data-node-id="'+multi.a+'"]');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...pa,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pa.x+24,y:pa.y+32,buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pa.x+24,y:pa.y+32,button:'left',clickCount:1});
  await until(()=>evaluate('window.argmapEditor.doc.get('+JSON.stringify(multi.b)+').x===384'));
  await evaluate('(() => {const s=document.querySelector(".multi-selection select");s.value='+JSON.stringify(multi.a)+';s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await until(()=>evaluate('window.argmapEditor.doc.get('+JSON.stringify(multi.b)+').parent!==null'));
  const pb=await point('.claim[data-node-id="'+multi.b+'"]');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...pb,button:'right',buttons:2,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...pb,button:'right',clickCount:1});
  await until(()=>evaluate('!!document.querySelector(".context-menu")'));
  await evaluate('Array.from(document.querySelectorAll(".context-menu .menu-item")).find(el=>el.textContent.includes("Make Ultimate Conclusion")).click()');
  await until(()=>evaluate('!!document.querySelector('+JSON.stringify('.claim.root[data-node-id="'+multi.b+'"]')+')'));
  const groupDrop = await evaluate(`(() => {
    const e=window.argmapEditor;
    e.loadFile({format:'argument-mapper',version:1,title:'Shared bracket',nodes:[]});
    const root=e.doc.addRoot('Conclusion',280,26), g=e.doc.addGroup(root,'reason','First');
    const second=e.doc.addPremise(g.groupId,undefined,'Second'), third=e.doc.addPremise(g.groupId,undefined,'Third');
    e.doc.addGroup(root,'objection','Objection');
    e.select([g.premiseId,second]); e.setView({x:0,y:0,zoom:.8});
    return {first:g.premiseId,second,third,id:g.groupId,width:e.layout.boxes.get(g.groupId).w};
  })()`);
  const origin=await point('.claim[data-node-id="'+groupDrop.first+'"]');
  const dropAt={x:origin.x+28,y:origin.y+98};
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...origin,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...dropAt,buttons:1});
  await until(()=>evaluate('!!document.querySelector(".detach-hint")'));
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...dropAt,button:'left',clickCount:1});
  const check=JSON.stringify(groupDrop);
  await until(()=>evaluate(`(()=>{const g=${check},e=window.argmapEditor;
    return [g.first,g.second].every(id=>e.doc.get(id).parent===null && e.doc.get(id).stance==='reason' && !e.labels.has(id))
      && e.doc.get(g.third).parent===g.id && e.layout.boxes.get(g.id).w<g.width;})()`));
  console.log('Chrome passed: dragging two co-premises out shrinks a three-premise bracket');

  await evaluate('window.dispatchEvent(new Event("argmap:theme"))');
  await until(()=>evaluate('Array.from(document.querySelectorAll(".tabs button")).some(b=>b.textContent==="Color")'));
  await clickLabel('Color');
  for(const mode of ['dark','light']){
    await evaluate('window.argmapEditor.setAppearance('+JSON.stringify(mode)+')');
    await until(()=>evaluate(`(() => {
      const swatches=Array.from(document.querySelectorAll('.theme-body input[type=color]'),i=>i.value.toLowerCase());
      const props=['--bg','--reason-ink','--reason-fill','--reason-line','--objection-ink','--objection-fill','--objection-line','--root-ink','--root-fill','--root-line'];
      const style=getComputedStyle(document.querySelector('.canvas'));
      return document.documentElement.dataset.theme==='${mode}' && swatches.length===props.length &&
        props.every((name,i)=>style.getPropertyValue(name).trim().toLowerCase()===swatches[i]);
    })()`));
  }
  await evaluate('window.argmapEditor.setTheme({reason:{...window.argmapEditor.doc.theme.reason,fill:"#123456"}})');
  await until(()=>evaluate('document.querySelectorAll(".theme-body input[type=color]")[2].value==="#123456"'));
  await evaluate('document.querySelectorAll(".theme-body input[type=color]")[2].closest("label").querySelector("button").click()');
  await until(()=>evaluate('document.querySelectorAll(".theme-body input[type=color]")[2].value===getComputedStyle(document.querySelector(".canvas")).getPropertyValue("--reason-fill").trim() && !window.argmapEditor.doc.theme.reason.fill'));
  console.log('Chrome passed: all ten theme picker swatches match canvas defaults in light and dark, including custom/reset');
  console.log('Chrome passed: rectangle selection, multi-drag, join and right-click promotion');
  console.log('Chrome passed: floating green premise without conclusion badge, then drag to reconnect');
  console.log('Chrome passed: hover stance switch in both directions and detached co-premise bracket shrink');
  console.log('Chrome passed: drag handle, live preview and attachment');
  console.log('Chrome passed: workspace tabs and dashed sticky attachment');
  console.log('Chrome passed: Enter opens Add, reason and objection insertion, cut without clipboard.');
} finally {
  socket?.close();
  const closed = new Promise(resolve => browser.once('close', resolve));
  browser.kill();
  await closed;
  await new Promise(resolve => server.httpServer.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}
