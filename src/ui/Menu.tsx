import { useEffect, useRef, useState } from 'react';
import { Editor } from '../editor';
import { commands, MenuItem } from '../commands';

interface MenuListProps {
  editor: Editor;
  items: MenuItem[];
  onDone: () => void;
  /** Extra submenu contents by label, e.g. the recent files list. */
  dynamic?: Record<string, { label: string; run: () => void }[]>;
}

/** A dropdown list of commands with submenus. */
export function MenuList({ editor, items, onDone, dynamic }: MenuListProps) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  return (
    <div className="menu-list" role="menu">
      {items.map((item, i) => {
        if (item === '-') return <div key={i} className="menu-sep" role="separator" />;
        if (typeof item === 'object') {
          const extra = dynamic?.[item.label];
          const empty = !item.items.length && !extra?.length;
          return (
            <div
              key={item.label}
              className={`menu-item has-sub${empty ? ' disabled' : ''}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-disabled={empty}
              onPointerEnter={() => setOpenSub(item.label)}
              onClick={() => setOpenSub(item.label)}
            >
              <span className="menu-check" />
              <span className="menu-label">{item.label}</span>
              <span className="menu-shortcut">›</span>
              {openSub === item.label && !empty ? (
                <div className="submenu">
                  {extra ? (
                    <div className="menu-list" role="menu">
                      {extra.map((x) => (
                        <div key={x.label} className="menu-item" role="menuitem" onClick={(e) => { e.stopPropagation(); onDone(); x.run(); }}>
                          <span className="menu-check" />
                          <span className="menu-label" dir="auto">{x.label}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <MenuList editor={editor} items={item.items} onDone={onDone} />
                  )}
                </div>
              ) : null}
            </div>
          );
        }
        const c = commands.get(item);
        if (!c) return null;
        const enabled = c.enabled ? c.enabled(editor) : true;
        const checked = c.checked?.(editor);
        return (
          <div
            key={c.id}
            className={`menu-item${enabled ? '' : ' disabled'}`}
            role={c.checked ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={c.checked ? !!checked : undefined}
            aria-disabled={!enabled}
            onPointerEnter={() => setOpenSub(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (!enabled) return;
              onDone();
              c.run(editor);
            }}
          >
            <span className="menu-check">{checked ? '✓' : ''}</span>
            <span className="menu-label">{c.label}</span>
            <span className="menu-shortcut">{c.shortcut ?? ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Close a popup when clicking elsewhere or pressing Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);
  return ref;
}

export function ContextMenu({ editor, items, x, y, onClose }: { editor: Editor; items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  const ref = useDismiss(true, onClose);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y, ref]);
  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }}>
      <MenuList editor={editor} items={items} onDone={onClose} />
    </div>
  );
}
