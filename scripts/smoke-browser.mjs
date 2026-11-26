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
const browser = spawn('google-chrome', ['--headless', '--disable-dev-shm-usage', '--remote-debugging-port=9222',
  '--user-data-dir=' + profile, 'http://127.0.0.1:4173'], { stdio: 'inherit' });
let socket;
async function until(check) {
  for (let i = 0; i < 100; i++) {
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
  await evaluate(add + '.focus()');
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
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
  console.log('Chrome passed: Enter opens Add, reason and objection insertion, cut without clipboard.');
} finally {
  socket?.close();
  const closed = new Promise(resolve => browser.once('close', resolve));
  browser.kill();
  await closed;
  await new Promise(resolve => server.httpServer.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}
