// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Invitation, LanPresence, Mdns, MdnsService } from '../electron/lan-presence';

/** A pretend mDNS network: what is published is what browsers see. */
function fakeNetwork() {
  const services: Record<string, MdnsService[]> = { argmap: [], 'argmap-person': [] };
  const browsers: Array<{ type: string; ev: EventEmitter }> = [];
  const mdns: Mdns = {
    publish(o) {
      const svc: MdnsService = { name: o.name, port: o.port, addresses: ['127.0.0.1'], txt: o.txt };
      services[o.type].push(svc);
      browsers.filter((b) => b.type === o.type).forEach((b) => b.ev.emit('up', svc));
      return { stop: () => (services[o.type] = services[o.type].filter((x) => x !== svc)) };
    },
    find(o) {
      const ev = new EventEmitter();
      browsers.push({ type: o.type, ev });
      return { get services() { return services[o.type]; }, on: (e, fn) => ev.on(e, fn), update: () => {}, stop: () => {} };
    },
  };
  return { mdns, services };
}

const made: LanPresence[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  for (const p of made.splice(0)) await p.stop();
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

async function presence(mdns: Mdns) {
  const p = new LanPresence(mdns);
  made.push(p);
  await p.start();
  return p;
}

describe('people and maps on the network', () => {
  it('lists other people with the app open, not yourself, and hides people who turn it off', async () => {
    const net = fakeNetwork();
    const sara = await presence(net.mdns);
    const ali = await presence(net.mdns);
    sara.setMe({ name: 'Sara', color: '#e8590c', deviceId: 'sara-device-1', visible: true });
    ali.setMe({ name: 'Ali', color: '#1c7ed6', deviceId: 'ali-device-22', visible: true });
    expect(sara.nearby().people.map((p) => p.name)).toEqual(['Ali']);
    expect(ali.nearby().people.map((p) => p.name)).toEqual(['Sara']);
    ali.setMe({ name: 'Ali', color: '#1c7ed6', deviceId: 'ali-device-22', visible: false });
    expect(sara.nearby().people).toEqual([]);
  });

  it('shows shared maps with how many people are in them', async () => {
    const net = fakeNetwork();
    const info = http.createServer((_req, res) => res.end(JSON.stringify({ people: 3 })));
    servers.push(info);
    await new Promise<void>((r) => info.listen(0, '127.0.0.1', r));
    const port = (info.address() as { port: number }).port;
    net.mdns.publish({ name: 'Remote work (pc)', type: 'argmap', port, txt: { title: 'Remote work', by: 'Mohammad' } });
    const p = await presence(net.mdns);
    await p.refresh();
    expect(p.nearby().hosts).toEqual([
      { name: 'Remote work (pc)', title: 'Remote work', hostName: 'Mohammad', address: '127.0.0.1', port, people: 3 },
    ]);
    // Our own shared map is not listed for ourselves.
    p.ownHost = { port, addresses: ['10.0.0.5'] };
    expect(p.nearby().hosts).toEqual([]);
  });

  it('delivers an invitation that points back at the computer that sent it', async () => {
    const net = fakeNetwork();
    const host = await presence(net.mdns);
    const guest = await presence(net.mdns);
    guest.setMe({ name: 'Ali', color: '#1c7ed6', deviceId: 'ali-device-22', visible: true });
    const got: Invitation[] = [];
    guest.on('invitation', (i: Invitation) => got.push(i));
    const ali = host.nearby().people[0];
    await host.invite(ali, { from: 'Mohammad', fromColor: '#ae3ec9', title: 'Remote work', port: 47821, role: 'view', invite: 'tok' });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ from: 'Mohammad', title: 'Remote work', address: '127.0.0.1', port: 47821, role: 'view', invite: 'tok' });

    // Someone who turned visibility off can't be invited.
    guest.setMe({ name: 'Ali', color: '#1c7ed6', deviceId: 'ali-device-22', visible: false });
    await expect(host.invite(ali, { from: 'M', fromColor: '#000000', title: 't', port: 1, role: 'edit', invite: 'x' })).rejects.toThrow();
  });
});
