/**
 * Google Drive for the desktop app.
 *
 * Sign-in uses the OAuth flow for installed apps: the system browser opens Google's
 * consent page and redirects back to a one-off server on 127.0.0.1, protected by PKCE
 * and a random state. Only the `drive.file` scope is requested, so the app can see
 * the files it created or that the user opened with it, and nothing else in Drive.
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  authUrl?: string;
  tokenUrl?: string;
  apiBase?: string;
  uploadBase?: string;
}

/** Keeps the refresh token between runs (encrypted by the caller where possible). */
export interface TokenStore {
  load(): Promise<string | null>;
  save(value: string | null): Promise<void>;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export interface DriveStatus {
  configured: boolean;
  signedIn: boolean;
  email?: string;
  name?: string;
}

export type SaveResult = { file: DriveFile } | { conflict: DriveFile };

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const MIME = 'application/vnd.argument-mapper+json';
const FIELDS = 'id,name,modifiedTime';

interface Saved {
  refreshToken: string;
  email?: string;
  name?: string;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#1b1f27">` +
  `<div style="text-align:center"><h1 style="font-size:22px">${title}</h1><p>${body}</p></div></body>`;

export class GoogleDrive {
  private cfg: Required<DriveConfig>;
  private saved: Saved | null | undefined;
  private access: { token: string; expires: number } | null = null;
  private pendingSignIn: { cancel: () => void } | null = null;

  constructor(cfg: DriveConfig, private store: TokenStore, private openBrowser: (url: string) => void) {
    this.cfg = {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      apiBase: 'https://www.googleapis.com/drive/v3',
      uploadBase: 'https://www.googleapis.com/upload/drive/v3',
      ...cfg,
    };
  }

  get configured(): boolean {
    return !!this.cfg.clientId;
  }

  private async load(): Promise<Saved | null> {
    if (this.saved === undefined) {
      try {
        const raw = await this.store.load();
        this.saved = raw ? (JSON.parse(raw) as Saved) : null;
      } catch {
        this.saved = null;
      }
    }
    return this.saved;
  }

  private async persist(s: Saved | null): Promise<void> {
    this.saved = s;
    await this.store.save(s ? JSON.stringify(s) : null);
  }

  async status(): Promise<DriveStatus> {
    const s = await this.load();
    return { configured: this.configured, signedIn: !!s, email: s?.email, name: s?.name };
  }

  /** Opens the browser for consent and waits for Google to redirect back. */
  async signIn(timeoutMs = 5 * 60 * 1000): Promise<DriveStatus> {
    if (!this.configured) throw new Error('Google Drive is not set up in this build of the app.');
    this.pendingSignIn?.cancel();
    const { verifier, challenge } = pkcePair();
    const state = b64url(randomBytes(16));

    const server = http.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const code = await new Promise<string>((resolve, reject) => {
      const done = (err: Error | null, value?: string) => {
        clearTimeout(timer);
        this.pendingSignIn = null;
        server.close();
        if (err) reject(err);
        else resolve(value!);
      };
      const timer = setTimeout(() => done(new Error('Sign-in timed out. Try again.')), timeoutMs);
      this.pendingSignIn = { cancel: () => done(new Error('Sign-in was cancelled.')) };
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri);
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get('error');
        const got = url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (url.searchParams.get('state') !== state) {
          res.end(PAGE('Sign-in failed', 'This sign-in link is out of date. Start again from the app.'));
          return;
        }
        if (err || !got) {
          res.end(PAGE('Sign-in cancelled', 'You can close this tab and go back to Argument Mapper.'));
          done(new Error(err === 'access_denied' ? 'Sign-in was cancelled.' : `Google said: ${err ?? 'no code'}`));
          return;
        }
        res.end(PAGE('You are signed in', 'You can close this tab and go back to Argument Mapper.'));
        done(null, got);
      });
      const auth = new URL(this.cfg.authUrl);
      auth.search = new URLSearchParams({
        client_id: this.cfg.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
      }).toString();
      this.openBrowser(auth.toString());
    });

