import { MapNode, Theme, stickyH, stickyW } from '../model/types';
import { textStyle } from '../theme';
import { Size } from './layout';

export const CLAIM = {
  minWidth: 120,
  minHeight: 40,
};

const cache = new Map<string, Size>();
let probe: HTMLDivElement | null = null;

/**
 * Measure a node by rendering its text in a hidden element with exactly the same
 * text styles as the real node, so wrapping (including right-to-left text) matches.
 */
export function domMeasure(node: MapNode, theme: Theme): Size {
  const text = node.text || (node.kind === 'sticky' ? 'Note' : 'Type a claim');
  const st = textStyle(node, theme);
  const sticky = node.kind === 'sticky';
  const key = JSON.stringify([text, st, node.kind, sticky ? stickyH(node) : 0]);
  const hit = cache.get(key);
  if (hit) return hit;
  if (!probe) {
    probe = document.createElement('div');
    probe.className = 'claim-text claim-probe';
    probe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(probe);
  }
  probe.removeAttribute('style');
  Object.assign(probe.style, st, {
    fontSize: `${st.fontSize}px`,
    maxWidth: `${st.maxWidth}px`,
    // A sticky note has a fixed width; its text wraps inside it.
    ...(sticky ? { width: `${stickyW(node)}px` } : {}),
  });
  probe.textContent = text;
  const rect = probe.getBoundingClientRect();
  if (sticky) {
    // A paper note keeps its size, and only grows taller when the text needs it.
    const size = { w: stickyW(node), h: Math.max(stickyH(node), Math.ceil(rect.height) + 4) };
    if (cache.size > 5000) cache.clear();
    cache.set(key, size);
    return size;
  }
  const minW = node.kind === 'sticky' ? 100 : CLAIM.minWidth;
  const size = {
    w: Math.ceil(Math.min(Number(st.maxWidth), Math.max(minW, rect.width))) + 4,
    h: Math.ceil(Math.max(CLAIM.minHeight, rect.height)) + 4,
  };
  if (cache.size > 5000) cache.clear();
  cache.set(key, size);
  return size;
}

/** Rough measure for tests and non-DOM environments. */
export function approxMeasure(node: MapNode): Size {
  if (node.kind === 'sticky') return { w: stickyW(node), h: stickyH(node) };
  const chars = Math.max(10, (node.text || 'Type a claim').length);
  const perLine = 28;
  const lines = Math.ceil(chars / perLine);
  return { w: Math.min(240, Math.max(CLAIM.minWidth, Math.min(chars, perLine) * 8 + 24)), h: Math.max(CLAIM.minHeight, lines * 20 + 20) };
}
