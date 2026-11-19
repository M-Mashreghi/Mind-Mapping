import { MapNode } from '../model/types';
import { Size } from './layout';

export const CLAIM = {
  minWidth: 120,
  maxWidth: 240,
  minHeight: 40,
};

const cache = new Map<string, Size>();
let probe: HTMLDivElement | null = null;

/**
 * Measure a claim by rendering its text in a hidden element that uses the same
 * CSS class as the real node, so wrapping (including right-to-left text) matches.
 */
export function domMeasure(node: MapNode): Size {
  const text = node.text || 'Type a claim';
  const key = `${node.implicit ? 1 : 0}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!probe) {
    probe = document.createElement('div');
    probe.className = 'claim-text claim-probe';
    probe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(probe);
  }
  probe.textContent = text;
  const rect = probe.getBoundingClientRect();
  const size = {
    w: Math.ceil(Math.min(CLAIM.maxWidth, Math.max(CLAIM.minWidth, rect.width))),
    h: Math.ceil(Math.max(CLAIM.minHeight, rect.height)),
  };
  if (cache.size > 5000) cache.clear();
  cache.set(key, size);
  return size;
}

/** Rough measure for tests and non-DOM environments. */
export function approxMeasure(node: MapNode): Size {
  const chars = Math.max(10, (node.text || 'Type a claim').length);
  const perLine = 28;
  const lines = Math.ceil(chars / perLine);
  return { w: Math.min(CLAIM.maxWidth, Math.max(CLAIM.minWidth, Math.min(chars, perLine) * 8 + 24)), h: Math.max(CLAIM.minHeight, lines * 20 + 20) };
}
