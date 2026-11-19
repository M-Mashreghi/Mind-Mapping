import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Editor } from './editor';
import { domMeasure } from './layout/measure';
import { canvasContextMenu, cmd, commandForKey, nodeContextMenu } from './commands';
import { Canvas } from './ui/Canvas';
import { MenuBar } from './ui/MenuBar';
import { ContextMenu } from './ui/Menu';
import { AboutDialog, ShortcutsDialog } from './ui/Dialogs';
import { isClaim } from './model/types';

const editor = new Editor(domMeasure);
// Expose for debugging and end-to-end tests.
(window as unknown as { argmapEditor: Editor }).argmapEditor = editor;

function isTextField(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

export function App() {
  useSyncExternalStore(editor.subscribe, editor.getVersion);
  const [menu, setMenu] = useState<{ kind: 'node' | 'canvas'; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<'shortcuts' | 'about' | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // Re-measure once web fonts are ready.
  useEffect(() => {
    void document.fonts?.ready.then(() => editor.relayout());
  }, []);

  useEffect(() => {
    const onShortcuts = () => setDialog('shortcuts');
    const onAbout = () => setDialog('about');
    window.addEventListener('argmap:shortcuts', onShortcuts);
    window.addEventListener('argmap:about', onAbout);
    return () => {
      window.removeEventListener('argmap:shortcuts', onShortcuts);
      window.removeEventListener('argmap:about', onAbout);
    };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || editor.editing || isTextField(e.target)) return;
      if (dialog) return;
      const arrows: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      };
      if (arrows[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        editor.navigate(arrows[e.key]);
        return;
      }
      // Clipboard keys are handled by the copy/cut/paste events below.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ['KeyC', 'KeyX', 'KeyV'].includes(e.code)) return;
      const id = commandForKey(e);
      if (id) {
        const c = cmd(id);
        e.preventDefault();
        if (!c.enabled || c.enabled(editor)) c.run(editor);
        return;
      }
      // Typing a character on a selected claim starts editing with that character.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && isClaim(editor.doc.get(editor.primary))) {
        e.preventDefault();
        editor.startEditing(undefined, e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  // System clipboard integration.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (editor.editing || isTextField(e.target) || !editor.selection.length) return;
      const text = cut ? editor.cut() : editor.copyText();
      if (!text || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (editor.editing || isTextField(e.target)) return;
      e.preventDefault();
      editor.pasteText(e.clipboardData?.getData('text/plain') ?? null);
    };
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', paste);
    };
  }, []);

  // Desktop: confirm before closing with unsaved changes.
  useEffect(() => {
    const bridge = window.argmapDesktop;
    if (bridge) {
      // The main process asks Save / Don't save / Cancel; this runs on Save.
      bridge.onCloseRequest(async () => {
        if (await editor.save()) bridge.confirmClose();
      });
    }
    // Web: the draft is kept in local storage, but still warn on accidental close.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!bridge && editor.file.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const zoomPct = Math.round(editor.view.zoom * 100);

  return (
    <div className="app">
      <MenuBar editor={editor} />
      <main className="stage">
        <Canvas editor={editor} onContextMenu={(kind, x, y) => setMenu({ kind, x, y })} />

        <div className="toolbar toolbar-insert" role="toolbar" aria-label="Insert">
          <button onClick={() => cmd('insert.root').run(editor)} title="New root claim (Ctrl+D)">
            <span className="swatch swatch-claim" /> Claim
          </button>
          <button onClick={() => editor.addReason()} disabled={!editor.primary} title="Add a reason (Alt+S)">
            <span className="swatch swatch-reason" /> Reason
          </button>
          <button onClick={() => editor.addObjection()} disabled={!editor.primary} title="Add an objection (Alt+O)">
            <span className="swatch swatch-objection" /> Objection
          </button>
        </div>

        <div className="toolbar toolbar-view" role="toolbar" aria-label="View">
          <button onClick={() => editor.undo()} disabled={!editor.doc.undo.canUndo()} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
          <button onClick={() => editor.redo()} disabled={!editor.doc.undo.canRedo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
          <span className="toolbar-sep" />
          <button onClick={() => editor.zoomAt(1 / 1.2)} title="Zoom out (Ctrl+-)" aria-label="Zoom out">−</button>
          <button className="zoom-pct" onClick={() => editor.zoomToFit()} title="Zoom to fit (Ctrl+1)">{zoomPct}%</button>
          <button onClick={() => editor.zoomAt(1.2)} title="Zoom in (Ctrl++)" aria-label="Zoom in">+</button>
          <span className="toolbar-sep" />
          <button onClick={() => setDialog('shortcuts')} title="Keyboard shortcuts (Ctrl+/)" aria-label="Help">?</button>
        </div>

        {editor.message ? (
          <div className={`toast toast-${editor.message.kind}`} role="status">{editor.message.text}</div>
        ) : null}
      </main>

      {menu ? (
        <ContextMenu
          editor={editor}
          items={menu.kind === 'node' ? nodeContextMenu : canvasContextMenu}
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
        />
      ) : null}
      {dialog === 'shortcuts' ? <ShortcutsDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'about' ? <AboutDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
