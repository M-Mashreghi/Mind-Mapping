import { LayoutResult, placeLineLabels } from '../layout/layout';
import { Connection, MapNode, Theme, stanceOf } from '../model/types';
import { boxStyle, textStyle } from '../theme';

import interRegular from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import vazirArabic from '@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff2?url';
import vazirArabicBold from '@fontsource/vazirmatn/files/vazirmatn-arabic-700-normal.woff2?url';
import merriRegular from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff2?url';
import merriBold from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff2?url';
import caveatRegular from '@fontsource/caveat/files/caveat-latin-400-normal.woff2?url';
import caveatBold from '@fontsource/caveat/files/caveat-latin-700-normal.woff2?url';

/** Colours resolved from the live CSS variables, so exports match light or dark mode. */
export interface Colors {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  reason: string;
  reasonSoft: string;
  reasonText: string;
  objection: string;
  objectionSoft: string;
  objectionText: string;
  /** The argument-map look: premise boxes, brackets and the main claim pill. */
  reasonFill: string;
  reasonLine: string;
  reasonInk: string;
  objectionFill: string;
  objectionLine: string;
  objectionInk: string;
  rootFill: string;
  rootLine: string;
  rootInk: string;
  badgeBg: string;
  badgeInk: string;
}

export function readColors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback = '') => cs.getPropertyValue(name).trim() || fallback;
  const reason = v('--reason', '#1e9e5a');
  const objection = v('--objection', '#d9433f');
  return {
    bg: v('--bg', '#ffffff'),
    surface: v('--surface', '#ffffff'),
    surface2: v('--surface-2', '#f0f2f5'),
    ink: v('--ink', '#1b1f27'),
    ink2: v('--ink-2', '#5b6372'),
    ink3: v('--ink-3', '#8b93a1'),
    line: v('--line', '#d7dbe2'),
    reason,
    reasonSoft: v('--reason-soft', 'rgba(30,158,90,0.09)'),
    reasonText: v('--reason-text', reason),
    objection,
    objectionSoft: v('--objection-soft', 'rgba(217,67,63,0.08)'),
    objectionText: v('--objection-text', objection),
    reasonFill: v('--reason-fill', '#e3f4df'),
    reasonLine: v('--reason-line', '#8ccc84'),
    reasonInk: v('--reason-ink', '#1d4a1c'),
    objectionFill: v('--objection-fill', '#fcdcd6'),
    objectionLine: v('--objection-line', '#ea8a7e'),
    objectionInk: v('--objection-ink', '#6b1c13'),
    rootFill: v('--root-fill', '#1f2126'),
    rootLine: v('--root-line', '#1f2126'),
    rootInk: v('--root-ink', '#ffffff'),
    badgeBg: v('--badge-bg', '#ffffff'),
    badgeInk: v('--badge-ink', '#3b4150'),
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR = /[A-Za-zÀ-ɏЀ-ӿ]/;
function isRtl(line: string): boolean {
  for (const ch of line) {
    if (RTL.test(ch)) return true;
    if (LTR.test(ch)) return false;
  }
  return false;
}

let ctx: CanvasRenderingContext2D | null = null;
function wrap(text: string, font: string, maxWidth: number): string[] {
  ctx = ctx ?? document.createElement('canvas').getContext('2d');
  if (!ctx) return text.split('\n');
  ctx.font = font;
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width <= maxWidth || !line.trim()) {
        line = test;
        // A single word wider than the box is broken by characters.
        while (ctx.measureText(line).width > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        out.push(line.trimEnd());
        line = w.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

function edgePath(x1: number, y1: number, x2: number, y2: number, style: Theme['lineStyle']): string {
  const my = (y1 + y2) / 2;
  if (style === 'straight') return `M${x1} ${y1} L${x2} ${y2}`;
  if (style === 'elbow') return `M${x1} ${y1} V${my} H${x2} V${y2}`;
  return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
}

async function toDataUrl(url: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:font/woff2;base64,${btoa(bin)}`;
}

async function fontFaces(theme: Theme, hasSticky: boolean): Promise<string> {
  const faces: [string, string, number][] = [
    ['Inter', interRegular, 400],
    ['Inter', interBold, 700],
    ['Vazirmatn', vazirArabic, 400],
    ['Vazirmatn', vazirArabicBold, 700],
  ];
  if (theme.font === 'serif') faces.push(['Merriweather', merriRegular, 400], ['Merriweather', merriBold, 700]);
  // Sticky notes are always handwritten.
  if (theme.font === 'hand' || hasSticky) faces.push(['Caveat', caveatRegular, 400], ['Caveat', caveatBold, 700]);
  try {
    const rules = await Promise.all(
      faces.map(async ([family, url, weight]) => `@font-face{font-family:'${family}';font-weight:${weight};src:url(${await toDataUrl(url)}) format('woff2');}`),
    );
    return rules.join('');
  } catch {
    return '';
  }
}

export interface SvgInput {
  nodes: MapNode[];
  layout: LayoutResult;
  theme: Theme;
  labels: Map<string, string>;
  connections: Connection[];
  colors: Colors;
  title: string;
  /** Embed fonts so the file renders the same everywhere (needed for PNG). */
  embedFonts?: boolean;
  background?: boolean;
}

/** Render the map as a standalone SVG document. */
export async function buildSvg(input: SvgInput): Promise<{ svg: string; width: number; height: number }> {
  const { nodes, layout, theme, labels, connections, colors: c } = input;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pad = 32;
  const b = layout.bounds;
  const ox = pad - b.x;
  const oy = pad - b.y + 10; // room for labels above the top boxes
  const width = Math.ceil(b.w + pad * 2);
  const height = Math.ceil(b.h + pad * 2 + 10);
  const bold = theme.mapStyle === 'bold';
  const edgeW = theme.lineWidth * (bold ? 1.6 : 1);
  const radius = Math.min(theme.radius, 30);
  const parts: string[] = [];

  const hasSticky = nodes.some((n) => n.kind === 'sticky');
  const fonts = input.embedFonts ? await fontFaces(theme, hasSticky) : '';
  // Measure with the real fonts, or the text wraps differently from the screen.
  try {
    const families = new Set(nodes.filter((n) => n.kind === 'claim' || n.kind === 'sticky').map((n) => String(textStyle(n, theme).fontFamily)));
    await Promise.all([...families].flatMap((f) => [document.fonts.load(`400 16px ${f}`), document.fonts.load(`700 16px ${f}`)]));
  } catch {
    /* measuring falls back to whatever is loaded */
  }
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(input.title)}">`,
    `<title>${esc(input.title)}</title>`,
    `<defs>${fonts ? `<style>${fonts}</style>` : ''}`,
    `<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c.reason}"/></marker>`,
    `<marker id="ao" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c.objection}"/></marker>`,
    `<marker id="al" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c.ink3}"/></marker>`,
    `<filter id="sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity="0.12"/></filter>`,
    `<filter id="paper" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#3c2d00" flood-opacity="0.3"/></filter>`,
    `<linearGradient id="sticky" x1="0" y1="0" x2="0.08" y2="1"><stop offset="0" stop-color="#fff7b8"/><stop offset="0.55" stop-color="#fff19a"/><stop offset="1" stop-color="#fbe77e"/></linearGradient>`,
    `</defs>`,
  );
  if (input.background !== false) parts.push(`<rect width="100%" height="100%" fill="${c.bg}"/>`);
  parts.push(`<g transform="translate(${ox} ${oy})">`);

  // Reasons and objections: a bracket over their co-premises
  for (const box of layout.boxes.values()) {
    if (box.kind !== 'reason' && box.kind !== 'objection') continue;
    const n = byId.get(box.id);
    const r = box.kind === 'reason';
    const stroke = n?.style?.border || (r ? c.reasonLine : c.objectionLine);
    const left = box.x + 2, right = box.x + box.w - 2, top = box.y + 4, bottom = box.y + 13, rr = 9;
    parts.push(
      `<path d="M${left} ${bottom} A${rr} ${rr} 0 0 1 ${left + rr} ${top} H${right - rr} A${rr} ${rr} 0 0 1 ${right} ${bottom}" fill="none" stroke="${stroke}" stroke-width="${edgeW}"/>`,
    );
  }

  // Lines from each claim down to its reasons and objections
  for (const e of layout.edges) {
    const color = e.kind === 'reason' ? c.reasonLine : c.objectionLine;
    parts.push(`<path d="${edgePath(e.x1, e.y1, e.x2, e.y2, theme.lineStyle)}" fill="none" stroke="${color}" stroke-width="${edgeW}"/>`);
  }

  // Words on the lines, on a patch of background so the line stops behind them
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  const labelFont = "400 14px 'Inter', 'Vazirmatn', sans-serif";
  if (ctx) ctx.font = labelFont;
  const labelWidth = (t: string) => (ctx ? ctx.measureText(t).width : t.length * 7.5) + 14;
  for (const l of placeLineLabels(layout, byId, theme, labelWidth)) {
    const w = Math.min(260, labelWidth(l.text));
    parts.push(
      `<rect x="${l.x - w / 2}" y="${l.y - 10}" width="${w}" height="20" rx="6" fill="${c.bg}"/>`,
      `<text x="${l.x}" y="${l.y}" text-anchor="middle" dominant-baseline="central" font-family="Inter, Vazirmatn, sans-serif" font-size="14" fill="${l.own ? c.ink : c.ink2}">${esc(l.text)}</text>`,
    );
  }

  // Claims and sticky notes
  for (const box of layout.boxes.values()) {
    if (box.kind !== 'claim' && box.kind !== 'sticky') continue;
    const n = byId.get(box.id);
    if (!n) continue;
    const ts = textStyle(n, theme);
    const bs = boxStyle(n, theme);
    const sticky = n.kind === 'sticky';
    const isRoot = n.kind === 'claim' && n.parent === null;
    const groupNode = n.parent ? byId.get(n.parent) : undefined;
    const group = stanceOf(n, groupNode);
    const inReason = group === 'reason', inObjection = group === 'objection';
    const fill = (bs.background as string)
      || (sticky ? 'url(#sticky)' : isRoot ? c.rootFill : inReason ? c.reasonFill : inObjection ? c.objectionFill : n.implicit ? c.surface2 : c.surface);
    const stroke = (bs.borderColor as string)
      || (isRoot ? c.rootLine : inReason ? c.reasonLine : inObjection ? c.objectionLine : n.implicit ? c.ink3 : c.line);
    const sw = isRoot && bold ? 3 : theme.borderWidth;
    const color = (bs.color as string) || (sticky ? '#3b3200' : isRoot ? c.rootInk : inReason ? c.reasonInk : inObjection ? c.objectionInk : c.ink);
    const rx = isRoot ? box.h / 2 : Math.min(radius, 12, box.h / 2);
    // Sticky notes lean a little, like paper stuck on a wall.
    const tilt = sticky ? ` transform="rotate(-1 ${box.x + box.w / 2} ${box.y + box.h / 2})"` : '';
    if (sticky) parts.push(`<g${tilt}>`);
    parts.push(
      sticky
        ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="2" fill="${fill}" filter="url(#paper)"/>` +
          `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${Math.round(box.h * 0.14)}" fill="rgba(150,120,0,0.06)"/>`
        : `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${n.implicit ? ' stroke-dasharray="6 4"' : ''}${theme.shadow && isRoot ? ' filter="url(#sh)"' : ''}/>`,
    );
    // A premise arguing the other way from its group gets a bar of its own colour above it.
    if (n.stance && groupNode && n.stance !== groupNode.kind) {
      parts.push(`<path d="M${box.x + 4} ${box.y - 11} H${box.x + box.w - 4}" stroke="${inReason ? c.reasonLine : c.objectionLine}" stroke-width="${edgeW + 1}" stroke-linecap="round"/>`);
    }
    const px = Number(ts.fontSize);
    const lh = Math.round(px * 1.43);
    const [, padX] = String(ts.padding).split(' ').map((p) => parseFloat(p));
    const family = String(ts.fontFamily).replace(/"/g, "'");
    const font = `${ts.fontStyle === 'italic' ? 'italic ' : ''}${ts.fontWeight} ${px}px ${family}`;
    const text = n.text || (sticky ? 'Note' : '');
    const lines = text ? wrap(text, font, box.w - 2 * padX - 4) : [];
    const y0 = box.y + (box.h - lines.length * lh) / 2 + lh * 0.72;
    const align = (ts.textAlign as string) || 'center';
    lines.forEach((line, i) => {
      const rtl = isRtl(line);
      let anchor = 'middle';
      let x = box.x + box.w / 2;
      if (align === 'left') {
        x = box.x + padX + 2;
        anchor = rtl ? 'end' : 'start';
      } else if (align === 'right') {
        x = box.x + box.w - padX - 2;
        anchor = rtl ? 'start' : 'end';
      }
      parts.push(
        `<text x="${x}" y="${y0 + i * lh}" text-anchor="${anchor}"${rtl ? ' direction="rtl" unicode-bidi="plaintext"' : ''} font-family="${esc(family)}" font-size="${px}" font-weight="${ts.fontWeight}"${ts.fontStyle === 'italic' ? ' font-style="italic"' : ''}${ts.textDecoration !== 'none' ? ` text-decoration="${ts.textDecoration}"` : ''} fill="${color}">${esc(line)}</text>`,
      );
    });
    if (sticky) parts.push('</g>');
    // Level numbers sit on the top-right corner, like a tab.
    const label = labels.get(n.id);
    if (label) {
      const lw = Math.max(24, label.length * 6 + 12);
      const lx = box.x + box.w - (isRoot ? 22 : 10) - lw;
      parts.push(
        `<rect x="${lx}" y="${box.y - 10}" width="${lw}" height="18" rx="9" fill="${c.badgeBg}" stroke="${c.line}"/>`,
        `<text x="${lx + lw / 2}" y="${box.y + 3}" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" font-weight="600" fill="${c.badgeInk}">${esc(label)}</text>`,
      );
    }
  }

  // Free-form connections
  for (const conn of connections) {
    const a = layout.boxes.get(conn.from);
    const bb = layout.boxes.get(conn.to);
    if (!a || !bb) continue;
    const exit = (box: typeof a, tx: number, ty: number) => {
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const dx = tx - cx, dy = ty - cy;
      const k = Math.min(dx ? box.w / 2 / Math.abs(dx) : Infinity, dy ? box.h / 2 / Math.abs(dy) : Infinity);
      return { x: cx + dx * k, y: cy + dy * k };
    };
    const p1 = exit(a, bb.x + bb.w / 2, bb.y + bb.h / 2);
    const p2 = exit(bb, a.x + a.w / 2, a.y + a.h / 2);
    parts.push(`<path d="M${p1.x} ${p1.y} L${p2.x} ${p2.y}" fill="none" stroke="${c.ink3}" stroke-width="1.5" stroke-dasharray="6 5"${a.kind === 'sticky' || bb.kind === 'sticky' ? '' : ' marker-end="url(#al)"'}/>`);
  }

  parts.push('</g></svg>');
  return { svg: parts.join('\n'), width, height };
}

/** Rasterise an SVG string to PNG bytes at the given scale. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the map image.'));
      img.src = url;
    });
    const maxSide = 16000;
    const s = Math.min(scale, maxSide / width, maxSide / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * s));
    canvas.height = Math.max(1, Math.round(height * s));
    const g = canvas.getContext('2d')!;
    g.scale(s, s);
    g.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not create the PNG.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
