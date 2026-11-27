import type { ConnectorStyle } from './types';

export function connectorStroke(style?: ConnectorStyle) {
  const width = style?.width;
  const opacity = style?.opacity;
  return {
    stroke: typeof style?.color === 'string' && /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : undefined,
    strokeWidth: typeof width === 'number' && Number.isFinite(width) ? Math.min(12, Math.max(0.5, width)) : undefined,
    opacity: typeof opacity === 'number' && Number.isFinite(opacity) ? Math.min(1, Math.max(0.1, opacity)) : undefined,
    strokeDasharray: style?.pattern === 'dotted' ? `0.1 ${Math.max(3, (typeof width === 'number' && Number.isFinite(width) ? Math.min(12,width) : 2) * 2)}` : style?.pattern === 'dashed' ? '7 5' : style?.pattern === 'solid' ? 'none' : undefined,
    strokeLinecap: style?.pattern === 'dotted' ? 'round' as const : undefined,
  };
}
