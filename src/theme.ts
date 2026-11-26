import type { CSSProperties } from 'react';
import { FontSize, MapNode, Theme, stickyW } from './model/types';

import '@fontsource/inter/400.css';
import '@fontsource/inter/400-italic.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';

/** Fonts ship with the app so maps look the same offline and on every machine. */
export const FONTS: { id: string; label: string; css: string }[] = [
  { id: 'system', label: 'Inter', css: "'Inter', 'Vazirmatn', 'Segoe UI', system-ui, sans-serif" },
  { id: 'vazir', label: 'Vazirmatn (Persian)', css: "'Vazirmatn', 'Inter', sans-serif" },
  { id: 'serif', label: 'Merriweather', css: "'Merriweather', 'Vazirmatn', Georgia, serif" },
  { id: 'hand', label: 'Caveat (handwriting)', css: "'Caveat', 'Vazirmatn', cursive" },
  { id: 'mono', label: 'Monospace', css: "ui-monospace, 'Cascadia Mono', 'DejaVu Sans Mono', monospace" },
];

export const fontCss = (id: string) => (FONTS.find((f) => f.id === id) ?? FONTS[0]).css;

export const FONT_SIZES: Record<FontSize, { px: number; label: string; maxWidth: number }> = {
  xs: { px: 12, label: 'XSmall', maxWidth: 250 },
  s: { px: 13, label: 'Small', maxWidth: 260 },
  m: { px: 14, label: 'Medium', maxWidth: 270 },
  l: { px: 17, label: 'Large', maxWidth: 300 },
  xl: { px: 21, label: 'XLarge', maxWidth: 340 },
};

/** Text layout properties shared by the measuring probe and the rendered node. */
export function textStyle(node: MapNode, theme: Theme): CSSProperties {
  const s = node.style ?? {};
  const isRoot = node.kind === 'claim' && node.parent === null;
  // The main claim reads one size larger than the rest unless it has its own size.
  const order: FontSize[] = ['xs', 's', 'm', 'l', 'xl'];
  const rootSize = order[Math.min(order.length - 1, order.indexOf(theme.fontSize) + (theme.mapStyle === 'bold' ? 2 : 1))];
  const size = FONT_SIZES[s.size ?? (isRoot ? rootSize : theme.fontSize)];
  const sticky = node.kind === 'sticky';
  const hand = theme.font === 'hand' || sticky;
  const px = hand ? size.px + 4 : size.px;
  return {
    fontFamily: fontCss(sticky ? 'hand' : theme.font),
    fontSize: px,
    lineHeight: `${Math.round(px * 1.43)}px`,
    fontWeight: s.bold || (theme.mapStyle === 'bold' && isRoot) ? 700 : isRoot ? 600 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
    direction: s.direction,
    textAlign: s.align ?? (s.direction==='rtl'?'right':s.direction==='ltr'?'left':'center'),
    maxWidth: sticky ? stickyW(node) : size.maxWidth,
    padding: sticky ? `${Math.round(px * 0.9)}px ${Math.round(px * 1.0)}px` : isRoot ? `${Math.round(px * 0.9)}px ${Math.round(px * 1.6)}px` : `${Math.round(px * 0.65)}px ${Math.round(px * 0.85)}px`,
  };
}

/** Box colours for a node, from its own style, then the theme, then CSS defaults. */
export function boxStyle(node: MapNode, theme: Theme): CSSProperties {
  const s = node.style ?? {};
  const isRoot = node.kind === 'claim' && node.parent === null;
  const out: CSSProperties = {};
  const fill = s.fill || (isRoot ? theme.root.fill : '');
  const border = s.border || (isRoot ? theme.root.border : '');
  const color = s.color || (isRoot ? theme.root.text : '');
  if (fill) out.background = fill;
  if (border) out.borderColor = border;
  if (color) out.color = color;
  // A custom fill without a text colour gets readable text in light and dark mode.
  else if (fill) out.color = readableOn(fill);
  return out;
}

/** Dark or light text, whichever reads better on a hex background. */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#1b1f27' : '#ffffff';
}

/** CSS variables for the whole map from the theme. */
export function themeVars(theme: Theme): CSSProperties {
  const v: Record<string, string> = {
    '--node-border-width': `${theme.borderWidth}px`,
    '--node-radius': `${theme.radius}px`,
    '--edge-width': `${theme.lineWidth}`,
  };
  if (theme.canvas) v['--bg'] = theme.canvas;
  for (const kind of ['reason', 'objection'] as const) {
    const c = theme[kind];
    if (c.border) v[`--${kind}`] = v[`--${kind}-line`] = c.border;
    if (c.fill) v[`--${kind}-soft`] = v[`--${kind}-fill`] = c.fill;
    if (c.text) v[`--${kind}-text`] = v[`--${kind}-ink`] = c.text;
  }
  if (theme.root.fill) v['--root-fill'] = theme.root.fill;
  if (theme.root.border) v['--root-line'] = theme.root.border;
  if (theme.root.text) v['--root-ink'] = theme.root.text;
  if (!theme.shadow) v['--shadow'] = 'none';
  return v as CSSProperties;
}

/** 24 ready-made colours for fills, borders and text. */
export const PALETTE = [
  '#ffffff', '#f1f3f5', '#ced4da', '#868e96', '#495057', '#212529',
  '#ffe3e3', '#ffa8a8', '#fa5252', '#c92a2a', '#fff3bf', '#ffd43b',
  '#f59f00', '#e67700', '#d3f9d8', '#69db7c', '#2f9e44', '#2b8a3e',
  '#d0ebff', '#74c0fc', '#1c7ed6', '#e5dbff', '#9775fa', '#6741d9',
];
