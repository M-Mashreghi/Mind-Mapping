import { useEffect, useRef } from 'react';
import { Editor } from '../editor';

export function FindBar({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    focus();
    window.addEventListener('argmap:focus-find', focus);
    return () => window.removeEventListener('argmap:focus-find', focus);
  }, []);
  const f = editor.find!;
  return (
    <div className="find-bar" role="search">
      <input
        ref={ref}
        type="search"
        dir="auto"
        placeholder="Find in map"
        aria-label="Find in map"
        value={f.query}
        onChange={(e) => editor.runFind(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') editor.findStep(e.shiftKey ? -1 : 1);
          if (e.key === 'Escape') editor.closeFind();
        }}
      />
      <span className="find-count">{f.query ? (f.matches.length ? `${f.index + 1} of ${f.matches.length}` : 'No matches') : ''}</span>
      <button onClick={() => editor.findStep(-1)} disabled={!f.matches.length} aria-label="Previous match">↑</button>
      <button onClick={() => editor.findStep(1)} disabled={!f.matches.length} aria-label="Next match">↓</button>
      <button onClick={() => editor.closeFind()} aria-label="Close find">×</button>
    </div>
  );
}
