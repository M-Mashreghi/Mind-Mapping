/**
 * LAN collaboration server. Runs inside the host's desktop app.
 *
 * - Serves the web build over HTTP so people can join from any browser.
 * - Relays Yjs document updates and presence (awareness) over WebSocket using the
 *   y-websocket wire protocol, so the stock y-websocket client works.
 * - Nobody gets in without the host's say-so. A guest asks over HTTP with their name
 *   and whether they want to edit or only view; the host allows them for this
 *   sharing session or for good, or turns them away. An allowed guest gets a ticket
 *   for the WebSocket. View-only connections can read the map and show presence,
 *   but their edits are ignored, and the host can change roles or remove people.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

export type Role = 'edit' | 'view';

export interface ServerOptions {
  port?: number;
  /** Directory with the built web app (index.html). Optional. */
  staticDir?: string;
  host?: string;
  /** Remembers people the host chose to "always allow". In memory when left out. */
  trust?: TrustStore;
  /** How long a join request waits for the host before it expires. */
  requestTimeoutMs?: number;
}

export interface ServerInfo {
  port: number;
  addresses: string[];
  /** The host's own pass to its server. Never shown to guests. */
  hostTicket: string;
}

/** Someone the host allowed for good: they get in next time without asking. */
export interface TrustedPerson {
  deviceId: string;
  name: string;
  role: Role;
  keyHash: string;
  since: string;
}

export interface TrustStore {
  load(): Promise<TrustedPerson[]>;
  save(list: TrustedPerson[]): Promise<void>;
}

export interface JoinRequest {
  id: string;
  deviceId: string;
  name: string;
  color: string;
  want: Role;
  at: number;
}

export interface Guest {
  id: string;
  deviceId: string;
  name: string;
  color: string;
  role: Role;
  online: boolean;
  trusted: boolean;
}

/** What the host's window shows: who is asking, who is in, who is always allowed. */
export interface HostState {
  requests: JoinRequest[];
  guests: Guest[];
  trusted: Array<Omit<TrustedPerson, 'keyHash'>>;
}

export type JoinAnswer =
  | { status: 'approved'; ticket: string; role: Role; color: string }
  | { status: 'pending'; requestId: string; secret: string }
  | { status: 'denied' | 'expired' | 'cancelled' };

interface Ticket {
  id: string;
  token: string;
  role: Role;
  name: string;
  color: string;
  deviceId: string;
  isHost: boolean;
}

interface Pending extends JoinRequest {
  secret: string;
  keyHash: string;
  answer: JoinAnswer | null;
  waiters: Set<(a: JoinAnswer) => void>;
  timer: ReturnType<typeof setTimeout>;
}

interface Conn {
  ticket: Ticket;
  clients: Set<number>;
}

/** Server-to-client control messages ride on their own y-websocket message type. */
export const MESSAGE_CONTROL = 100;
export type ControlMessage = { type: 'role'; role: Role } | { type: 'removed' };

const PALETTE = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#d6336c', '#5f3dc4', '#1098ad', '#c92a2a'];
const MAX_PENDING = 20;

const token = () => randomBytes(24).toString('base64url');
const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

