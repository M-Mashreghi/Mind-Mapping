import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Editor } from '../editor';
import { hitTest, Box, Edge } from '../layout/layout';
import { MapNode } from '../model/types';
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
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const id = target?.dataset.nodeId;
    if (id && editing?.id === id) return; // clicks inside the text editor
    ref.current!.focus({ preventScroll: true });
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
      if (doc.get(id)?.kind === 'claim') editor.startEditing(id);
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
  const groups = boxes.filter((b) => b.kind !== 'claim');
  const claims = boxes.filter((b) => b.kind === 'claim');

  const grid = 24 * view.zoom;
  const style: React.CSSProperties = editor.showGrid
    ? { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }
    : { backgroundImage: 'none' };

  return (
    <div
      ref={ref}
      className={`canvas${drag?.active ? ' dragging' : ''}`}
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
          {layout.edges.map((edge) => (
            <EdgePath key={edge.from} edge={edge} from={offsetFor(edge.from)} to={offsetFor(edge.to)} />
          ))}
        </svg>
        {groups.map((b) => (
          <GroupView key={b.id} box={b} offset={offsetFor(b.id)} selected={selected.has(b.id)} dropTarget={drag?.target === b.id} />
        ))}
        {claims.map((b) => (
          <ClaimView
            key={b.id}
            box={b}
            node={nodes.get(b.id)!}
            offset={offsetFor(b.id)}
            selected={selected.has(b.id)}
            dropTarget={drag?.target === b.id}
            editor={editor}
            editing={editing?.id === b.id ? editing : null}
          />
        ))}
      </div>
    </div>
  );
}

function EdgePath({ edge, from, to }: { edge: Edge; from: { dx: number; dy: number }; to: { dx: number; dy: number } }) {
  const x1 = edge.x1 + from.dx, y1 = edge.y1 + from.dy;
  const x2 = edge.x2 + to.dx, y2 = edge.y2 + to.dy;
  const my = (y1 + y2) / 2;
  return (
    <path
      className={`edge edge-${edge.kind}`}
      d={`M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`}
      markerEnd={`url(#arrow-${edge.kind})`}
    />
  );
}

function GroupView({ box, offset, selected, dropTarget }: { box: Box; offset: { dx: number; dy: number }; selected: boolean; dropTarget: boolean }) {
  return (
    <div
      data-node-id={box.id}
      className={`group group-${box.kind}${selected ? ' selected' : ''}${dropTarget ? ' drop-target' : ''}${offset.dx || offset.dy ? ' moving' : ''}`}
      style={{ left: box.x + offset.dx, top: box.y + offset.dy, width: box.w, height: box.h }}
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
  offset: { dx: number; dy: number };
  selected: boolean;
  dropTarget: boolean;
  editor: Editor;
  editing: { id: string; initial?: string } | null;
}

function ClaimView({ box, node, offset, selected, dropTarget, editor, editing }: ClaimProps) {
  const cls = [
    'claim',
    node.parent === null ? 'root' : '',
    node.implicit ? 'implicit' : '',
    selected ? 'selected' : '',
    dropTarget ? 'drop-target' : '',
    editing ? 'editing' : '',
    offset.dx || offset.dy ? 'moving' : '',
  ].filter(Boolean).join(' ');
  return (
    <div
      data-node-id={box.id}
      className={cls}
      style={{ left: box.x + offset.dx, top: box.y + offset.dy, width: box.w, minHeight: box.h }}
      role="treeitem"
      aria-selected={selected}
    >
      {editing ? (
        <NodeEditor editor={editor} text={node.text} initial={editing.initial} />
      ) : (
        <div className={`claim-text${node.text ? '' : ' placeholder'}`} dir="auto">
          {node.text || 'Type a claim'}
        </div>
      )}
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
