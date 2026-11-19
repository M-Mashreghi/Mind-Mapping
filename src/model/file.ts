import { MapFile, MapNode } from './types';

export const FILE_EXTENSION = 'amap';

export function serialize(file: MapFile): string {
  return JSON.stringify(file, null, 2);
}

/** Parse and validate an .amap file. Throws an Error with a readable message. */
export function parseMapFile(text: string): MapFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a valid argument map (it is not JSON).');
  }
  const f = data as Partial<MapFile>;
  if (!f || f.format !== 'argument-mapper' || !Array.isArray(f.nodes)) {
    throw new Error('This file is not an Argument Mapper map.');
  }
  if (typeof f.version !== 'number' || f.version > 1) {
    throw new Error('This map was saved by a newer version of Argument Mapper.');
  }
  const ids = new Set<string>();
  const nodes: MapNode[] = [];
  for (const raw of f.nodes as MapNode[]) {
    if (!raw || typeof raw.id !== 'string' || ids.has(raw.id)) continue;
    if (!['claim', 'reason', 'objection'].includes(raw.kind)) continue;
    ids.add(raw.id);
    nodes.push({ ...raw, text: typeof raw.text === 'string' ? raw.text : '', order: Number(raw.order) || 0 });
  }
  // Drop nodes whose parent is missing; turn orphaned claims into roots.
  for (const n of nodes) {
    if (n.parent !== null && !ids.has(n.parent)) {
      if (n.kind === 'claim') {
        n.parent = null;
        n.x = n.x ?? 0;
        n.y = n.y ?? 0;
      }
    }
  }
  return {
    format: 'argument-mapper',
    version: 1,
    title: typeof f.title === 'string' ? f.title : 'Untitled argument',
    nodes: nodes.filter((n) => n.parent === null ? n.kind === 'claim' : ids.has(n.parent)),
    settings: f.settings,
  };
}