export function memoryTrust(initial: TrustedPerson[] = []): TrustStore {
  let list = initial;
  return { load: async () => list, save: async (l) => void (list = l) };
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

export class CollabServer extends EventEmitter {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private conns = new Map<WebSocket, Conn>();
  private tickets = new Map<string, Ticket>();
  private pending = new Map<string, Pending>();
  private trusted: TrustedPerson[] = [];
  private trust: TrustStore = memoryTrust();
  private requestTimeoutMs = 5 * 60 * 1000;
  private http: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  info: ServerInfo | null = null;

  constructor() {
    super();
    // The server itself is not a participant.
    this.awareness.setLocalState(null);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const msg = encoding.toUint8Array(enc);
      for (const ws of this.conns.keys()) if (ws !== origin) this.send(ws, msg);
    });
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = added.concat(updated, removed);
      const conn = origin instanceof WebSocket ? this.conns.get(origin) : undefined;
      if (conn) {
        for (const id of added) conn.clients.add(id);
        for (const id of removed) conn.clients.delete(id);
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      const msg = encoding.toUint8Array(enc);
      for (const ws of this.conns.keys()) this.send(ws, msg);
    });
  }

  get peerCount(): number {
    return this.conns.size;
  }

  // ------------------------------------------------------------ host state

  state(): HostState {
    const online = new Set([...this.conns.values()].map((c) => c.ticket.id));
    const trustedIds = new Set(this.trusted.map((t) => t.deviceId));
    return {
      requests: [...this.pending.values()]
        .filter((p) => !p.answer)
        .map(({ id, deviceId, name, color, want, at }) => ({ id, deviceId, name, color, want, at })),
      guests: [...this.tickets.values()]
        .filter((t) => !t.isHost)
        .map((t) => ({ id: t.id, deviceId: t.deviceId, name: t.name, color: t.color, role: t.role, online: online.has(t.id), trusted: trustedIds.has(t.deviceId) })),
      trusted: this.trusted.map(({ keyHash: _k, ...rest }) => rest),
    };
  }

  private changed() {
    this.emit('change', this.state());
  }

  /** A colour nobody in the room is using yet, preferring the one they picked. */
  private pickColor(wanted: string): string {
    const used = new Set([...this.tickets.values()].map((t) => t.color.toLowerCase()));
    if (/^#[0-9a-f]{6}$/i.test(wanted) && !used.has(wanted.toLowerCase())) return wanted;
    return PALETTE.find((c) => !used.has(c)) ?? PALETTE[used.size % PALETTE.length];
  }

  private issue(deviceId: string, name: string, color: string, role: Role, isHost = false): Ticket {
    // One ticket per device, so reconnecting or asking again doesn't duplicate people.
    const existing = [...this.tickets.values()].find((t) => !isHost && !t.isHost && t.deviceId === deviceId);
    if (existing) {
      existing.name = name;
      existing.role = role;
      this.pushRole(existing);
      return existing;
    }
    const t: Ticket = { id: token().slice(0, 12), token: token(), role, name, color: isHost ? color : this.pickColor(color), deviceId, isHost };
    this.tickets.set(t.token, t);
    return t;
  }

  /** Someone on the network asks to come in. */
  async requestJoin(body: { deviceId?: unknown; key?: unknown; name?: unknown; color?: unknown; want?: unknown }): Promise<JoinAnswer> {
    const deviceId = clean(body.deviceId, 64);
    const key = clean(body.key, 128);
    const name = clean(body.name, 40) || 'Guest';
    const color = clean(body.color, 7);
    const want: Role = body.want === 'view' ? 'view' : 'edit';
    if (deviceId.length < 8 || key.length < 16) throw new Error('bad request');
    const keyHash = sha(key);

    const trusted = this.trusted.find((t) => t.deviceId === deviceId && t.keyHash === keyHash);
    if (trusted && (want === 'view' || trusted.role === 'edit')) {
      if (trusted.name !== name) {
        trusted.name = name;
        void this.trust.save(this.trusted);
      }
      const t = this.issue(deviceId, name, color, want);
      this.changed();
      return { status: 'approved', ticket: t.token, role: t.role, color: t.color };
    }

    // A new request from the same device replaces the old one.
    for (const p of this.pending.values()) if (p.deviceId === deviceId && !p.answer) this.settle(p, { status: 'cancelled' });
    if ([...this.pending.values()].filter((p) => !p.answer).length >= MAX_PENDING) throw new Error('busy');

    const p: Pending = {
      id: token().slice(0, 12), deviceId, name, color, want, at: Date.now(),
      secret: token(), keyHash, answer: null, waiters: new Set(),
      timer: setTimeout(() => this.settle(p, { status: 'expired' }), this.requestTimeoutMs),
    };
    this.pending.set(p.id, p);
    this.changed();
    this.emit('request', p.name, p.want);
    return { status: 'pending', requestId: p.id, secret: p.secret };
  }

  private settle(p: Pending, answer: JoinAnswer) {
    if (p.answer) return;
    clearTimeout(p.timer);
    p.answer = answer;
    for (const w of p.waiters) w(answer);
    p.waiters.clear();
    // Keep the answer briefly so a guest polling right now still gets it.
    setTimeout(() => this.pending.delete(p.id), 60000).unref?.();
    this.changed();
  }

  /** Wait (up to `waitMs`) for the host to answer a request. */
  async waitForAnswer(id: string, secret: string, waitMs = 25000): Promise<JoinAnswer | { status: 'pending' }> {
    const p = this.pending.get(id);
    if (!p || p.secret !== secret) return { status: 'expired' };
    if (p.answer) return p.answer;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        p.waiters.delete(done);
        resolve({ status: 'pending' });
      }, waitMs);
      const done = (a: JoinAnswer) => {
        clearTimeout(timer);
        resolve(a);
      };
      p.waiters.add(done);
    });
  }

  cancelRequest(id: string, secret: string): void {
    const p = this.pending.get(id);
    if (p && p.secret === secret) this.settle(p, { status: 'cancelled' });
  }

  /** The host lets someone in, for this sharing session or for good. */
  async approve(id: string, role: Role, always = false): Promise<void> {
    const p = this.pending.get(id);
    if (!p || p.answer) return;
    if (always) {
      this.trusted = this.trusted.filter((t) => t.deviceId !== p.deviceId);
      this.trusted.push({ deviceId: p.deviceId, name: p.name, role, keyHash: p.keyHash, since: new Date().toISOString() });
      await this.trust.save(this.trusted);
    }
    const t = this.issue(p.deviceId, p.name, p.color, role);
    this.settle(p, { status: 'approved', ticket: t.token, role: t.role, color: t.color });
  }

  deny(id: string): void {
    const p = this.pending.get(id);
    if (p) this.settle(p, { status: 'denied' });
  }

  private ticketById(id: string): Ticket | undefined {
    return [...this.tickets.values()].find((t) => t.id === id && !t.isHost);
  }

  private control(ticket: Ticket, msg: ControlMessage) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_CONTROL);
    encoding.writeVarString(enc, JSON.stringify(msg));
    const data = encoding.toUint8Array(enc);
    for (const [ws, c] of this.conns) if (c.ticket === ticket) this.send(ws, data);
  }

  private pushRole(t: Ticket) {
    this.control(t, { type: 'role', role: t.role });
  }

  /** Switch someone between "can edit" and "view only" while they are in. */
  async setRole(guestId: string, role: Role): Promise<void> {
    const t = this.ticketById(guestId);
    if (!t || t.role === role) return;
    t.role = role;
    this.pushRole(t);
    const tr = this.trusted.find((x) => x.deviceId === t.deviceId);
    if (tr && tr.role !== role) {
      tr.role = role;
      await this.trust.save(this.trusted);
    }
    this.changed();
  }

  /** Send someone out. They need to ask again to come back (unless always allowed and `forget` is false). */
  async remove(guestId: string, forget = true): Promise<void> {
    const t = this.ticketById(guestId);
    if (!t) return;
    this.control(t, { type: 'removed' });
    this.tickets.delete(t.token);
    for (const [ws, c] of this.conns) if (c.ticket === t) setTimeout(() => this.close(ws), 50);
    if (forget) await this.forget(t.deviceId, false);
    this.changed();
  }

  /** Stop always allowing someone. */
  async forget(deviceId: string, notify = true): Promise<void> {
    const before = this.trusted.length;
    this.trusted = this.trusted.filter((t) => t.deviceId !== deviceId);
    if (this.trusted.length !== before) await this.trust.save(this.trusted);
    if (notify) this.changed();
  }

  // ------------------------------------------------------------ network

  async start(opts: ServerOptions = {}): Promise<ServerInfo> {
    const staticDir = opts.staticDir;
    if (opts.trust) this.trust = opts.trust;
    if (opts.requestTimeoutMs) this.requestTimeoutMs = opts.requestTimeoutMs;
    try {
      this.trusted = (await this.trust.load()).filter((t) => t && t.deviceId && t.keyHash);
    } catch {
      this.trusted = [];
    }

    const json = (res: http.ServerResponse, status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(body));
    };

    this.http = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? '/', 'http://x');
      if (reqUrl.pathname.startsWith('/api/')) {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type',
          }).end();
          return;
        }
        try {
          if (reqUrl.pathname === '/api/join' && req.method === 'POST') {
            const raw = await readBody(req, 4096);
            return json(res, 200, await this.requestJoin(JSON.parse(raw)));
          }
          const m = /^\/api\/join\/([\w-]+)$/.exec(reqUrl.pathname);
          if (m) {
            const secret = reqUrl.searchParams.get('secret') ?? '';
            if (req.method === 'DELETE') {
              this.cancelRequest(m[1], secret);
              return json(res, 200, { status: 'cancelled' });
            }
            const wait = Math.min(Number(reqUrl.searchParams.get('wait') ?? 25000) || 0, 25000);
            return json(res, 200, await this.waitForAnswer(m[1], secret, wait));
          }
          return json(res, 404, { error: 'not found' });
        } catch (e) {
          return json(res, (e as Error).message === 'busy' ? 429 : 400, { error: (e as Error).message });
        }
      }
      if (!staticDir) {
        res.writeHead(404).end();
        return;
      }
      try {
        const urlPath = decodeURIComponent(reqUrl.pathname);
        const rel = path.normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^([/\\])+/, '');
        const file = path.resolve(staticDir, rel);
        if (!file.startsWith(path.resolve(staticDir))) throw new Error('outside');
        const body = await fs.readFile(file);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(body);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      }
    });

    this.wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
    this.http.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const ticket = this.tickets.get(url.searchParams.get('ticket') ?? '');
      if (!ticket) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, ticket));
    });

    const port = await new Promise<number>((resolve, reject) => {
      const tryPort = (p: number, attemptsLeft: number) => {
        const onError = (err: NodeJS.ErrnoException) => {
          this.http!.off('listening', onListening);
          if (err.code === 'EADDRINUSE' && attemptsLeft > 0) tryPort(p === 0 ? 0 : p + 1, attemptsLeft - 1);
          else reject(err);
        };
        const onListening = () => {
          this.http!.off('error', onError);
          resolve((this.http!.address() as { port: number }).port);
        };
        this.http!.once('error', onError);
        this.http!.once('listening', onListening);
        this.http!.listen(p, opts.host ?? '0.0.0.0');
      };
      tryPort(opts.port ?? 47821, 10);
    });

    const host = this.issue('host', 'Host', '#1b1f27', 'edit', true);
    this.info = { port, addresses: lanAddresses(), hostTicket: host.token };
    this.changed();
    return this.info;
  }

  private send(ws: WebSocket, msg: Uint8Array) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg, (err) => err && this.close(ws));
  }

  private onConnection(ws: WebSocket, ticket: Ticket) {
    ws.binaryType = 'arraybuffer';
    this.conns.set(ws, { ticket, clients: new Set() });
    ws.on('message', (data: ArrayBuffer | Buffer) => this.onMessage(ws, new Uint8Array(data as ArrayBuffer)));
    ws.on('close', () => this.close(ws));
    ws.on('error', () => this.close(ws));
    if (!ticket.isHost) this.changed();

    // Keep-alive so dropped laptops are noticed.
    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return this.close(ws);
      alive = false;
      try {
        ws.ping();
      } catch {
        this.close(ws);
      }
    }, 30000);
    ws.once('close', () => clearInterval(ping));

    // Tell them what they may do, then start syncing and share everyone's presence.
    if (!ticket.isHost) this.control(ticket, { type: 'role', role: ticket.role });
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.send(ws, encoding.toUint8Array(enc));
    const states = this.awareness.getStates();
    if (states.size) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      this.send(ws, encoding.toUint8Array(a));
    }
  }

  private onMessage(ws: WebSocket, data: Uint8Array) {
    const conn = this.conns.get(ws);
    if (!conn) return;
    try {
      const dec = decoding.createDecoder(data);
      const type = decoding.readVarUint(dec);
      if (type === MESSAGE_SYNC) {
        const syncType = decoding.peekVarUint(dec);
        // View-only guests may ask for the document but never change it.
        if (conn.ticket.role === 'view' && syncType !== syncProtocol.messageYjsSyncStep1) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(dec, enc, this.doc, ws);
        if (encoding.length(enc) > 1) this.send(ws, encoding.toUint8Array(enc));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), ws);
      } else if (type === MESSAGE_QUERY_AWARENESS) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]));
        this.send(ws, encoding.toUint8Array(enc));
      }
    } catch {
      // Ignore malformed messages from a misbehaving client.
    }
  }

  private close(ws: WebSocket) {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.clients], null);
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    if (!conn.ticket.isHost) this.changed();
  }

  async stop(): Promise<void> {
    for (const p of this.pending.values()) this.settle(p, { status: 'expired' });
    for (const ws of [...this.conns.keys()]) this.close(ws);
    this.wss?.close();
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
    this.http = null;
    this.wss = null;
    this.info = null;
    this.tickets.clear();
    this.pending.clear();
    this.removeAllListeners();
    this.doc.destroy();
  }
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
