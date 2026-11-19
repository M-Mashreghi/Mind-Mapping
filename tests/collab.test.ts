// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { CollabServer } from '../electron/collab-server';
import { MapDoc, newMapFile } from '../src/model/doc';
import { requestAccess, CollabSession, ControlMessage } from '../src/collab/session';

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

function connect(port: number, ticket: string, doc = new Y.Doc()) {
  const p = new WebsocketProvider(`ws://127.0.0.1:${port}`, 'map', doc, {
    params: { ticket },
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

let n = 0;
const identity = () => ({ deviceId: `device-${++n}-xxxxxxxx`, key: `key-${n}-0123456789abcdef0123` });

/** Ask to join; when the host is asked, `decide` answers for them. */
async function ask(
  s: CollabServer,
  port: number,
  opts: { name?: string; want?: 'edit' | 'view'; id?: { deviceId: string; key: string }; color?: string },
  decide?: (requestId: string) => void,
) {
  let waited = false;
  const res = await requestAccess(
    `http://127.0.0.1:${port}`,
    { name: opts.name ?? 'Sara', color: opts.color ?? '#e8590c', want: opts.want ?? 'edit' },
    {
      identity: opts.id ?? identity(),
      onWaiting: () => {
        waited = true;
        const r = s.state().requests.at(-1)!;
        setTimeout(() => decide?.(r.id), 10);
      },
    },
  );
  return { ...res, waited };
}

describe('LAN collaboration server', () => {
  it('syncs a map between the host and an admitted guest, both ways', async () => {
    const { s, info } = await start();
    const host = new MapDoc();
    host.load(newMapFile('Shared'));
    const root = host.roots()[0].id;
    connect(info.port, info.hostTicket, host.ydoc);

    const a = await ask(s, info.port, {}, (id) => void s.approve(id, 'edit'));
    expect(a.role).toBe('edit');
    const guest = new MapDoc();
    connect(info.port, a.ticket, guest.ydoc);
    await until(() => guest.has(root));
    expect(guest.title).toBe('Shared');

    guest.addGroup(root, 'objection', 'from the guest');
    await until(() => host.children(root).length === 1);
    host.setText(root, 'edited by host');
    await until(() => guest.get(root)?.text === 'edited by host');
  });

  it('lets the host turn an edit request into view only, and ignores the viewer’s edits', async () => {
    const { s, info } = await start();
    const host = new MapDoc();
    host.load(newMapFile('Shared'));
    const root = host.roots()[0].id;
    connect(info.port, info.hostTicket, host.ydoc);

    const a = await ask(s, info.port, { want: 'edit' }, (id) => void s.approve(id, 'view'));
    expect(a.role).toBe('view');
    const viewer = new MapDoc();
    connect(info.port, a.ticket, viewer.ydoc);
    await until(() => viewer.has(root));
    viewer.setText(root, 'vandalism');
    host.addGroup(root, 'reason', 'later edit');
    await until(() => viewer.children(root).length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(host.get(root)!.text).toBe('Main claim');
  });

  it('turns people away when the host says no, and refuses sockets without a ticket', async () => {
    const { s, info } = await start();
    await expect(ask(s, info.port, {}, (id) => s.deny(id))).rejects.toThrow(/did not let you in/);
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/map?ticket=made-up`);
    const result = await new Promise<string>((r) => {
      ws.on('open', () => r('open'));
      ws.on('error', () => r('error'));
      ws.on('unexpected-response', () => r('rejected'));
    });
    expect(result).not.toBe('open');
  });

  it('lets "always allowed" people back in without asking, until the host stops allowing them', async () => {
    const saved: unknown[] = [];
    const trust = { load: async () => [], save: async (l: unknown[]) => void saved.push(structuredClone(l)) };
    const s = new CollabServer();
    servers.push(s);
    const info = await s.start({ port: 0, host: '127.0.0.1', trust: trust as never });
    const me = identity();

    const first = await ask(s, info.port, { id: me }, (id) => void s.approve(id, 'edit', true));
    expect(first.waited).toBe(true);
    expect(s.state().trusted.map((t) => t.name)).toEqual(['Sara']);
    expect(saved.length).toBe(1);

    const again = await ask(s, info.port, { id: me });
    expect(again.waited).toBe(false);
    expect(again.role).toBe('edit');

    // Someone who copied the device id but not its key still has to ask.
    const imposter = ask(s, info.port, { id: { deviceId: me.deviceId, key: 'another-key-0123456789' } }, (id) => s.deny(id));
    await expect(imposter).rejects.toThrow(/did not let you in/);

    await s.forget(me.deviceId);
    const later = await ask(s, info.port, { id: me }, (id) => void s.approve(id, 'view'));
    expect(later.waited).toBe(true);
    expect(later.role).toBe('view');
  });

  it('allows once only for this sharing session', async () => {
    const { s, info } = await start();
    const me = identity();
    await ask(s, info.port, { id: me }, (id) => void s.approve(id, 'edit'));
    expect(s.state().trusted).toEqual([]);
    const again = await ask(s, info.port, { id: me }, (id) => void s.approve(id, 'edit'));
    expect(again.waited).toBe(true);
  });

  it('shows the host who is in, and lets them change roles and remove people live', async () => {
    const { s, info } = await start();
    const host = new MapDoc();
    host.load(newMapFile('Shared'));
    const root = host.roots()[0].id;
    connect(info.port, info.hostTicket, host.ydoc);

    const a = await ask(s, info.port, { name: 'Ali', want: 'view' }, (id) => void s.approve(id, 'view'));
    const guestDoc = new MapDoc();
    const got: ControlMessage[] = [];
    const session = new CollabSession(
      `ws://127.0.0.1:${info.port}`, a.ticket, guestDoc.ydoc, { name: 'Ali', color: a.color }, () => {}, (m) => got.push(m),
      WebSocket as unknown as typeof globalThis.WebSocket,
    );
    try {
      await until(() => guestDoc.has(root));
      await until(() => s.state().guests.some((g) => g.name === 'Ali' && g.online));
      const g = s.state().guests[0];
      expect(g.role).toBe('view');

      await s.setRole(g.id, 'edit');
      await until(() => got.some((m) => m.type === 'role' && m.role === 'edit'));
      guestDoc.setText(root, 'now I can edit');
      await until(() => host.get(root)?.text === 'now I can edit');

      await s.remove(g.id);
      await until(() => got.some((m) => m.type === 'removed'));
      await until(() => s.state().guests.length === 0);
    } finally {
      session.destroy();
    }
  });

  it('gives each person their own cursor colour', async () => {
    const { s, info } = await start();
    const a = await ask(s, info.port, { color: '#1c7ed6' }, (id) => void s.approve(id, 'edit'));
    const b = await ask(s, info.port, { color: '#1c7ed6' }, (id) => void s.approve(id, 'edit'));
    expect(a.color).toBe('#1c7ed6');
    expect(b.color).not.toBe('#1c7ed6');
  });

  it('shares presence between participants', async () => {
    const { s, info } = await start();
    const x = await ask(s, info.port, {}, (id) => void s.approve(id, 'edit'));
    const a = connect(info.port, info.hostTicket);
    const b = connect(info.port, x.ticket);
    a.p.awareness.setLocalStateField('user', { name: 'Sara', color: '#f00' });
    await until(() => [...b.p.awareness.getStates().values()].some((st) => st.user?.name === 'Sara'));
  });
});
