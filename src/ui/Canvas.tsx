import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Editor } from '../editor';
import { hitTest, Box, Edge } from '../layout/layout';
import { Connection, LineStyle, MapNode, Theme } from '../model/types';
import { boxStyle, textStyle, themeVars } from '../theme';
import { NodeEditor } from './NodeEditor';

interface Props {
  editor: Editor;
  onContextMenu: (kind: 'node' | 'canvas', x: number, y: number) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  ids: string[];
  moving: Set<string>;
  active: boolean;
  dx: number;
  dy: number;
  target: string | null;
}

interface PanState {
  pointerId: number;
  startX: number;
  startY: number;
  viewX: number;
  viewY: number;
  moved: boolean;
}

export function Canvas({ editor, onContextMenu }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);

  const { layout, view, selection, editing, doc } = editor;
  const selected = new Set(selection);

  // Keep the editor informed of the viewport size.
  useLayoutEffect(() => {
    const el = ref.current!;
    const update = () => {
      const r = el.getBoundingClientRect();
      editor.viewport = { w: r.width, h: r.height };
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor]);

  // Wheel: pan, or zoom with Ctrl/Cmd (and trackpad pinch).
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        editor.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      } else {
        editor.setView({ x: editor.view.x - e.deltaX, y: editor.view.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editor]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const conn = (e.target as Element).closest<SVGElement>('[data-connection-id]');
    if (conn) {
      e.preventDefault();
      editor.selectConnection(conn.dataset.connectionId!);
      return;
    }
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const id = target?.dataset.nodeId;
    if (id && editing?.id === id) return; // clicks inside the text editor
    if ((e.target as HTMLElement).closest('.node-badge')) return;
    ref.current!.focus({ preventScroll: true });
    if (id && e.altKey) {
      e.preventDefault();
      editor.connectTo(id);
      return;
    }
    if (!id) {
      editor.commitEditing();
      panRef.current = {
        pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
        viewX: view.x, viewY: view.y, moved: false,
      };
      ref.current!.setPointerCapture(e.pointerId);
      return;
    }
    e.preventDefault();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      editor.select([id], true);
    } else if (!selected.has(id)) {
      editor.select([id]);
    }
    const ids = additive ? editor.selection : selected.has(id) ? selection : [id];
    const moving = new Set<string>();
    for (const sid of ids) for (const d of doc.subtreeIds(sid)) moving.add(d);
    dragRef.current = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      ids, moving, active: false, dx: 0, dy: 0, target: null,
    };
    ref.current!.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pan = panRef.current;
    if (pan && pan.pointerId === e.pointerId) {
      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
      editor.setView({ x: pan.viewX + dx, y: pan.viewY + dy });
      return;
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const sdx = e.clientX - d.startX;
    const sdy = e.clientY - d.startY;
    if (!d.active && Math.abs(sdx) + Math.abs(sdy) < 5) return;
    d.active = true;
    d.dx = sdx / view.zoom;
    d.dy = sdy / view.zoom;
    const p = local(e);
    const m = editor.screenToMap(p.x, p.y);
    const hit = hitTest(layout, m.x, m.y, d.moving);
    d.target = hit && d.ids.some((id) => doc.canMove(id, hit.id)) ? hit.id : null;
    setDrag({ ...d });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const pan = panRef.current;
    if (pan && pan.pointerId === e.pointerId) {
      panRef.current = null;
      if (!pan.moved && !e.shiftKey) editor.clearSelection();
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || !d.active) return;
    editor.drop(d.ids, d.target, d.dx, d.dy);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const id = target?.dataset.nodeId;
    if (id) {
      const k = doc.get(id)?.kind;
      if (k === 'claim' || k === 'sticky') editor.startEditing(id);
      return;
    }
    const p = local(e);
    editor.addRoot(editor.screenToMap(p.x, p.y));
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const id = target?.dataset.nodeId;
    if (id) {
      if (!selected.has(id)) editor.select([id]);
      onContextMenu('node', e.clientX, e.clientY);
    } else {
      onContextMenu('canvas', e.clientX, e.clientY);
    }
  };

  const offsetFor = (id: string) =>
    drag?.active && drag.moving.has(id) ? { dx: drag.dx, dy: drag.dy } : { dx: 0, dy: 0 };

  const nodes = new Map<string, MapNode>(doc.all().map((n) => [n.id, n]));
  const boxes = [...layout.boxes.values()];
  const groups = boxes.filter((b) => b.kind === 'reason' || b.kind === 'objection');
  const claims = boxes.filter((b) => b.kind === 'claim' || b.kind === 'sticky');
  const theme = doc.theme;
  const labels = editor.labels;
  const matches = new Set(editor.find?.matches ?? []);
  const current = editor.find?.matches[editor.find.index];
  const connections = doc.allConnections();

  const grid = 24 * view.zoom;
  const style: React.CSSProperties = editor.showGrid
    ? { ...themeVars(theme), backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }
    : { ...themeVars(theme), backgroundImage: 'none' };

  return (
    <div
      ref={ref}
      className={`canvas${drag?.active ? ' dragging' : ''} map-${theme.mapStyle}`}
      style={style}
      tabIndex={0}
      role="application"
      aria-label="Argument map"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContext}
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <svg className="edges" width="1" height="1" overflow="visible" aria-hidden="true">
          <defs>
            <marker id="arrow-reason" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" className="arrow-reason" />
            </marker>
            <marker id="arrow-objection" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" className="arrow-objection" />
            </marker>
          </defs>
          <marker id="arrow-link" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="arrow-link" />
          </marker>
          {layout.edges.map((edge) => (
            <EdgePath key={edge.from} edge={edge} lineStyle={theme.lineStyle} from={offsetFor(edge.from)} to={offsetFor(edge.to)} />
          ))}
        </svg>
        {groups.map((b) => (
          <GroupView key={b.id} box={b} node={nodes.get(b.id)!} offset={offsetFor(b.id)} selected={selected.has(b.id)} dropTarget={drag?.target === b.id} />
        ))}
        {claims.map((b) => (
          <ClaimView
            key={b.id}
            box={b}
            node={nodes.get(b.id)!}
            theme={theme}
            label={labels.get(b.id)}
            match={matches.has(b.id) ? (current === b.id ? 'current' : 'match') : undefined}
            offset={offsetFor(b.id)}
            selected={selected.has(b.id)}
            dropTarget={drag?.target === b.id}
            editor={editor}
            editing={editing?.id === b.id ? editing : null}
          />
        ))}
        <svg className="connections" width="1" height="1" overflow="visible">
          {connections.map((c) => (
            <ConnectionPath
              key={c.id}
              conn={c}
              a={layout.boxes.get(c.from)}
              b={layout.boxes.get(c.to)}
              oa={offsetFor(c.from)}
              ob={offsetFor(c.to)}
              selected={editor.selectedConnection === c.id}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

type Off = { dx: number; dy: number };

/** Point where the line from a box's centre towards (tx, ty) leaves the box. */
function exitPoint(b: Box, o: Off, tx: number, ty: number) {
  const cx = b.x + o.dx + b.w / 2;
  const cy = b.y + o.dy + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? b.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? b.h / 2 / Math.abs(dy) : Infinity;
  const k = Math.min(sx, sy);
  return { x: cx + dx * k, y: cy + dy * k };
}

function ConnectionPath({ conn, a, b, oa, ob, selected }: { conn: Connection; a?: Box; b?: Box; oa: Off; ob: Off; selected: boolean }) {
  if (!a || !b) return null;
  const ca = { x: a.x + oa.dx + a.w / 2, y: a.y + oa.dy + a.h / 2 };
  const cb = { x: b.x + ob.dx + b.w / 2, y: b.y + ob.dy + b.h / 2 };
  const p1 = exitPoint(a, oa, cb.x, cb.y);
  const p2 = exitPoint(b, ob, ca.x, ca.y);
  const d = `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`;
  return (
    <g data-connection-id={conn.id} className={`connection${selected ? ' selected' : ''}`}>
      <path className="connection-hit" d={d} />
      <path className="connection-line" d={d} markerEnd="url(#arrow-link)" />
    </g>
  );
}

export function edgePath(x1: number, y1: number, x2: number, y2: number, style: LineStyle): string {
  const my = (y1 + y2) / 2;
  if (style === 'straight') return `M${x1} ${y1} L${x2} ${y2}`;
  if (style === 'elbow') return `M${x1} ${y1} V${my} H${x2} V${y2}`;
  return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
}

function EdgePath({ edge, from, to, lineStyle }: { edge: Edge; from: Off; to: Off; lineStyle: LineStyle }) {
  const x1 = edge.x1 + from.dx, y1 = edge.y1 + from.dy;
  const x2 = edge.x2 + to.dx, y2 = edge.y2 + to.dy;
  return (
    <path
      className={`edge edge-${edge.kind}`}
      d={edgePath(x1, y1, x2, y2, lineStyle)}
      markerEnd={`url(#arrow-${edge.kind})`}
    />
  );
}

function GroupView({ box, node, offset, selected, dropTarget }: { box: Box; node: MapNode; offset: Off; selected: boolean; dropTarget: boolean }) {
  const st = node.style ?? {};
  return (
    <div
      data-node-id={box.id}
      className={`group group-${box.kind}${selected ? ' selected' : ''}${dropTarget ? ' drop-target' : ''}${offset.dx || offset.dy ? ' moving' : ''}`}
      style={{
        left: box.x + offset.dx, top: box.y + offset.dy, width: box.w, height: box.h,
        ...(st.fill ? { background: st.fill } : {}), ...(st.border ? { borderColor: st.border } : {}),
      }}
      role="group"
      aria-label={box.kind === 'reason' ? 'Reason' : 'Objection'}
    >
      <span className="group-label">{box.kind === 'reason' ? 'Reason' : 'Objection'}</span>
    </div>
  );
}

interface ClaimProps {
  box: Box;
  node: MapNode;
  theme: Theme;
  label?: string;
  match?: 'match' | 'current';
  offset: Off;
  selected: boolean;
  dropTarget: boolean;
  editor: Editor;
  editing: { id: string; initial?: string } | null;
}

function ClaimView({ box, node, theme, label, match, offset, selected, dropTarget, editor, editing }: ClaimProps) {
  const cls = [
    node.kind === 'sticky' ? 'sticky' : 'claim',
    node.kind === 'claim' && node.parent === null ? 'root' : '',
    node.implicit ? 'implicit' : '',
    selected ? 'selected' : '',
    dropTarget ? 'drop-target' : '',
    editing ? 'editing' : '',
    match ? `find-${match}` : '',
    offset.dx || offset.dy ? 'moving' : '',
  ].filter(Boolean).join(' ');
  const { maxWidth: _max, ...text } = textStyle(node, theme);
  const placeholder = node.kind === 'sticky' ? 'Note' : 'Type a claim';
  return (
    <div
      data-node-id={box.id}
      className={cls}
      style={{ left: box.x + offset.dx, top: box.y + offset.dy, width: box.w, minHeight: box.h, ...boxStyle(node, theme) }}
      role="treeitem"
      aria-selected={selected}
    >
      {editing ? (
        <NodeEditor editor={editor} text={node.text} initial={editing.initial} style={text} />
      ) : (
        <div className={`claim-text${node.text ? '' : ' placeholder'}`} dir="auto" style={text}>
          {node.text || placeholder}
        </div>
      )}
      {label ? <span className="node-label">{label}</span> : null}
      {node.note || node.link ? (
        <span className="node-badges">
          {node.note ? (
            <button className="node-badge" title={node.note.slice(0, 200)} aria-label="Show note"
              onClick={() => { editor.select([node.id]); editor.toggleNotes(true); }}>
              <NoteIcon />
            </button>
          ) : null}
          {node.link ? (
            <a className="node-badge" href={node.link} target="_blank" rel="noreferrer noopener" title={node.link} aria-label="Open link">
              <LinkIcon />
            </a>
          ) : null}
        </span>
      ) : null}
      {box.hidden ? (
        <button
          className="fold-badge"
          title={`Show ${box.hidden} hidden boxes`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => editor.doc.setCollapsed([box.id], false)}
        >
          +{box.hidden}
        </button>
      ) : null}
    </div>
  );
}

function NoteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 2h7l3 3v9H3z M10 2v3h3 M5.5 8h5 M5.5 11h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 9.5l3-3 M7 4.5l1.2-1.2a2.8 2.8 0 014 4L11 8.5 M9 11.5l-1.2 1.2a2.8 2.8 0 01-4-4L5 7.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
