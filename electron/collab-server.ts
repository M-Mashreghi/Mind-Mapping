/**
 * LAN collaboration server. Runs inside the host's desktop app.
 *
 * - Serves the web build over HTTP so people can join from any browser.
 * - Relays Yjs document updates and presence (awareness) over WebSocket using the
 *   y-websocket wire protocol, so the stock y-websocket client works.
 * - Every connection must present the edit code or the view code; view-only
 *   connections can read the map and show presence but their edits are ignored.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

export interface ServerOptions {
  port?: number;
  /** Directory with the built web app (index.html). Optional. */
  staticDir?: string;
  editCode?: string;
  viewCode?: string;
  host?: string;
}

export interface ServerInfo {
  port: number;
  editCode: string;
  viewCode: string;
  addresses: string[];
}

interface Conn {
  readOnly: boolean;
  clients: Set<number>;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
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

export class CollabServer {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private conns = new Map<WebSocket, Conn>();
  private http: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  info: ServerInfo | null = null;

  constructor() {
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

  async start(opts: ServerOptions = {}): Promise<ServerInfo> {
    const editCode = opts.editCode ?? makeCode();
    const viewCode = opts.viewCode ?? makeCode();
    const staticDir = opts.staticDir;

    this.http = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? '/', 'http://x');
      if (reqUrl.pathname === '/api/role') {
        const code = (reqUrl.searchParams.get('code') ?? '').toUpperCase();
        const role = code === editCode ? 'edit' : code === viewCode ? 'view' : null;
        res.writeHead(role ? 200 : 401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(role ? { role } : { error: 'bad code' }));
        return;
      }
      if (!staticDir) {
        res.writeHead(404).end();
        return;
      }
      try {
        const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
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
      const code = (url.searchParams.get('code') ?? '').toUpperCase();
      const readOnly = code === viewCode;
      if (code !== editCode && !readOnly) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, readOnly));
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

    this.info = { port, editCode, viewCode, addresses: lanAddresses() };
    return this.info;
  }

  private send(ws: WebSocket, msg: Uint8Array) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg, (err) => err && this.close(ws));
  }

  private onConnection(ws: WebSocket, readOnly: boolean) {
    ws.binaryType = 'arraybuffer';
    this.conns.set(ws, { readOnly, clients: new Set() });
    ws.on('message', (data: ArrayBuffer | Buffer) => this.onMessage(ws, new Uint8Array(data as ArrayBuffer)));
    ws.on('close', () => this.close(ws));
    ws.on('error', () => this.close(ws));

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

    // Start syncing: send our state vector, and everyone's presence.
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
        if (conn.readOnly && syncType !== syncProtocol.messageYjsSyncStep1) return;
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
  }

  async stop(): Promise<void> {
    for (const ws of [...this.conns.keys()]) this.close(ws);
    this.wss?.close();
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
    this.http = null;
    this.wss = null;
    this.info = null;
    this.doc.destroy();
  }
}
