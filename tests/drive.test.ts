// @vitest-environment node
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { GoogleDrive, MIME, SCOPE, TokenStore } from '../electron/google-drive';
import { fakeGoogle } from './fake-google';

/** Plays the user's browser: approve the consent page and follow the redirect. */
const browser = (codes: Map<string, string>, approve = true) => (authUrl: string) => {
  const u = new URL(authUrl);
  expect(u.searchParams.get('scope')).toBe(SCOPE);
  expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  const redirect = new URL(u.searchParams.get('redirect_uri')!);
  expect(redirect.hostname).toBe('127.0.0.1');
  const code = `code-${codes.size}`;
  codes.set(code, u.searchParams.get('code_challenge')!);
  const q = approve ? `code=${code}` : 'error=access_denied';
  void fetch(`${redirect.origin}/?${q}&state=${u.searchParams.get('state')}`);
};


function memoryStore(): TokenStore & { value: string | null } {
  return {
    value: null,
    async load() { return this.value; },
    async save(v) { this.value = v; },
  };
}

const servers: http.Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function setup() {
  const g = await fakeGoogle();
  servers.push(g.server);
  return g;
}

describe('Google Drive', () => {
  it('signs in with PKCE through a loopback redirect and remembers the account', async () => {
    const g = await setup();
    const store = memoryStore();
    const drive = new GoogleDrive(g.config, store, browser(g.codes));
    expect(await drive.status()).toEqual({ configured: true, signedIn: false, email: undefined, name: undefined });
    const s = await drive.signIn();
    expect(s).toMatchObject({ signedIn: true, email: 'sara@example.com' });
    expect(JSON.parse(store.value!).refreshToken).toBe('rt-1');
    // A new run of the app reads the stored token.
    const again = new GoogleDrive(g.config, store, () => {});
    expect((await again.status()).signedIn).toBe(true);
  });

  it('reports a cancelled consent', async () => {
    const g = await setup();
    const drive = new GoogleDrive(g.config, memoryStore(), browser(g.codes, false));
    await expect(drive.signIn()).rejects.toThrow('cancelled');
    expect((await drive.status()).signedIn).toBe(false);
  });

  it('is off when no client id is configured', async () => {
    const drive = new GoogleDrive({ clientId: '', clientSecret: '' }, memoryStore(), () => {});
    expect((await drive.status()).configured).toBe(false);
    await expect(drive.signIn()).rejects.toThrow('not set up');
  });

  it('creates, lists, opens and updates maps', async () => {
    const g = await setup();
    const drive = new GoogleDrive(g.config, memoryStore(), browser(g.codes));
    await drive.signIn();
    const created = await drive.save({ name: 'Cars.amap', content: '{"a":1}' });
    if (!('file' in created)) throw new Error('expected a file');
    expect(g.files.get(created.file.id)!.mimeType).toBe(MIME);
    expect((await drive.list()).map((f) => f.name)).toEqual(['Cars.amap']);
    const opened = await drive.open(created.file.id);
    expect(opened.content).toBe('{"a":1}');
    const updated = await drive.save({ id: created.file.id, name: 'Cars.amap', content: '{"a":2}', expectedModified: opened.file.modifiedTime });
    expect('file' in updated).toBe(true);
    expect(g.files.get(created.file.id)!.content).toBe('{"a":2}');
  });

  it('does not overwrite a file that changed in Drive since it was opened', async () => {
    const g = await setup();
    const drive = new GoogleDrive(g.config, memoryStore(), browser(g.codes));
    await drive.signIn();
    const { file } = (await drive.save({ name: 'M.amap', content: 'v1' })) as { file: { id: string; modifiedTime: string } };
    // Someone else saves from another computer.
    await drive.save({ id: file.id, name: 'M.amap', content: 'theirs' });
    const res = await drive.save({ id: file.id, name: 'M.amap', content: 'mine', expectedModified: file.modifiedTime });
    expect('conflict' in res).toBe(true);
    expect(g.files.get(file.id)!.content).toBe('theirs');
    await drive.save({ id: file.id, name: 'M.amap', content: 'mine', expectedModified: file.modifiedTime, force: true });
    expect(g.files.get(file.id)!.content).toBe('mine');
  });

  it('refreshes an expired access token and signs out when the grant is revoked', async () => {
    const g = await setup();
    const store = memoryStore();
    const drive = new GoogleDrive(g.config, store, browser(g.codes));
    await drive.signIn();
    g.expireAccess();
    expect(await drive.list()).toEqual([]);
    expect(g.state.refreshes).toBe(1);
    g.expireAccess();
    g.state.revokedRefresh = true;
    await expect(drive.list()).rejects.toThrow('expired');
    expect(store.value).toBeNull();
    expect((await drive.status()).signedIn).toBe(false);
  });
});
