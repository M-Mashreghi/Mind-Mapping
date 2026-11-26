export type ClaimKind = 'claim';
export type GroupKind = 'reason' | 'objection';
export type NodeKind = ClaimKind | GroupKind | 'sticky';

export type FontSize = 'xs' | 's' | 'm' | 'l' | 'xl';

/** Per-node overrides of the map theme. */
export interface NodeStyle {
  direction?: 'ltr' | 'rtl';
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
  /**
   * Premise only: set when it argues the other way from its group, e.g. a reason that
   * sits beside the premises of an objection. Drawn in its own colour with a bar above it.
   */
  stance?: GroupKind;
  /** Claim only: hide the reasons and objections below it. */
  collapsed?: boolean;
  /** Root/sticky only: position of the top-centre of the box, in map units. */
  x?: number;
  y?: number;
  /** Sticky note only: its size in map units (a square paper note by default). */
  w?: number;
  h?: number;
  /** Manual nudge applied to this node and everything below it. */
  dx?: number;
  dy?: number;
  style?: NodeStyle;
  evidence?: { source: string; page: string; quote: string }[];
  questions?: { text: string; answer: string }[];
  review?: 'open' | 'partial' | 'resolved';
  sharedClaim?: string;
  tray?: boolean;
  passage?: string;
  excerpt?: [number, number];
  challengesInference?: string;
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

/** A comment left on a node, usually by a collaborator. */
export type Proposal = { kind: 'wording'; before: string; after: string } | { kind: 'joint'; before: string | null; group: string };

export interface Comment {
  proposal?: Proposal;
  id: string;
  node: string;
  author: string;
  color?: string;
  text: string;
  at: string;
}

export interface Reaction {
  node: string;
  emoji: string;
  author: string;
}

export const REACTIONS = ['👍', '👏', '🥳', '😂', '😎', '❤️', '🤔', '❓'];

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
  /** Write "Because" / "But" on lines that have no words of their own. */
  lineLabels: boolean;
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
  numbering: 'level',
  lineStyle: 'elbow',
  lineLabels: false,
  lineWidth: 1.5,
  font: 'system',
  fontSize: 's',
  canvas: '',
  reason: { fill: '', border: '', text: '' },
  objection: { fill: '', border: '', text: '' },
  root: { fill: '', border: '', text: '' },
  borderWidth: 1.5,
  radius: 8,
  shadow: true,
};

/** The words written on the line from a reason or objection to its claim. */
export const lineLabel = (group: MapNode, theme: Pick<Theme, 'lineLabels'>): string =>
  group.text.trim() || (theme.lineLabels ? (group.kind === 'objection' ? 'But' : 'Because') : '');

/** Whether a premise supports or opposes, from its own stance or else its group's kind. */
export const isConclusion = (node: MapNode): boolean =>
  node.kind === 'claim' && node.parent === null && !node.stance;

export const stanceOf = (premise: MapNode | undefined, group: MapNode | undefined): GroupKind | undefined =>
  premise?.stance ?? (group && (group.kind === 'reason' || group.kind === 'objection') ? group.kind : undefined);

export const isGroup = (n: MapNode | undefined): boolean =>
  !!n && (n.kind === 'reason' || n.kind === 'objection');

export const isClaim = (n: MapNode | undefined): boolean => !!n && n.kind === 'claim';

/** Sticky notes are square paper notes: about 3×3 inches next to the claim boxes. */
export const STICKY = { size: 240, min: 120, max: 800 };
export const stickyW = (n: MapNode): number => Math.min(STICKY.max, Math.max(STICKY.min, Math.round(n.w ?? STICKY.size)));
export const stickyH = (n: MapNode): number => Math.min(STICKY.max, Math.max(STICKY.min, Math.round(n.h ?? n.w ?? STICKY.size)));

/** Claims and sticky notes: nodes that carry text in a box. */
export const isTextNode = (n: MapNode | undefined): boolean => !!n && (n.kind === 'claim' || n.kind === 'sticky');

export interface MapFile {
  format: 'argument-mapper';
  version: 1;
  title: string;
  nodes: MapNode[];
  connections?: Connection[];
  theme?: Partial<Theme>;
  comments?: Comment[];
  reactions?: Reaction[];
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
