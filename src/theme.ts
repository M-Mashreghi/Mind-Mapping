import type { CSSProperties } from 'react';
import { FontSize, MapNode, Theme } from './model/types';

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
  xs: { px: 12, label: 'XS', maxWidth: 220 },
  s: { px: 13, label: 'S', maxWidth: 230 },
  m: { px: 14, label: 'M', maxWidth: 240 },
  l: { px: 17, label: 'L', maxWidth: 280 },
  xl: { px: 21, label: 'XL', maxWidth: 330 },
};

/** Text layout properties shared by the measuring probe and the rendered node. */
export function textStyle(node: MapNode, theme: Theme): CSSProperties {
  const s = node.style ?? {};
  const isRoot = node.kind === 'claim' && node.parent === null;
  const size = FONT_SIZES[s.size ?? (theme.mapStyle === 'bold' && isRoot ? 'l' : theme.fontSize)];
  const hand = theme.font === 'hand';
  const px = hand ? size.px + 4 : size.px;
  return {
    fontFamily: fontCss(theme.font),
    fontSize: px,
    lineHeight: `${Math.round(px * 1.43)}px`,
    fontWeight: s.bold || (theme.mapStyle === 'bold' && isRoot) ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
    textAlign: s.align ?? 'center',
    maxWidth: node.kind === 'sticky' ? 220 : size.maxWidth,
    padding: `${Math.round(px * 0.65)}px ${Math.round(px * 0.85)}px`,
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
  if (theme.reason.border) v['--reason'] = theme.reason.border;
  if (theme.reason.fill) v['--reason-soft'] = theme.reason.fill;
  if (theme.reason.text) v['--reason-text'] = theme.reason.text;
  if (theme.objection.border) v['--objection'] = theme.objection.border;
  if (theme.objection.fill) v['--objection-soft'] = theme.objection.fill;
  if (theme.objection.text) v['--objection-text'] = theme.objection.text;
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
