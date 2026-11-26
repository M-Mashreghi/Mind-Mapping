import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Editor } from './editor';
import { domMeasure } from './layout/measure';
import { canvasContextMenu, cmd, commandForKey, nodeContextMenu } from './commands';
import { ArgumentWorkspace } from './ui/ArgumentWorkspace';
import { Canvas } from './ui/Canvas';
import { MenuBar } from './ui/MenuBar';
import { ContextMenu } from './ui/Menu';
import { AboutDialog, HistoryDialog, ShortcutsDialog } from './ui/Dialogs';
import { AddHandles, NodeToolbar } from './ui/NodeToolbar';
import { Dock } from './ui/Dock';
import { NotesPanel } from './ui/NotesPanel';
import { FindBar } from './ui/FindBar';
import { ThemePanel } from './ui/ThemePanel';
import { ShareDialog, RequestRow } from './ui/ShareDialog';
import { DriveDialog } from './ui/DriveDialog';
import { isClaim } from './model/types';

/** The small bar at the bottom of a presentation: back, where you are, next, done. */
function PresentBar({ editor }: { editor: Editor }) {
  const p = editor.presentation!;
  const total = p.steps.length;
  return (
    <div className="present-bar" role="toolbar" aria-label="Presentation">
      <button onClick={() => editor.presentPrev()} disabled={p.index <= 0} title="Back (←)" aria-label="Back">
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <span className="present-count" aria-live="polite">{Math.min(p.index + 1, total)} / {total}</span>
      <button onClick={() => editor.presentNext()} disabled={p.index >= total - 1} title="Next (→ or Space)" aria-label="Next">
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <span className="present-sep" />
      <button className="present-exit" onClick={() => editor.stopPresentation()} title="End presentation (Esc)">End</button>
    </div>
  );
}

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
  const [dialog, setDialog] = useState<'shortcuts' | 'about' | 'theme' | 'history' | 'share' | 'drive' | null>(editor.pendingJoin ? 'share' : null);
  const [workspace,setWorkspace]=useState(false);
  useEffect(() => {
    const locate = () => {
      const id = new URLSearchParams(location.hash.slice(1)).get('node');
      if (id && editor.doc.has(id)) { editor.select([id]); editor.scrollIntoView(id); }
    };
    locate();
    window.addEventListener('hashchange',locate);
    return ()=>window.removeEventListener('hashchange',locate);
  }, [editor.doc, editor.file.name]);
  const closeMenu = useCallback(() => setMenu(null), []);

  // Re-measure once web fonts are ready.
  useEffect(() => {
    void document.fonts?.ready.then(() => editor.relayout());
  }, []);

  useEffect(() => {
    const onShortcuts = () => setDialog('shortcuts');
    const onAbout = () => setDialog('about');
    const onTheme = () => setDialog('theme');
    const onHistory = () => setDialog('history');
    const onShare = () => setDialog('share');
    const onDrive = () => setDialog('drive');
    window.addEventListener('argmap:share', onShare);
    window.addEventListener('argmap:drive', onDrive);
    window.addEventListener('argmap:history', onHistory);
    window.addEventListener('argmap:shortcuts', onShortcuts);
    window.addEventListener('argmap:about', onAbout);
    window.addEventListener('argmap:theme', onTheme);
    return () => {
      window.removeEventListener('argmap:theme', onTheme);
      window.removeEventListener('argmap:share', onShare);
      window.removeEventListener('argmap:drive', onDrive);
      window.removeEventListener('argmap:history', onHistory);
      window.removeEventListener('argmap:shortcuts', onShortcuts);
      window.removeEventListener('argmap:about', onAbout);
    };
  }, []);

  // macOS app menu: Undo, Redo and Select All go to the text being edited, or to the map.
  useEffect(() => {
    window.argmapDesktop?.onMenuEdit?.((action) => {
      const el = document.activeElement;
      if (editor.editing || isTextField(el)) {
        document.execCommand(action);
        return;
      }
      const c = cmd(`edit.${action}`);
      if (!c.enabled || c.enabled(editor)) c.run(editor);
    });
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || dialog) return;
      const button = e.target instanceof Element && e.target.closest('button, a[href], [role="menuitem"]');
      if (button && ['Enter', ' ', 'Tab'].includes(e.key)) return;
      if (editor.presentation) {
        const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'];
        const prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'];
        if (next.includes(e.key)) editor.presentNext();
        else if (prev.includes(e.key)) editor.presentPrev();
        else if (e.key === 'Home') editor.presentGo(0);
        else if (e.key === 'End') editor.presentGo(Number.MAX_SAFE_INTEGER);
        else if (e.key === 'Escape' || e.key === 'F5') editor.stopPresentation();
        else return;
        e.preventDefault();
        return;
      }
      if (editor.editing || isTextField(e.target)) return;
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
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !editor.readOnly && isClaim(editor.doc.get(editor.primary))) {
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
      if (dialog || editor.presentation || editor.editing || isTextField(e.target) || !editor.selection.length || !e.clipboardData) return;
      if (cut && editor.readOnly) return;
      const text = cut ? editor.cut() : editor.copyText();
      if (!text) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (dialog || editor.presentation || editor.editing || isTextField(e.target) || editor.readOnly || !e.clipboardData) return;
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
  }, [dialog]);

  // Desktop: confirm before closing with unsaved changes.
  useEffect(() => {
    const bridge = window.argmapDesktop;
    if (bridge) {
      // The main process asks Save / Don't save / Cancel; this runs on Save.
      bridge.onCloseRequest(async () => {
        if (await editor.save()) bridge.confirmClose();
      });
      // Files opened from the file manager or command line.
      bridge.onOpenPath((path) => void editor.openRecent(path));
    }
    // Web: the draft is kept in local storage, but still warn on accidental close.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!bridge && editor.file.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Web: the browser leaves full screen on Esc by itself; end the presentation with it.
  useEffect(() => {
    if (window.argmapDesktop) return;
    const onChange = () => {
      if (!document.fullscreenElement && editor.presentation) editor.stopPresentation(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const zoomPct = Math.round(editor.view.zoom * 100);
  const presenting = editor.presentation;

  useEffect(() => {
    if (editor.appearance === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = editor.appearance;
  }, [editor.appearance]);

  return (
    <div className={`app${presenting ? ' presenting' : ''}`}>
      {presenting ? null : <MenuBar editor={editor} />}
      <div className="workspace">
      <main className="stage">
        <Canvas editor={editor} onContextMenu={(kind, x, y) => setMenu({ kind, x, y })} />
        {presenting ? (
          <PresentBar editor={editor} />
        ) : (
          <>
        <AddHandles editor={editor} />
        <NodeToolbar editor={editor} onMore={(x, y) => setMenu({ kind: 'node', x, y })} />
        {editor.find ? <FindBar editor={editor} /> : null}

        <Dock editor={editor} />

        <div className="corner-tools"><div className="pill"><button style={{width:'auto',padding:'0 10px'}} aria-expanded={workspace} onClick={()=>setWorkspace(!workspace)}>Workspace</button></div>
          <div className="pill" role="toolbar" aria-label="Zoom">
            <button onClick={() => editor.zoomAt(1 / 1.2)} title="Zoom out (Ctrl+-)" aria-label="Zoom out">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
            <button className="zoom-pct" onClick={() => editor.zoomToFit()} title="Zoom to fit (Ctrl+1)">{zoomPct}%</button>
            <button onClick={() => editor.zoomAt(1.2)} title="Zoom in (Ctrl++)" aria-label="Zoom in">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="pill" role="toolbar" aria-label="History">
            <button onClick={() => editor.undo()} disabled={!editor.doc.undo.canUndo() || editor.readOnly} title="Undo (Ctrl+Z)" aria-label="Undo">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4L2.5 7l3 3M3 7h6.5a4 4 0 010 8H7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button onClick={() => editor.redo()} disabled={!editor.doc.undo.canRedo() || editor.readOnly} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 4l3 3-3 3M13 7H6.5a4 4 0 000 8H9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div className="pill" role="toolbar" aria-label="Help">
            <button onClick={() => setDialog('shortcuts')} title="Keyboard shortcuts (Ctrl+/)" aria-label="Help">?</button>
          </div>
        </div>
          </>
        )}

        {editor.message ? (
          <div className={`toast toast-${editor.message.kind}`} role="status">{editor.message.text}</div>
        ) : null}
      </main>
      {workspace && !presenting && <ArgumentWorkspace editor={editor} close={()=>setWorkspace(false)}/>}
      {editor.notesOpen && !presenting ? <NotesPanel editor={editor} /> : null}
      </div>

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
      {dialog === 'theme' ? <ThemePanel editor={editor} onClose={() => setDialog(null)} /> : null}
      {dialog === 'history' ? <HistoryDialog editor={editor} onClose={() => setDialog(null)} /> : null}
      {dialog === 'drive' ? <DriveDialog editor={editor} onClose={() => setDialog(null)} /> : null}
      {dialog === 'share' ? <ShareDialog editor={editor} onClose={() => setDialog(null)} /> : null}
      {editor.invitations.length ? (
        <aside className="join-popups invites" aria-live="polite" aria-label="Invitations">
          <ul>
            {editor.invitations.map((inv) => (
              <li key={inv.id} className="join-request">
                <span className="avatar" style={{ background: inv.fromColor }}>{(inv.from.trim()[0] ?? '?').toLocaleUpperCase()}</span>
                <div className="who">
                  <span><strong dir="auto">{inv.from}</strong> invites you to {inv.role === 'edit' ? 'edit' : 'view'} <strong dir="auto">“{inv.title}”</strong></span>
                  <div className="join-actions">
                    <button className="primary" onClick={() => void editor.acceptInvitation(inv.id)}>Join</button>
                    <button className="link-button" onClick={() => editor.dismissInvitation(inv.id)}>Not now</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      {dialog !== 'share' && editor.collab?.role === 'host' && editor.hostState?.requests.length ? (
        <aside className="join-popups" aria-live="polite" aria-label="People asking to join">
          <ul>
            {editor.hostState.requests.map((r) => <RequestRow key={r.id} editor={editor} request={r} />)}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
