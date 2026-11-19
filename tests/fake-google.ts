// A small stand-in for Google's OAuth and Drive endpoints, used by tests.
import http from 'node:http';
import { createHash } from 'node:crypto';

/** A tiny stand-in for Google's OAuth and Drive endpoints. */
export async function fakeGoogle(port = 0) {
  const files = new Map<string, { id: string; name: string; mimeType: string; modifiedTime: string; content: string }>();
  const codes = new Map<string, string>(); // code -> challenge
  let accessToken = 'at-1';
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  const state = { refreshes: 0, revokedRefresh: false };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const json = (code: number, v: unknown) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(v));

    if (url.pathname === '/token') {
      const p = new URLSearchParams(body);
      if (p.get('client_id') !== 'cid' || p.get('client_secret') !== 'secret') return json(401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        const challenge = codes.get(p.get('code')!);
        const expected = createHash('sha256').update(p.get('code_verifier')!).digest('base64url');
        if (!challenge || challenge !== expected) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: accessToken, expires_in: 3600, refresh_token: 'rt-1' });
      }
      if (p.get('grant_type') === 'refresh_token') {
        if (state.revokedRefresh) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        state.refreshes++;
        accessToken = `at-${state.refreshes + 1}`;
        return json(200, { access_token: accessToken, expires_in: 3600 });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/auth') {
      // Auto-approve, as if the user clicked "Allow".
      const code = `code-${codes.size}`;
      codes.set(code, url.searchParams.get('code_challenge')!);
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.search = new URLSearchParams({ code, state: url.searchParams.get('state')! }).toString();
      res.writeHead(302, { Location: back.toString() }).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${accessToken}`) return json(401, { error: { message: 'Invalid Credentials' } });
    const meta = (f: { id: string; name: string; modifiedTime: string }) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime });

    if (url.pathname === '/drive/about') return json(200, { user: { emailAddress: 'sara@example.com', displayName: 'Sara' } });
    if (url.pathname === '/drive/files' && req.method === 'GET') {
      return json(200, { files: [...files.values()].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)).map(meta) });
    }
    const m = url.pathname.match(/^\/(drive|upload)\/files(?:\/([^/]+))?$/);
    if (!m) return json(404, {});
    const [, kind, id] = m;
    if (kind === 'drive' && id) {
      const f = files.get(id);
      if (!f) return json(404, { error: { message: 'File not found' } });
      if (url.searchParams.get('alt') === 'media') return res.writeHead(200).end(f.content);
      return json(200, meta(f));
    }
    // Multipart upload: metadata part, then content part.
    const boundary = /boundary=(.+)$/.exec(req.headers['content-type'] ?? '')![1];
    const parts = body.split(`--${boundary}`).slice(1, -1).map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
    const metadata = JSON.parse(parts[0]);
    if (req.method === 'POST') {
      const f = { id: `f${files.size + 1}`, name: metadata.name, mimeType: metadata.mimeType, modifiedTime: now(), content: parts[1] };
      files.set(f.id, f);
      return json(200, meta(f));
    }
    const f = files.get(id!);
    if (!f) return json(404, { error: { message: 'File not found' } });
    Object.assign(f, { name: metadata.name ?? f.name, content: parts[1], modifiedTime: now() });
    return json(200, meta(f));
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return {
    files, state, server, codes,
    config: { clientId: 'cid', clientSecret: 'secret', authUrl: `${base}/auth`, tokenUrl: `${base}/token`, apiBase: `${base}/drive`, uploadBase: `${base}/upload` },
    expireAccess: () => (accessToken = 'rotated'),
  };
}

