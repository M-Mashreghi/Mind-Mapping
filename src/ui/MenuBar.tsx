import { useCallback, useState } from 'react';
import { Editor } from '../editor';
import { menus } from '../commands';
import { MenuList, useDismiss } from './Menu';
import { Logo } from './Logo';

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
          {editor.file.dirty ? (editor.file.path ? 'Saving…' : 'Not saved') : editor.file.path ? 'Saved' : ''}
        </span>
      </div>
    </header>
  );
}
