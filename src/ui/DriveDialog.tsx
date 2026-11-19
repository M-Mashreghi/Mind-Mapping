import { useEffect, useState } from 'react';
import { Editor } from '../editor';
import { DriveFile, DriveStatus, platform } from '../platform/platform';
import { Dialog } from './Dialogs';

/** Sign in to Google Drive, open a map from it, or save the current map to it. */
export function DriveDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const drive = platform.drive;
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!drive) return;
    setError(null);
    try {
      const s = await drive.status();
      setStatus(s);
      if (s.signedIn) {
        setFiles(null);
        setFiles(await drive.list());
      }
    } catch (e) {
      setError((e as Error).message);
      setFiles([]);
      // An expired sign-in shows the sign-in button again.
      setStatus(await drive.status().catch(() => null));
    }
  };

  useEffect(() => {
    void refresh();
    return () => void drive?.cancelSignIn().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!drive) {
    return (
      <Dialog title="Google Drive" onClose={onClose}>
        <p>Google Drive works in the desktop app. In the browser, download the map and upload it to Drive yourself.</p>
      </Dialog>
    );
  }

  const q = query.trim().toLocaleLowerCase();
  const shown = (files ?? []).filter((f) => !q || f.name.toLocaleLowerCase().includes(q));
  const current = editor.file.drive?.id;

  return (
    <Dialog title="Google Drive" onClose={onClose}>
      <div className="drive">
        {!status ? (
          <p className="muted">Checking…</p>
        ) : !status.configured ? (
          <p>
            This copy of the app was built without a Google sign-in key, so Drive is turned off. See
            “Google Drive” in the README for how to add one.
          </p>
        ) : !status.signedIn ? (
          <section className="drive-signin">
            <p>
              Sign in with Google to open and save maps in your Drive. Your browser opens Google’s sign-in page;
              come back here when it says you are signed in.
            </p>
            <p className="muted">
              The app can only see maps it created or that you open with it, never the rest of your Drive.
            </p>
            {busy === 'signin' ? (
              <div className="drive-actions">
                <span className="muted">Waiting for you to finish in the browser…</span>
                <button onClick={() => void drive.cancelSignIn()}>Cancel</button>
              </div>
            ) : (
              <button className="primary" onClick={() => void act('signin', async () => {
                await drive.signIn();
                await refresh();
              })}>Sign in with Google</button>
            )}
          </section>
        ) : (
          <>
            <section className="drive-account">
              <span>
                Signed in as <strong>{status.email ?? status.name ?? 'your Google account'}</strong>
              </span>
              <button className="link-button" onClick={() => void act('signout', async () => {
                await drive.signOut();
                setFiles(null);
                await refresh();
              })}>Sign out</button>
            </section>
            <section className="drive-save">
              <button className="primary" disabled={!!busy} onClick={() => void act('save', async () => {
                if (await editor.saveToDrive(!current)) {
                  onClose();
                }
              })}>
                {current ? 'Save changes to Drive' : 'Save this map to Drive'}
              </button>
              {current ? (
                <button disabled={!!busy} onClick={() => void act('copy', async () => {
                  if (await editor.saveToDrive(true)) onClose();
                })}>Save as a new copy</button>
              ) : null}
            </section>
            <section>
              <div className="drive-list-head">
                <h3>Your maps in Drive</h3>
                <input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search maps in Drive" />
                <button className="icon-button" title="Refresh" aria-label="Refresh" onClick={() => void refresh()}>↻</button>
              </div>
              <ul className="drive-list">
                {files === null ? <li className="muted">Loading…</li> : null}
                {files !== null && !shown.length ? (
                  <li className="muted">{q ? 'No maps match.' : 'No maps yet. Save this one to start.'}</li>
                ) : null}
                {shown.map((f) => (
                  <li key={f.id}>
                    <button disabled={!!busy} className={f.id === current ? 'current' : ''}
                      onClick={() => void act(`open:${f.id}`, async () => {
                        if (await editor.openFromDrive(f.id)) onClose();
                      })}>
                      <strong dir="auto">{f.name.replace(/\.amap$/i, '')}</strong>
                      <span>{f.id === current ? 'Open now · ' : ''}{new Date(f.modifiedTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        {error ? <p className="share-error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}
