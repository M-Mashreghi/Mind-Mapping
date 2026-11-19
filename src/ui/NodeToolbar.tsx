import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Editor } from '../editor';
import { FontSize, isTextNode } from '../model/types';
import { FONT_SIZES, PALETTE } from '../theme';
import { useDismiss } from './Menu';

type Pop = 'fill' | 'border' | 'color' | 'size' | null;

/** Floating toolbar above the selected box: colours, text style, notes, link. */
export function NodeToolbar({ editor, onMore }: { editor: Editor; onMore: (x: number, y: number) => void }) {
  const [pop, setPop] = useState<Pop>(null);
  const close = useCallback(() => setPop(null), []);
  const ref = useDismiss(pop !== null, close);
  const [width, setWidth] = useState(0);
  const measured = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const w = measured.current?.offsetWidth ?? 0;
    if (w && w !== width) setWidth(w);
  });
  const id = editor.primary;
  const box = id ? editor.layout.boxes.get(id) : undefined;
  const node = editor.doc.get(id);
  if (!box || !node || editor.editing) return null;

  const { zoom, x, y } = editor.view;
  const half = width / 2 + 8;
  const left = Math.max(half, Math.min((box.x + box.w / 2) * zoom + x, editor.viewport.w - half));
  const top = box.y * zoom + y - 12;
  const below = top < 56;
  const style = node.style ?? {};
  const text = isTextNode(node);

  const swatches = (key: 'fill' | 'border' | 'color') => (
    <div className="popover swatches" role="listbox" aria-label="Colours">
      {PALETTE.map((c) => (
        <button key={c} className="swatch-btn" style={{ background: c }} title={c} aria-label={c}
          onClick={() => { editor.setStyle({ [key]: c }); close(); }} />
      ))}
      <label className="swatch-custom" title="Custom colour">
        <input type="color" value={style[key] || '#888888'} onChange={(e) => editor.setStyle({ [key]: e.target.value })} />
        Custom
      </label>
      <button className="swatch-reset" onClick={() => { editor.setStyle({ [key]: undefined }); close(); }}>Default</button>
    </div>
  );

  return (
    <div
      ref={(el) => {
        ref.current = el;
        measured.current = el;
      }}
      className={`node-toolbar${below ? ' below' : ''}`}
      style={below ? { left, top: (box.y + box.h) * zoom + y + 12 } : { left, top }}
      role="toolbar"
      aria-label="Box style"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="tb-item">
        <button title="Fill colour" aria-label="Fill colour" onClick={() => setPop(pop === 'fill' ? null : 'fill')}>
          <span className="tb-fill" style={{ background: style.fill || 'var(--surface)' }} />
        </button>
        {pop === 'fill' ? swatches('fill') : null}
      </div>
      <div className="tb-item">
        <button title="Border colour" aria-label="Border colour" onClick={() => setPop(pop === 'border' ? null : 'border')}>
          <span className="tb-border" style={{ borderColor: style.border || 'var(--ink-2)' }} />
        </button>
        {pop === 'border' ? swatches('border') : null}
      </div>
      {text ? (
        <>
          <span className="tb-sep" />
          <div className="tb-item">
            <button title="Font size" onClick={() => setPop(pop === 'size' ? null : 'size')}>
              {FONT_SIZES[style.size ?? editor.doc.theme.fontSize].label}
            </button>
            {pop === 'size' ? (
              <div className="popover size-list" role="listbox">
                {(Object.keys(FONT_SIZES) as FontSize[]).map((s) => (
                  <button key={s} className={(style.size ?? editor.doc.theme.fontSize) === s ? 'on' : ''}
                    onClick={() => { editor.setStyle({ size: s }); close(); }}>
                    {FONT_SIZES[s].label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="tb-item">
            <button title="Text colour" aria-label="Text colour" onClick={() => setPop(pop === 'color' ? null : 'color')}>
              <span className="tb-text" style={{ borderBottomColor: style.color || 'var(--ink)' }}>A</span>
            </button>
            {pop === 'color' ? swatches('color') : null}
          </div>
          <button className={style.bold ? 'on' : ''} title="Bold (Ctrl+B)" onClick={() => editor.toggleStyle('bold')}><b>B</b></button>
          <button className={style.italic ? 'on' : ''} title="Italic (Ctrl+I)" onClick={() => editor.toggleStyle('italic')}><i>I</i></button>
          <button className={style.underline ? 'on' : ''} title="Underline (Ctrl+U)" onClick={() => editor.toggleStyle('underline')}><u>U</u></button>
          <button className={style.strike ? 'on' : ''} title="Strikethrough (Ctrl+Shift+X)" onClick={() => editor.toggleStyle('strike')}><s>S</s></button>
          <button title="Text alignment"
            onClick={() => {
              const order = ['center', 'left', 'right'] as const;
              const cur = style.align ?? 'center';
              const next = order[(order.indexOf(cur) + 1) % 3];
              editor.setStyle({ align: next === 'center' ? undefined : next });
            }}>
            <AlignIcon align={style.align ?? 'center'} />
          </button>
          <button title="Bulleted list (Ctrl+Shift+8)" onClick={() => editor.toggleList('bullet')}>•≡</button>
          <span className="tb-sep" />
          <button className={node.link ? 'on' : ''} title="Link (Ctrl+K)" onClick={() => editor.editLink()}>Link</button>
          <button className={node.note ? 'on' : ''} title="Notes (N)" onClick={() => editor.toggleNotes(true)}>Note</button>
        </>
      ) : null}
      <span className="tb-sep" />
      <button title="More actions" aria-label="More actions" onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onMore(r.left, r.bottom + 4);
      }}>···</button>
    </div>
  );
}

function AlignIcon({ align }: { align: 'left' | 'center' | 'right' }) {
  const lines = [[2, 14], [4, 12], [2, 14], [5, 11]];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {lines.map(([a, b], i) => {
        const w = b - a;
        const x1 = align === 'left' ? 2 : align === 'right' ? 14 - w : a;
        return <line key={i} x1={x1} x2={x1 + w} y1={3 + i * 3.3} y2={3 + i * 3.3} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />;
      })}
    </svg>
  );
}
