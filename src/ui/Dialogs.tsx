import { useCallback } from 'react';
import { commands } from '../commands';
import { useDismiss } from './Menu';
import { Logo } from './Logo';

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const close = useCallback(onClose, [onClose]);
  const ref = useDismiss(true, close);
  return (
    <div className="dialog-backdrop">
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

const SECTIONS: { title: string; ids: string[] }[] = [
  { title: 'Build the argument', ids: ['insert.reason', 'insert.objection', 'insert.child', 'insert.sibling', 'insert.parent', 'insert.root', 'edit.implicit', 'edit.detach'] },
  { title: 'Edit', ids: ['edit.text', 'edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.pasteRoot', 'edit.selectAll', 'edit.delete'] },
  { title: 'View', ids: ['view.fold', 'view.foldLevel', 'view.unfoldLevel', 'view.zoomIn', 'view.zoomOut', 'view.fit', 'view.recenter', 'view.fullscreen'] },
  { title: 'File', ids: ['file.new', 'file.open', 'file.save', 'file.saveAs'] },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div className="shortcut-grid">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h3>{s.title}</h3>
            <dl>
              {s.ids.map((id) => {
                const c = commands.get(id)!;
                return (
                  <div key={id} className="shortcut-row">
                    <dt>{c.label}</dt>
                    <dd><kbd>{c.shortcut}</kbd></dd>
                  </div>
                );
              })}
              {s.title === 'Edit' ? (
                <div className="shortcut-row"><dt>Move selection</dt><dd><kbd>Arrow keys</kbd></dd></div>
              ) : null}
            </dl>
          </section>
        ))}
      </div>
      <p className="hint">Drag a box onto another claim to make it a reason for that claim, or onto a reason to add it as a co-premise. Drag the background to pan; hold Ctrl and scroll to zoom.</p>
    </Dialog>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About Argument Mapper" onClose={onClose}>
      <div className="about">
        <Logo size={48} />
        <p><strong>Argument Mapper</strong> {__APP_VERSION__}</p>
        <p>Free and open-source argument mapping. Released under the MIT licence.</p>
      </div>
    </Dialog>
  );
}
