import { useEffect, useRef } from 'react';
import { Editor } from '../editor';

interface Props {
  editor: Editor;
  text: string;
  /** Typed character that started editing: replaces the text. */
  initial?: string;
  style?: React.CSSProperties;
}

/** In-place plain-text editor for a claim. Enter commits, Shift+Enter adds a line, Esc cancels. */
export function NodeEditor({ editor, text, initial, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current!;
    el.textContent = initial ?? text;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    if (initial !== undefined) range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const onCommit = () => finish(true);
    window.addEventListener('argmap:commit-edit', onCommit);
    return () => window.removeEventListener('argmap:commit-edit', onCommit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current ? ref.current.innerText.replace(/ /g, ' ') : null;
    editor.finishEditing(commit ? value : null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      finish(true);
      editor.addSibling();
    }
  };

  return (
    <div
      ref={ref}
      className="claim-text claim-input"
      style={style}
      dir="auto"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="true"
      aria-label="Claim text"
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
