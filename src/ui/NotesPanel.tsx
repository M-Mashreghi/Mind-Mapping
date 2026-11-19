import { useEffect, useRef, useState } from 'react';
import { Editor } from '../editor';
import { isTextNode } from '../model/types';

/** Side panel: the selected box's note, plus every note in the map with search. */
export function NotesPanel({ editor }: { editor: Editor }) {
  const [query, setQuery] = useState('');
  const [truncate, setTruncate] = useState(true);
  const area = useRef<HTMLTextAreaElement>(null);
  const id = editor.primary;
  const node = editor.doc.get(id);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    const focus = () => area.current?.focus();
    window.addEventListener('argmap:focus-note', focus);
    return () => window.removeEventListener('argmap:focus-note', focus);
  }, []);

  // Commit the draft when the selection changes.
  useEffect(() => {
    setDraft(null);
  }, [id]);

  const commit = () => {
    if (draft !== null && id) editor.doc.setNote(id, draft.trimEnd());
    setDraft(null);
  };

  const q = query.trim().toLocaleLowerCase();
  const withNotes = editor.doc
    .all()
    .filter((n) => n.note && (!q || `${n.text}\n${n.note}`.toLocaleLowerCase().includes(q)))
    .sort((a, b) => {
      const ba = editor.layout.boxes.get(a.id), bb = editor.layout.boxes.get(b.id);
      return (ba?.y ?? 0) - (bb?.y ?? 0) || (ba?.x ?? 0) - (bb?.x ?? 0);
    });

  const exportNotes = () => {
    const md = [`# Notes: ${editor.doc.title}`, ''];
    for (const n of editor.doc.all().filter((x) => x.note)) {
      md.push(`## ${n.text || '(untitled box)'}`, '', n.note!, '');
    }
    const blob = new Blob([md.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${editor.doc.title} notes.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <aside className="notes-panel" aria-label="Notes" onKeyDown={(e) => e.stopPropagation()}>
      <div className="panel-head">
        <h2>Notes</h2>
        <button className="icon-button" onClick={() => editor.toggleNotes(false)} aria-label="Close notes">×</button>
      </div>
      <section className="note-editor">
        {node && (isTextNode(node) || node.kind === 'reason' || node.kind === 'objection') ? (
          <>
            <div className="note-for" dir="auto">{node.text || (node.kind === 'claim' ? 'Untitled claim' : node.kind)}</div>
            <textarea
              ref={area}
              dir="auto"
              placeholder="Write a note for this box…"
              value={draft ?? node.note ?? ''}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  commit();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />
          </>
        ) : (
          <p className="muted">Select a box to add a note to it.</p>
        )}
      </section>
      <div className="notes-tools">
        <input type="search" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
        <label className="check"><input type="checkbox" checked={truncate} onChange={(e) => setTruncate(e.target.checked)} /> Truncate</label>
        <button onClick={exportNotes} disabled={!editor.doc.all().some((n) => n.note)}>Export</button>
      </div>
      <ul className="notes-list">
        {withNotes.map((n) => (
          <li key={n.id} className={n.id === id ? 'current' : ''}>
            <button onClick={() => { editor.select([n.id]); editor.scrollIntoView(n.id); }}>
              <strong dir="auto">{n.text || 'Untitled'}</strong>
              <span dir="auto" className={truncate ? 'truncate' : ''}>{n.note}</span>
            </button>
          </li>
        ))}
        {!withNotes.length ? <li className="muted">{q ? 'No notes match.' : 'No notes yet.'}</li> : null}
      </ul>
    </aside>
  );
}
