import { useCallback, useState } from 'react';
import { Editor } from '../editor';
import { menus } from '../commands';
import { MenuList, useDismiss } from './Menu';
import { Logo } from './Logo';
import { initial } from './ShareDialog';

export function MenuBar({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const ref = useDismiss(open !== null, close);
  const [title, setTitle] = useState<string | null>(null);

  const recent = editor.recent.map((path) => ({
    label: path.split(/[\\/]/).pop() ?? path,
    run: () => void editor.openRecent(path),
  }));

  return (
    <header className="menubar">
      <div className="brand" title="Argument Mapper">
        <Logo />
      </div>
      <nav ref={ref} className="menus" aria-label="Main menu">
        {menus.map((m) => (
          <div key={m.label} className={`menu${open === m.label ? ' open' : ''}`}>
            <button
              className="menu-button"
              aria-haspopup="menu"
              aria-expanded={open === m.label}
              onClick={() => setOpen(open === m.label ? null : m.label)}
              onPointerEnter={() => open && setOpen(m.label)}
            >
              {m.label}
            </button>
            {open === m.label ? (
              <div className="dropdown">
                <MenuList editor={editor} items={m.items} onDone={close} dynamic={{ 'Open recent': recent }} />
              </div>
            ) : null}
          </div>
        ))}
      </nav>
      <div className="title-area">
        <input
          className="map-title"
          dir="auto"
          aria-label="Map title"
          value={title ?? editor.doc.title}
          onFocus={() => setTitle(editor.doc.title)}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title !== null) editor.rename(title);
            setTitle(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setTitle(null);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className={`save-state${editor.file.dirty ? ' dirty' : ''}`}>
          {editor.collab?.role === 'guest'
            ? editor.collab.readOnly ? 'View only' : 'Shared'
            : editor.file.dirty
              ? (editor.file.path || editor.file.drive ? 'Saving…' : 'Not saved')
              : editor.file.drive ? 'Saved in Drive' : editor.file.path ? 'Saved' : ''}
        </span>
      </div>
      <div className="share-area">
        {editor.collab ? (
          <div className="avatars" aria-label="People here">
            {editor.peers.slice(0, 5).map((p) => (
              <span key={p.clientId} className="avatar" style={{ background: p.user.color }} title={p.user.name}>{initial(p.user.name)}</span>
            ))}
            {editor.peers.length > 5 ? <span className="avatar more">+{editor.peers.length - 5}</span> : null}
          </div>
        ) : null}
        <button className="present-button" onClick={() => editor.startPresentation()} title="Present the map one claim at a time (F5)">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor" /></svg>
          Present
        </button>
        <button
          className={`share-button${editor.collab ? ' live' : ''}`}
          onClick={() => window.dispatchEvent(new CustomEvent('argmap:share'))}
          title="Work together on your local network"
        >
          {editor.collab
            ? editor.collab.session.status === 'connected'
              ? <>Live <span className="live-count" title="People in this map, you included">· {editor.peers.length + 1}</span></>
              : 'Reconnecting…'
            : 'Share'}
        </button>
      </div>
    </header>
  );
}
