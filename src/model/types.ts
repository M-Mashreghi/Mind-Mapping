export type ClaimKind = 'claim';
export type GroupKind = 'reason' | 'objection';
export type NodeKind = ClaimKind | GroupKind;

/**
 * A node in an argument map.
 *
 * Structure rules:
 *  - A claim is either a root (parent === null) or a premise inside a group.
 *  - A group (reason or objection) always hangs under a claim and holds one or
 *    more premises (claims). Several premises in one group are co-premises.
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
  /** Root only: position of the top-centre of the root box, in map units. */
  x?: number;
  y?: number;
  /** Manual nudge applied to this node and everything below it. */
  dx?: number;
  dy?: number;
}

export const isGroup = (n: MapNode | undefined): boolean =>
  !!n && (n.kind === 'reason' || n.kind === 'objection');

export const isClaim = (n: MapNode | undefined): boolean => !!n && n.kind === 'claim';

export interface MapFile {
  format: 'argument-mapper';
  version: 1;
  title: string;
  nodes: MapNode[];
  settings?: Record<string, unknown>;
}
