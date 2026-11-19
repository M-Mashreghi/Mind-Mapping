export type ClaimKind = 'claim';
export type GroupKind = 'reason' | 'objection';
export type NodeKind = ClaimKind | GroupKind | 'sticky';

export type FontSize = 'xs' | 's' | 'm' | 'l' | 'xl';

/** Per-node overrides of the map theme. */
export interface NodeStyle {
  fill?: string;
  border?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: FontSize;
  align?: 'left' | 'center' | 'right';
}

/**
 * A node in an argument map.
 *
 * Structure rules:
 *  - A claim is either a root (parent === null) or a premise inside a group.
 *  - A group (reason or objection) always hangs under a claim and holds one or
 *    more premises (claims). Several premises in one group are co-premises.
 *  - A sticky note is always free-standing (parent === null).
 */
export interface MapNode {
  id: string;
  kind: NodeKind;
  parent: string | null;
  /** Sort key among siblings (fractional, so inserts never renumber). */
  order: number;
  text: string;
  /** Claim only: an unstated / hidden assumption, drawn with a dashed border. */
  implicit?: boolean;
  /** Claim only: hide the reasons and objections below it. */
  collapsed?: boolean;
  /** Root/sticky only: position of the top-centre of the box, in map units. */
  x?: number;
  y?: number;
  /** Manual nudge applied to this node and everything below it. */
  dx?: number;
  dy?: number;
  style?: NodeStyle;
  /** Longer free-text note attached to the node. */
  note?: string;
  /** A web link opened from the node. */
  link?: string;
}

/** A free-form arrow between any two nodes, outside the argument structure. */
export interface Connection {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export type Numbering = 'none' | 'level' | 'hierarchical' | 'sequential';
export type LineStyle = 'curved' | 'straight' | 'elbow';

export interface ColorSet {
  fill: string;
  border: string;
  text: string;
}

export interface Theme {
  mapStyle: 'standard' | 'bold';
  density: 'compact' | 'comfortable';
  numbering: Numbering;
  lineStyle: LineStyle;
  lineWidth: number;
  font: string;
  fontSize: FontSize;
  canvas: string;
  reason: ColorSet;
  objection: ColorSet;
  root: ColorSet;
  borderWidth: number;
  radius: number;
  shadow: boolean;
}

/** Empty strings mean "use the built-in colour for the current light/dark mode". */
export const DEFAULT_THEME: Theme = {
  mapStyle: 'standard',
  density: 'compact',
  numbering: 'none',
  lineStyle: 'curved',
  lineWidth: 2,
  font: 'system',
  fontSize: 'm',
  canvas: '',
  reason: { fill: '', border: '', text: '' },
  objection: { fill: '', border: '', text: '' },
  root: { fill: '', border: '', text: '' },
  borderWidth: 1.5,
  radius: 8,
  shadow: true,
};

export const isGroup = (n: MapNode | undefined): boolean =>
  !!n && (n.kind === 'reason' || n.kind === 'objection');

export const isClaim = (n: MapNode | undefined): boolean => !!n && n.kind === 'claim';

/** Claims and sticky notes: nodes that carry text in a box. */
export const isTextNode = (n: MapNode | undefined): boolean => !!n && (n.kind === 'claim' || n.kind === 'sticky');

export interface MapFile {
  format: 'argument-mapper';
  version: 1;
  title: string;
  nodes: MapNode[];
  connections?: Connection[];
  theme?: Partial<Theme>;
  /** Earlier saved versions, newest first. */
  history?: Snapshot[];
  settings?: Record<string, unknown>;
}

export interface Snapshot {
  savedAt: string;
  title: string;
  nodes: MapNode[];
  connections?: Connection[];
  theme?: Partial<Theme>;
}
