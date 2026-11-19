// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { CollabServer } from '../electron/collab-server';
import { MapDoc, newMapFile } from '../src/model/doc';

const servers: CollabServer[] = [];
const providers: WebsocketProvider[] = [];

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  for (const s of servers.splice(0)) await s.stop();
});

async function start() {
  const s = new CollabServer();
  servers.push(s);
  const info = await s.start({ port: 0, host: '127.0.0.1' });
  return { s, info };
}

function connect(port: number, code: string, doc = new Y.Doc()) {
  const p = new WebsocketProvider(`ws://127.0.0.1:${port}`, 'map', doc, {
    params: { code },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  providers.push(p);
  return { doc, p };
}

const until = async (fn: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('LAN collaboration server', () => {
  it('syncs a map between the host and a guest, both ways', async () => {
    const { info } = await start();
    const host = new MapDoc();
    host.load(newMapFile('Shared'));
    const root = host.roots()[0].id;
    connect(info.port, info.editCode, host.ydoc);

    const guest = new MapDoc();
    connect(info.port, info.editCode, guest.ydoc);
    await until(() => guest.has(root));
    expect(guest.title).toBe('Shared');

    guest.addGroup(root, 'objection', 'from the guest');
    await until(() => host.children(root).length === 1);
    host.setText(root, 'edited by host');
    await until(() => guest.get(root)?.text === 'edited by host');
  });

  it('ignores edits from view-only guests', async () => {
    const { info } = await start();
    const host = new MapDoc();
    host.load(newMapFile('Shared'));
    const root = host.roots()[0].id;
    connect(info.port, info.editCode, host.ydoc);

    const viewer = new MapDoc();
    connect(info.port, info.viewCode, viewer.ydoc);
    await until(() => viewer.has(root));
    viewer.setText(root, 'vandalism');
    host.addGroup(root, 'reason', 'later edit');
    await until(() => viewer.children(root).length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(host.get(root)!.text).toBe('Main claim');
  });

  it('rejects a wrong code', async () => {
    const { info } = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/map?code=WRONG1`);
    const result = await new Promise<string>((r) => {
      ws.on('open', () => r('open'));
      ws.on('error', () => r('error'));
      ws.on('unexpected-response', () => r('rejected'));
    });
    expect(result).not.toBe('open');
  });

  it('shares presence between participants', async () => {
    const { info } = await start();
    const a = connect(info.port, info.editCode);
    const b = connect(info.port, info.editCode);
    a.p.awareness.setLocalStateField('user', { name: 'Sara', color: '#f00' });
    await until(() => [...b.p.awareness.getStates().values()].some((s) => s.user?.name === 'Sara'));
  });
});

describe('role check', () => {
  it('tells edit and view codes apart', async () => {
    const { info } = await start();
    const base = `http://127.0.0.1:${info.port}`;
    const { checkCode } = await import('../src/collab/session');
    expect(await checkCode(base, info.editCode)).toBe('edit');
    expect(await checkCode(base, info.viewCode.toLowerCase())).toBe('view');
    await expect(checkCode(base, 'NOPE00')).rejects.toThrow(/code is not right/);
  });
});
