import { useEffect, useState } from 'react';
import { Editor } from '../editor';
import { platform, FoundHost } from '../platform/platform';
import { randomColor } from '../collab/session';
import { Dialog } from './Dialogs';

const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#d6336c', '#5f3dc4'];

/** Host a map on the local network, or join one, and see who is connected. */
export function ShareDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [name, setName] = useState(editor.user?.name ?? '');
  const [color, setColor] = useState(editor.user?.color ?? randomColor());
  const [address, setAddress] = useState(editor.pendingJoin?.address ?? '');
  const [code, setCode] = useState(editor.pendingJoin?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundHost[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const collab = editor.collab;

  const scan = async () => {
    setFound(null);
    try {
      setFound(await platform.discoverHosts());
    } catch {
      setFound([]);
    }
  };

  useEffect(() => {
    if (platform.canHost && !collab) void scan();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveUser = (): boolean => {
    if (!name.trim()) {
      setError('Enter your name so others can see who you are.');
      return false;
    }
    editor.setUser({ name, color });
    return true;
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    if (!saveUser()) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const you = (
    <section className="share-you">
      <label>
        Your name
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && editor.setUser({ name, color })} placeholder="e.g. Sara" autoFocus={!editor.user} />
      </label>
      <div className="share-colors" role="radiogroup" aria-label="Your colour">
        {COLORS.map((c) => (
          <button key={c} role="radio" aria-checked={c === color} className={`share-color${c === color ? ' on' : ''}`} style={{ background: c }}
            aria-label={c} onClick={() => { setColor(c); if (name.trim()) editor.setUser({ name, color: c }); }} />
        ))}
      </div>
    </section>
  );

  if (collab) {
    const peers = editor.peers;
    const host = collab.host;
    const links = host
      ? (host.addresses.length ? host.addresses : ['127.0.0.1']).map((a) => `http://${a}:${host.port}`)
      : [];
    return (
      <Dialog title={collab.role === 'host' ? 'Sharing on your network' : 'Shared map'} onClose={onClose}>
        <div className="share">
          {you}
          {host ? (
            <section>
              <p className="muted">
                People on the same network can open the app and choose <b>Join</b>, or open a link below in any browser.
              </p>
              <div className="share-codes">
                <div>
                  <span className="share-label">Can edit</span>
                  <code className="share-code">{host.editCode}</code>
                  <button onClick={() => copy(`${links[0]}/?join=${host.editCode}`, 'edit')}>{copied === 'edit' ? 'Copied' : 'Copy link'}</button>
                </div>
                <div>
                  <span className="share-label">View only</span>
                  <code className="share-code">{host.viewCode}</code>
                  <button onClick={() => copy(`${links[0]}/?join=${host.viewCode}`, 'view')}>{copied === 'view' ? 'Copied' : 'Copy link'}</button>
                </div>
              </div>
              <p className="share-address">
                Address: {links.map((l) => <code key={l}>{l.replace('http://', '')}</code>)}
              </p>
            </section>
          ) : (
            <section>
              <p>
                Connected to <code>{collab.httpBase.replace(/^https?:\/\//, '')}</code>
                {collab.readOnly ? ' as view only.' : ' with edit access.'}{' '}
                <span className={`share-status ${collab.session.status}`}>{collab.session.status === 'connected' ? 'Live' : 'Reconnecting…'}</span>
              </p>
              <p className="muted">When you leave, you keep a copy of the map that you can save.</p>
            </section>
          )}
          <section>
            <h3>People here ({peers.length + 1})</h3>
            <ul className="share-peers">
              <li><span className="avatar" style={{ background: editor.user?.color }}>{initial(editor.user?.name)}</span>{editor.user?.name} (you)</li>
              {peers.map((p) => (
                <li key={p.clientId}><span className="avatar" style={{ background: p.user.color }}>{initial(p.user.name)}</span>{p.user.name}</li>
              ))}
            </ul>
          </section>
          {error ? <p className="share-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button className="danger" onClick={() => void editor.leave().then(onClose)}>
              {collab.role === 'host' ? 'Stop sharing' : 'Leave'}
            </button>
            <button className="primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Work together on your network" onClose={onClose}>
      <div className="share">
        {you}
        {platform.canHost ? (
          <section>
            <h3>Share this map</h3>
            <p className="muted">Others on the same Wi-Fi or office network can edit it with you. Your file stays on this computer and keeps saving here.</p>
            <button className="primary" disabled={busy} onClick={() => void run(() => editor.startHosting())}>Start sharing</button>
          </section>
        ) : null}
        <section>
          <h3>Join a shared map</h3>
          {found?.length ? (
            <ul className="share-found">
              {found.map((h) => (
                <li key={`${h.address}:${h.port}`}>
                  <button onClick={() => setAddress(`${h.address}:${h.port}`)}>
                    <strong dir="auto">{h.title || 'Untitled map'}</strong>
                    <span>{h.name} · {h.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {platform.canHost ? (
            <button className="link-button" onClick={() => void scan()}>{found === null ? 'Looking for shared maps…' : 'Look again'}</button>
          ) : null}
          <form
            className="share-join"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await editor.join(address || location.host, code);
                onClose();
              });
            }}
          >
            <label>
              Address
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20:47821" />
            </label>
            <label>
              Code
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={12} className="share-code-input" />
            </label>
            <button type="submit" className="primary" disabled={busy || !code.trim()}>Join</button>
          </form>
        </section>
        {error ? <p className="share-error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}

export function initial(name?: string): string {
  return (name?.trim()[0] ?? '?').toLocaleUpperCase();
}
