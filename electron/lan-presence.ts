/**
 * Who is around on the local network.
 *
 * Every desktop app that has a name (and hasn't turned this off) announces itself over
 * mDNS as an `argmap-person`, with a small "inbox" HTTP server where hosts can send an
 * invitation. The app also keeps watching the network for shared maps (`argmap`) and
 * for people, and asks each shared map how many people are in it.
 */
import http from 'node:http';
import { EventEmitter } from 'node:events';

export interface Me {
  name: string;
  color: string;
  deviceId: string;
  visible: boolean;
}

export interface NearbyHost {
  name: string;
  title: string;
  hostName: string;
  address: string;
  port: number;
  /** People in the map right now, the host included. Null until the host answers. */
  people: number | null;
}

export interface NearbyPerson {
  deviceId: string;
  name: string;
  color: string;
  address: string;
  port: number;
}

export interface Nearby {
  hosts: NearbyHost[];
  people: NearbyPerson[];
}

export interface Invitation {
  id: string;
  from: string;
  fromColor: string;
  title: string;
  address: string;
  port: number;
  role: 'edit' | 'view';
  invite: string;
  at: number;
}

/** The parts of bonjour-service this needs (so tests can fake it). */
export interface MdnsService {
  name: string;
  port: number;
  host?: string;
  addresses?: string[];
  txt?: Record<string, unknown>;
}
export interface MdnsBrowser {
  readonly services: MdnsService[];
  on(ev: 'up' | 'down', fn: (s: MdnsService) => void): unknown;
  update(): void;
  stop(): void;
}
export interface Mdns {
  publish(opts: { name: string; type: string; port: number; txt?: Record<string, string> }): { stop?: CallableFunction };
  find(opts: { type: string }): MdnsBrowser;
}

