import { t } from '@3db/i18n';
import {
  annotationItems,
  arrangementBase,
  BALLOON_RADIUS,
  DATUM_TRIANGLE,
  FRAME_HEIGHT,
  buildScene,
  dimensionAt,
  dimensionsInBox,
  itemsInBox,
  rectInBox,
  selectionBox,
  dragDimension,
  featureAt,
  fromSheet,
  layoutViews,
  planDimension,
  previewDerived,
  resolveLines,
  ratio,
  sideAt,
  snapCut,
  scaleFromRatio,
  scaleTarget,
  segmentDistance,
  sheetMetrics,
  slideAxis,
  surfaceFinishBox,
  surfaceFinishItems,
  toSheet,
  toSvg,
  toView,
  visibleElements,
  type DimensionHandle,
  type PlacedView,
  type Pickable,
  type SceneItem,
  type ViewLines,
} from '@3db/drawing';
import { axesOf, oppositeSide, projectedAxes, type Annotation, sectionArrow, sectionAxes, type Dimension, type DrawingView, type Id, type Scale, type SectionDrawingView, type SurfaceFinish, type ViewSide } from '@3db/model';
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
 * moved across. A `table`: a table (the parts list, the hole table) is moved by its upper left corner; a `balloon`: the circle of a balloon is moved, its leader stays on the part. A `draw`: the line of a section or the circle of a detail is being drawn on a view, with the tool.
 */
type Drag =
  | { kind: 'move'; id: string; mode: 'shift' | 'slide' | 'free'; axis: 0 | 1 | null; from: P; origin: P; delta: P }
  | { kind: 'scale'; id: string; target: ReturnType<typeof scaleTarget>; centre: P; r0: number; ratio0: number; scale: Scale }
  | { kind: 'dimension'; id: string; onText: boolean; handle: DimensionHandle; patch: ReturnType<typeof dragDimension> }
  | { kind: 'sectionLine'; id: string; line: [P, P]; vertical: boolean; scale: number; from: P; delta: number }
  | { kind: 'table'; id: string; from: P; origin: P; delta: P }
  | { kind: 'balloon'; id: string; item: string; from: P; origin: P; delta: P }
  | { kind: 'surface'; id: string; from: P; origin: P; delta: P }
  /** An annotation (D-I3) moved as a whole; its leader's point stays on the feature. `delta` is in sheet mm. */
  | { kind: 'annotation'; id: string; from: P; delta: P }
  | { kind: 'draw'; tool: 'section' | 'detail'; vertical?: boolean; view: Id; from: P; to: P }
  /** The last click of a section or a detail: where its view goes. `free` (Ctrl held): put where the pointer is, not in line with the parent. */
  | { kind: 'placeDraw'; placement: DrawPlacement; from: P; to: P; free: boolean }
  /** A box dragged over the paper from where nothing was (D-I1a): what it holds is chosen; with Ctrl it is added to what was. */
  | { kind: 'box'; from: P; to: P; add: boolean };
