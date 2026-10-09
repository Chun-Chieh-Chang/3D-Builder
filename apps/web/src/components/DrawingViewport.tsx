import { t } from '@3db/i18n';
import {
  arrangementBase,
  buildScene,
  dimensionAt,
  dragDimension,
  featureAt,
  layoutViews,
  planDimension,
  scaleFromRatio,
  scaleTarget,
  segmentDistance,
  sheetMetrics,
  slideAxis,
  toSheet,
  toSvg,
  toView,
  type DimensionHandle,
  type Pickable,
  type SceneItem,
} from '@3db/drawing';
import { axesOf, type Dimension, type DrawingView, type Id, type Scale } from '@3db/model';
import { useEffect, useMemo, useRef, useState } from 'react';
import { store, useStore } from '../state/store';

/** Pixels in a millimetre of an SVG drawn at its size (CSS: 96 pixels to the inch). */
const PX = 96 / 25.4;
type P = [number, number];

/**
 * What the pointer is doing on the sheet. To a view: a move, of the view the others are arranged round, which takes them all with it (`shift`); of a view that is in line with
 * the rest, along that line only, which changes the distance to the others (`slide`); or free (`free`, with Shift held, or a view that has no line), which puts the view where
 * it is let go. A scale: the handle at the corner of the chosen view, which changes the scale the view takes and so that of every view that takes it. To a dimension: its line
 * (how far it is from the view) or its text (along the line) is taken, a circle's leader (the way it points, how long it is), an angle's arc. To the line of a section: it is
 * moved across. A `draw`: the line of a section or the circle of a detail is being drawn on a view, with the tool.
 */
type Drag =
  | { kind: 'move'; id: string; mode: 'shift' | 'slide' | 'free'; axis: 0 | 1 | null; from: P; origin: P; delta: P }
  | { kind: 'scale'; id: string; target: ReturnType<typeof scaleTarget>; centre: P; r0: number; ratio0: number; scale: Scale }
  | { kind: 'dimension'; id: string; onText: boolean; handle: DimensionHandle; patch: ReturnType<typeof dragDimension> }
  | { kind: 'sectionLine'; id: string; line: [P, P]; vertical: boolean; scale: number; from: P; delta: number }
  | { kind: 'draw'; tool: 'section' | 'detail'; view: Id; from: P; to: P };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The line of a section as it is when it has been moved by `by` (view units) across itself. */
const movedLine = (line: [P, P], vertical: boolean, by: number): [P, P] => (vertical ? [[line[0][0] + by, line[0][1]], [line[1][0] + by, line[1][1]]] : [[line[0][0], line[0][1] + by], [line[1][0], line[1][1] + by]]);

/** The shape a dimension chosen on the sheet is drawn over in, so that it can be seen which one it is. */
function Highlight({ items, height, color }: { items: readonly SceneItem[]; height: number; color: string }) {
  return (
    <>
      {items.map((i, k) =>
        i.kind === 'polyline' ? (
          <polyline key={k} points={Array.from({ length: i.points.length / 2 }, (_, j) => `${i.points[2 * j]},${height - i.points[2 * j + 1]!}`).join(' ') + (i.closed ? ` ${i.points[0]},${height - i.points[1]!}` : '')} fill={i.filled ? color : 'none'} stroke={color} strokeWidth={0.55} />
        ) : (
          <text key={k} x={i.at[0]} y={height - i.at[1]} fontSize={i.height * 1.4} textAnchor={i.anchor === 'center' ? 'middle' : i.anchor === 'right' ? 'end' : 'start'} fill={color} transform={i.angle ? `rotate(${-i.angle} ${i.at[0]} ${height - i.at[1]})` : undefined}>
            {i.text}
          </text>
        ),
      )}
    </>
  );
}