    const tok = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    if (!tok.refresh_token) throw new Error('Google did not return a refresh token. Try signing in again.');
    this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
    const saved: Saved = { refreshToken: tok.refresh_token };
    try {
      const about = (await (await this.api('/about?fields=user(emailAddress,displayName)', {}, tok.access_token)).json()) as {
        user?: { emailAddress?: string; displayName?: string };
      };
      saved.email = about.user?.emailAddress;
      saved.name = about.user?.displayName;
    } catch {
      /* the account name is only for display */
    }
    await this.persist(saved);
    return this.status();
  }

  cancelSignIn(): void {
    this.pendingSignIn?.cancel();
  }

  async signOut(): Promise<void> {
    const s = await this.load();
    this.access = null;
    await this.persist(null);
    if (s) {
      // Best effort: tell Google to forget the grant too.
      fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.refreshToken)}`, { method: 'POST' }).catch(() => {});
    }
  }

  private async tokenRequest(params: Record<string, string>) {
    const res = await fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, ...params }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      const e = new Error(body.error_description || body.error || `Google sign-in failed (${res.status}).`) as Error & { code?: string };
      e.code = body.error;
      throw e;
    }
    return { access_token: body.access_token, expires_in: body.expires_in ?? 3600, refresh_token: body.refresh_token };
  }

  private async token(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.access && this.access.expires > Date.now()) return this.access.token;
    const s = await this.load();
    if (!s) throw new Error('Sign in to Google Drive first.');
    try {
      const tok = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken });
      this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
      return tok.access_token;
    } catch (e) {
      if ((e as { code?: string }).code === 'invalid_grant') {
        await this.persist(null);
        throw new Error('Your Google sign-in has expired. Sign in again.');
      }
      throw e;
    }
  }

  private async api(pathAndQuery: string, init: RequestInit = {}, token?: string, base = this.cfg.apiBase): Promise<Response> {
    const send = async (t: string) =>
      fetch(base + pathAndQuery, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${t}` } });
    let res = await send(token ?? (await this.token()));
    if (res.status === 401 && !token) res = await send(await this.token(true));
    if (!res.ok) {
      let msg = `Google Drive error ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) msg = body.error.message;
      } catch {
        /* keep the status message */
      }
      if (res.status === 404) msg = 'That file is no longer in Google Drive, or this app cannot see it.';
      throw new Error(msg);
    }
    return res;
  }

  /** Maps in Drive that this app can see, newest first. */
  async list(): Promise<DriveFile[]> {
    const q = `trashed = false and (mimeType = '${MIME}' or name contains '.amap')`;
    const params = new URLSearchParams({ q, fields: `files(${FIELDS})`, orderBy: 'modifiedTime desc', pageSize: '200', spaces: 'drive' });
    const body = (await (await this.api(`/files?${params}`)).json()) as { files?: DriveFile[] };
    return body.files ?? [];
  }

  async meta(id: string): Promise<DriveFile> {
    return (await (await this.api(`/files/${encodeURIComponent(id)}?fields=${FIELDS}`)).json()) as DriveFile;
  }

  async open(id: string): Promise<{ file: DriveFile; content: string }> {
    const file = await this.meta(id);
    const content = await (await this.api(`/files/${encodeURIComponent(id)}?alt=media`)).text();
    return { file, content };
  }

  /**
   * Create a file (no id) or replace one. When `expectedModified` is given and the file
   * changed in Drive since then, nothing is written and the newer file is returned.
   */
  async save(opts: { id?: string; name: string; content: string; expectedModified?: string; force?: boolean }): Promise<SaveResult> {
    if (opts.id && opts.expectedModified && !opts.force) {
      const current = await this.meta(opts.id);
      if (current.modifiedTime !== opts.expectedModified) return { conflict: current };
    }
    const boundary = `argmap${b64url(randomBytes(12))}`;
    const metadata = opts.id ? { name: opts.name } : { name: opts.name, mimeType: MIME };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n${opts.content}\r\n--${boundary}--`;
    const pathAndQuery = opts.id
      ? `/files/${encodeURIComponent(opts.id)}?uploadType=multipart&fields=${FIELDS}`
      : `/files?uploadType=multipart&fields=${FIELDS}`;
    const res = await this.api(
      pathAndQuery,
      { method: opts.id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
      undefined,
      this.cfg.uploadBase,
    );
    return { file: (await res.json()) as DriveFile };
  }
}
