import { useCallback, useState } from 'react';
import { Editor } from '../editor';
import { cmd } from '../commands';
import { REACTIONS, isTextNode } from '../model/types';
import { useDismiss } from './Menu';
import { Emoji } from './Emoji';

type Pop = 'add' | 'react' | null;

/** The tool dock at the bottom of the map: select or pan, add things, react. */
export function Dock({ editor }: { editor: Editor }) {
  const [pop, setPop] = useState<Pop>(null);
  const close = useCallback(() => setPop(null), []);
  const ref = useDismiss(pop !== null, close);
  const node = editor.doc.get(editor.primary);
  const canReact = !!node && isTextNode(node) && !editor.readOnly;

  const item = (label: string, keys: string, run: () => void, enabled = true, swatch?: string) => (
    <button role="menuitem" disabled={!enabled} onClick={() => { run(); close(); }}>
      {swatch ? <span className={`swatch swatch-${swatch}`} /> : <span className="swatch-blank" />}
      <span className="menu-label">{label}</span>
      <span className="menu-shortcut">{keys}</span>
    </button>
  );

  return (
    <div ref={ref} className="dock" role="toolbar" aria-label="Tools" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dock-group">
        <button className={`dock-btn${editor.tool === 'select' ? ' on' : ''}`} title="Select and move (V)" aria-label="Select tool"
          onClick={() => editor.setTool('select')}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 3l11 6.2-4.8 1.1L8 15z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </button>
        <button className={`dock-btn${editor.tool === 'pan' ? ' on' : ''}`} title="Move around the map (H)" aria-label="Pan tool"
          onClick={() => editor.setTool('pan')}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7 10V4.8a1.2 1.2 0 012.4 0V9m0-4.6V3.6a1.2 1.2 0 012.4 0V9m0-4.2a1.2 1.2 0 012.4 0V10m0-3a1.2 1.2 0 012.4 0v4.5A5.5 5.5 0 0111.1 17H10a5 5 0 01-4-2l-2.4-3.3a1.2 1.2 0 011.9-1.4L7 12"
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <span className="dock-sep" />
      {!editor.readOnly ? (
        <div className="dock-item">
          <button className={`dock-add${pop === 'add' ? ' on' : ''}`} title="Add" aria-label="Add" aria-haspopup="menu"
            onClick={() => setPop(pop === 'add' ? null : 'add')}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {pop === 'add' ? (
            <div className="menu-list dock-pop" role="menu">
              {item('Claim', 'Ctrl+D', () => cmd('insert.root').run(editor), true, 'claim')}
              {item('Reason', 'Alt+S', () => editor.addReason(), !!editor.primary, 'reason')}
              {item('Objection', 'Alt+O', () => editor.addObjection(), !!editor.primary, 'objection')}
              {item('Co-premise', 'Tab', () => editor.addSibling(), !!node?.parent && node.kind === 'claim')}
              {item('Sticky note', 'Alt+N', () => editor.addSticky(), true, 'sticky')}
              {item('Connection', 'Alt+Click', () => cmd('insert.connection').run(editor), !!editor.primary)}
            </div>
          ) : null}
        </div>
      ) : (
        <span className="dock-note">View only</span>
      )}
      <span className="dock-sep" />
      <div className="dock-item">
        <button className={`dock-btn dock-emoji${pop === 'react' ? ' on' : ''}`} title={canReact ? 'React to the selected box' : 'Select a box to react to it'}
          aria-label="React" disabled={!canReact} onClick={() => setPop(pop === 'react' ? null : 'react')}>
          <Emoji e="😊" size={22} />
        </button>
        {pop === 'react' && node ? (
          <div className="popover reactions dock-pop" role="listbox" aria-label="Reactions">
            {REACTIONS.map((r) => (
              <button key={r} title={r} aria-label={r} onClick={() => { editor.toggleReaction(node.id, r); close(); }}><Emoji e={r} size={22} /></button>
            ))}
            <button className="reaction-comment" onClick={() => { editor.toggleNotes(true); close(); }}>Comment…</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
