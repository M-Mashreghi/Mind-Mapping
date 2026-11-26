import { useEffect, useState } from 'react';
import { Editor } from '../editor';
import { ColorSet, FontSize, Theme } from '../model/types';
import { FONTS, FONT_SIZES, readableOn } from '../theme';
import { readColors } from '../export/svg';
import { Dialog } from './Dialogs';

type Tab = 'layout' | 'color' | 'text' | 'shape';

function Choice<T extends string | number | boolean>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="choice" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ColorField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  const color = value || fallback;
  const hex = /^#[0-9a-f]{3}$/i.test(color) ? color.replace(/[0-9a-f]/gi, digit => digit + digit) : color;
  return (
    <div className="color-field">
      <span>{label}</span>
      <input type="color" aria-label={label} value={hex} onChange={(e) => onChange(e.target.value)} />
      {value ? <button className="link-button" onClick={() => onChange('')}>Default</button> : <span className="muted">Default</span>}
    </div>
  );
}

function ColorSetFields({ title, set, defaults, onChange }: { title: string; set: ColorSet; defaults: ColorSet; onChange: (s: ColorSet) => void }) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <ColorField label="Text" value={set.text} fallback={defaults.text} onChange={(text) => onChange({ ...set, text })} />
      <ColorField label="Fill" value={set.fill} fallback={defaults.fill} onChange={(fill) => onChange({ ...set, fill })} />
      <ColorField label="Border" value={set.border} fallback={defaults.border} onChange={(border) => onChange({ ...set, border })} />
    </fieldset>
  );
}

/** Map-wide theme: layout, colours, text and shapes. */
export function ThemePanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('layout');
  const [palette,setPalette] = useState(() => readColors(document.documentElement));
  useEffect(() => {
    const refresh = () => setPalette(readColors(document.documentElement));
    const system = window.matchMedia?.('(prefers-color-scheme: dark)');
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    system?.addEventListener('change',refresh);
    refresh();
    return () => { observer.disconnect(); system?.removeEventListener('change',refresh); };
  }, []);
  const t = editor.doc.theme;
  const set = (patch: Partial<Theme>) => editor.setTheme(patch);
  return (
    <Dialog title="Customize layout & style" onClose={onClose}>
      <div className="tabs" role="tablist">
        {(['layout', 'color', 'text', 'shape'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <div className="theme-body">
        {tab === 'layout' ? (
          <>
            <h3>Map style</h3>
            <Choice value={t.mapStyle} onChange={(mapStyle) => set({ mapStyle })}
              options={[{ value: 'standard', label: 'Standard' }, { value: 'bold', label: 'High impact' }]} />
            <h3>Density</h3>
            <Choice value={t.density} onChange={(density) => set({ density })}
              options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]} />
            <h3>Labels</h3>
            <Choice value={t.numbering} onChange={(numbering) => set({ numbering })}
              options={[
                { value: 'none', label: 'None' }, { value: 'level', label: 'By level' },
                { value: 'hierarchical', label: 'Hierarchical' }, { value: 'sequential', label: 'Sequential' },
              ]} />
          </>
        ) : null}
        {tab === 'color' ? (
          <>
            <h3>Canvas</h3>
            <ColorField label="Background" value={t.canvas} fallback={palette.bg} onChange={(canvas) => set({ canvas })} />
            <ColorSetFields title="Reasons (support)" set={t.reason} defaults={{text:palette.reasonInk,fill:palette.reasonFill,border:palette.reasonLine}} onChange={(reason) => set({ reason })} />
            <ColorSetFields title="Objections" set={t.objection} defaults={{text:palette.objectionInk,fill:palette.objectionFill,border:palette.objectionLine}} onChange={(objection) => set({ objection })} />
            <ColorSetFields title="Root claim" set={t.root} defaults={{text:t.root.fill ? readableOn(t.root.fill) : palette.rootInk,fill:palette.rootFill,border:palette.rootLine}} onChange={(root) => set({ root })} />
          </>
        ) : null}
        {tab === 'text' ? (
          <>
            <h3>Font</h3>
            <Choice value={t.font} onChange={(font) => set({ font })} options={FONTS.map((f) => ({ value: f.id, label: f.label }))} />
            <h3>Size</h3>
            <Choice value={t.fontSize} onChange={(fontSize) => set({ fontSize })}
              options={(Object.keys(FONT_SIZES) as FontSize[]).map((s) => ({ value: s, label: FONT_SIZES[s].label }))} />
          </>
        ) : null}
        {tab === 'shape' ? (
          <>
            <h3>Border thickness</h3>
            <Choice value={t.borderWidth} onChange={(borderWidth) => set({ borderWidth })}
              options={[1, 1.5, 2, 3, 4].map((v) => ({ value: v, label: `${v}px` }))} />
            <h3>Corner radius</h3>
            <Choice value={t.radius} onChange={(radius) => set({ radius })}
              options={[{ value: 2, label: 'S' }, { value: 8, label: 'M' }, { value: 14, label: 'L' }, { value: 999, label: 'Round' }]} />
            <h3>Shadow</h3>
            <Choice value={t.shadow} onChange={(shadow) => set({ shadow })} options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }]} />
            <h3>Line thickness</h3>
            <Choice value={t.lineWidth} onChange={(lineWidth) => set({ lineWidth })}
              options={[1, 1.5, 2, 3, 4].map((v) => ({ value: v, label: `${v}px` }))} />
            <h3>Line style</h3>
            <Choice value={t.lineStyle} onChange={(lineStyle) => set({ lineStyle })}
              options={[{ value: 'curved', label: 'Curved' }, { value: 'straight', label: 'Straight' }, { value: 'elbow', label: 'Right angles' }]} />
            <h3>Words on lines</h3>
            <Choice value={t.lineLabels} onChange={(lineLabels) => set({ lineLabels })}
              options={[{ value: false, label: 'Only my own' }, { value: true, label: 'Because / But' }]} />
          </>
        ) : null}
      </div>
      <div className="dialog-foot">
        <button className="link-button" onClick={() => editor.resetAllStyling()}>Reset styling</button>
        <button className="primary" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}
