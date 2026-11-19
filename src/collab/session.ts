import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';

export interface PeerUser {
  name: string;
  color: string;
}

export interface Peer {
  clientId: number;
  user: PeerUser;
  cursor: { x: number; y: number } | null;
  selection: string[];
  editing: string | null;
}

export type Status = 'connecting' | 'connected' | 'disconnected';

const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#d6336c', '#5f3dc4', '#1098ad', '#c92a2a'];

export function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

/** The user's name and colour for collaboration, remembered on this device. */
export function loadUser(): PeerUser | null {
  try {
    const raw = localStorage.getItem('argument-mapper:user');
    const u = raw ? JSON.parse(raw) : null;
    return u && typeof u.name === 'string' && u.name ? { name: u.name.slice(0, 40), color: u.color || randomColor() } : null;
  } catch {
    return null;
  }
}

export function saveUser(u: PeerUser): void {
  try {
    localStorage.setItem('argument-mapper:user', JSON.stringify(u));
  } catch {
    /* ignore */
  }
}

export type Role = 'edit' | 'view';

/** This device's identity towards hosts, so a host can "always allow" it. Kept on this device only. */
export function deviceIdentity(): { deviceId: string; key: string } {
  const make = (n: number) => {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  };
  try {
    const raw = localStorage.getItem('argument-mapper:device');
    const d = raw ? JSON.parse(raw) : null;
    if (d && typeof d.deviceId === 'string' && typeof d.key === 'string') return d;
    const fresh = { deviceId: make(12), key: make(24) };
    localStorage.setItem('argument-mapper:device', JSON.stringify(fresh));
    return fresh;
  } catch {
    return { deviceId: make(12), key: make(24) };
  }
}

export interface Admission {
  ticket: string;
  role: Role;
  color: string;
}

/**
 * Ask a host to let us in and wait for their answer. `onWaiting` is called once the
 * host has been asked (it is skipped when the host always allows this device).
 */
export async function requestAccess(
  httpBase: string,
  me: PeerUser & { want: Role },
  opts: { onWaiting?: () => void; signal?: AbortSignal; fetchImpl?: typeof fetch; identity?: { deviceId: string; key: string }; invite?: string } = {},
): Promise<Admission> {
  const f = opts.fetchImpl ?? fetch;
  const id = opts.identity ?? deviceIdentity();
  const where = httpBase.replace(/^https?:\/\//, '');
  let res: Response;
  try {
    res = await f(`${httpBase}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...id, name: me.name, color: me.color, want: me.want, invite: opts.invite }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error(`Can't reach ${where}. Check the address and that both computers are on the same network.`);
  }
  if (res.status === 429) throw new Error('The host has too many people waiting. Try again in a minute.');
  if (!res.ok) throw new Error(`The host answered with an error (${res.status}).`);
  let answer = (await res.json()) as { status: string; ticket?: string; role?: Role; color?: string; requestId?: string; secret?: string };
  if (answer.status === 'pending') {
    opts.onWaiting?.();
    const { requestId, secret } = answer;
    const url = `${httpBase}/api/join/${requestId}?secret=${encodeURIComponent(secret ?? '')}`;
    const cancel = () => void f(url, { method: 'DELETE' }).catch(() => {});
    opts.signal?.addEventListener('abort', cancel, { once: true });
    try {
      while (answer.status === 'pending') {
        let r: Response;
        try {
          r = await f(url, { cache: 'no-store', signal: opts.signal });
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
          // A blip on the network: wait a moment and keep waiting for the host.
          await new Promise((ok) => setTimeout(ok, 1500));
          continue;
        }
        answer = await r.json();
      }
    } finally {
      opts.signal?.removeEventListener('abort', cancel);
    }
  }
  if (answer.status === 'approved' && answer.ticket) {
    return { ticket: answer.ticket, role: answer.role === 'view' ? 'view' : 'edit', color: answer.color || me.color };
  }
  if (answer.status === 'denied') throw new Error('The host did not let you in.');
  if (answer.status === 'cancelled') throw new Error('The request was cancelled.');
  throw new Error('The host did not answer in time. Ask again when they are at their computer.');
}

/** Server-to-client control messages (role changes, being removed). */
export const MESSAGE_CONTROL = 100;
export type ControlMessage = { type: 'role'; role: Role } | { type: 'removed' };

/** A live connection of one Yjs document to a host. */
export class CollabSession {
  readonly provider: WebsocketProvider;
  status: Status = 'connecting';
  synced = false;
  private onChange: () => void;

  constructor(
    wsBase: string,
    ticket: string,
    doc: Y.Doc,
    user: PeerUser,
    onChange: () => void,
    onControl?: (msg: ControlMessage) => void,
    WebSocketPolyfill?: typeof WebSocket,
  ) {
    this.onChange = onChange;
    this.provider = new WebsocketProvider(wsBase, 'map', doc, {
      params: { ticket },
      disableBc: true,
      maxBackoffTime: 5000,
      ...(WebSocketPolyfill ? { WebSocketPolyfill } : {}),
    });
    this.provider.messageHandlers[MESSAGE_CONTROL] = (_enc, dec) => {
      try {
        onControl?.(JSON.parse(decoding.readVarString(dec)) as ControlMessage);
      } catch {
        /* ignore a garbled message */
      }
    };
    this.provider.awareness.setLocalState({ user, cursor: null, selection: [], editing: null });
    this.provider.on('status', ({ status }: { status: Status }) => {
      this.status = status;
      this.onChange();
    });
    this.provider.on('sync', (synced: boolean) => {
      this.synced = synced;
      this.onChange();
    });
    this.provider.awareness.on('change', () => this.onChange());
  }

  get clientId(): number {
    return this.provider.awareness.clientID;
  }

  peers(): Peer[] {
    const out: Peer[] = [];
    this.provider.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.clientId || !state?.user) return;
      out.push({
        clientId,
        user: state.user as PeerUser,
        cursor: (state.cursor as Peer['cursor']) ?? null,
        selection: Array.isArray(state.selection) ? state.selection : [],
        editing: (state.editing as string) ?? null,
      });
    });
    return out;
  }

  setPresence(fields: Partial<Omit<Peer, 'clientId'>>): void {
    const cur = this.provider.awareness.getLocalState() ?? {};
    let changed = false;
    for (const [k, v] of Object.entries(fields)) {
      if (JSON.stringify(cur[k]) !== JSON.stringify(v)) changed = true;
    }
    if (changed) this.provider.awareness.setLocalState({ ...cur, ...fields });
  }

  destroy(): void {
    this.provider.awareness.setLocalState(null);
    this.provider.destroy();
  }
}