type DrawPlacement =
  | { tool: 'section'; view: Id; line: [P, P] }
  | { tool: 'detail'; view: Id; centre: P; radius: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An annotation moved by `dv` (view units): where it stands moves, the point its leader touches does not (it is on the feature). */
function movedAnnotation(a: Annotation, dv: P): Annotation {
  const by = (q: P): P => [round2(q[0] + dv[0]), round2(q[1] + dv[1])];
  if (a.kind === 'centreLine') return { ...a, from: by(a.from), to: by(a.to) };
  return { ...a, at: by(a.at) } as Annotation;
}

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
  const [pendingDraw, setPendingDraw] = useState<Extract<Drag, { kind: 'draw' }> | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<DrawPlacement | null>(null);
  const [drawCursor, setDrawCursor] = useState<P | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  /** Where the pointer is on the sheet, and what is under it: for the preview of a tool and the cursor. */
  const [hover, setHover] = useState<{ p: P; feature: { view: Id; feature: Pickable } | null; dimension: string | null; ctrl?: boolean } | null>(null);
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
    if (drag.kind === 'placeDraw') return doc;
    if (drag.kind === 'box') return doc;
    if (drag.kind === 'dimension') return { ...doc, dimensions: doc.dimensions.map((x) => (x.id === drag.id ? ({ ...x, ...drag.patch } as Dimension) : x)) };
    if (drag.kind === 'table') return { ...doc, tables: doc.tables.map((x) => (x.id === drag.id ? { ...x, at: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as P } : x)) };
    if (drag.kind === 'balloon') return { ...doc, tables: doc.tables.map((x) => (x.id === drag.id && x.kind === 'bom' ? { ...x, balloonAt: { ...x.balloonAt, [drag.item]: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as P } } : x)) };
    if (drag.kind === 'sectionLine') return { ...doc, views: doc.views.map((v) => (v.id === drag.id && v.kind === 'section' ? { ...v, line: movedLine(drag.line, drag.vertical, drag.delta) } : v)) as DrawingView[] };
    if (drag.kind === 'annotation') {
      return {
        ...doc,
        annotations: (doc.annotations ?? []).map((a) => {
          const pl = basePlaced.get(a.view);
          return a.id === drag.id && pl ? movedAnnotation(a, [drag.delta[0] / pl.scale, drag.delta[1] / pl.scale]) : a;
        }),
      };
    }
    if (drag.kind === 'surface') return { ...doc, surfaceFinishes: doc.surfaceFinishes.map((f) => (f.id === drag.id ? { ...f, at: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as P } : f)) };
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
  /** What each annotation draws, marked with its id: what the pointer takes hold of, and what a choice is shown with (D-I3). */
  const annotationHit = useMemo(() => {
    const lookup = (key: string) => (shown.title as Record<string, string | undefined>)[key] ?? shown.properties?.[key];
    return (shown.annotations ?? []).flatMap((a) => {
      const pl = built.placed.get(a.view);
      return pl ? annotationItems([a], pl, lookup, shown.sheet.unit ?? 'mm').map((i) => ({ ...i, group: a.id })) : [];
    });
  }, [shown, built]);
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
        else if (pendingDraw) {
          setPendingDraw(null);
          setDrawCursor(null);
        }
        else if (pendingPlacement) {
          setPendingPlacement(null);
          setDrawCursor(null);
        }
        else if (tool) {
          if (tool.kind === 'dimension' && tool.picks.length > 0) d.setTool({ kind: 'dimension', picks: [] });
          else if (tool.kind === 'annotate' && tool.first) d.setTool({ kind: 'annotate', what: tool.what });
          else d.setTool(null);
        } else if (drw.selection.length > 0) d.clearSelection();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !tool && drw.selection.length > 0) {
        // everything chosen goes, as one step (views too: they were chosen by a click on them)
        e.preventDefault();
        d.deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag, pendingDraw, pendingPlacement, tool, drw.selection, d]);
  useEffect(() => {
    setPendingDraw(null);
    setPendingPlacement(null);
    setDrawCursor(null);
  }, [tool?.kind]);
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

  /** The edges and vertices each view shows, by name (D-I2): worked out once per view from its lines and the worker's projected edges. */
  // a detail view's lines are its parent's, cut by its circle: what can be pointed at in it is what is drawn in it (its features and edges are its parent's)
  const viewLines = useMemo(() => resolveLines(drw.doc, drw.lines), [drw.doc, drw.lines]);
  const seenByView = useMemo(() => new Map(drw.doc.views.map((v) => [v.id, visibleElements(viewLines.get(v.id), drw.edges.get(v.id), drw.features.get(v.id) ?? [])])), [drw.doc.views, viewLines, drw.edges, drw.features]);
  /** The element of a view under the point (the views in the order they are drawn, the last on top); when `only` is given, in that view only. */
  const featureUnder = (p: P, only?: Id): { view: Id; feature: Pickable } | null => {
    for (const v of [...drw.doc.views].reverse()) {
      if (only && v.id !== only) continue;
      const placed = basePlaced.get(v.id);
      if (!placed || placed.w <= 0) continue;
      const f = featureAt(viewLines.get(v.id), drw.features.get(v.id) ?? [], toView(placed, p), reach / placed.scale, seenByView.get(v.id));
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

  /** The surface finish whose symbol is under the point (sheet mm), the last in the document on top. */
  const finishUnder = (p: P): SurfaceFinish | null => {
    const all = shown.surfaceFinishes;
    for (let i = all.length - 1; i >= 0; i--) {
      const f = all[i]!;
      const placed = built.placed.get(f.view);
      if (!placed) continue;
      const [sx, sy] = toSheet(placed, f.at[0], f.at[1]);
      const box = surfaceFinishBox(f);
      // the symbol leans one way or another, so what is taken hold of is the square about its point that holds it
      const r = Math.max(box.w, box.h) * 0.75 + reach;
      if (Math.abs(p[0] - sx) <= r && Math.abs(p[1] - sy) <= r) return f;
    }
    return null;
  };

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
    if (!tool && (e.target as HTMLElement).closest('[data-scale-handle]') && drw.selected) {
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
    if (tool?.kind === 'placeView') {
      // a click on the sheet with a view of the palette in hand puts it there
      d.placeModelView(tool.source, tool.direction, [round2(p[0]), round2(p[1])]);
      return;
    }
    if (tool?.kind === 'project') {
      const g = projectGhost(p);
      if (!g) return d.notifyInfo(t('drawingUi.hint.project'));
      if (g.side === 'corner') {
        const source = drw.palette?.source;
        if (source) {
          d.placeModelView(source, 'isometric', [round2(g.placed.at[0]), round2(g.placed.at[1])]);
          d.setTool({ kind: 'project', parent: tool.parent });
        }
      } else d.placeProjected(tool.parent, g.side, g.slide, g.shift);
      // the parent stays the one projected from, for the next view
      d.select(tool.parent);
      return;
    }
    if (tool?.kind === 'dimension') return dimensionDown(p);
    if (tool?.kind === 'annotate') return annotateDown(p);
    if (tool?.kind === 'surface') {
      const view = viewUnder(p);
      const placed = view && built.placed.get(view.id);
      if (!view || !placed) return d.notifyInfo(t('drawingUi.toolSurfaceFinish'));
      const at = fromSheet(placed, p[0], p[1]);
      d.addSurfaceFinish(view.id, [round2(at[0]), round2(at[1])]);
      return;
    }
    if (tool) {
      if (pendingPlacement) {
        capture(e);
        setDrag({ kind: 'placeDraw', placement: pendingPlacement, from: p, to: p, free: e.ctrlKey || e.metaKey });
        return;
      }
      const view = viewUnder(p);
      if (!view) return d.notifyInfo(t(tool.kind === 'section' ? 'drawingUi.hint.section' : 'drawingUi.hint.detail'));
      if (pendingDraw?.tool === tool.kind) {
        if (view.id !== pendingDraw.view) return;
        const placement = makeDrawPlacement({ ...pendingDraw, to: p });
        setPendingDraw(null);
        if (placement) {
          setPendingPlacement(placement);
          setDrawCursor(p);
        } else setDrawCursor(null);
        return;
      }
      capture(e);
      d.select(view.id);
      setDrag({ kind: 'draw', tool: tool.kind, ...(tool.kind === 'section' ? { vertical: tool.vertical ?? true } : {}), view: view.id, from: p, to: p });
      return;
    }
    // Ctrl (⌘ on a Mac) and a click: what is under the pointer is added to what is chosen, or taken out of it; nothing is dragged
    if (e.ctrlKey || e.metaKey) {
      const under = pickUnder(p);
      if (under) d.pick([under], 'toggle');
      else {
        capture(e);
        setDrag({ kind: 'box', from: p, to: p, add: true });
      }
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
    // an annotation: chosen, and moved as a whole where it is let go
    const ann = dimensionAt(annotationHit, p, reach);
    if (ann) {
      capture(e);
      d.pick([{ kind: 'annotation', id: ann.id }], 'replace');
      setDrag({ kind: 'annotation', id: ann.id, from: p, delta: [0, 0] });
      return;
    }
    // a surface finish: its symbol is taken and put where it is let go
    const finish = finishUnder(p);
    if (finish) {
      capture(e);
      d.selectDimension(null);
      d.selectSurfaceFinish(finish.id);
      setDrag({ kind: 'surface', id: finish.id, from: p, origin: [finish.at[0], finish.at[1]], delta: [0, 0] });
      return;
    }
    // the line of a section on its parent: it is moved across
    const sec = sectionLines.find((s) => segmentDistance(p, s.p0, s.p1) <= reach);
    if (sec) {
      capture(e);
      d.select(sec.id);
      d.selectDimension(null);
      d.selectSurfaceFinish(null);
      setDrag({ kind: 'sectionLine', id: sec.id, line: sec.line, vertical: sec.vertical, scale: sec.scale, from: p, delta: 0 });
      return;
    }
    // a balloon (its circle) or a table (its box): moved by the pointer; the tables are drawn over the views
    for (const [tableId, spots] of built.balloons) {
      const spot = spots.find((s) => Math.hypot(p[0] - s.centre[0], p[1] - s.centre[1]) <= BALLOON_RADIUS + reach);
      if (spot) {
        capture(e);
        d.selectDimension(null);
        d.selectSurfaceFinish(null);
        setDrag({ kind: 'balloon', id: tableId, item: spot.item, from: p, origin: spot.centre, delta: [0, 0] });
        return;
      }
    }
    for (const [tableId, box] of [...built.tableBoxes].reverse()) {
      if (p[0] >= box.x && p[0] <= box.x + box.w && p[1] >= box.y && p[1] <= box.y + box.h) {
        capture(e);
        d.pick([{ kind: 'table', id: tableId }], 'replace');
        setDrag({ kind: 'table', id: tableId, from: p, origin: [box.x, box.y + box.h], delta: [0, 0] });
        return;
      }
    }
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
      // the paper where nothing is: a box is dragged to choose with (the other buttons pan); a click lets go of everything
      setDrag({ kind: 'box', from: p, to: p, add: false });
    }
  };

  /** What a click with Ctrl adds to or takes from the choice: a dimension, a surface finish, a table, a view — in the order they are drawn over each other. */
  const pickUnder = (p: P): { kind: 'view' | 'dimension' | 'finish' | 'table' | 'annotation'; id: Id } | null => {
    const dim = dimensionAt(dimensionItems, p, reach);
    if (dim) return { kind: 'dimension', id: dim.id };
    const ann = dimensionAt(annotationHit, p, reach);
    if (ann) return { kind: 'annotation', id: ann.id };
    const finish = finishUnder(p);
    if (finish) return { kind: 'finish', id: finish.id };
    for (const [tableId, box] of [...built.tableBoxes].reverse()) if (p[0] >= box.x && p[0] <= box.x + box.w && p[1] >= box.y && p[1] <= box.y + box.h) return { kind: 'table', id: tableId };
    const view = viewUnder(p);
    return view ? { kind: 'view', id: view.id } : null;
  };

  /**
   * What a box chooses: the dimensions, the surface finishes and the tables (a window: those wholly inside it; a crossing, dragged to the left: those it touches).
   * Views are not chosen by a box — a box is dragged over a view to reach what is drawn on it, and a view chosen by accident would be deleted with Delete.
   */
  const boxPicks = (from: P, to: P) => {
    const { rect, crossing } = selectionBox(from, to);
    const picks: { kind: 'dimension' | 'finish' | 'table' | 'annotation'; id: Id }[] = dimensionsInBox(dimensionItems, rect, crossing).map((id) => ({ kind: 'dimension', id }));
    for (const id of dimensionsInBox(annotationHit, rect, crossing)) picks.push({ kind: 'annotation', id });
    for (const f of shown.surfaceFinishes) {
      const placed = built.placed.get(f.view);
      if (placed && itemsInBox(surfaceFinishItems([f], placed), rect, crossing)) picks.push({ kind: 'finish', id: f.id });
    }
    for (const [tableId, box] of built.tableBoxes) if (rectInBox(box, rect, crossing)) picks.push({ kind: 'table', id: tableId });
    return picks;
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
    } else if (drag?.kind === 'placeDraw' || drag?.kind === 'box') {
      setDrag({ ...drag, to: p });
    } else if (pendingDraw || pendingPlacement) {
      setDrawCursor(p);
      setHover((h) => ({ p, feature: null, dimension: null, ctrl: e.ctrlKey || e.metaKey, ...(h && h.p === p ? {} : {}) }));
    } else if (drag) {
      setDrag({ ...drag, delta: [p[0] - drag.from[0], p[1] - drag.from[1]] } as Drag);
    } else if (panning) {
      setPan({ ...pan, x: e.clientX - panning.x, y: e.clientY - panning.y });
    } else if (tool || dimensionItems.length > 0) {
      // what is under the pointer: for the tool's preview, and for the cursor
      const feature = tool?.kind === 'dimension' ? featureUnder(p, tool.picks[0]?.view) : null;
      const dimension = tool ? null : (dimensionAt(dimensionItems, p, reach)?.id ?? null);
      setHover((h) => (tool || h?.dimension !== dimension || h?.feature ? { p, feature, dimension, ctrl: e.ctrlKey || e.metaKey } : h));
    }
  };
  /** The scale the dragged view had before: the one of what the drag changes. */
  const shownBefore = (drag: Extract<Drag, { kind: 'scale' }>): Scale | null => ('sheet' in drag.target ? drw.doc.sheet.scale : (drw.doc.views.find((v) => v.id === (drag.target as { view: string }).view)?.scale ?? null));
  const up = (e: React.PointerEvent) => {
    if (!drag && tool?.kind === 'placeView' && tool.dragged) {
      // a view dragged from the palette and let go over the sheet: it is put there
      const p = onSheet(e);
      if (p[0] >= 0 && p[1] >= 0 && p[0] <= sheet.width && p[1] <= sheet.height) d.placeModelView(tool.source, tool.direction, [round2(p[0]), round2(p[1])]);
    }
    if (drag?.kind === 'box') {
      // a press and let go without a drag (a few pixels) is a click on the paper: everything is let go of, unless Ctrl was held
      if (Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]) < reach) {
        if (!drag.add) d.clearSelection();
      } else d.pick(boxPicks(drag.from, drag.to), drag.add ? 'add' : 'replace');
    } else if (drag?.kind === 'placeDraw') {
      placeDraw(drag.placement, drag.to, drag.free);
      setPendingPlacement(null);
      setDrawCursor(null);
    } else if (drag?.kind === 'scale') {
      const was = shownBefore(drag);
      if (was === null || was[0] !== drag.scale[0] || was[1] !== drag.scale[1]) {
        if ('sheet' in drag.target) d.setSheet({ scale: drag.scale });
        else d.setView(drag.target.view, { scale: drag.scale });
      }
    } else if (drag?.kind === 'dimension') {
      if (Object.keys(drag.patch).length > 0) d.setDimension(drag.id, drag.patch);
    } else if (drag?.kind === 'sectionLine') {
      if (Math.abs(drag.delta) > 0.005) d.setView(drag.id, { line: movedLine(drag.line, drag.vertical, round2(drag.delta)) });
    } else if (drag?.kind === 'table') {
      if (Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) d.setTable(drag.id, { at: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])] });
    } else if (drag?.kind === 'balloon') {
      if (Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) {
        const table = drw.doc.tables.find((x) => x.id === drag.id);
        const was = table?.kind === 'bom' ? table.balloonAt : undefined;
        d.setTable(drag.id, { balloonAt: { ...was, [drag.item]: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])] } });
      }
    } else if (drag?.kind === 'draw') {
      if (Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]) < 3) {
        if (drag.tool === 'section') {
          const placement = makeDrawPlacement({ ...drag, to: drag.from });
          if (placement) {
            setPendingPlacement(placement);
            setDrawCursor(drag.from);
          }
        } else {
          setPendingDraw({ ...drag, to: drag.from });
          setDrawCursor(drag.from);
        }
      } else {
        const placement = makeDrawPlacement(drag);
        if (placement) {
          setPendingPlacement(placement);
          setDrawCursor(drag.to);
        }
      }
    } else if (drag?.kind === 'annotation') {
      const a = (drw.doc.annotations ?? []).find((x) => x.id === drag.id);
      const pl = a && basePlaced.get(a.view);
      if (a && pl && Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) {
        const m = movedAnnotation(a, [drag.delta[0] / pl.scale, drag.delta[1] / pl.scale]);
        d.setAnnotation(a.id, m.kind === 'centreLine' ? { from: m.from, to: m.to } : { at: (m as { at: P }).at });
      }
    } else if (drag?.kind === 'surface') {
      if (Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) d.setSurfaceFinish(drag.id, { at: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])] });
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

  /** The middle of the circle or arc of a view nearest the point (its middle or its line within reach), for a centre line or mark (view units). */
  const circleNear = (viewId: Id, pv: P): { centre: P; radius: number } | null => {
    const pl = basePlaced.get(viewId);
    if (!pl) return null;
    const tol = reach / pl.scale;
    let best: { centre: P; radius: number; d: number } | null = null;
    for (const f of drw.features.get(viewId) ?? []) {
      if (f.type !== 'circle') continue;
      const toCentre = Math.hypot(pv[0] - f.centre[0], pv[1] - f.centre[1]);
      const dist = Math.min(toCentre, Math.abs(toCentre - f.radius));
      if (dist <= tol && (!best || dist < best.d)) best = { centre: f.centre, radius: f.radius, d: dist };
    }
    return best && { centre: best.centre, radius: best.radius };
  };

  /** A press with an annotation tool (D-I3): the first click (the feature), or the second (where it goes), or a circle for a centre mark. */
  const annotateDown = (p: P) => {
    if (tool?.kind !== 'annotate') return;
    const hintKey = { note: 'drawingUi.hint.note', datum: 'drawingUi.hint.datum', fcf: 'drawingUi.hint.fcf', centreLine: 'drawingUi.hint.centreLine', centreMark: 'drawingUi.hint.centreMark' } as const;
    const first = tool.first;
    // a feature is most often pointed at on the view's outline, which is the edge of its box: a point just outside it, within reach, is on that view
    const near = (q: P) =>
      viewUnder(q) ??
      [...drw.doc.views].reverse().find((v) => {
        const pl = built.placed.get(v.id);
        return pl && pl.w > 0 && Math.abs(q[0] - pl.at[0]) <= pl.w / 2 + reach && Math.abs(q[1] - pl.at[1]) <= pl.h / 2 + reach;
      });
    // a note may stand on the paper away from every view (a technical requirement): it belongs to the nearest view, and moves with it
    const nearest = (q: P) =>
      [...drw.doc.views]
        .map((v) => ({ v, pl: built.placed.get(v.id) }))
        .filter((x) => x.pl && x.pl.w > 0)
        .map(({ v, pl }) => ({ v, gap: Math.hypot(Math.max(0, Math.abs(q[0] - pl!.at[0]) - pl!.w / 2), Math.max(0, Math.abs(q[1] - pl!.at[1]) - pl!.h / 2)) }))
        .sort((x, y) => x.gap - y.gap)[0]?.v;
    const view = first ? drw.doc.views.find((v) => v.id === first.view) : (near(p) ?? (tool.what === 'note' ? nearest(p) : undefined));
    const pl = view && basePlaced.get(view.id);
    if (!view || !pl) return d.notifyInfo(t(hintKey[tool.what]));
    const raw = fromSheet(pl, p[0], p[1]);
    const pv: P = [round2(raw[0]), round2(raw[1])];
    if (tool.what === 'centreMark') {
      const c = circleNear(view.id, pv);
      if (!c) return d.notifyInfo(t('drawingUi.hint.centreMark'));
      d.addAnnotation({ kind: 'centreMark', view: view.id, at: [round2(c.centre[0]), round2(c.centre[1])], radius: round2(c.radius) });
      return;
    }
    const snapped = (q: P): P => {
      const c = tool.what === 'centreLine' ? circleNear(view.id, q) : null;
      return c ? [round2(c.centre[0]), round2(c.centre[1])] : q;
    };
    if (!first) return d.setTool({ kind: 'annotate', what: tool.what, first: { view: view.id, at: snapped(pv) } });
    const firstSheet = toSheet(pl, first.at[0], first.at[1]);
    const same = Math.hypot(p[0] - firstSheet[0], p[1] - firstSheet[1]) < 1.5 * reach;
    switch (tool.what) {
      case 'centreLine':
        if (same) return;
        d.addAnnotation({ kind: 'centreLine', view: view.id, from: first.at, to: snapped(pv) });
        d.setTool({ kind: 'annotate', what: 'centreLine' });
        return;
      case 'note':
        d.addAnnotation({ kind: 'note', view: view.id, text: t('drawingUi.newNote'), ...(same ? { at: first.at } : { at: pv, leader: first.at }) });
        d.setTool(null);
        // the text is written in the panel
        setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-field="noteText"]')?.select(), 0);
        return;
      case 'fcf':
        d.addAnnotation({ kind: 'fcf', view: view.id, characteristic: 'position', tolerance: 0.05, datums: [], ...(same ? { at: first.at } : { at: pv, leader: first.at }) });
        d.setTool(null);
        return;
      case 'datum': {
        // the square goes where the second click is: its direction and distance from the triangle
        const dx = p[0] - firstSheet[0];
        const dy = p[1] - firstSheet[1];
        const angle = same ? 90 : Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10;
        const length = same ? 6 : round2(Math.max(0, Math.hypot(dx, dy) - DATUM_TRIANGLE - FRAME_HEIGHT / 2));
        d.addAnnotation({ kind: 'datum', view: view.id, at: first.at, label: d.nextDatumLabel(), angle, length });
        d.setTool(null);
        return;
      }
    }
  };

  /** Turn the cut line or detail circle gesture into geometry, then wait for the view placement click. */
  const makeDrawPlacement = (g: Extract<Drag, { kind: 'draw' }>): DrawPlacement | null => {
    const placed = basePlaced.get(g.view);
    const box = drw.lines.get(g.view)?.box;
    if (!placed || !box) return null;
    const at = toView(placed, g.from);
    if (g.tool === 'detail') {
      const radius = Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]) / placed.scale;
      if (radius < 1) {
        d.notifyInfo(t('drawingUi.hint.detail'));
        return null;
      }
      return { tool: 'detail', view: g.view, centre: [round2(at[0]), round2(at[1])], radius: round2(radius) };
    }
    const dx = Math.abs(g.to[0] - g.from[0]);
    const dy = Math.abs(g.to[1] - g.from[1]);
    // a press with no drag is a cut of the kind chosen (vertical unless horizontal was); a drag is along the line it draws
    const horizontal = Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]) >= 3 ? dx > dy : g.vertical === false;
    // the line snaps to the middle of a circle, an edge-on plane or the middle of the view, as SolidWorks infers it
    const snapped = snapCut(drw.features.get(g.view) ?? [], box, horizontal ? at[1] : at[0], !horizontal, reach / placed.scale).coord;
    const pad = 5;
    const line: [P, P] = horizontal ? [[box.min[0] - pad, round2(snapped)], [box.max[0] + pad, round2(snapped)]] : [[round2(snapped), box.min[1] - pad], [round2(snapped), box.max[1] + pad]];
    return { tool: 'section', view: g.view, line };
  };

  /**
   * Place the derived view at the chosen sheet point, as the final click in the SolidWorks workflow. A section goes in line with its parent on the side the
   * pointer is (which sets the way its arrows look), slid along that line to the pointer; with Ctrl it goes where the pointer is. A detail goes where the pointer is.
   */
  const placeDraw = (placement: DrawPlacement, at: P, free: boolean) => {
    if (placement.tool === 'detail') d.addDetail(placement.view, placement.centre, placement.radius, [round2(at[0]), round2(at[1])]);
    else {
      const g = free ? null : sectionGhost(placement, at);
      if (g) d.addSection(placement.view, placement.line, undefined, { flip: g.flip, slide: g.slide, shift: g.shift });
      else d.addSection(placement.view, placement.line, [round2(at[0]), round2(at[1])]);
    }
    d.setTool(null);
  };

  /** A preview at full size seen as a view placed at `at` (sheet mm) at the sheet's scale: for a view from the palette or the isometric off a corner. */
  const ghostAt = (lines: ViewLines | null | undefined, at: P, scale = ratio(drw.doc.sheet.scale)): PlacedView | null => {
    if (!lines?.box) return null;
    const w = (lines.box.max[0] - lines.box.min[0]) * scale;
    const h = (lines.box.max[1] - lines.box.min[1]) * scale;
    return { id: 'ghost', at, scale, w, h, centre: [(lines.box.min[0] + lines.box.max[0]) / 2, (lines.box.min[1] + lines.box.max[1]) / 2] };
  };

  /** What the projection tool would make with the pointer at `p`: a view on a side of the parent, in line and slid to the pointer, or the isometric off a corner. */
  const projectGhost = (p: P): { side: ViewSide; slide: number; shift: [number, number] | null; placed: PlacedView; lines: ViewLines } | { side: 'corner'; placed: PlacedView; lines: ViewLines } | null => {
    if (tool?.kind !== 'project') return null;
    const parent = drw.doc.views.find((v) => v.id === tool.parent);
    const parentPlaced = basePlaced.get(tool.parent);
    const parentAxes = parent && axesOf(drw.doc.views, drw.doc.sheet.projection, parent);
    if (!parent || !parentPlaced || parentPlaced.w <= 0 || !parentAxes) return null;
    const side = sideAt(parentPlaced, p);
    if (side === null) return null;
    if (side === 'corner') {
      const lines = drw.palette?.lines.isometric;
      const placed = ghostAt(lines, p);
      return placed && lines ? { side, placed, lines } : null;
    }
    const lines = d.linesForAxes(projectedAxes(parentAxes, side, drw.doc.sheet.projection));
    if (!lines) return null;
    const g = previewDerived(drw.doc, drw.lines, { id: 'ghost', name: '', kind: 'projected', parent: tool.parent, side }, lines, p);
    return g ? { side, slide: g.slide, shift: g.shift, placed: g.placed, lines } : null;
  };

  /**
   * Where a section would go with the pointer at `p`: in line with its parent on the side the pointer is, its arrows looking the way that side asks (third angle:
   * away from it; first angle: toward it), slid to the pointer.
   */
  const sectionGhost = (placement: Extract<DrawPlacement, { tool: 'section' }>, p: P): { flip: boolean; slide: number; shift: [number, number] | null; placed: PlacedView; lines: ViewLines; label: string } | null => {
    const parent = drw.doc.views.find((v) => v.id === placement.view);
    const parentPlaced = basePlaced.get(placement.view);
    const parentAxes = parent && axesOf(drw.doc.views, drw.doc.sheet.projection, parent);
    if (!parent || !parentPlaced || !parentAxes) return null;
    const vertical = placement.line[0][0] === placement.line[1][0];
    const side: ViewSide = vertical ? (p[0] >= parentPlaced.at[0] ? 'right' : 'left') : p[1] >= parentPlaced.at[1] ? 'up' : 'down';
    const arrow = drw.doc.sheet.projection === 'first' ? side : oppositeSide(side);
    const flip = sectionArrow({ line: placement.line }) !== arrow;
    const lines = d.linesForAxes(sectionAxes(parentAxes, arrow));
    if (!lines) return null;
    const label = d.peekLabel();
    const view: SectionDrawingView = { id: 'ghost', name: '', kind: 'section', parent: placement.view, line: placement.line, label, ...(flip ? { flip: true } : {}) };
    const g = previewDerived(drw.doc, drw.lines, view, lines, p);
    return g ? { flip, slide: g.slide, shift: g.shift, placed: g.placed, lines, label } : null;
  };

  // the frame and the scale handle are on the view chosen last, when a view is what was chosen (a dimension chosen makes its view the panel's, not a chosen view)
  const selected = drw.selected && drw.selection.some((x) => x.kind === 'view' && x.id === drw.selected) ? built.placed.get(drw.selected) : undefined;
  const chosenDims = new Set(drw.selection.filter((x) => x.kind === 'dimension').map((x) => x.id));
  const chosen = chosenDims.size > 0 ? dimensionItems.filter((i) => i.group && chosenDims.has(i.group)) : [];
  // the other views chosen (not the one with the scale handle), and the tables chosen
  const otherViews = drw.selection.flatMap((x) => (x.kind === 'view' && x.id !== drw.selected ? [built.placed.get(x.id)].filter((v) => v && v.w > 0) : [])) as NonNullable<ReturnType<typeof built.placed.get>>[];
  const chosenTables = drw.selection.flatMap((x) => (x.kind === 'table' ? [built.tableBoxes.get(x.id)].filter(Boolean) : [])) as { x: number; y: number; w: number; h: number }[];
  const boxing = drag?.kind === 'box' && Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]) >= reach ? selectionBox(drag.from, drag.to) : null;
  const dimensionHints = ['drawingUi.hint.dimension0', 'drawingUi.hint.dimension1', 'drawingUi.hint.dimension2'] as const;
  const hint =
    pendingPlacement
      ? t(pendingPlacement.tool === 'section' ? 'drawingUi.hint.placeSection' : 'drawingUi.hint.placeDerived')
      : tool?.kind === 'placeView'
      ? t('drawingUi.hint.placeView')
      : tool?.kind === 'project'
      ? t('drawingUi.hint.project')
      : tool?.kind === 'annotate'
      ? t(({ note: 'drawingUi.hint.note', datum: 'drawingUi.hint.datum', fcf: 'drawingUi.hint.fcf', centreLine: 'drawingUi.hint.centreLine', centreMark: 'drawingUi.hint.centreMark' } as const)[tool.what])
      : tool?.kind === 'dimension'
      ? t(dimensionHints[Math.min(2, tool.picks.length)]!)
      : tool?.kind === 'surface'
      ? t('drawingUi.toolSurfaceFinish')
      : tool
      ? t(tool.kind === 'section' ? 'drawingUi.hint.section' : 'drawingUi.hint.detail')
      : drw.doc.views.length === 0
      ? t('drawingUi.mainViewFirst')
      : null;
  const cursor = tool ? 'crosshair' : hover?.dimension || drag?.kind === 'dimension' || drag?.kind === 'surface' || drag?.kind === 'annotation' ? 'move' : undefined;
  // the symbol of the surface finish chosen, drawn over in its own colour so that it can be seen which one it is
  const chosenAnnotations = new Set(drw.selection.filter((x) => x.kind === 'annotation').map((x) => x.id));
  const chosenAnnotationItems = chosenAnnotations.size > 0 ? annotationHit.filter((i) => chosenAnnotations.has(i.group)) : [];
  const annotateFrom = (() => {
    if (tool?.kind !== 'annotate' || !tool.first) return null;
    const pl = basePlaced.get(tool.first.view);
    return pl ? toSheet(pl, tool.first.at[0], tool.first.at[1]) : null;
  })();
  const chosenFinishIds = new Set(drw.selection.filter((x) => x.kind === 'finish').map((x) => x.id));
  const chosenFinishItems = shown.surfaceFinishes.flatMap((f) => {
    const placed = chosenFinishIds.has(f.id) ? built.placed.get(f.view) : undefined;
    return placed ? surfaceFinishItems([f], placed) : [];
  });
  // the geometry of the tool's preview on the sheet
  const drawn = drag?.kind === 'draw' ? drag : pendingDraw ? { ...pendingDraw, to: drawCursor ?? pendingDraw.from } : null;
  const placementCursor = drag?.kind === 'placeDraw' ? drag.to : pendingPlacement ? drawCursor : null;
  const drawnPlaced = drawn ? basePlaced.get(drawn.view) : undefined;
  // the preview of the view a tool would make: a view from the palette, a projected view, a section (D-V)
  const ghost: { placed: PlacedView; lines: ViewLines; label?: string } | null = (() => {
    const at = hover?.p;
    if (!at) return null;
    if (tool?.kind === 'placeView') {
      const lines = drw.palette?.lines[tool.direction];
      const placed = ghostAt(lines, at);
      return placed && lines ? { placed, lines } : null;
    }
    if (tool?.kind === 'project') return projectGhost(at);
    if (tool?.kind === 'section' && (pendingPlacement?.tool === 'section' || (drag?.kind === 'placeDraw' && drag.placement.tool === 'section'))) {
      const placement = (drag?.kind === 'placeDraw' ? drag.placement : pendingPlacement) as Extract<DrawPlacement, { tool: 'section' }>;
      const p = (drag?.kind === 'placeDraw' ? drag.to : drawCursor) ?? at;
      if (hover?.ctrl || (drag?.kind === 'placeDraw' && drag.free)) {
        const parent = drw.doc.views.find((v) => v.id === placement.view);
        const parentAxes = parent && axesOf(drw.doc.views, drw.doc.sheet.projection, parent);
        const vertical = placement.line[0][0] === placement.line[1][0];
        const arrow = sectionArrow({ line: placement.line });
        const lines = parentAxes ? d.linesForAxes(sectionAxes(parentAxes, arrow)) : null;
        const placed = ghostAt(lines, p, basePlaced.get(placement.view)?.scale);
        void vertical;
        return placed && lines ? { placed, lines, label: d.peekLabel() } : null;
      }
      const g = sectionGhost(placement, p);
      return g ? { placed: g.placed, lines: g.lines, label: g.label } : null;
    }
    return null;
  })();
  // before the press of the section tool: the cutting line where it would go over the view under the pointer, snapped
  const cutPreview = (() => {
    if (tool?.kind !== 'section' || drag || pendingDraw || pendingPlacement || !hover) return null;
    const view = viewUnder(hover.p);
    const placed = view && basePlaced.get(view.id);
    const box = view && drw.lines.get(view.id)?.box;
    if (!view || !placed || !box) return null;
    const vertical = tool.vertical ?? true;
    const at = toView(placed, hover.p);
    const snap = snapCut(drw.features.get(view.id) ?? [], box, vertical ? at[0] : at[1], vertical, reach / placed.scale);
    const pad = 5;
    const a = vertical ? toSheet(placed, snap.coord, box.min[1] - pad) : toSheet(placed, box.min[0] - pad, snap.coord);
    const b = vertical ? toSheet(placed, snap.coord, box.max[1] + pad) : toSheet(placed, box.max[0] + pad, snap.coord);
    return { a, b, snapped: snap.snapped };
  })();
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
          {chosenFinishItems.length > 0 && <Highlight items={chosenFinishItems} height={sheet.height} color="#1c7ed6" />}
          {chosenAnnotationItems.length > 0 && <Highlight items={chosenAnnotationItems} height={sheet.height} color="#1c7ed6" />}
          {annotateFrom && (
            <g data-annotate-preview>
              <circle cx={annotateFrom[0]} cy={sheet.height - annotateFrom[1]} r={1} fill="#f08c00" />
              {hover && <line x1={annotateFrom[0]} y1={sheet.height - annotateFrom[1]} x2={hover.p[0]} y2={sheet.height - hover.p[1]} stroke="#f08c00" strokeWidth={0.35} strokeDasharray="2 1" />}
            </g>
          )}
          {otherViews.map((v, k) => (
            <rect key={`v${k}`} data-chosen-view x={v.at[0] - v.w / 2 - 1} y={sheet.height - v.at[1] - v.h / 2 - 1} width={v.w + 2} height={v.h + 2} fill="none" stroke="#1c7ed6" strokeWidth={0.4} strokeDasharray="3 1.5" />
          ))}
          {chosenTables.map((b, k) => (
            <rect key={`t${k}`} data-chosen-table x={b.x - 0.8} y={sheet.height - b.y - b.h - 0.8} width={b.w + 1.6} height={b.h + 1.6} fill="none" stroke="#1c7ed6" strokeWidth={0.6} />
          ))}
          {boxing && (
            <rect
              data-selection-box={boxing.crossing ? 'crossing' : 'window'}
              x={boxing.rect.x0}
              y={sheet.height - boxing.rect.y1}
              width={boxing.rect.x1 - boxing.rect.x0}
              height={boxing.rect.y1 - boxing.rect.y0}
              fill={boxing.crossing ? 'rgba(47,158,68,0.08)' : 'rgba(28,126,214,0.08)'}
              stroke={boxing.crossing ? '#2f9e44' : '#1c7ed6'}
              strokeWidth={0.4}
              strokeDasharray={boxing.crossing ? '2 1' : undefined}
            />
          )}
          {tool?.kind === 'dimension' &&
            [...tool.picks.map((x) => x.feature), ...(hover?.feature && tool.picks.length < 2 ? [hover.feature.feature] : [])].map((f, k) => {
              const view = (tool.picks[0]?.view ?? hover?.feature?.view)!;
              const placed = basePlaced.get(view);
              if (!placed) return null;
              const colour = k < tool.picks.length ? '#1c7ed6' : '#f08c00';
              const box = viewLines.get(view)?.box;
              if (f.type === 'circle' || f.type === 'torus') {
                // a circle is drawn about its own middle, a fillet's arc about `at` (which is `major` off the torus's centre), both of the radius written
                const [fx, fy] = f.type === 'circle' ? f.centre : f.at;
                const c = toSheet(placed, fx, fy);
                return <circle key={k} cx={c[0]} cy={sheet.height - c[1]} r={f.radius * placed.scale} fill="none" stroke={colour} strokeWidth={0.8} />;
              }
              if (f.type === 'vertex') {
                const c = toSheet(placed, f.at[0], f.at[1]);
                return <circle key={k} data-pick="vertex" cx={c[0]} cy={sheet.height - c[1]} r={1.1} fill={colour} stroke="#fff" strokeWidth={0.3} />;
              }
              if (f.type === 'outline') {
                const sa = toSheet(placed, f.from[0], f.from[1]);
                const sb = toSheet(placed, f.to[0], f.to[1]);
                return <line key={k} data-pick="outline" x1={sa[0]} y1={sheet.height - sa[1]} x2={sb[0]} y2={sheet.height - sb[1]} stroke={colour} strokeWidth={1} />;
              }
              if (f.type === 'edge') {
                const sa = toSheet(placed, f.a[0], f.a[1]);
                const sb = toSheet(placed, f.b[0], f.b[1]);
                return <line key={k} data-pick="edge" x1={sa[0]} y1={sheet.height - sa[1]} x2={sb[0]} y2={sheet.height - sb[1]} stroke={colour} strokeWidth={1} />;
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
          {ghost && (
            <g data-ghost opacity={0.75}>
              {ghost.lines.visible.map((l, k) => (
                <polyline key={k} points={Array.from({ length: l.length / 2 }, (_, j) => toSheet(ghost.placed, l[2 * j]!, l[2 * j + 1]!)).map(([x, y]) => `${x},${sheet.height - y}`).join(' ')} fill="none" stroke="#5c7cfa" strokeWidth={0.3} />
              ))}
              <rect x={ghost.placed.at[0] - ghost.placed.w / 2 - 2} y={sheet.height - ghost.placed.at[1] - ghost.placed.h / 2 - 2} width={ghost.placed.w + 4} height={ghost.placed.h + 4} fill="none" stroke="#5c7cfa" strokeWidth={0.3} strokeDasharray="2 1.5" />
              {ghost.label && (
                <text x={ghost.placed.at[0]} y={sheet.height - ghost.placed.at[1] + ghost.placed.h / 2 + 7} fontSize={4} textAnchor="middle" fill="#5c7cfa">
                  {`${ghost.label}–${ghost.label}`}
                </text>
              )}
            </g>
          )}
          {cutPreview && (
            <g data-cut-preview>
              <line x1={cutPreview.a[0]} y1={sheet.height - cutPreview.a[1]} x2={cutPreview.b[0]} y2={sheet.height - cutPreview.b[1]} stroke={cutPreview.snapped ? '#f08c00' : '#1c7ed6'} strokeWidth={0.6} strokeDasharray="6 2 1 2" />
            </g>
          )}
          {placementCursor && <path d={`M ${placementCursor[0] - 2} ${sheet.height - placementCursor[1]} h 4 M ${placementCursor[0]} ${sheet.height - placementCursor[1] - 2} v 4`} fill="none" stroke="#1c7ed6" strokeWidth={0.7} />}
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
      {tool?.kind === 'section' && !pendingPlacement && (
        <div className="heads-up drawing-toolopts" data-section-type style={{ top: 44 }}>
          <button className={tool.vertical !== false ? 'active' : ''} data-action="sectionVertical" onClick={() => d.setTool({ kind: 'section', vertical: true })}>
            {t('drawingUi.sectionVertical')}
          </button>
          <button className={tool.vertical === false ? 'active' : ''} data-action="sectionHorizontal" onClick={() => d.setTool({ kind: 'section', vertical: false })}>
            {t('drawingUi.sectionHorizontal')}
          </button>
        </div>
      )}
      {hint && (
        <div className="drawing-hint" data-hint>
          {hint}
        </div>
      )}
      {!bootMs && <div className="boot-overlay">{t('drawingUi.loadingKernel')}</div>}
    </main>
  );
}
