import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Editor } from '../editor';
import { hitTest, placeLineLabels, Box, Edge } from '../layout/layout';

let labelCtx: CanvasRenderingContext2D | null | undefined;
/** Width of the words on a line, in the label font. */
function labelWidth(text: string): number {
  if (labelCtx === undefined) {
    labelCtx = document.createElement('canvas').getContext('2d');
    if (labelCtx) labelCtx.font = "400 14px 'Inter', 'Vazirmatn', sans-serif";
  }
  return (labelCtx ? labelCtx.measureText(text).width : text.length * 7.5) + 14;
}
import { Connection, LineStyle, MapNode, STICKY, Theme, stanceOf } from '../model/types';
import { boxStyle, textStyle, themeVars } from '../theme';
import { attach, dropLabel } from '../model/workspace';
import { NodeEditor } from './NodeEditor';
import { Emoji } from './Emoji';

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
  const [wire,setWire]=useState<{source:string;x:number;y:number;target?:string}|null>(null);
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
      if (editor.presentation) editor.presentFocus();
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
    const handle=(e.target as Element).closest<HTMLElement>('[data-wire]');
    if(handle && !editor.readOnly && !editor.presentation){
      const p=local(e),source=handle.dataset.wire!;
      e.preventDefault();editor.select([source]);setWire({source,...editor.screenToMap(p.x,p.y)});
      e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    const conn = (e.target as Element).closest<SVGElement>('[data-connection-id]');
    if (conn) {
      e.preventDefault();
      editor.selectConnection(conn.dataset.connectionId!);
      return;
    }
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const id = target?.dataset.nodeId;
    if (editor.presentation && id) {
      // Presenting: a click on a claim goes to it; nothing is moved or edited.
      if (doc.get(id)?.kind === 'claim') editor.presentAt(id);
      return;
    }
    if (id && editing?.id === id) return; // clicks inside the text editor
    if ((e.target as HTMLElement).closest('.node-badge')) return;
    ref.current!.focus({ preventScroll: true });
    if (id && e.altKey) {
      e.preventDefault();
      editor.connectTo(id);
      return;
    }
    if (!id || editor.tool === 'pan') {
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
    if (editor.readOnly) return;
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
    if(wire){
      const p=local(e),m=editor.screenToMap(p.x,p.y);
      const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
      setWire({...wire,...m,target:target!==wire.source?target:undefined});return;
    }
    if (editor.collab) {
      const p = local(e);
      editor.setCursor(editor.screenToMap(p.x, p.y));
    }
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
    if(wire){
      const id=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
      if(!editor.readOnly && id && id!==wire.source)doc.addConnection(wire.source,id);
      setWire(null);return;
    }
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
    if (editor.presentation) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const id = target?.dataset.nodeId;
    if (id) {
      const k = doc.get(id)?.kind;
      if ((k === 'claim' || k === 'sticky') && !editor.readOnly) editor.startEditing(id);
      else if ((k === 'reason' || k === 'objection') && !editor.readOnly) editor.editLineLabel(id);
      return;
    }
    if (editor.readOnly) return;
    const p = local(e);
    editor.addRoot(editor.screenToMap(p.x, p.y));
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    if (editor.presentation) return;
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
  const boxes = [...layout.boxes.values()].filter(b=>!nodes.get(b.id)?.tray);
  const groups = boxes.filter((b) => b.kind === 'reason' || b.kind === 'objection');
  const claims = boxes.filter((b) => b.kind === 'claim' || b.kind === 'sticky');
  const theme = doc.theme;
  const labels = editor.labels;
  const matches = new Set(editor.find?.matches ?? []);
  const current = editor.find?.matches[editor.find.index];
  const connections = doc.allConnections();
  const peers = editor.peers;
  const commentCounts = editor.showComments ? doc.commentCounts() : new Map<string, number>();
  const reactions = editor.showComments ? doc.reactionsByNode() : new Map<string, Map<string, string[]>>();
  const me = editor.user?.name ?? 'Me';

  const grid = 24 * view.zoom;
  const style: React.CSSProperties = editor.showGrid
    ? { ...themeVars(theme), backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }
    : { ...themeVars(theme), backgroundImage: 'none' };

  return (
    <div
      ref={ref}
      className={`canvas${editor.presentation ? ' presenting' : ''}${drag?.active ? ' dragging' : ''}${editor.tool === 'pan' ? ' panning' : ''} map-${theme.mapStyle}`}
      style={style}
      tabIndex={0}
      role="application"
      aria-label="Argument map"
      onPointerDown={onPointerDown}
      onDragOver={ev=>{if(!editor.readOnly&&ev.dataTransfer.types.includes('application/x-argument-idea'))ev.preventDefault();}}
      onDrop={ev=>{
        if(editor.readOnly)return;
        const idea=doc.get(ev.dataTransfer.getData('application/x-argument-idea'));
        const target=(ev.target as Element).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        if(!idea?.tray||!target||doc.get(target)?.kind!=='claim')return;
        ev.preventDefault();
        const choice=window.prompt('Place idea as reason or objection?', 'reason')?.trim().toLowerCase();
        if(choice==='reason'||choice==='objection')doc.ydoc.transact(()=>{if(attach(doc,target,choice,idea.text))doc.remove([idea.id]);},doc);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={()=>{setWire(null);setDrag(null);dragRef.current=null;panRef.current=null;}}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContext}
      onPointerLeave={() => editor.setCursor(null)}
    >
      {editor.presentation ? <style>{presentCss(editor)}</style> : null}
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
          {layout.edges.map((edge) => (
            <EdgePath key={`hit-${edge.from}`} hit edge={edge} lineStyle={theme.lineStyle} from={offsetFor(edge.from)} to={offsetFor(edge.to)} />
          ))}
        </svg>
        {drag?.active && drag.target && (() => {
          const to=layout.boxes.get(drag.target), from=layout.boxes.get(drag.ids[0]), target=doc.get(drag.target);
          if(!to||!from||!target)return null;
          return <><svg className="edges" width="1" height="1" overflow="visible"><line x1={from.x+drag.dx+from.w/2} y1={from.y+drag.dy+from.h/2} x2={to.x+to.w/2} y2={to.y+to.h/2} stroke="var(--brand)" strokeDasharray="5 4"/></svg><span className="idea-drop-preview" style={{left:to.x,top:to.y-27}}>{dropLabel(target,doc.get(drag.ids[0]))}</span></>;
        })()}
        {wire && layout.boxes.has(wire.source) && <svg className="edges wire-preview" width="1" height="1" overflow="visible"><line x1={layout.boxes.get(wire.source)!.x+layout.boxes.get(wire.source)!.w} y1={layout.boxes.get(wire.source)!.y} x2={wire.x} y2={wire.y} stroke="var(--brand)" strokeWidth="2" strokeDasharray="6 5"/></svg>}
        {groups.map((b) => (
          <GroupView key={b.id} box={b} node={nodes.get(b.id)!} offset={offsetFor(b.id)} selected={selected.has(b.id)} dropTarget={drag?.target === b.id || wire?.target===b.id} />
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
            groupKind={stanceOf(nodes.get(b.id), nodes.get(nodes.get(b.id)!.parent ?? ''))}
            offStance={!!nodes.get(b.id)!.stance && nodes.get(b.id)!.stance !== nodes.get(nodes.get(b.id)!.parent ?? '')?.kind}
            comments={commentCounts.get(b.id) ?? 0}
            reactions={reactions.get(b.id)}
            me={me}
          />
        ))}
        {placeLineLabels(layout, nodes, theme, labelWidth, offsetFor, editor.labelEditing ?? undefined).map((l) => (
          <EdgeLabel
            key={`label-${l.id}`}
            id={l.id}
            kind={l.kind}
            x={l.x}
            y={l.y}
            text={l.text}
            own={l.own}
            editing={editor.labelEditing === l.id}
            selected={selected.has(l.id)}
            editor={editor}
          />
        ))}
        {peers.flatMap((p) =>
          p.selection.map((id) => {
            const b = layout.boxes.get(id);
            if (!b) return null;
            return (
              <div key={`${p.clientId}-${id}`} className="peer-selection" style={{ left: b.x - 4, top: b.y - 4, width: b.w + 8, height: b.h + 8, borderColor: p.user.color }}>
                <span className="peer-tag" style={{ background: p.user.color }}>{p.editing === id ? `${p.user.name} is typing…` : p.user.name}</span>
              </div>
            );
          }),
        )}
        {peers.map((p) =>
          p.cursor ? (
            <div key={p.clientId} className="peer-cursor" style={{ left: p.cursor.x, top: p.cursor.y, transform: `scale(${1 / view.zoom})` }} aria-hidden="true">
              <svg width="16" height="20" viewBox="0 0 16 20"><path d="M1 1l13 9-6 1.2L5 18z" fill={p.user.color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>
              <span style={{ background: p.user.color }}>{p.user.name}</span>
            </div>
          ) : null,
        )}
        <svg className="connections" width="1" height="1" overflow="visible">
          {connections.map((c) => (
            <ConnectionPath
              key={c.id}
              conn={c}
              annotation={nodes.get(c.from)?.kind==='sticky'||nodes.get(c.to)?.kind==='sticky'}
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

/** Presenting: claims not reached yet are faint, the current one is ringed. */
function presentCss(editor: Editor): string {
  const p = editor.presentation!;
  const ids = [...editor.presentFuture()].filter((id) => /^[\w-]+$/.test(id));
  const cur = p.steps[p.index] ?? '';
  const faint = ids.flatMap((id) => [`.canvas.presenting [data-node-id="${id}"]`, `.canvas.presenting [data-edge="${id}"]`]).join(',');
  return [
    faint ? `${faint}{opacity:.1}` : '',
    /^[\w-]+$/.test(cur) ? `.canvas.presenting .claim[data-node-id="${cur}"]{box-shadow:0 0 0 3px var(--brand),0 8px 28px rgba(0,0,0,.18)}` : '',
  ].join('');
}

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

function ConnectionPath({ conn, a, b, oa, ob, selected, annotation }: { annotation:boolean; conn: Connection; a?: Box; b?: Box; oa: Off; ob: Off; selected: boolean }) {
  if (!a || !b) return null;
  const ca = { x: a.x + oa.dx + a.w / 2, y: a.y + oa.dy + a.h / 2 };
  const cb = { x: b.x + ob.dx + b.w / 2, y: b.y + ob.dy + b.h / 2 };
  const p1 = exitPoint(a, oa, cb.x, cb.y);
  const p2 = exitPoint(b, ob, ca.x, ca.y);
  const d = `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`;
  return (
    <g data-from={conn.from} data-to={conn.to} data-connection-id={conn.id} className={`connection${selected ? ' selected' : ''}`}>
      <path className="connection-hit" d={d} />
      <path className="connection-line" d={d} strokeDasharray={annotation ? "6 5" : undefined} markerEnd={annotation ? undefined : "url(#arrow-link)"} />
    </g>
  );
}

export function edgePath(x1: number, y1: number, x2: number, y2: number, style: LineStyle): string {
  const my = (y1 + y2) / 2;
  if (style === 'straight') return `M${x1} ${y1} L${x2} ${y2}`;
  if (style === 'elbow') return `M${x1} ${y1} V${my} H${x2} V${y2}`;
  return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
}

function EdgePath({ edge, from, to, lineStyle, hit }: { edge: Edge; from: Off; to: Off; lineStyle: LineStyle; hit?: boolean }) {
  const x1 = edge.x1 + from.dx, y1 = edge.y1 + from.dy;
  const x2 = edge.x2 + to.dx, y2 = edge.y2 + to.dy;
  const d = edgePath(x1, y1, x2, y2, lineStyle);
  // A wide, invisible copy of the line: click it to pick the group, double-click to write on it.
  if (hit) return <path className="edge-hit" data-node-id={edge.from} d={d} />;
  return <path className={`edge edge-${edge.kind}`} data-edge={edge.from} d={d} />;
}

function EdgeLabel({ id, kind, x, y, text, own, editing, selected, editor }: {
  id: string; kind: Edge['kind']; x: number; y: number; text: string; own: boolean; editing: boolean; selected: boolean; editor: Editor;
}) {
  const done = useRef(false);
  if (editing) {
    done.current = false;
    const finish = (value: string | null) => {
      if (done.current) return;
      done.current = true;
      editor.finishLineLabel(value);
    };
    return (
      <div className={`edge-label edge-label-${kind} editing`} style={{ left: x, top: y }}>
        <input
          autoFocus
          defaultValue={own ? text : ''}
          placeholder={kind === 'objection' ? 'But' : 'Because'}
          maxLength={60}
          size={Math.max(8, (own ? text.length : 7) + 2)}
          aria-label="Words on the line"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onInput={(e) => ((e.target as HTMLInputElement).size = Math.max(8, (e.target as HTMLInputElement).value.length + 2))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') finish((e.target as HTMLInputElement).value);
            else if (e.key === 'Escape') finish(null);
          }}
          onBlur={(e) => finish(e.target.value)}
        />
      </div>
    );
  }
  return (
    <div
      data-node-id={id}
      className={`edge-label edge-label-${kind}${own ? '' : ' auto'}${selected ? ' selected' : ''}`}
      style={{ left: x, top: y }}
      title="Click to write on the line"
      // One click writes on it: the box toolbar would cover the second click of a double-click.
      onPointerDown={(e) => {
        if (e.button !== 0 || editor.readOnly) return;
        e.stopPropagation();
        e.preventDefault();
        editor.editLineLabel(id);
      }}
    >
      {text}
    </div>
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
  groupKind?: string;
  /** Argues the other way from its group: gets a bar of its own colour above it. */
  offStance?: boolean;
  comments: number;
  reactions?: Map<string, string[]>;
  me: string;
}

function ClaimView({ box, node, theme, label, match, offset, selected, dropTarget, editor, editing, groupKind, offStance, comments, reactions, me }: ClaimProps) {
  const cls = [
    node.kind === 'sticky' ? 'sticky' : 'claim',
    node.kind === 'claim' && node.parent === null ? 'root' : '',
    groupKind === 'reason' ? 'in-reason' : groupKind === 'objection' ? 'in-objection' : '',
    node.implicit ? 'implicit' : '',
    selected ? 'selected' : '',
    dropTarget ? 'drop-target' : '',
    editing ? 'editing' : '',
    match ? `find-${match}` : '',
    offset.dx || offset.dy ? 'moving' : '',
  ].filter(Boolean).join(' ');
  const { maxWidth: _max, ...text } = textStyle(node, theme);
  const placeholder = node.kind === 'sticky' ? 'Note' : 'Type a claim';
  const [resize, setResize] = useState<{ w: number; h: number } | null>(null);
  const canResize = node.kind === 'sticky' && selected && !editor.readOnly && !editing;
  const startResize = (e: import('react').PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, w0 = box.w, h0 = box.h, zoom = editor.view.zoom;
    const size = (ev: PointerEvent) => ({
      w: Math.min(STICKY.max, Math.max(STICKY.min, w0 + (ev.clientX - x0) / zoom)),
      h: Math.min(STICKY.max, Math.max(STICKY.min, h0 + (ev.clientY - y0) / zoom)),
    });
    const move = (ev: PointerEvent) => setResize(size(ev));
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const s = size(ev);
      setResize(null);
      if (Math.abs(s.w - w0) > 1 || Math.abs(s.h - h0) > 1) editor.resizeSticky(node.id, s.w, s.h);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      data-node-id={box.id}
      className={cls}
      style={{
        left: box.x + offset.dx,
        top: box.y + offset.dy,
        width: resize?.w ?? box.w,
        minHeight: resize?.h ?? box.h,
        ...(node.kind === 'sticky' ? { height: resize?.h ?? box.h } : {}),
        ...boxStyle(node, theme),
      }}
      role="treeitem"
      aria-selected={selected}
    >
      {editing ? (
        <NodeEditor editor={editor} text={node.text} initial={editing.initial} style={text} />
      ) : (
        <div className={`claim-text${node.text ? '' : ' placeholder'}`} dir={node.style?.direction??"auto"} style={text}>
          {node.text || placeholder}
        </div>
      )}
      {node.evidence?.length ? <button className="node-badge" title={node.evidence.map(v=>[v.source,v.page,v.quote].filter(Boolean).join(' · ')).join('\n')} onClick={()=>window.alert(node.evidence!.map(v=>[v.source,v.page,v.quote].filter(Boolean).join(' · ')).join('\n'))}>Sources ({node.evidence.length})</button>:null}
      {node.questions?.some(q=>!q.answer) && <span title={node.questions.map(q=>q.text).join('\n')}>?</span>}
      {offStance ? <span className={`stance-bar stance-${groupKind}`} aria-hidden="true" /> : null}
      {label ? <span className="node-label">{label}</span> : null}
      {node.kind==='sticky'&&!editor.readOnly&&!editor.presentation&&!editing&&<span className="wire-handle" data-wire={node.id} title="Drag to connect this note to a box">↗</span>}
      {canResize ? (
        <span className="sticky-resize" title="Drag to resize" aria-label="Resize note" onPointerDown={startResize} />
      ) : null}
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
      {comments || reactions?.size ? (
        <span className="node-social" onPointerDown={(e) => e.stopPropagation()}>
          {[...(reactions ?? new Map<string, string[]>())].map(([emoji, authors]) => (
            <button key={emoji} className={`reaction-chip${authors.includes(me) ? ' mine' : ''}`} title={authors.join(', ')}
              aria-label={`${emoji} ${authors.length}`} disabled={editor.readOnly}
              onClick={() => editor.toggleReaction(node.id, emoji)}>
              <Emoji e={emoji} size={15} />{authors.length > 1 ? <small>{authors.length}</small> : null}
            </button>
          ))}
          {comments ? (
            <button className="comment-chip" title={`${comments} comment${comments > 1 ? 's' : ''}`} aria-label={`${comments} comments`}
              onClick={() => { editor.select([node.id]); editor.toggleNotes(true); }}>
              <CommentIcon /> {comments}
            </button>
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

function CommentIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3h11v8h-6l-3.5 3v-3h-1.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
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