/**
 * The sheet of the open drawing (C16): the scene as SVG on a page that can be panned (drag on the paper) and zoomed (wheel). A view is chosen by clicking it and moved by
 * dragging it. A dimension is chosen by clicking its line or text, moved by dragging them, edited by double clicking it (the panel), deleted with Delete. The tools make a
 * dimension from the elements pointed at in the view and put it where the pointer is, a section from a line drawn on a view, a detail from a circle drawn on one.
 */
export function DrawingViewport() {
  const drw = useStore((s) => s.drw)!;
  const bootMs = useStore((s) => s.bootMs);
  const d = store.drawingStore!;
  const host = useRef<HTMLElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0, zoom: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  /** Where the pointer is on the sheet, and what is under it: for the preview of a tool and the cursor. */
  const [hover, setHover] = useState<{ p: P; feature: { view: Id; feature: Pickable } | null; dimension: string | null } | null>(null);
  const sheet = sheetMetrics(drw.doc.sheet);
  const tool = drw.tool;
  /** Where the views are before anything is dragged: what the tools read their geometry from. */
  const basePlaced = useMemo(() => layoutViews(drw.doc, drw.lines), [drw.doc, drw.lines]);

  /** The dimension the tool would make from what is pointed at and where the pointer is (it is drawn while the pointer moves). */
  const plan = useMemo(() => {
    if (tool?.kind !== 'dimension' || !hover || tool.picks.length === 0) return null;
    const first = tool.picks[0]!;
    const view = drw.doc.views.find((v) => v.id === first.view);
    const placed = basePlaced.get(first.view);
    const axes = view && axesOf(drw.doc.views, drw.doc.sheet.projection, view);
    if (!view || !placed || !axes) return null;
    const picks = tool.picks.map((x) => x.feature);
    // with one element chosen, an element under the pointer is the second one for now
    const second = picks.length === 1 && hover.feature && hover.feature.view === first.view && hover.feature.feature.ref.name !== picks[0]!.ref.name ? hover.feature.feature : null;
    const result = planDimension(second ? [...picks, second] : picks, hover.p, placed, axes);
    return 'draft' in result ? { view: first.view, ...result } : null;
  }, [tool, hover, drw.doc, basePlaced]);

  // what is shown: the document, as the drag would leave it (the other views follow while the pointer moves), and the dimension being made
  const shown = useMemo(() => {
    let doc = drw.doc;
    if (plan) doc = { ...doc, dimensions: [...doc.dimensions, { id: 'preview', view: plan.view, ...plan.draft } as Dimension] };
    if (!drag) return doc;
    if (drag.kind === 'draw') return doc;
    if (drag.kind === 'dimension') return { ...doc, dimensions: doc.dimensions.map((x) => (x.id === drag.id ? ({ ...x, ...drag.patch } as Dimension) : x)) };
    if (drag.kind === 'sectionLine') return { ...doc, views: doc.views.map((v) => (v.id === drag.id && v.kind === 'section' ? { ...v, line: movedLine(drag.line, drag.vertical, drag.delta) } : v)) as DrawingView[] };
    if (drag.kind === 'scale') {
      const target = drag.target;
      return 'sheet' in target ? { ...doc, sheet: { ...doc.sheet, scale: drag.scale } } : { ...doc, views: doc.views.map((v) => (v.id === target.view ? { ...v, scale: drag.scale } : v)) };
    }
    if (drag.mode === 'shift') {
      const was = doc.sheet.shift ?? [0, 0];
      return { ...doc, sheet: { ...doc.sheet, shift: [was[0] + drag.delta[0], was[1] + drag.delta[1]] as P } };
    }
    if (drag.mode === 'slide') return { ...doc, views: doc.views.map((v) => (v.id === drag.id ? { ...v, slide: (v.slide ?? 0) + drag.delta[drag.axis!] } : v)) };
    return { ...doc, views: doc.views.map((v) => (v.id === drag.id ? { ...v, at: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as P, slide: undefined } : v)) };
  }, [drw.doc, drag, plan]);
  const elements = useMemo(() => (plan ? new Map(drw.elements).set('preview', { elements: plan.facts }) : drw.elements), [drw.elements, plan]);
  const built = useMemo(() => buildScene(shown, drw.lines, elements, drw.features, drw.boms), [shown, drw.lines, elements, drw.features, drw.boms]);
  const svg = useMemo(() => toSvg(built.scene), [built]);
  /** The items of the dimensions that are there (not the one being made): what the pointer can take hold of. */
  const dimensionItems = useMemo(() => built.scene.items.filter((i) => i.group && i.group !== 'preview'), [built]);
  /** The lines of the sections on the sheet, where they are drawn on their parents (sheet mm). */
  const sectionLines = useMemo(
    () =>
      shown.views.flatMap((v) => {
        if (v.kind !== 'section') return [];
        const parent = built.placed.get(v.parent);
        if (!parent) return [];
        const vertical = v.line[0][0] === v.line[1][0];
        return [{ id: v.id, line: v.line as [P, P], vertical, scale: parent.scale, p0: toSheet(parent, v.line[0][0], v.line[0][1]) as P, p1: toSheet(parent, v.line[1][0], v.line[1][1]) as P }];
      }),
    [shown, built],
  );

  const fit = () => {
    const el = host.current;
    if (!el) return;
    const zoom = Math.min((el.clientWidth - 40) / (sheet.width * PX), (el.clientHeight - 40) / (sheet.height * PX));
    setPan({ zoom, x: (el.clientWidth - sheet.width * PX * zoom) / 2, y: (el.clientHeight - sheet.height * PX * zoom) / 2 });
  };
  useEffect(fit, [drw.fitRequest, drw.doc.sheet.size, drw.doc.sheet.orientation]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setPan((p) => {
        const zoom = Math.min(20, Math.max(0.05, p.zoom * Math.pow(1.1, -e.deltaY / 100)));
        const k = zoom / p.zoom;
        return { zoom, x: px - (px - p.x) * k, y: py - (py - p.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Esc lets go of what is being done, one thing at a time; Delete takes the dimension chosen away
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.key === 'Escape') {
        if (drag) setDrag(null);
        else if (tool) {
          if (tool.kind === 'dimension' && tool.picks.length > 0) d.setTool({ kind: 'dimension', picks: [] });
          else d.setTool(null);
        } else if (drw.dimension) d.selectDimension(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && drw.dimension && !tool) {
        e.preventDefault();
        const id = drw.dimension;
        d.selectDimension(null);
        d.deleteDimensions([id]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag, tool, drw.dimension, d]);
  // a dimension that is gone (deleted, undone) is not the one chosen
  useEffect(() => {
    if (drw.dimension && !drw.doc.dimensions.some((x) => x.id === drw.dimension)) d.selectDimension(null);
  }, [drw.doc, drw.dimension, d]);

  /** A pointer position on the sheet, in mm from its lower left corner. */
  const onSheet = (e: { clientX: number; clientY: number }): P => {
    const rect = host.current!.getBoundingClientRect();
    return [(e.clientX - rect.left - pan.x) / (pan.zoom * PX), sheet.height - (e.clientY - rect.top - pan.y) / (pan.zoom * PX)];
  };
  /** How close the pointer has to be to take hold of something (mm on the sheet): the same few pixels whatever the zoom. */
  const reach = 6 / (pan.zoom * PX);

  /** The element of a view under the point (the views in the order they are drawn, the last on top); when `only` is given, in that view only. */
  const featureUnder = (p: P, only?: Id): { view: Id; feature: Pickable } | null => {
    for (const v of [...drw.doc.views].reverse()) {
      if (only && v.id !== only) continue;
      const placed = basePlaced.get(v.id);
      if (!placed || placed.w <= 0) continue;
      const f = featureAt(drw.lines.get(v.id), drw.features.get(v.id) ?? [], toView(placed, p), reach / placed.scale);
      if (f) return { view: v.id, feature: f };
    }
    return null;
  };
  /** The view whose box the point is in, the last drawn on top. */
  const viewUnder = (p: P): DrawingView | undefined =>
    [...drw.doc.views].reverse().find((v) => {
      const placed = built.placed.get(v.id);
      return placed && placed.w > 0 && Math.abs(p[0] - placed.at[0]) <= placed.w / 2 && Math.abs(p[1] - placed.at[1]) <= placed.h / 2;
    });

  /** Keeps the pointer while it is dragged outside the sheet (nothing to keep when the event is not from a real pointer). */
  const capture = (e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone (or the event is synthetic)
    }
  };

  /** A press with the dimension tool: the first element, the second, or the place the dimension goes. */
  const dimensionDown = (p: P) => {
    if (tool?.kind !== 'dimension') return;
    const first = tool.picks[0];
    const hit = featureUnder(p, first?.view);
    if (!first) {
      if (hit) d.setTool({ kind: 'dimension', picks: [hit] });
      else d.notifyInfo(t('drawingUi.hint.dimension0'));
      return;
    }
    const view = drw.doc.views.find((v) => v.id === first.view);
    const placed = basePlaced.get(first.view);
    const axes = view && axesOf(drw.doc.views, drw.doc.sheet.projection, view);
    if (!view || !placed || !axes) return;
    // a second element pointed at (not the same one): then the place comes
    if (tool.picks.length === 1 && hit && hit.feature.ref.name !== first.feature.ref.name) {
      d.setTool({ kind: 'dimension', picks: [first, hit] });
      return;
    }
    const result = planDimension(tool.picks.map((x) => x.feature), p, placed, axes);
    if ('error' in result) return d.notifyInfo(result.error);
    if ('need' in result) return d.notifyInfo(t('drawingUi.hint.dimension1'));
    if (d.addDimension(first.view, result.draft)) d.setTool({ kind: 'dimension', picks: [] });
  };

  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.heads-up')) return;
    const p = onSheet(e);
    // the handle at the corner of the chosen view: the scale
    if ((e.target as HTMLElement).closest('[data-scale-handle]') && drw.selected) {
      const view = drw.doc.views.find((v) => v.id === drw.selected);
      const placed = view && built.placed.get(view.id);
      if (view && placed) {
        capture(e);
        setDrag({ kind: 'scale', id: view.id, target: scaleTarget(drw.doc, view), centre: [placed.at[0], placed.at[1]], r0: Math.max(1e-6, Math.hypot(p[0] - placed.at[0], p[1] - placed.at[1])), ratio0: placed.scale, scale: scaleFromRatio(placed.scale) });
        return;
      }
    }
    if (e.button !== 0) {
      // the other buttons pan the sheet, as they always did
      capture(e);
      setPanning({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    // the tools
    if (tool?.kind === 'dimension') return dimensionDown(p);
    if (tool) {
      const view = viewUnder(p);
      if (!view) return d.notifyInfo(t(tool.kind === 'section' ? 'drawingUi.hint.section' : 'drawingUi.hint.detail'));
      capture(e);
      d.select(view.id);
      setDrag({ kind: 'draw', tool: tool.kind, view: view.id, from: p, to: p });
      return;
    }
    // a dimension: its text slides, the rest of it moves away from or round what it measures
    const dim = dimensionAt(dimensionItems, p, reach);
    const outcome = dim && built.dimensions.get(dim.id);
    if (dim && outcome && !('error' in outcome)) {
      d.selectDimension(dim.id);
      if (outcome.handle) {
        capture(e);
        setDrag({ kind: 'dimension', id: dim.id, onText: dim.text, handle: outcome.handle, patch: {} });
      }
      return;
    }
    // the line of a section on its parent: it is moved across
    const sec = sectionLines.find((s) => segmentDistance(p, s.p0, s.p1) <= reach);
    if (sec) {
      capture(e);
      d.select(sec.id);
      d.selectDimension(null);
      setDrag({ kind: 'sectionLine', id: sec.id, line: sec.line, vertical: sec.vertical, scale: sec.scale, from: p, delta: 0 });
      return;
    }
    d.selectDimension(null);
    // the view under the pointer, the one drawn last when they overlap
    const hit = viewUnder(p);
    capture(e);
    if (hit) {
      d.select(hit.id);
      const at = built.placed.get(hit.id)!.at;
      const axis = slideAxis(drw.doc, hit);
      const base = arrangementBase(drw.doc);
      const mode = !hit.at && base?.id === hit.id ? 'shift' : axis !== null && !e.shiftKey ? 'slide' : 'free';
      setDrag({ kind: 'move', id: hit.id, mode, axis, from: p, origin: [at[0], at[1]], delta: [0, 0] });
    } else {
      d.select(null);
      setPanning({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };
  const move = (e: React.PointerEvent) => {
    const p = onSheet(e);
    if (drag?.kind === 'scale') {
      setDrag({ ...drag, scale: scaleFromRatio((drag.ratio0 * Math.hypot(p[0] - drag.centre[0], p[1] - drag.centre[1])) / drag.r0) });
    } else if (drag?.kind === 'dimension') {
      // measured against the dimension as it was when it was taken hold of, not as the drag has moved it since
      setDrag({ ...drag, patch: dragDimension(drag.handle, drag.onText, p) });
    } else if (drag?.kind === 'sectionLine') {
      const by = drag.vertical ? p[0] - drag.from[0] : p[1] - drag.from[1];
      setDrag({ ...drag, delta: by / drag.scale });
    } else if (drag?.kind === 'draw') {
      setDrag({ ...drag, to: p });
    } else if (drag) {
      setDrag({ ...drag, delta: [p[0] - drag.from[0], p[1] - drag.from[1]] } as Drag);
    } else if (panning) {
      setPan({ ...pan, x: e.clientX - panning.x, y: e.clientY - panning.y });
    } else if (tool || dimensionItems.length > 0) {
      // what is under the pointer: for the tool's preview, and for the cursor
      const feature = tool?.kind === 'dimension' ? featureUnder(p, tool.picks[0]?.view) : null;
      const dimension = tool ? null : (dimensionAt(dimensionItems, p, reach)?.id ?? null);
      setHover((h) => (tool || h?.dimension !== dimension || h?.feature ? { p, feature, dimension } : h));
    }
  };
  /** The scale the dragged view had before: the one of what the drag changes. */
  const shownBefore = (drag: Extract<Drag, { kind: 'scale' }>): Scale | null => ('sheet' in drag.target ? drw.doc.sheet.scale : (drw.doc.views.find((v) => v.id === (drag.target as { view: string }).view)?.scale ?? null));
  const up = () => {
    if (drag?.kind === 'scale') {
      const was = shownBefore(drag);
      if (was === null || was[0] !== drag.scale[0] || was[1] !== drag.scale[1]) {
        if ('sheet' in drag.target) d.setSheet({ scale: drag.scale });
        else d.setView(drag.target.view, { scale: drag.scale });
      }
    } else if (drag?.kind === 'dimension') {
      if (Object.keys(drag.patch).length > 0) d.setDimension(drag.id, drag.patch);
    } else if (drag?.kind === 'sectionLine') {
      if (Math.abs(drag.delta) > 0.005) d.setView(drag.id, { line: movedLine(drag.line, drag.vertical, round2(drag.delta)) });
    } else if (drag?.kind === 'draw') {
      finishDraw(drag);
    } else if (drag && Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) {
      const view = drw.doc.views.find((v) => v.id === drag.id);
      if (drag.mode === 'shift') {
        const was = drw.doc.sheet.shift ?? [0, 0];
        d.setSheet({ shift: [round2(was[0] + drag.delta[0]), round2(was[1] + drag.delta[1])] });
      } else if (drag.mode === 'slide') d.setView(drag.id, { slide: round2((view?.slide ?? 0) + drag.delta[drag.axis!]) });
      else d.setView(drag.id, { at: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])], slide: null });
    }
    setDrag(null);
    setPanning(null);
  };

  /** What is drawn with the tool is made: a section through where the pointer was pressed, along the direction it was dragged; a detail round the middle it was pressed on. */
  const finishDraw = (g: Extract<Drag, { kind: 'draw' }>) => {
    const placed = basePlaced.get(g.view);
    const box = drw.lines.get(g.view)?.box;
    if (!placed || !box) return;
    const at = toView(placed, g.from);
    if (g.tool === 'detail') {
      const radius = Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]) / placed.scale;
      if (radius < 1) return d.notifyInfo(t('drawingUi.hint.detail'));
      d.addDetail(g.view, [round2(at[0]), round2(at[1])], round2(radius));
      return d.setTool(null);
    }
    const dx = Math.abs(g.to[0] - g.from[0]);
    const dy = Math.abs(g.to[1] - g.from[1]);
    // a press with no drag is a vertical cut; a drag is along the line it draws
    const horizontal = Math.max(dx, dy) >= 3 && dx > dy;
    const pad = 5;
    const line: [P, P] = horizontal ? [[box.min[0] - pad, round2(at[1])], [box.max[0] + pad, round2(at[1])]] : [[round2(at[0]), box.min[1] - pad], [round2(at[0]), box.max[1] + pad]];
    d.addSection(g.view, line);
    d.setTool(null);
  };

  const selected = drw.selected ? built.placed.get(drw.selected) : undefined;
  const chosen = drw.dimension ? dimensionItems.filter((i) => i.group === drw.dimension) : [];
  const dimensionHints = ['drawingUi.hint.dimension0', 'drawingUi.hint.dimension1', 'drawingUi.hint.dimension2'] as const;
  const hint = tool?.kind === 'dimension' ? t(dimensionHints[Math.min(2, tool.picks.length)]!) : tool ? t(tool.kind === 'section' ? 'drawingUi.hint.section' : 'drawingUi.hint.detail') : null;
  const cursor = tool ? 'crosshair' : hover?.dimension || drag?.kind === 'dimension' ? 'move' : undefined;
  // the geometry of the tool's preview on the sheet
  const drawn = drag?.kind === 'draw' ? drag : null;
  const drawnPlaced = drawn ? basePlaced.get(drawn.view) : undefined;
  return (
    <main
      className="viewport drawing-viewport"
      ref={host}
      style={cursor ? { cursor } : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onDoubleClick={(e) => {
        if (tool) return;
        const dim = dimensionAt(dimensionItems, onSheet(e), reach);
        if (!dim) return;
        d.selectDimension(dim.id);
        // the panel's text field is where it is edited
        setTimeout(() => document.querySelector<HTMLElement>('[data-field="dimText"]')?.focus(), 0);
      }}
      data-drawing-canvas
    >
      <div className="drawing-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${pan.zoom})` }}>
        <div className="drawing-paper" data-svg dangerouslySetInnerHTML={{ __html: svg }} />
        <svg className="drawing-overlay" data-overlay width={sheet.width * PX} height={sheet.height * PX} viewBox={`0 0 ${sheet.width} ${sheet.height}`}>
          {chosen.length > 0 && <Highlight items={chosen} height={sheet.height} color="#1c7ed6" />}
          {tool?.kind === 'dimension' &&
            [...tool.picks.map((x) => x.feature), ...(hover?.feature && tool.picks.length < 2 ? [hover.feature.feature] : [])].map((f, k) => {
              const view = (tool.picks[0]?.view ?? hover?.feature?.view)!;
              const placed = basePlaced.get(view);
              if (!placed) return null;
              const colour = k < tool.picks.length ? '#1c7ed6' : '#f08c00';
              const box = drw.lines.get(view)?.box;
              if (f.type === 'circle') {
                const c = toSheet(placed, f.centre[0], f.centre[1]);
                return <circle key={k} cx={c[0]} cy={sheet.height - c[1]} r={f.radius * placed.scale} fill="none" stroke={colour} strokeWidth={0.8} />;
              }
              const [a, b] = f.type === 'plane' ? (f.axis === 'x' ? [[f.coord, box?.min[1] ?? 0], [f.coord, box?.max[1] ?? 0]] : [[box?.min[0] ?? 0, f.coord], [box?.max[0] ?? 0, f.coord]]) : [[f.at[0] - f.dir[0] * 15, f.at[1] - f.dir[1] * 15], [f.at[0] + f.dir[0] * 15, f.at[1] + f.dir[1] * 15]];
              const sa = toSheet(placed, a![0]!, a![1]!);
              const sb = toSheet(placed, b![0]!, b![1]!);
              return <line key={k} x1={sa[0]} y1={sheet.height - sa[1]} x2={sb[0]} y2={sheet.height - sb[1]} stroke={colour} strokeWidth={0.8} />;
            })}
          {plan && <Highlight items={built.scene.items.filter((i) => i.group === 'preview')} height={sheet.height} color="#1c7ed6" />}
          {drawn && drawnPlaced && drawn.tool === 'detail' && <circle cx={drawn.from[0]} cy={sheet.height - drawn.from[1]} r={Math.hypot(drawn.to[0] - drawn.from[0], drawn.to[1] - drawn.from[1])} fill="none" stroke="#1c7ed6" strokeWidth={0.5} strokeDasharray="2 1" />}
          {drawn && drawnPlaced && drawn.tool === 'section' && (() => {
            const horizontal = Math.max(Math.abs(drawn.to[0] - drawn.from[0]), Math.abs(drawn.to[1] - drawn.from[1])) >= 3 && Math.abs(drawn.to[0] - drawn.from[0]) > Math.abs(drawn.to[1] - drawn.from[1]);
            const half = (horizontal ? drawnPlaced.w : drawnPlaced.h) / 2 + 5;
            return horizontal ? (
              <line x1={drawnPlaced.at[0] - half} x2={drawnPlaced.at[0] + half} y1={sheet.height - drawn.from[1]} y2={sheet.height - drawn.from[1]} stroke="#1c7ed6" strokeWidth={0.6} strokeDasharray="6 2 1 2" />
            ) : (
              <line y1={sheet.height - (drawnPlaced.at[1] - half)} y2={sheet.height - (drawnPlaced.at[1] + half)} x1={drawn.from[0]} x2={drawn.from[0]} stroke="#1c7ed6" strokeWidth={0.6} strokeDasharray="6 2 1 2" />
            );
          })()}
        </svg>
        {selected && selected.w > 0 && (
          <div
            className="drawing-selection"
            data-selection
            style={{ left: (selected.at[0] - selected.w / 2) * PX - 4, top: (sheet.height - selected.at[1] - selected.h / 2) * PX - 4, width: selected.w * PX + 8, height: selected.h * PX + 8 }}
          >
            <span
              className="drawing-handle"
              data-scale-handle
              title={t('drawingUi.scaleHandle')}
              style={{ width: 12 / pan.zoom, height: 12 / pan.zoom, right: -6 / pan.zoom, bottom: -6 / pan.zoom, borderWidth: 1 / pan.zoom }}
            />
          </div>
        )}
      </div>
      <div className="heads-up">
        <button onClick={fit}>{t('drawingUi.fit')}</button>
        <button disabled={!drw.canUndo} onClick={() => d.undo()}>
          {t('drawingUi.undo')}
        </button>
        <button disabled={!drw.canRedo} onClick={() => d.redo()}>
          {t('drawingUi.redo')}
        </button>
      </div>
      {hint && (
        <div className="drawing-hint" data-hint>
          {hint}
        </div>
      )}
      {!bootMs && <div className="boot-overlay">{t('drawingUi.loadingKernel')}</div>}
    </main>
  );
}