const ipv4 = (s: MdnsService) => (s.addresses ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? s.host ?? '';
const txt = (s: MdnsService, k: string) => String((s.txt as Record<string, unknown> | undefined)?.[k] ?? '');
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

export class LanPresence extends EventEmitter {
  private me: Me | null = null;
  private published: { stop?: CallableFunction } | null = null;
  private inbox: http.Server | null = null;
  private inboxPort = 0;
  private hostsBrowser: MdnsBrowser | null = null;
  private peopleBrowser: MdnsBrowser | null = null;
  private counts = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private last = '';
  /** Our own shared map, hidden from our own list. */
  ownHost: { port: number; addresses: string[] } | null = null;

  constructor(private mdns: Mdns, private fetchImpl: typeof fetch = fetch) {
    super();
  }

  /** Open the inbox and start watching the network. */
  async start(): Promise<void> {
    if (this.inbox) return;
    this.inbox = http.createServer((req, res) => void this.onInbox(req, res));
    await new Promise<void>((r) => this.inbox!.listen(0, '0.0.0.0', r));
    this.inboxPort = (this.inbox.address() as { port: number }).port;
    try {
      this.hostsBrowser = this.mdns.find({ type: 'argmap' });
      this.peopleBrowser = this.mdns.find({ type: 'argmap-person' });
      for (const b of [this.hostsBrowser, this.peopleBrowser]) {
        b.on('up', () => this.changed());
        b.on('down', () => this.changed());
      }
    } catch {
      // No multicast on this network: joining by address still works.
    }
    this.timer = setInterval(() => void this.refresh(), 4000);
    this.timer.unref?.();
  }

  get port(): number {
    return this.inboxPort;
  }

  /** Who we are, and whether others may see us. Re-announces when it changes. */
  setMe(me: Me): void {
    const next: Me = {
      name: clean(me.name, 40),
      color: /^#[0-9a-f]{6}$/i.test(me.color) ? me.color : '#868e96',
      deviceId: clean(me.deviceId, 64),
      visible: !!me.visible,
    };
    if (JSON.stringify(next) === JSON.stringify(this.me)) return;
    this.me = next;
    this.unpublish();
    if (next.visible && next.name && next.deviceId && this.inboxPort) {
      try {
        this.published = this.mdns.publish({
          name: `${next.name} (${next.deviceId.slice(0, 6)})`.slice(0, 63),
          type: 'argmap-person',
          port: this.inboxPort,
          txt: { name: next.name, color: next.color, id: next.deviceId },
        });
      } catch {
        /* discovery is a convenience */
      }
    }
  }

  private unpublish() {
    try {
      this.published?.stop?.();
    } catch {
      /* ignore */
    }
    this.published = null;
  }

  nearby(): Nearby {
    const own = this.ownHost;
    const hosts = new Map<string, NearbyHost>();
    for (const s of this.hostsBrowser?.services ?? []) {
      const address = ipv4(s);
      if (!address) continue;
      if (own && s.port === own.port && (own.addresses.includes(address) || address.startsWith('127.'))) continue;
      const key = `${address}:${s.port}`;
      hosts.set(key, {
        name: s.name,
        title: txt(s, 'title') || s.name,
        hostName: txt(s, 'by') || txt(s, 'host'),
        address,
        port: s.port,
        people: this.counts.get(key) ?? null,
      });
    }
    const people = new Map<string, NearbyPerson>();
    for (const s of this.peopleBrowser?.services ?? []) {
      const deviceId = txt(s, 'id');
      const address = ipv4(s);
      if (!deviceId || !address || deviceId === this.me?.deviceId) continue;
      people.set(deviceId, { deviceId, name: txt(s, 'name') || s.name, color: txt(s, 'color'), address, port: s.port });
    }
    return { hosts: [...hosts.values()], people: [...people.values()] };
  }

  private changed() {
    const n = this.nearby();
    const key = JSON.stringify(n);
    if (key === this.last) return;
    this.last = key;
    this.emit('change', n);
  }

  /** Ask every shared map how many people are in it, and look again now and then. */
  async refresh(): Promise<void> {
    if (++this.tick % 3 === 0) {
      try {
        this.hostsBrowser?.update();
        this.peopleBrowser?.update();
      } catch {
        /* ignore */
      }
    }
    const hosts = this.nearby().hosts;
    await Promise.all(
      hosts.map(async (h) => {
        const key = `${h.address}:${h.port}`;
        try {
          const res = await this.fetchImpl(`http://${key}/api/info`, { signal: AbortSignal.timeout(2500) });
          const body = (await res.json()) as { people?: number };
          if (typeof body.people === 'number') this.counts.set(key, body.people);
        } catch {
          this.counts.delete(key);
        }
      }),
    );
    this.changed();
  }

  /** Send someone an invitation to the map we are sharing. */
  async invite(person: { address: string; port: number }, inv: { from: string; fromColor: string; title: string; port: number; role: 'edit' | 'view'; invite: string }): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(`http://${person.address}:${person.port}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inv),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      throw new Error('Could not reach them. They may have closed the app.');
    }
    if (!res.ok) throw new Error('They could not be invited right now.');
  }

  private async onInbox(req: http.IncomingMessage, res: http.ServerResponse) {
    const done = (status: number) => res.writeHead(status, { 'Content-Type': 'text/plain' }).end();
    if (req.method !== 'POST' || req.url !== '/invite') return done(404);
    if (!this.me?.visible) return done(403);
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) return done(413);
    }
    try {
      const b = JSON.parse(raw) as Record<string, unknown>;
      // The invitation points at the computer that sent it, never somewhere else.
      const address = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
      const port = Number(b.port);
      if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return done(400);
      const inv: Invitation = {
        id: Math.random().toString(36).slice(2, 10),
        from: clean(b.from, 40) || 'Someone',
        fromColor: /^#[0-9a-f]{6}$/i.test(String(b.fromColor)) ? String(b.fromColor) : '#868e96',
        title: clean(b.title, 100) || 'Untitled map',
        address: address.includes(':') ? `[${address}]` : address,
        port,
        role: b.role === 'view' ? 'view' : 'edit',
        invite: clean(b.invite, 64),
        at: Date.now(),
      };
      this.emit('invitation', inv);
      done(200);
    } catch {
      done(400);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.unpublish();
    this.hostsBrowser?.stop();
    this.peopleBrowser?.stop();
    await new Promise<void>((r) => (this.inbox ? this.inbox.close(() => r()) : r()));
    this.inbox = null;
  }
}
