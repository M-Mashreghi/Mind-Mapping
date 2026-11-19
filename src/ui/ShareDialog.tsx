import { useEffect, useState } from 'react';
import { Editor } from '../editor';
import { platform, FoundHost, Role } from '../platform/platform';
import { randomColor } from '../collab/session';
import { Dialog } from './Dialogs';

const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#d6336c', '#5f3dc4'];

/** Host a map on the local network, or join one, and see who is connected. */
export function ShareDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [name, setName] = useState(editor.user?.name ?? '');
  const [color, setColor] = useState(editor.user?.color ?? randomColor());
  const [address, setAddress] = useState(editor.pendingJoin?.address ?? '');
  const [want, setWant] = useState<Role>('edit');
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
    const hs = editor.hostState;
    const h = platform.host;
    return (
      <Dialog title={collab.role === 'host' ? 'Sharing on your network' : 'Shared map'} onClose={onClose}>
        <div className="share">
          {you}
          {host ? (
            <section>
              <p className="muted">
                People on the same network open the app and choose <b>Join</b>, or open the link in any browser.
                Nobody gets in until you say so, and you choose whether they can edit or only look.
              </p>
              <div className="share-link">
                <code>{links[0]}</code>
                <button onClick={() => copy(`${links[0]}/?join`, 'link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>
              </div>
              {links.length > 1 ? (
                <p className="share-address">Also reachable at: {links.slice(1).map((l) => <code key={l}>{l.replace('http://', '')}</code>)}</p>
              ) : null}
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
          {host && hs?.requests.length ? (
            <section>
              <h3>Asking to join ({hs.requests.length})</h3>
              <ul className="share-people">
                {hs.requests.map((r) => <RequestRow key={r.id} editor={editor} request={r} />)}
              </ul>
            </section>
          ) : null}
          <section>
            {host && hs && h ? (
              <>
                <h3>People ({hs.guests.filter((g) => g.online).length + 1} here)</h3>
                <ul className="share-people">
                  <li>
                    <span className="avatar" style={{ background: editor.user?.color }}>{initial(editor.user?.name)}</span>
                    <span className="who">{editor.user?.name} (you, host)</span>
                  </li>
                  {hs.guests.map((g) => (
                    <li key={g.id} className={g.online ? '' : 'away'}>
                      <span className="avatar" style={{ background: g.color }}>{initial(g.name)}</span>
                      <span className="who">
                        <span dir="auto">{g.name}</span>
                        <small>{g.online ? 'Here now' : 'Not connected'}{g.trusted ? ' · Always allowed' : ''}</small>
                      </span>
                      <select aria-label={`What ${g.name} can do`} value={g.role} onChange={(e) => void h.setRole(g.id, e.target.value as Role)}>
                        <option value="edit">Can edit</option>
                        <option value="view">View only</option>
                      </select>
                      <button className="link-button danger-text" onClick={() => void h.remove(g.id)} title="Send them out. They have to ask again to come back.">Remove</button>
                    </li>
                  ))}
                </ul>
                {!hs.guests.length ? <p className="muted">No one has joined yet.</p> : null}
              </>
            ) : (
              <>
                <h3>People here ({peers.length + 1})</h3>
                <ul className="share-people">
                  <li><span className="avatar" style={{ background: editor.user?.color }}>{initial(editor.user?.name)}</span><span className="who">{editor.user?.name} (you)</span></li>
                  {peers.map((p) => (
                    <li key={p.clientId}><span className="avatar" style={{ background: p.user.color }}>{initial(p.user.name)}</span><span className="who" dir="auto">{p.user.name}</span></li>
                  ))}
                </ul>
              </>
            )}
          </section>
          {host && hs && h && hs.trusted.length ? (
            <section>
              <h3>Always allowed</h3>
              <p className="muted">These people get in without asking, whenever you share a map.</p>
              <ul className="share-people">
                {hs.trusted.map((t) => (
                  <li key={t.deviceId}>
                    <span className="who"><span dir="auto">{t.name}</span><small>{t.role === 'edit' ? 'Can edit' : 'View only'}</small></span>
                    <button className="link-button" onClick={() => void h.forget(t.deviceId)}>Stop allowing</button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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

  const joining = editor.joining;
  return (
    <Dialog title="Work together on your network" onClose={() => { editor.cancelJoin(); onClose(); }}>
      <div className="share">
        {you}
        {platform.canHost && !joining ? (
          <section>
            <h3>Share this map</h3>
            <p className="muted">Others on the same Wi-Fi or office network can ask to join. You decide who gets in and whether they can edit. Your file stays on this computer and keeps saving here.</p>
            <button className="primary" disabled={busy} onClick={() => void run(() => editor.startHosting())}>Start sharing</button>
          </section>
        ) : null}
        <section>
          <h3>Join a shared map</h3>
          {joining ? (
            <div className="share-waiting" role="status">
              <span className="spinner" aria-hidden="true" />
              <div>
                <strong>{joining.waiting ? 'Waiting for the host to let you in…' : 'Contacting the host…'}</strong>
                <p className="muted">You asked to {joining.want === 'edit' ? 'edit' : 'view'} the map at <code>{joining.address}</code>.</p>
              </div>
              <button onClick={() => editor.cancelJoin()}>Cancel</button>
            </div>
          ) : (
            <>
              {found?.length ? (
                <ul className="share-found">
                  {found.map((h) => (
                    <li key={`${h.address}:${h.port}`}>
                      <button className={address === `${h.address}:${h.port}` ? 'on' : ''} onClick={() => setAddress(`${h.address}:${h.port}`)}>
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
                    if (await editor.join(address || location.host, want)) onClose();
                  });
                }}
              >
                <label>
                  Address
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20:47821" />
                </label>
                <div className="share-want" role="radiogroup" aria-label="What you want to do">
                  <button type="button" role="radio" aria-checked={want === 'edit'} className={want === 'edit' ? 'on' : ''} onClick={() => setWant('edit')}>Edit</button>
                  <button type="button" role="radio" aria-checked={want === 'view'} className={want === 'view' ? 'on' : ''} onClick={() => setWant('view')}>Only view</button>
                </div>
                <button type="submit" className="primary" disabled={busy || !(address.trim() || platform.kind === 'web')}>Ask to join</button>
              </form>
            </>
          )}
        </section>
        {error ? <p className="share-error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}

/** One person asking to join: let them in this time, always, or not at all. */
export function RequestRow({ editor, request: r }: { editor: Editor; request: import('../platform/platform').JoinRequest }) {
  const [role, setRole] = useState<Role>(r.want);
  const [busy, setBusy] = useState(false);
  const answer = (a: 'once' | 'always' | 'deny') => {
    setBusy(true);
    void editor.answerRequest(r.id, a, role).finally(() => setBusy(false));
  };
  return (
    <li className="join-request">
      <span className="avatar" style={{ background: r.color || '#868e96' }}>{initial(r.name)}</span>
      <div className="who">
        <span><strong dir="auto">{r.name}</strong> wants to {r.want === 'edit' ? 'edit' : 'view'} this map</span>
        <div className="share-want small" role="radiogroup" aria-label={`What ${r.name} can do`}>
          <button type="button" role="radio" aria-checked={role === 'edit'} className={role === 'edit' ? 'on' : ''} onClick={() => setRole('edit')}>Can edit</button>
          <button type="button" role="radio" aria-checked={role === 'view'} className={role === 'view' ? 'on' : ''} onClick={() => setRole('view')}>View only</button>
        </div>
        <div className="join-actions">
          <button className="primary" disabled={busy} onClick={() => answer('once')} title="Let them in while you share this map">Allow this time</button>
          <button disabled={busy} onClick={() => answer('always')} title="Let them in now and whenever you share in future">Always allow</button>
          <button className="link-button danger-text" disabled={busy} onClick={() => answer('deny')}>Don’t allow</button>
        </div>
      </div>
    </li>
  );
}

export function initial(name?: string): string {
  return (name?.trim()[0] ?? '?').toLocaleUpperCase();
}
