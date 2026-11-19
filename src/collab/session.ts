import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

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

/** Ask the host what a code allows, before connecting. */
export async function checkCode(httpBase: string, code: string): Promise<'edit' | 'view'> {
  let res: Response;
  try {
    res = await fetch(`${httpBase}/api/role?code=${encodeURIComponent(code)}`, { cache: 'no-store' });
  } catch {
    throw new Error(`Can't reach ${httpBase.replace(/^https?:\/\//, '')}. Check the address and that both computers are on the same network.`);
  }
  if (res.status === 401) throw new Error('That code is not right. Ask the host for the current code.');
  if (!res.ok) throw new Error(`The host answered with an error (${res.status}).`);
  const body = (await res.json()) as { role?: string };
  return body.role === 'view' ? 'view' : 'edit';
}

/** A live connection of one Yjs document to a host. */
export class CollabSession {
  readonly provider: WebsocketProvider;
  status: Status = 'connecting';
  synced = false;
  private onChange: () => void;

  constructor(wsBase: string, code: string, doc: Y.Doc, user: PeerUser, onChange: () => void) {
    this.onChange = onChange;
    this.provider = new WebsocketProvider(wsBase, 'map', doc, { params: { code }, disableBc: true, maxBackoffTime: 5000 });
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
