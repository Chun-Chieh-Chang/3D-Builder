import { t } from '@3db/i18n';
import { DrawingMenu, type DrawingMenuAt } from './DrawingViewMenu';
import { SheetTabs } from './SheetTabs';
import {
  chamferReferenceAt,
  projectionReferenceLines, withProjectedReference, showsHidden,
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
  planOrdinate,
  previewDerived,
  resolveLines,
  attachedAnnotations,
  ratio,
  sideAt,
  cornerAt,
  snapCut,
  dimensionReferenceAt,
  lineAcrossBox,
  alignedTo,
  finishSectionLine,
  firstCutTo,
  stepTo,
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
  type DimensionMode,
  type DimensionDraft,
  type PlacedView,
  type Pickable,
  type SceneItem,
  type ViewLines,
} from '@3db/drawing';
import { sameDrawingRef, axesOf, oppositeSide, page, drawingFromPage, projectedAxes, type Annotation, type Attachment, type AuxiliaryDrawingView, type ClosedOutline, sectionArrow, sectionLookAxes, type Dimension, type DrawingView, type Id, type Scale, type LocalSectionDrawingView, type SectionDrawingView, type SurfaceFinish, type ViewCorner, type ViewSide} from '@3db/model';
import { useEffect, useMemo, useRef, useState } from 'react';
import { store, useStore } from '../state/store';
import type { DrawingPick } from '../state/drawing';

/** Pixels in a millimetre of an SVG drawn at its size (CSS: 96 pixels to the inch). */
const PX = 96 / 25.4;
type P = [number, number];

/** Whether a dimension of this kind is made from two elements as well as one: a diameter, radius and chamfer are of one element, and the next click places them. */
const takesSecond = (mode: DimensionMode | undefined) => mode !== 'radius' && mode !== 'diameter' && mode !== 'chamfer';
/** What the dimension tool says it wants next (ADR 0177): the first element (said for the kind asked for), a second one or the place, the place. */
function dimensionHint(mode: Exclude<DimensionMode, 'smart'> | undefined, picked: number): string {
  if (picked === 0) return t(mode ? `drawingUi.hint.dimMode.${mode}` : 'drawingUi.hint.dimension0');
  return t(picked === 1 && takesSecond(mode) ? 'drawingUi.hint.dimension1' : 'drawingUi.hint.dimension2');
}

/**
 * What the pointer is doing on the sheet. To a view: a move, of the view the others are arranged round, which takes them all with it (`shift`); of a view that is in line with
 * the rest, along that line only, which changes the distance to the others (`slide`); or free (`free`, with Shift held, or a view that has no line), which puts the view where
 * it is let go. A scale: the handle at the corner of the chosen view, which changes the scale the view takes and so that of every view that takes it. To a dimension: its line
 * (how far it is from the view) or its text (along the line) is taken, a circle's leader (the way it points, how long it is), an angle's arc. To the line of a section: it is
 * moved across. A `table`: a table (the parts list, the hole table) is moved by its upper left corner; a `balloon`: the circle of a balloon is moved, its leader stays on the part. A `draw`: the line of a section or the circle of a detail is being drawn on a view, with the tool.
 */
type Drag =
  | { kind: 'caption'; id: string; from: P; origin: P; delta: P }
  | { kind: 'move'; id: string; mode: 'shift' | 'slide' | 'free'; axis: 0 | 1 | null; from: P; origin: P; delta: P }
  | { kind: 'scale'; id: string; target: ReturnType<typeof scaleTarget>; centre: P; r0: number; ratio0: number; scale: Scale }
  | { kind: 'dimension'; id: string; from: P; onText: boolean; handle: DimensionHandle; patch: ReturnType<typeof dragDimension> }
  | { kind: 'sectionLine'; id: string; line: SectionDrawingView['line']; vertical: boolean; scale: number; from: P; delta: number }
  | { kind: 'table'; id: string; from: P; origin: P; delta: P }
  | { kind: 'balloon'; id: string; item: string; from: P; origin: P; delta: P }
  | { kind: 'surface'; id: string; from: P; origin: P; delta: P }
  /** An annotation (D-I3) moved as a whole; its leader's point stays on the feature. `delta` is in sheet mm. */
  | { kind: 'annotation'; id: string; from: P; delta: P }
  | { kind: 'draw'; tool: 'section' | 'sectionLocal' | 'crop' | 'auxiliary' | 'detail'; vertical?: boolean; slant?: boolean; view: Id; from: P; to: P }
  /** The last click of a section or a detail: where its view goes. `free` (Ctrl held): put where the pointer is, not in line with the parent. */
  | { kind: 'placeDraw'; placement: DrawPlacement; from: P; to: P; free: boolean }
  /** A box dragged over the paper from where nothing was (D-I1a): what it holds is chosen; with Ctrl it is added to what was. */
  | { kind: 'box'; from: P; to: P; add: boolean };
type DrawPlacement =
  | { tool: 'section'; view: Id; line: SectionDrawingView['line']; aligned?: boolean }
  | { tool: 'detail'; view: Id; centre: P; radius: number }
  | { tool: 'sectionLocal'; view: Id; outline: LocalSectionDrawingView['outline']; depth: number }
  | { tool: 'crop'; view: Id; outline: ClosedOutline }
  | { tool: 'auxiliary'; view: Id; line: AuxiliaryDrawingView['line'] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An annotation moved by `dv` (view units): where it stands moves, the point its leader touches does not (it is on the feature). */
function movedAnnotation(a: Annotation, dv: P): Annotation {
  const by = (q: P): P => [round2(q[0] + dv[0]), round2(q[1] + dv[1])];
  if (a.kind === 'centreLine') return { ...a, from: by(a.from), to: by(a.to) };
  return { ...a, at: by(a.at) } as Annotation;
}

/** The line of a section as it is when it has been moved by `by` (view units) across itself: all its points (a stepped or aligned line bends, D-I5). */
const movedLine = (line: SectionDrawingView['line'], vertical: boolean, by: number): SectionDrawingView['line'] =>
  line.map(([x, y]) => (vertical ? [x + by, y] : [x, y + by])) as SectionDrawingView['line'];

/**
 * The rectangle a drag drew, in a view's own coordinates (a local section's cutting outline, a cropped view's region, B1/B2.7); null when the drag is too small
 * to be one (2 mm on either side, full size).
 */
function dragRectangle(placed: { at: [number, number]; scale: number; centre: [number, number] }, from: P, to: P): { kind: 'rectangle'; p0: [number, number]; p1: [number, number] } | null {
  const toViewPt = (p: P): [number, number] => [(p[0] - placed.at[0]) / placed.scale + placed.centre[0], (p[1] - placed.at[1]) / placed.scale + placed.centre[1]];
  const a = toViewPt(from);
  const b = toViewPt(to);
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { kind: 'rectangle', p0: [round2(x0), round2(y0)], p1: [round2(x1), round2(y1)] };
}

/** The shape a dimension chosen on the sheet is drawn over in, so that it can be seen which one it is. */
function Highlight({ items, height, color, pixel }: { items: readonly SceneItem[]; height: number; color: string; pixel: number }) {
  return (
    <>
      {items.map((i, k) =>
        i.kind === 'polyline' ? (
          <polyline key={k} points={Array.from({ length: i.points.length / 2 }, (_, j) => `${i.points[2 * j]},${height - i.points[2 * j + 1]!}`).join(' ') + (i.closed ? ` ${i.points[0]},${height - i.points[1]!}` : '')} fill={i.filled ? color : 'none'} stroke={color} strokeWidth={1.5 / pixel} />
        ) : (
          <text key={k} fontFamily="sans-serif" x={i.at[0]} y={height - i.at[1]} fontSize={i.height * 1.4} textAnchor={i.anchor === 'center' ? 'middle' : i.anchor === 'right' ? 'end' : 'start'} fill={color} transform={i.angle ? `rotate(${-i.angle} ${i.at[0]} ${height - i.at[1]})` : undefined}>
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
  /** A stepped or aligned section's line being clicked out (D-I5): the parent view and the points so far, in its view coordinates. */
  const [pathDraw, setPathDraw] = useState<{ view: Id; mode: 'stepped' | 'aligned'; points: P[] } | null>(null);
  const [drawCursor, setDrawCursor] = useState<P | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  /** The right-click menu of a view (D-I7): opened when the right button is let go where it was pressed (a drag with it pans). */
  const [menu, setMenu] = useState<DrawingMenuAt | null>(null);
  const rightFrom = useRef<{ x: number; y: number } | null>(null);
  /** Where the pointer is on the sheet, and what is under it: for the preview of a tool and the cursor. */
  const [hover, setHover] = useState<{ p: P; feature: { view: Id; feature: Pickable } | null; dimension: string | null; ctrl?: boolean } | null>(null);
  const activePageIndex = drw.activePageIndex ?? 0;
  const curPage = page(drw.doc, activePageIndex);
  const pageDoc = useMemo(() => drawingFromPage(curPage, drw.doc.properties), [curPage, drw.doc.properties]);
  const sheet = sheetMetrics(curPage.sheet);
  const tool = drw.tool;
  /** Where the views are before anything is dragged: what the tools read their geometry from. */
  const basePlaced = useMemo(() => layoutViews(pageDoc, drw.lines), [pageDoc, drw.lines]);

  // a detail view's lines are its parent's, cut by its circle: what can be pointed at in it is what is drawn in it (its features and edges are its parent's)
  const viewLines = useMemo(() => resolveLines(pageDoc, drw.lines), [pageDoc, drw.lines]);
  const selectionLines = useMemo(() => new Map(curPage.views.map(v => {
    const own = basePlaced.get(v.id);
    const lines = own ? projectionReferenceLines(viewLines.get(v.id), own) : viewLines.get(v.id);
    if (!lines) return [v.id, lines] as const;
    const shaded = v.display === 'shaded';
    const visible = [...(!shaded ? lines.visible : []), ...(showsHidden(v) ? lines.hidden : []), ...(!shaded && v.showTangentEdges !== false ? lines.tangent ?? [] : []), ...(showsHidden(v) && v.showTangentEdges !== false ? lines.tangentHidden ?? [] : [])];
    return [v.id, { ...lines, visible, hidden: [] as number[][], tangent: [] as number[][], tangentHidden: [] as number[][] }] as const;
  })), [curPage.views, viewLines, basePlaced]);
  const seenByView = useMemo(() => new Map(curPage.views.map((v) => [v.id, visibleElements(selectionLines.get(v.id), drw.edges.get(v.id), drw.features.get(v.id) ?? [])])), [curPage.views, selectionLines, drw.edges, drw.features]);
  /** The dimension the tool would make from what is pointed at and where the pointer is (it is drawn while the pointer moves). */
  const plan = useMemo(() => {
    if (tool?.kind !== 'dimension' || !hover || tool.picks.length === 0) return null;
    const first = tool.picks[0]!;
    const view = curPage.views.find((v) => v.id === first.view);
    const placed = basePlaced.get(first.view);
    const axes = view && axesOf(curPage.views, curPage.sheet.projection, view);
    if (!view || !placed || !axes) return null;
    const picks = tool.picks.map((x) => x.feature);
    // with one element chosen, an element under the pointer is the second one for now (a diameter or a radius has none)
    const second = picks.length === 1 && takesSecond(tool.mode) && hover.feature && hover.feature.view === first.view && !sameDrawingRef(hover.feature.feature.ref, picks[0]!.ref) ? hover.feature.feature : null;
    const result = planDimension(second ? [...picks, second] : picks, hover.p, placed, axes, tool.mode);
    return 'draft' in result ? { view: first.view, ...result } : null;
  }, [tool, hover, curPage, basePlaced]);

  // what is shown: the document, as the drag would leave it (the other views follow while the pointer moves), and the dimension being made
  const shown = useMemo(() => {
    let pg = curPage;
    if (plan) pg = { ...pg, dimensions: [...pg.dimensions, { id: 'preview', view: plan.view, ...plan.draft } as Dimension] };
    if (!drag) return pg;
    if (drag.kind === 'draw') return pg;
    if (drag.kind === 'placeDraw') return pg;
    if (drag.kind === 'box') return pg;
    if (drag.kind === 'caption') return { ...pg, views: pg.views.map(v => v.id === drag.id ? { ...v, caption: { ...v.caption, offset: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as P } } : v) };
    if (drag.kind === 'dimension') return { ...pg, dimensions: pg.dimensions.map((x) => (x.id === drag.id ? ({ ...x, ...drag.patch } as Dimension) : x)) };
    if (drag.kind === 'table') return { ...pg, tables: pg.tables.map((x) => (x.id === drag.id ? { ...x, at: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as P } : x)) };
    if (drag.kind === 'balloon') return { ...pg, tables: pg.tables.map((x) => (x.id === drag.id && x.kind === 'bom' ? { ...x, balloonAt: { ...x.balloonAt, [drag.item]: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as P } } : x)) };
    if (drag.kind === 'sectionLine') return { ...pg, views: pg.views.map((v) => (v.id === drag.id && v.kind === 'section' ? { ...v, line: movedLine(drag.line, drag.vertical, drag.delta) } : v)) as DrawingView[] };
    if (drag.kind === 'annotation') {
      return {
        ...pg,
        annotations: (pg.annotations ?? []).map((a) => {
          const pl = basePlaced.get(a.view);
          return a.id === drag.id && pl ? movedAnnotation(a, [drag.delta[0] / pl.scale, drag.delta[1] / pl.scale]) : a;
        }),
      };
    }
    if (drag.kind === 'surface') return { ...pg, surfaceFinishes: pg.surfaceFinishes.map((f) => (f.id === drag.id ? { ...f, at: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as P } : f)) };
    if (drag.kind === 'scale') {
      const target = drag.target;
      return 'sheet' in target ? { ...pg, sheet: { ...pg.sheet, scale: drag.scale } } : { ...pg, views: pg.views.map((v) => (v.id === target.view ? { ...v, scale: drag.scale } : v)) };
    }
    if (drag.mode === 'shift') {
      const was = pg.sheet.shift ?? [0, 0];
      return { ...pg, sheet: { ...pg.sheet, shift: [was[0] + drag.delta[0], was[1] + drag.delta[1]] as P } };
    }
    if (drag.mode === 'slide') return { ...pg, views: pg.views.map((v) => (v.id === drag.id ? { ...v, slide: (v.slide ?? 0) + drag.delta[drag.axis!] } : v)) };
    return { ...pg, views: pg.views.map((v) => (v.id === drag.id ? { ...v, at: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as P, slide: undefined } : v)) };
  }, [curPage, drag, plan]);
  const elements = useMemo(() => (plan ? new Map(drw.elements).set('preview', { elements: plan.facts }) : drw.elements), [drw.elements, plan]);
  // the annotations fastened to the model, where the model has their elements now (D-I2)
  const attached = useMemo(() => attachedAnnotations(shown.annotations ?? [], new Map(curPage.views.map((v) => [v.id, { seen: seenByView.get(v.id), features: drw.features.get(v.id) ?? [] }]))), [shown, seenByView, curPage.views, drw.features]);
  const shownDoc = useMemo(() => drawingFromPage({ ...shown, annotations: attached.annotations }, drw.doc.properties), [drw.doc.properties, shown, attached]);
  const built = useMemo(() => buildScene(shownDoc, drw.lines, elements, drw.features, drw.boms), [shownDoc, drw.lines, elements, drw.features, drw.boms]);
  const svg = useMemo(() => toSvg(built.scene, { strokeScale: pan.zoom }), [built, pan.zoom]);
  /** The items of the dimensions that are there (not the one being made): what the pointer can take hold of. */
  const captionItems = useMemo(() => built.scene.items.filter(i => i.kind === 'text' && i.viewCaption).map(i => ({ ...i, group: i.kind === 'text' ? i.viewCaption : undefined })), [built]);
  const dimensionItems = useMemo(() => built.scene.items.filter((i) => i.group && i.group !== 'preview'), [built]);
  /** What each annotation draws, marked with its id: what the pointer takes hold of, and what a choice is shown with (D-I3). */
  const annotationHit = useMemo(() => {
    const lookup = (key: string) => (shown.title as Record<string, string | undefined>)[key] ?? drw.doc.properties?.[key];
    return (attached.annotations ?? []).flatMap((a) => {
      const pl = built.placed.get(a.view);
      return pl ? annotationItems([a], pl, lookup, shown.sheet.unit ?? 'mm').map((i) => ({ ...i, group: a.id })) : [];
    });
  }, [shown, attached, built, drw.doc.properties]);
  /** The lines of the sections on the sheet, where they are drawn on their parents (sheet mm). */
  const sectionLines = useMemo(
    () =>
      shown.views.flatMap((v) => {
        if (v.kind !== 'section') return [];
        const parent = built.placed.get(v.parent);
        if (!parent) return [];
        // each segment can be taken hold of (a stepped or aligned line has several, D-I5); the whole line is moved across the first's way
        const vertical = Math.abs(v.line[1][0] - v.line[0][0]) <= Math.abs(v.line[1][1] - v.line[0][1]);
        return v.line.slice(1).map((q, i) => ({ id: v.id, line: v.line, vertical, scale: parent.scale, p0: toSheet(parent, v.line[i]![0], v.line[i]![1]) as P, p1: toSheet(parent, q[0], q[1]) as P }));
      }),
    [shown, built],
  );

  const fit = () => {
    const el = host.current;
    if (!el) return;
    const zoom = Math.min((el.clientWidth - 40) / (sheet.width * PX), (el.clientHeight - 40) / (sheet.height * PX));
    setPan({ zoom, x: (el.clientWidth - sheet.width * PX * zoom) / 2, y: (el.clientHeight - sheet.height * PX * zoom) / 2 });
  };
  useEffect(fit, [drw.fitRequest, curPage.sheet.size, curPage.sheet.orientation, activePageIndex]);

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
      if (e.key === 'Enter' && pathDraw && !drag) {
        // a stepped line is finished when the user says so (an aligned one by its third point)
        e.preventDefault();
        finishPath(pathDraw);
        return;
      }
      if (e.key === 'Escape') {
        if (drag) setDrag(null);
        else if (pathDraw) {
          setPathDraw(null);
          setDrawCursor(null);
        } else if (pendingDraw) {
          setPendingDraw(null);
          setDrawCursor(null);
        }
        else if (pendingPlacement) {
          setPendingPlacement(null);
          setDrawCursor(null);
        }
        else if (tool) {
          if (tool.kind === 'dimension' && tool.picks.length > 0) d.setTool({ kind: 'dimension', picks: [], ...(tool.mode ? { mode: tool.mode } : {}) });
          else if (tool.kind === 'ordinate' && tool.picks.length > 0) d.setTool({ kind: 'ordinate', picks: [] });
          else if (tool.kind === 'baseline') d.setTool(null);
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
  }, [drag, pendingDraw, pendingPlacement, pathDraw, tool, drw.selection, d]);
  useEffect(() => {
    setPendingDraw(null);
    setPendingPlacement(null);
    setPathDraw(null);
    setDrawCursor(null);
  }, [tool?.kind, tool?.kind === 'section' ? tool.path : undefined]);
  // a dimension that is gone (deleted, undone) is not the one chosen
  useEffect(() => {
    if (drw.dimension && !curPage.dimensions.some((x) => x.id === drw.dimension)) d.selectDimension(null);
  }, [curPage.dimensions, drw.dimension, d]);

  /** A pointer position on the sheet, in mm from its lower left corner. */
  const onSheet = (e: { clientX: number; clientY: number }): P => {
    const rect = host.current!.getBoundingClientRect();
    return [(e.clientX - rect.left - pan.x) / (pan.zoom * PX), sheet.height - (e.clientY - rect.top - pan.y) / (pan.zoom * PX)];
  };
  /** How close the pointer has to be to take hold of something (mm on the sheet): the same few pixels whatever the zoom. */
  const reach = 6 / (pan.zoom * PX);

  /** The edges and vertices each view shows, by name (D-I2): worked out once per view from its lines and the worker's projected edges. */
  /** The element of a view under the point (the views in the order they are drawn, the last on top); when `only` is given, in that view only. */
  const featureUnder = (p: P, only?: Id, referencePoints = true): { view: Id; feature: Pickable } | null => {
    for (const v of [...curPage.views].reverse()) {
      if (only && v.id !== only) continue;
      const placed = basePlaced.get(v.id);
      if (!placed || placed.w <= 0) continue;
      const acquire = tool?.kind === 'dimension' && tool.mode === 'chamfer' ? chamferReferenceAt : referencePoints && (tool?.kind === 'dimension' || tool?.kind === 'ordinate') ? dimensionReferenceAt : featureAt;
      const pointSnaps = tool?.kind === 'ordinate' || (tool?.kind === 'dimension' && (!tool.mode || ['smart', 'horizontal', 'vertical', 'aligned'].includes(tool.mode)));
      const q = toView(placed, p), tolerance = reach / placed.scale;
      const native = acquire(selectionLines.get(v.id), drw.features.get(v.id) ?? [], q, tolerance, seenByView.get(v.id), pointSnaps);
      const f = !tool || tool.kind === 'dimension' || tool.kind === 'ordinate' || tool.kind === 'baseline' ? withProjectedReference(native, selectionLines.get(v.id), q, tolerance, referencePoints && pointSnaps) : native;
      if (f) return { view: v.id, feature: f };
    }
    return null;
  };
  /** The view whose box the point is in, the last drawn on top. */
  const viewUnder = (p: P): DrawingView | undefined =>
    [...curPage.views].reverse().find((v) => {
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

  /** Captions are drawn behind dimensions, annotations and tables: their hit order must match the scene. */
  const captionUnder = (p: P): { id: string; text: boolean } | null => {
    const hit = dimensionAt(captionItems, p, reach);
    if (!hit || dimensionAt(dimensionItems, p, reach) || dimensionAt(annotationHit, p, reach) || finishUnder(p)) return null;
    for (const box of built.tableBoxes.values()) if (p[0] >= box.x && p[0] <= box.x + box.w && p[1] >= box.y && p[1] <= box.y + box.h) return null;
    return hit;
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
    const mode = tool.mode;
    const keep = mode ? { mode } : {};
    if (!first) {
      if (hit) {
        if (mode === 'chamfer') {
          const view = curPage.views.find(v => v.id === hit.view);
          const placed = basePlaced.get(hit.view);
          const axes = view && axesOf(curPage.views, curPage.sheet.projection, view);
          if (!placed || !axes) return;
          const result = planDimension([hit.feature], p, placed, axes, mode);
          if ('error' in result) return d.notifyInfo(result.error);
        }
        d.setTool({ kind: 'dimension', picks: [hit], ...keep });
      }
      else d.notifyInfo(dimensionHint(mode, 0));
      return;
    }
    const view = curPage.views.find((v) => v.id === first.view);
    const placed = basePlaced.get(first.view);
    const axes = view && axesOf(curPage.views, curPage.sheet.projection, view);
    if (!view || !placed || !axes) return;
    // a second element pointed at (not the same one): then the place comes
    if (tool.picks.length === 1 && takesSecond(mode) && hit && !sameDrawingRef(hit.feature.ref, first.feature.ref)) {
      d.setTool({ kind: 'dimension', picks: [first, hit], ...keep });
      return;
    }
    const result = planDimension(tool.picks.map((x) => x.feature), p, placed, axes, mode);
    if ('error' in result) return d.notifyInfo(result.error);
    if ('need' in result) return d.notifyInfo(dimensionHint(mode, 1));
    // the tool stays the kind it is, for the next one (as SolidWorks's)
    if (d.addDimension(first.view, result.draft)) d.setTool({ kind: 'dimension', picks: [], ...keep });
  };

  /** A press with the ordinate tool (D-I4): the origin, an element, or (on the paper) where the row goes. */
  const ordinateDown = (p: P) => {
    if (tool?.kind !== 'ordinate') return;
    const first = tool.picks[0];
    const hit = featureUnder(p, first?.view);
    if (hit) {
      if (tool.picks.some((x) => sameDrawingRef(x.feature.ref, hit.feature.ref) && x.view === hit.view)) return;
      d.setTool({ kind: 'ordinate', picks: [...tool.picks, hit] });
      return;
    }
    if (!first) return d.notifyInfo(t('drawingUi.hint.ordinate0'));
    const placed = basePlaced.get(first.view);
    if (!placed) return;
    const plan = planOrdinate(tool.picks.map((x) => x.feature), p, placed);
    if ('error' in plan) return d.notifyInfo(plan.error);
    if ('need' in plan) return d.notifyInfo(t('drawingUi.hint.ordinate1'));
    if (d.addDimension(first.view, plan.draft)) d.setTool({ kind: 'ordinate', picks: [] });
  };

  /** A press with the baseline tool (E5): pick base element, pick 2nd element + sheet point to place initial dim, then subsequent picks auto-step */
  const baselineDown = (p: P) => {
    if (tool?.kind !== 'baseline') return;
    const viewId = tool.view ?? tool.base?.view;
    const hit = featureUnder(p, viewId);

    // 1. If base element is not chosen yet:
    if (!tool.base && !tool.baseRef) {
      if (hit) {
        d.setTool({ kind: 'baseline', view: hit.view, base: hit });
        d.notifyInfo(t('drawingUi.hint.baselineNext'));
      } else {
        d.notifyInfo(t('drawingUi.hint.baseline0'));
      }
      return;
    }

    const curViewId = tool.view ?? tool.base!.view;
    const view = curPage.views.find((v) => v.id === curViewId);
    const placed = curViewId ? basePlaced.get(curViewId) : undefined;
    const axes = view && axesOf(curPage.views, curPage.sheet.projection, view);
    if (!view || !placed || !axes) return;

    // 2. If initial offset not established yet:
    if (tool.lastOffset === undefined) {
      if (!tool.second) {
        if (hit && (!tool.base || !sameDrawingRef(hit.feature.ref, tool.base.feature.ref))) {
          d.setTool({ ...tool, second: hit });
          d.notifyInfo(t('drawingUi.hint.baselinePlace'));
        }
        return;
      }
      const baseFeature = tool.base ? tool.base.feature : hit?.feature;
      if (!baseFeature) return;
      const result = planDimension([baseFeature, tool.second.feature], p, placed, axes, 'smart');
      if ('error' in result) return d.notifyInfo(result.error);
      if ('draft' in result && result.draft.kind === 'linear') {
        const orientation = result.draft.orientation;
        const offset = result.draft.offset;
        if (d.addDimension(view.id, result.draft)) {
          d.setTool({
            kind: 'baseline',
            view: view.id,
            baseRef: result.draft.a,
            base: tool.base,
            lastOffset: offset,
            orientation,
            stepIndex: 1,
          });
          d.notifyInfo(t('drawingUi.hint.baselineContinue'));
        }
      }
      return;
    }

    // 3. Continuous baseline stepping: each subsequent element pick immediately creates a stepped linear dimension!
    if (hit) {
      const baseRef = tool.baseRef ?? tool.base?.feature.ref;
      if (!baseRef || sameDrawingRef(hit.feature.ref, baseRef)) return;
      const stepDist = 8;
      const sign = tool.lastOffset >= 0 ? 1 : -1;
      const nextOffset = tool.lastOffset + sign * stepDist;
      const draft: DimensionDraft = {
        kind: 'linear',
        a: baseRef,
        b: hit.feature.ref,
        orientation: tool.orientation ?? 'horizontal',
        offset: nextOffset,
      };
      if (d.addDimension(view.id, draft)) {
        d.setTool({
          ...tool,
          lastOffset: nextOffset,
          stepIndex: (tool.stepIndex ?? 1) + 1,
        });
      }
    }
  };

  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.heads-up')) return;
    const p = onSheet(e);
    // the handle at the corner of the chosen view: the scale
    if (!tool && (e.target as HTMLElement).closest('[data-scale-handle]') && drw.selected) {
      const view = curPage.views.find((v) => v.id === drw.selected);
      const placed = view && built.placed.get(view.id);
      // a locked view keeps its scale (B2.1): the handle does nothing, and that is said
      if (view?.locked) {
        d.notifyInfo(t('drawing.viewLocked'));
        return;
      }
      if (view && placed) {
        capture(e);
        setDrag({ kind: 'scale', id: view.id, target: scaleTarget(drw.doc, view), centre: [placed.at[0], placed.at[1]], r0: Math.max(1e-6, Math.hypot(p[0] - placed.at[0], p[1] - placed.at[1])), ratio0: placed.scale, scale: scaleFromRatio(placed.scale) });
        return;
      }
    }
    if (e.button !== 0) {
      // the other buttons pan the sheet, as they always did; the right button let go where it was pressed opens the menu of the view under it
      rightFrom.current = e.button === 2 ? { x: e.clientX, y: e.clientY } : null;
      capture(e);
      setPanning({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    // Active tools own their clicks; caption dragging belongs to selection mode.
    const caption = tool ? null : captionUnder(p);
    if (caption) {
      const view = curPage.views.find(v => v.id === caption.id);
      if (view) {
        if (e.ctrlKey || e.metaKey) { d.pick([{ kind: 'view', id: view.id }], 'toggle'); return; }
        d.setTool(null); d.select(view.id); capture(e);
        const offset = view.caption?.offset ?? [0, 0];
        setDrag({ kind: 'caption', id: view.id, from: p, origin: [...offset], delta: [0, 0] });
        return;
      }
    }
    // An idle dimension tool must not swallow a drag of an existing numeric label.
    if (tool?.kind === 'dimension' && tool.picks.length === 0) {
      const hit = dimensionAt(dimensionItems, p, reach);
      const outcome = hit && built.dimensions.get(hit.id);
      if (hit?.text && outcome && !('error' in outcome) && outcome.handle) {
        d.setTool(null);
        d.selectDimension(hit.id);
        capture(e);
        setDrag({ kind: 'dimension', id: hit.id, from: p, onText: curPage.dimensions.find(x => x.id === hit.id)?.kind !== 'ordinate', handle: outcome.handle, patch: {} });
        return;
      }
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
      if (g.side === 'corner') d.placeCorner(tool.parent, g.corner, [round2(g.placed.at[0]), round2(g.placed.at[1])]);
      else d.placeProjected(tool.parent, g.side, g.slide, g.shift);
      // the parent stays the one projected from, for the next view
      d.select(tool.parent);
      return;
    }
    if (tool?.kind === 'dimension') return dimensionDown(p);
    if (tool?.kind === 'ordinate') return ordinateDown(p);
    if (tool?.kind === 'baseline') return baselineDown(p);
    if (tool?.kind === 'annotate') return annotateDown(p);
    if (tool?.kind === 'surface') {
      const view = viewUnder(p);
      const placed = view && built.placed.get(view.id);
      if (!view || !placed) return d.notifyInfo(t('drawingUi.toolSurfaceFinish'));
      const at = fromSheet(placed, p[0], p[1]);
      d.addSurfaceFinish(view.id, [round2(at[0]), round2(at[1])]);
      return;
    }
    if (tool?.kind === 'hideEdge') {
      // an edge pointed at is hidden (B2.2); the tool stays for the next one. A detail view's lines are its parent's: the edge it shows is the parent's
      const hit = featureUnder(p);
      if (!hit || hit.feature.type !== 'edge') return d.notifyInfo(t('drawingUi.hint.hideEdge'));
      const under = curPage.views.find((v) => v.id === hit.view);
      d.hideEdge(under?.kind === 'detail' ? under.parent : hit.view, hit.feature.ref);
      return;
    }
    if (tool) {
      if (pendingPlacement) {
        capture(e);
        setDrag({ kind: 'placeDraw', placement: pendingPlacement, from: p, to: p, free: e.ctrlKey || e.metaKey });
        return;
      }
      // a stepped or aligned line, a click a point (D-I5): the first on a view, the rest anywhere (a step may reach past the view's edge)
      if (tool.kind === 'section' && tool.path) {
        const hint = t(tool.path === 'aligned' ? 'drawingUi.hint.sectionAligned' : 'drawingUi.hint.sectionStepped');
        const id = pathDraw?.view ?? viewUnder(p)?.id;
        const placed = id ? basePlaced.get(id) : undefined;
        if (!id || !placed) return d.notifyInfo(hint);
        const q = toView(placed, p);
        if (!pathDraw) {
          d.select(id);
          setPathDraw({ view: id, mode: tool.path, points: [q] });
          setDrawCursor(p);
          return;
        }
        // a click on the last point again (a double click) finishes a stepped line
        const last = pathDraw.points[pathDraw.points.length - 1]!;
        const lastOnSheet = toSheet(placed, last[0], last[1]);
        if (pathDraw.points.length >= 2 && Math.hypot(lastOnSheet[0] - p[0], lastOnSheet[1] - p[1]) <= reach) return finishPath(pathDraw);
        const next = nextPathPoints(pathDraw, q);
        if (!next) return d.notifyInfo(hint);
        const grown = { ...pathDraw, points: next };
        if (grown.mode === 'aligned' && next.length === 3) return finishPath(grown);
        setPathDraw(grown);
        return;
      }
      const view = viewUnder(p);
      if (!view) return d.notifyInfo(t(tool.kind === 'section' ? 'drawingUi.hint.section' : tool.kind === 'sectionLocal' ? 'drawingUi.hint.localSection' : tool.kind === 'crop' ? 'drawingUi.hint.crop' : tool.kind === 'auxiliary' ? 'drawingUi.hint.auxiliary' : 'drawingUi.hint.detail'));
      // a cropped view crops a local section (B2.7), so a drag anywhere else is not the start of one
      if (tool.kind === 'crop' && view.kind !== 'sectionLocal') return d.notifyInfo(t('drawingUi.hint.cropParent'));
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
      setDrag({ kind: 'draw', tool: tool.kind, ...(tool.kind === 'sectionLocal' ? { depth: tool.depth } : {}), ...(tool.kind === 'section' ? { vertical: tool.vertical ?? true, ...(tool.slant ? { slant: true } : {}) } : {}), view: view.id, from: p, to: p });
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
        setDrag({ kind: 'dimension', id: dim.id, from: p, onText: dim.text && curPage.dimensions.find((x) => x.id === dim.id)?.kind !== 'ordinate', handle: outcome.handle, patch: {} });
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
      // a locked view (B2.1) keeps its place: it is chosen, but not dragged, and that is said
      if (hit.locked) {
        d.notifyInfo(t('drawing.viewLocked'));
        return;
      }
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
    const caption = captionUnder(p);
    if (caption) return { kind: 'view', id: caption.id };
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
      const patch = dragDimension(drag.handle, drag.onText, p);
      const start = dragDimension(drag.handle, drag.onText, drag.from);
      const original = curPage.dimensions.find(dimension => dimension.id === drag.id);
      // Preserve the grab point: extension lines and text need not start on the dimension line itself.
      if (original) {
        if (patch.offset !== undefined && start.offset !== undefined && 'offset' in original) {
          // Extension lines may start inside the view. offsetAt clamps placement
          // there, so use actual pointer displacement for an axis-aligned drag.
          patch.offset = original.kind === 'linear' && original.orientation !== 'aligned'
            ? round2(original.offset + (original.orientation === 'horizontal' ? p[1] - drag.from[1] : p[0] - drag.from[0]))
            : round2(original.offset + patch.offset - start.offset);
        }
        if (patch.slide !== undefined && start.slide !== undefined && (original.kind === 'linear' || original.kind === 'angle')) patch.slide = round2((original.slide ?? 0) + patch.slide - start.slide);
        if (patch.arc !== undefined && start.arc !== undefined && 'arc' in original) patch.arc = round2(original.arc + patch.arc - start.arc);
      }
      setDrag({ ...drag, patch });
    } else if (drag?.kind === 'sectionLine') {
      const by = drag.vertical ? p[0] - drag.from[0] : p[1] - drag.from[1];
      setDrag({ ...drag, delta: by / drag.scale });
    } else if (drag?.kind === 'draw') {
      setDrag({ ...drag, to: p });
    } else if (drag?.kind === 'placeDraw' || drag?.kind === 'box') {
      setDrag({ ...drag, to: p });
    } else if (pendingDraw || pendingPlacement || pathDraw) {
      setDrawCursor(p);
      setHover((h) => ({ p, feature: null, dimension: null, ctrl: e.ctrlKey || e.metaKey, ...(h && h.p === p ? {} : {}) }));
    } else if (drag) {
      setDrag({ ...drag, delta: [p[0] - drag.from[0], p[1] - drag.from[1]] } as Drag);
    } else if (panning) {
      setPan({ ...pan, x: e.clientX - panning.x, y: e.clientY - panning.y });
    } else {
      // what is under the pointer: for the tool's preview, and for the cursor (and hover highlight when no tool)
      const feature = tool?.kind === 'dimension' || tool?.kind === 'ordinate' ? featureUnder(p, tool.picks[0]?.view) : tool?.kind === 'hideEdge' ? featureUnder(p) : !tool ? featureUnder(p) : null;
      const dimension = tool ? null : (dimensionAt(dimensionItems, p, reach)?.id ?? dimensionAt(captionItems, p, reach)?.id ?? null);
      setHover((h) => (tool || h?.dimension !== dimension || h?.feature || feature ? { p, feature, dimension, ctrl: e.ctrlKey || e.metaKey } : h));
    }
  };
  /** The scale the dragged view had before: the one of what the drag changes. */
  const shownBefore = (drag: Extract<Drag, { kind: 'scale' }>): Scale | null => ('sheet' in drag.target ? curPage.sheet.scale : (curPage.views.find((v) => v.id === (drag.target as { view: string }).view)?.scale ?? null));
  const up = (e: React.PointerEvent) => {
    const right = rightFrom.current;
    rightFrom.current = null;
    if (right && e.button === 2 && Math.hypot(e.clientX - right.x, e.clientY - right.y) < 4) {
      // what is under the pointer, as a left click would take it: a dimension, an annotation, a surface finish, a view, else the sheet. It is chosen, unless it
      // already is (then the choice stays, and the menu works on all that is chosen)
      const p = onSheet(e);
      const take = (pick: DrawingPick) => {
        if (!drw.selection.some((x) => x.kind === pick.kind && x.id === pick.id)) d.pick([pick], 'replace');
      };
      // the same order a ctrl-click takes things in: a dimension, an annotation, a surface finish, a table, then a view under them
      // a line of a view on the edge of its box (its outline) is the view's, though the pointer is a hair outside the box (ADR 0177)
      const edgeOf = (): { kind: 'view'; id: Id } | null => {
        const f = featureUnder(p, undefined, false);
        return f ? { kind: 'view', id: f.view } : null;
      };
      const hit = pickUnder(p) ?? edgeOf();
      const at = { x: e.clientX, y: e.clientY };
      if (hit?.kind === 'dimension') {
        take({ kind: 'dimension', id: hit.id });
        setMenu({ ...at, kind: 'dimension', id: hit.id });
      } else if (hit?.kind === 'annotation') {
        take({ kind: 'annotation', id: hit.id });
        setMenu({ ...at, kind: 'annotation', id: hit.id });
      } else if (hit?.kind === 'finish') {
        take({ kind: 'finish', id: hit.id });
        setMenu({ ...at, kind: 'finish', id: hit.id });
      } else if (hit?.kind === 'table') {
        // a table's own menu (B2.6): the parts list and the hole table are drawn over the views, so they are taken before them, as SolidWorks does
        take({ kind: 'table', id: hit.id });
        setMenu({ ...at, kind: 'table', id: hit.id });
      } else if (hit?.kind === 'view') {
        take({ kind: 'view', id: hit.id });
        const f = featureUnder(p, hit.id, false);
        const leaf = (f?.feature.ref as { in?: string } | undefined)?.in ?? null;
        setMenu({ ...at, kind: 'view', view: hit.id, leaf, element: f?.feature ?? null });
      } else setMenu({ ...at, kind: 'sheet' });
    }
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
    } else if (drag?.kind === 'caption') {
      if (Math.hypot(...drag.delta) > 0.05) {
        const view = curPage.views.find(v => v.id === drag.id)!;
        d.setView(drag.id, { caption: { ...view.caption, offset: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])] } });
      }
    } else if (drag?.kind === 'sectionLine') {
      if (Math.abs(drag.delta) > 0.005) d.setView(drag.id, { line: movedLine(drag.line, drag.vertical, round2(drag.delta)) });
    } else if (drag?.kind === 'table') {
      if (Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) d.setTable(drag.id, { at: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])] });
    } else if (drag?.kind === 'balloon') {
      if (Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) {
        const table = curPage.tables.find((x) => x.id === drag.id);
        const was = table?.kind === 'bom' ? table.balloonAt : undefined;
        d.setTable(drag.id, { balloonAt: { ...was, [drag.item]: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])] } });
      }
    } else if (drag?.kind === 'draw') {
      if (Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]) < 3) {
        // a press with no drag: a vertical or horizontal cut is made there; a slanted one (like a detail's circle) waits for the second click, its direction
        if (drag.tool === 'section' && !drag.slant) {
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
      const a = (curPage.annotations ?? []).find((x) => x.id === drag.id);
      const pl = a && basePlaced.get(a.view);
      if (a && pl && Math.hypot(drag.delta[0], drag.delta[1]) > 0.05 && a.kind === 'datum' && a.attach) {
        // fastened to the model, the triangle stays where the edge is: the square goes where it is let go (its direction and its distance)
        const shownA = attached.annotations.find((x) => x.id === a.id) as typeof a;
        const foot = toSheet(pl, shownA.at[0], shownA.at[1]);
        const th = ((a.angle ?? 90) * Math.PI) / 180;
        const reachNow = DATUM_TRIANGLE + (a.length ?? 6) + FRAME_HEIGHT / 2;
        const box: P = [foot[0] + Math.cos(th) * reachNow + drag.delta[0], foot[1] + Math.sin(th) * reachNow + drag.delta[1]];
        const dx = box[0] - foot[0];
        const dy = box[1] - foot[1];
        d.setAnnotation(a.id, { angle: Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10, length: round2(Math.max(0, Math.hypot(dx, dy) - DATUM_TRIANGLE - FRAME_HEIGHT / 2)) });
      } else if (a && pl && Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) {
        const m = movedAnnotation(a, [drag.delta[0] / pl.scale, drag.delta[1] / pl.scale]);
        d.setAnnotation(a.id, m.kind === 'centreLine' ? { from: m.from, to: m.to } : { at: (m as { at: P }).at });
      }
    } else if (drag?.kind === 'surface') {
      if (Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) d.setSurfaceFinish(drag.id, { at: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])] });
    } else if (drag && Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) {
      // Drop target on sheet tab for cross-sheet move (Q5 Option A)
      const tabEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sheet-tab-index]') as HTMLElement | null;
      const targetIdx = tabEl ? Number(tabEl.getAttribute('data-sheet-tab-index')) : null;
      if (drag.kind === 'move' && targetIdx !== null && !isNaN(targetIdx) && targetIdx !== activePageIndex) {
        d.moveViewToPage(drag.id, targetIdx);
        d.setActivePage(targetIdx);
      } else {
        const view = curPage.views.find((v) => v.id === drag.id);
        if (drag.mode === 'shift') {
          const was = curPage.sheet.shift ?? [0, 0];
          d.setSheet({ shift: [round2(was[0] + drag.delta[0]), round2(was[1] + drag.delta[1])] });
        } else if (drag.mode === 'slide') d.setView(drag.id, { slide: round2((view?.slide ?? 0) + drag.delta[drag.axis!]) });
        else d.setView(drag.id, { at: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])], slide: null });
      }
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
      [...curPage.views].reverse().find((v) => {
        const pl = built.placed.get(v.id);
        return pl && pl.w > 0 && Math.abs(q[0] - pl.at[0]) <= pl.w / 2 + reach && Math.abs(q[1] - pl.at[1]) <= pl.h / 2 + reach;
      });
    // a note may stand on the paper away from every view (a technical requirement): it belongs to the nearest view, and moves with it
    const nearest = (q: P) =>
      [...curPage.views]
        .map((v) => ({ v, pl: built.placed.get(v.id) }))
        .filter((x) => x.pl && x.pl.w > 0)
        .map(({ v, pl }) => ({ v, gap: Math.hypot(Math.max(0, Math.abs(q[0] - pl!.at[0]) - pl!.w / 2), Math.max(0, Math.abs(q[1] - pl!.at[1]) - pl!.h / 2)) }))
        .sort((x, y) => x.gap - y.gap)[0]?.v;
    const view = first ? curPage.views.find((v) => v.id === first.view) : (near(p) ?? (tool.what === 'note' ? nearest(p) : undefined));
    const pl = view && basePlaced.get(view.id);
    if (!view || !pl) return d.notifyInfo(t(hintKey[tool.what]));
    const raw = fromSheet(pl, p[0], p[1]);
    const pv: P = [round2(raw[0]), round2(raw[1])];
    if (tool.what === 'centreMark') {
      const c = circleNear(view.id, pv);
      if (!c) return d.notifyInfo(t('drawingUi.hint.centreMark'));
      const ring = (drw.features.get(view.id) ?? []).find((x) => x.type === 'circle' && Math.hypot(x.centre[0] - c.centre[0], x.centre[1] - c.centre[1]) < 1e-6 && Math.abs(x.radius - c.radius) < 1e-6);
      d.addAnnotation({ kind: 'centreMark', view: view.id, at: [round2(c.centre[0]), round2(c.centre[1])], radius: round2(c.radius), ...(ring ? { attach: { ref: ring.ref, u: 0 } } : {}) });
      return;
    }
    const snapped = (q: P): P => {
      const c = tool.what === 'centreLine' ? circleNear(view.id, q) : null;
      return c ? [round2(c.centre[0]), round2(c.centre[1])] : q;
    };
    if (!first) return d.setTool({ kind: 'annotate', what: tool.what, first: { view: view.id, at: snapped(pv) } });
    // what the first click is on, fastened to (D-I2): a vertex, else a straight edge at its place along it, else a circle — so the annotation follows the model
    const attachAt = (q: P): Attachment | undefined => {
      const seen = seenByView.get(view.id);
      const tol = reach / pl.scale;
      const v = seen?.vertices.filter((x) => Math.hypot(x.at[0] - q[0], x.at[1] - q[1]) <= tol).sort((x, y) => Math.hypot(x.at[0] - q[0], x.at[1] - q[1]) - Math.hypot(y.at[0] - q[0], y.at[1] - q[1]))[0];
      if (v) return { ref: v.ref, u: 0 };
      let best: { e: NonNullable<typeof seen>['edges'][number]; d: number; u: number } | null = null;
      for (const e of seen?.edges ?? []) {
        const dx = e.b[0] - e.a[0];
        const dy = e.b[1] - e.a[1];
        const l2 = dx * dx + dy * dy;
        const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - e.a[0]) * dx + (q[1] - e.a[1]) * dy) / l2));
        const dd = Math.hypot(q[0] - e.a[0] - u * dx, q[1] - e.a[1] - u * dy);
        if (dd <= tol && (!best || dd < best.d)) best = { e, d: dd, u };
      }
      if (best) return { ref: best.e.ref, u: Math.round(best.u * 1e4) / 1e4 };
      const c = circleNear(view.id, q);
      const f = c && (drw.features.get(view.id) ?? []).find((x) => x.type === 'circle' && Math.hypot(x.centre[0] - c.centre[0], x.centre[1] - c.centre[1]) < 1e-6 && Math.abs(x.radius - c.radius) < 1e-6);
      return f ? { ref: f.ref, u: 0 } : undefined;
    };
    const firstAttach = attachAt(first.at);
    const firstSheet = toSheet(pl, first.at[0], first.at[1]);
    const same = Math.hypot(p[0] - firstSheet[0], p[1] - firstSheet[1]) < 1.5 * reach;
    switch (tool.what) {
      case 'centreLine':
        if (same) return;
        d.addAnnotation({ kind: 'centreLine', view: view.id, from: first.at, to: snapped(pv) });
        d.setTool({ kind: 'annotate', what: 'centreLine' });
        return;
      case 'note':
        d.addAnnotation({ kind: 'note', view: view.id, text: t('drawingUi.newNote'), ...(same ? { at: first.at } : { at: pv, leader: first.at, ...(firstAttach ? { attach: firstAttach } : {}) }) });
        d.setTool(null);
        // the text is written in the panel
        setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-field="noteText"]')?.select(), 0);
        return;
      case 'fcf':
        d.addAnnotation({ kind: 'fcf', view: view.id, characteristic: 'position', tolerance: 0.05, datums: [], ...(same ? { at: first.at } : { at: pv, leader: first.at, ...(firstAttach ? { attach: firstAttach } : {}) }) });
        d.setTool(null);
        return;
      case 'datum': {
        // the square goes where the second click is: its direction and distance from the triangle
        const dx = p[0] - firstSheet[0];
        const dy = p[1] - firstSheet[1];
        const angle = same ? 90 : Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10;
        const length = same ? 6 : round2(Math.max(0, Math.hypot(dx, dy) - DATUM_TRIANGLE - FRAME_HEIGHT / 2));
        d.addAnnotation({ kind: 'datum', view: view.id, at: first.at, label: d.nextDatumLabel(), angle, length, ...(firstAttach ? { attach: firstAttach } : {}) });
        d.setTool(null);
        return;
      }
    }
  };

  /** The points of a stepped or aligned line with one more click at `q` (view coordinates): null when that click makes no line (D-I5). */
  const nextPathPoints = (pd: { mode: 'stepped' | 'aligned'; points: P[] }, q: P): P[] | null => {
    if (pd.points.length === 1) {
      const end = firstCutTo(pd.points[0]!, q);
      return end ? [pd.points[0]!, end] : null;
    }
    return pd.mode === 'aligned' ? alignedTo(pd.points, q) : stepTo(pd.points, q);
  };

  /** A stepped or aligned line clicked out (D-I5): carried across its view, then the section waits to be placed, as a straight one does. */
  const finishPath = (pd: { view: Id; mode: 'stepped' | 'aligned'; points: P[] }) => {
    const box = drw.lines.get(pd.view)?.box;
    const enough = pd.mode === 'aligned' ? pd.points.length === 3 : pd.points.length >= 2;
    if (!box || !enough) return d.notifyInfo(t(pd.mode === 'aligned' ? 'drawingUi.hint.sectionAligned' : 'drawingUi.hint.sectionStepped'));
    const line = finishSectionLine(pd.points, box, 5) as SectionDrawingView['line'];
    setPathDraw(null);
    setPendingPlacement({ tool: 'section', view: pd.view, line, ...(pd.mode === 'aligned' ? { aligned: true } : {}) });
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
    if (g.tool === 'sectionLocal') {
      const rectangle = dragRectangle(placed, g.from, g.to);
      if (!rectangle) {
        d.notifyInfo(t('drawingUi.hint.localSectionDrag'));
        return null;
      }
      return { tool: 'sectionLocal', view: g.view, outline: rectangle, depth: drw.tool?.kind === 'sectionLocal' ? drw.tool.depth : 5 };
    }
    if (g.tool === 'crop') {
      // only a local section can be cropped (B2.7): the region a partial section cuts out is what is set apart
      if (curPage.views.find((v) => v.id === g.view)?.kind !== 'sectionLocal') {
        d.notifyInfo(t('drawingUi.hint.cropParent'));
        return null;
      }
      const rectangle = dragRectangle(placed, g.from, g.to);
      if (!rectangle) {
        d.notifyInfo(t('drawingUi.hint.crop'));
        return null;
      }
      return { tool: 'crop', view: g.view, outline: rectangle };
    }
    if (g.tool === 'auxiliary') {
      // the fold line (B2.7): the line dragged, carried across the whole view as a slanted cut is; the view is turned about it and looks square to it
      const line = lineAcrossBox(at, toView(placed, g.to), box, 5);
      if (!line) {
        d.notifyInfo(t('drawingUi.hint.auxiliary'));
        return null;
      }
      return { tool: 'auxiliary', view: g.view, line: [[round2(line[0][0]), round2(line[0][1])], [round2(line[1][0]), round2(line[1][1])]] };
    }
    if (g.slant) {
      // a slanted cut (D-I5): through the first point, along the drag (or toward the second click), across the whole view
      const line = lineAcrossBox(at, toView(placed, g.to), box, 5);
      if (!line) {
        d.notifyInfo(t('drawingUi.hint.sectionSlant'));
        return null;
      }
      return { tool: 'section', view: g.view, line: [[round2(line[0][0]), round2(line[0][1])], [round2(line[1][0]), round2(line[1][1])]] };
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
    switch (placement.tool) {
      case 'detail':
        d.addDetail(placement.view, placement.centre, placement.radius, [round2(at[0]), round2(at[1])]);
        break;
      case 'sectionLocal':
        d.addLocalSection(placement.view, placement.outline, placement.depth, [round2(at[0]), round2(at[1])]);
        break;
      case 'crop':
        d.addCrop(placement.view, placement.outline, [round2(at[0]), round2(at[1])]);
        break;
      case 'section': {
        const g = free ? null : sectionGhost(placement, at);
        const aligned = placement.aligned ? { aligned: true } : {};
        if (g) d.addSection(placement.view, placement.line, undefined, { flip: g.flip, slide: g.slide, shift: g.shift, ...aligned });
        else d.addSection(placement.view, placement.line, [round2(at[0]), round2(at[1])], aligned);
        break;
      }
      case 'auxiliary': {
        // an auxiliary view goes on the fold line's side as a section does; with Ctrl, where the pointer is
        const g = free ? null : auxiliaryGhost(placement, at);
        if (g) d.addAuxiliary(placement.view, placement.line, undefined, { flip: g.flip, slide: g.slide, shift: g.shift });
        else d.addAuxiliary(placement.view, placement.line, [round2(at[0]), round2(at[1])]);
        break;
      }
    }
    d.setTool(null);
  };

  /** A preview at full size seen as a view placed at `at` (sheet mm) at the sheet's scale: for a view from the palette or the isometric off a corner. */
  const ghostAt = (lines: ViewLines | null | undefined, at: P, scale = ratio(curPage.sheet.scale)): PlacedView | null => {
    if (!lines?.box) return null;
    const w = (lines.box.max[0] - lines.box.min[0]) * scale;
    const h = (lines.box.max[1] - lines.box.min[1]) * scale;
    return { id: 'ghost', at, scale, w, h, centre: [(lines.box.min[0] + lines.box.max[0]) / 2, (lines.box.min[1] + lines.box.max[1]) / 2] };
  };

  /** What the projection tool would make with the pointer at `p`: a view on a side of the parent, in line and slid to the pointer, or the isometric off a corner. */
  const projectGhost = (p: P): { side: ViewSide; slide: number; shift: [number, number] | null; placed: PlacedView; lines: ViewLines } | { side: 'corner'; corner: ViewCorner; placed: PlacedView; lines: ViewLines } | null => {
    if (tool?.kind !== 'project') return null;
    const parent = curPage.views.find((v) => v.id === tool.parent);
    const parentPlaced = basePlaced.get(tool.parent);
    const parentAxes = parent && axesOf(curPage.views, curPage.sheet.projection, parent);
    if (!parent || !parentPlaced || parentPlaced.w <= 0 || !parentAxes) return null;
    const side = sideAt(parentPlaced, p);
    if (side === null) return null;
    if (side === 'corner') {
      // the isometric from the corner the pointer is off, as the parent sees the part (ADR 0146): not one fixed isometric whatever the corner and the parent
      const corner = cornerAt(parentPlaced, p);
      const lines = d.linesForAxes(projectedAxes(parentAxes, corner, curPage.sheet.projection));
      const placed = ghostAt(lines, p, parentPlaced.scale);
      return placed && lines ? { side, corner, placed, lines } : null;
    }
    const lines = d.linesForAxes(projectedAxes(parentAxes, side, curPage.sheet.projection));
    if (!lines) return null;
    const g = previewDerived(pageDoc, drw.lines, { id: 'ghost', name: '', kind: 'projected', parent: tool.parent, side }, lines, p);
    return g ? { side, slide: g.slide, shift: g.shift, placed: g.placed, lines } : null;
  };

  /**
   * Where a view cut or turned about a line would go with the pointer at `p`: in line with its parent on the side the pointer is, its arrows looking the way that
   * side asks (third angle: away from it; first angle: toward it), slid to the pointer. A section's line is where it cuts the part; an auxiliary view's fold line
   * (B2.7) is what it is turned about — both look along the line's arrows, so both are placed the same way.
   */
  const lineGhost = (placement: Extract<DrawPlacement, { tool: 'section' | 'auxiliary' }>, p: P): { flip: boolean; slide: number; shift: [number, number] | null; placed: PlacedView; lines: ViewLines; label: string } | null => {
    const parent = curPage.views.find((v) => v.id === placement.view);
    const parentPlaced = basePlaced.get(placement.view);
    const parentAxes = parent && axesOf(curPage.views, curPage.sheet.projection, parent);
    if (!parent || !parentPlaced || !parentAxes) return null;
    // a line nearer vertical has its arrows nearer horizontal, so the view goes left or right of the parent (a slanted line too, D-I5)
    const [[x0, y0], [x1, y1]] = placement.line;
    const vertical = Math.abs(x1 - x0) <= Math.abs(y1 - y0);
    const side: ViewSide = vertical ? (p[0] >= parentPlaced.at[0] ? 'right' : 'left') : p[1] >= parentPlaced.at[1] ? 'up' : 'down';
    const arrow = curPage.sheet.projection === 'first' ? side : oppositeSide(side);
    const flip = sectionArrow({ line: placement.line }) !== arrow;
    const lines = d.linesForAxes(sectionLookAxes(parentAxes, { line: placement.line, ...(flip ? { flip } : {}) }));
    if (!lines) return null;
    const label = d.peekLabel();
    const view = placement.tool === 'section'
      ? { id: 'ghost', name: '', kind: 'section' as const, parent: placement.view, line: placement.line, label, ...(flip ? { flip: true } : {}) }
      : { id: 'ghost', name: '', kind: 'auxiliary' as const, parent: placement.view, line: placement.line, label, ...(flip ? { flip: true } : {}) };
    const g = previewDerived(drw.doc, drw.lines, view, lines, p);
    return g ? { flip, slide: g.slide, shift: g.shift, placed: g.placed, lines, label } : null;
  };
  const sectionGhost = (placement: Extract<DrawPlacement, { tool: 'section' }>, p: P) => lineGhost(placement, p);
  const auxiliaryGhost = (placement: Extract<DrawPlacement, { tool: 'auxiliary' }>, p: P) => lineGhost(placement, p);

  // the frame and the scale handle are on the view chosen last, when a view is what was chosen (a dimension chosen makes its view the panel's, not a chosen view)
  const selected = drw.selected && drw.selection.some((x) => x.kind === 'view' && x.id === drw.selected) ? built.placed.get(drw.selected) : undefined;
  const chosenDims = new Set(drw.selection.filter((x) => x.kind === 'dimension').map((x) => x.id));
  const chosen = chosenDims.size > 0 ? dimensionItems.filter((i) => i.group && chosenDims.has(i.group)) : [];
  // the other views chosen (not the one with the scale handle), and the tables chosen
  const otherViews = drw.selection.flatMap((x) => (x.kind === 'view' && x.id !== drw.selected ? [built.placed.get(x.id)].filter((v) => v && v.w > 0) : [])) as NonNullable<ReturnType<typeof built.placed.get>>[];
  const chosenTables = drw.selection.flatMap((x) => (x.kind === 'table' ? [built.tableBoxes.get(x.id)].filter(Boolean) : [])) as { x: number; y: number; w: number; h: number }[];
  const boxing = drag?.kind === 'box' && Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]) >= reach ? selectionBox(drag.from, drag.to) : null;
  const hint =
    pendingPlacement
      ? t(pendingPlacement.tool === 'section' ? 'drawingUi.hint.placeSection' : pendingPlacement.tool === 'sectionLocal' ? 'drawingUi.hint.placeLocalSection' : pendingPlacement.tool === 'crop' ? 'drawingUi.hint.placeCrop' : pendingPlacement.tool === 'auxiliary' ? 'drawingUi.hint.placeAuxiliary' : 'drawingUi.hint.placeDerived')
      : tool?.kind === 'placeView'
      ? t('drawingUi.hint.placeView')
      : tool?.kind === 'project'
      ? t('drawingUi.hint.project')
      : tool?.kind === 'ordinate'
      ? t(tool.picks.length === 0 ? 'drawingUi.hint.ordinate0' : 'drawingUi.hint.ordinate1')
      : tool?.kind === 'annotate'
      ? t(({ note: 'drawingUi.hint.note', datum: 'drawingUi.hint.datum', fcf: 'drawingUi.hint.fcf', centreLine: 'drawingUi.hint.centreLine', centreMark: 'drawingUi.hint.centreMark' } as const)[tool.what])
      : tool?.kind === 'dimension'
      ? dimensionHint(tool.mode, tool.picks.length)
      : tool?.kind === 'surface'
      ? t('drawingUi.toolSurfaceFinish')
      : tool?.kind === 'hideEdge'
      ? t('drawingUi.hint.hideEdge')
      : tool
      ? t(tool.kind === 'section' ? (tool.path === 'stepped' ? 'drawingUi.hint.sectionStepped' : tool.path === 'aligned' ? 'drawingUi.hint.sectionAligned' : tool.slant ? 'drawingUi.hint.sectionSlant' : 'drawingUi.hint.section') : tool.kind === 'sectionLocal' ? 'drawingUi.hint.localSection' : tool.kind === 'crop' ? 'drawingUi.hint.crop' : tool.kind === 'auxiliary' ? 'drawingUi.hint.auxiliary' : 'drawingUi.hint.detail')
      : curPage.views.length === 0
      ? t('drawingUi.mainViewFirst')
      : null;
  const cursor = tool ? 'crosshair' : hover?.dimension || drag?.kind === 'dimension' || drag?.kind === 'surface' || drag?.kind === 'annotation' || drag?.kind === 'caption' ? 'move' : undefined;
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
    const drawnBy = drag?.kind === 'placeDraw' ? drag.placement : pendingPlacement;
    if ((tool?.kind === 'section' || tool?.kind === 'auxiliary') && drawnBy && (drawnBy.tool === 'section' || drawnBy.tool === 'auxiliary') && drawnBy.tool === tool.kind) {
      const placement = drawnBy;
      const p = (drag?.kind === 'placeDraw' ? drag.to : drawCursor) ?? at;
      if (hover?.ctrl || (drag?.kind === 'placeDraw' && drag.free)) {
        const parent = curPage.views.find((v) => v.id === placement.view);
        const parentAxes = parent && axesOf(curPage.views, curPage.sheet.projection, parent);
        const lines = parentAxes ? d.linesForAxes(sectionLookAxes(parentAxes, { line: placement.line })) : null;
        const placed = ghostAt(lines, p, basePlaced.get(placement.view)?.scale);
        return placed && lines ? { placed, lines, label: d.peekLabel() } : null;
      }
      const g = lineGhost(placement, p);
      return g ? { placed: g.placed, lines: g.lines, label: g.label } : null;
    }
    return null;
  })();
  // before the press of the section tool: the cutting line where it would go over the view under the pointer, snapped
  const cutPreview = (() => {
    // a slanted line has no direction before the press: nothing to preview yet
    if (tool?.kind !== 'section' || tool.slant || tool.path || drag || pendingDraw || pendingPlacement || !hover) return null;
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
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        const caption = captionUnder(onSheet(e));
        if (caption) {
          d.setTool(null); d.select(caption.id);
          setTimeout(() => document.querySelector<HTMLElement>('[data-field="viewCaptionText"]')?.focus(), 0);
          return;
        }
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
          {chosen.length > 0 && <Highlight pixel={pan.zoom * PX} items={chosen} height={sheet.height} color="var(--accent)" />}
          {chosenFinishItems.length > 0 && <Highlight pixel={pan.zoom * PX} items={chosenFinishItems} height={sheet.height} color="var(--accent)" />}
          {chosenAnnotationItems.length > 0 && <Highlight pixel={pan.zoom * PX} items={chosenAnnotationItems} height={sheet.height} color="var(--accent)" />}
          {annotateFrom && (
            <g data-annotate-preview>
              <circle cx={annotateFrom[0]} cy={sheet.height - annotateFrom[1]} r={1} fill="var(--warn)" />
              {hover && <line x1={annotateFrom[0]} y1={sheet.height - annotateFrom[1]} x2={hover.p[0]} y2={sheet.height - hover.p[1]} stroke="var(--warn)" strokeWidth={0.35} strokeDasharray="2 1" />}
            </g>
          )}
          {otherViews.map((v, k) => (
            <rect key={`v${k}`} data-chosen-view x={v.at[0] - v.w / 2 - 1} y={sheet.height - v.at[1] - v.h / 2 - 1} width={v.w + 2} height={v.h + 2} fill="none" stroke="var(--accent)" strokeWidth={0.4} strokeDasharray="3 1.5" />
          ))}
          {chosenTables.map((b, k) => (
            <rect key={`t${k}`} data-chosen-table x={b.x - 0.8} y={sheet.height - b.y - b.h - 0.8} width={b.w + 1.6} height={b.h + 1.6} fill="none" stroke="var(--accent)" strokeWidth={0.6} />
          ))}
          {boxing && (
            <rect
              data-selection-box={boxing.crossing ? 'crossing' : 'window'}
              x={boxing.rect.x0}
              y={sheet.height - boxing.rect.y1}
              width={boxing.rect.x1 - boxing.rect.x0}
              height={boxing.rect.y1 - boxing.rect.y0}
              fill={boxing.crossing ? 'color-mix(in oklab, var(--ok) 8%, transparent)' : 'color-mix(in oklab, var(--accent) 8%, transparent)'}
              stroke={boxing.crossing ? 'var(--ok)' : 'var(--accent)'}
              strokeWidth={0.4}
              strokeDasharray={boxing.crossing ? '2 1' : undefined}
            />
          )}
          {(tool?.kind === 'dimension' || tool?.kind === 'ordinate') && hover?.feature && (() => {
            const f = hover.feature.feature;
            const placed = basePlaced.get(hover.feature.view);
            if (!placed || (f.type !== 'vertex' && f.type !== 'circle')) return null;
            const q = f.type === 'vertex' ? f.at : f.centre;
            const at = toSheet(placed, q[0], q[1]);
            if (Math.hypot(at[0] - hover.p[0], at[1] - hover.p[1]) > reach) return null;
            const r = 5 / (pan.zoom * PX);
            return <g data-dimension-snap={f.type === 'vertex' ? ('snap' in f && f.snap === 'midpoint' ? 'midpoint' : 'snap' in f && f.snap === 'quadrant' ? 'quadrant' : 'vertex') : 'centre'} stroke="var(--accent)" strokeWidth={1.5 / (pan.zoom * PX)} fill="var(--card)">
              <rect x={at[0] - r} y={sheet.height - at[1] - r} width={2 * r} height={2 * r} />
              <path d={`M ${at[0] - r} ${sheet.height - at[1]} h ${2 * r} M ${at[0]} ${sheet.height - at[1] - r} v ${2 * r}`} />
              <text x={at[0] + 2 * r} y={sheet.height - at[1] - r} stroke="none" fill="var(--accent)" fontSize={11 / (pan.zoom * PX)}>{t(f.type === 'vertex' && f.ref.kind === 'projection' ? 'drawingUi.snapProjectedPoint' : f.type !== 'vertex' ? 'drawingUi.snapCentre' : 'snap' in f && f.snap === 'midpoint' ? 'drawingUi.snapMidpoint' : 'snap' in f && f.snap === 'quadrant' ? 'drawingUi.snapQuadrant' : 'drawingUi.snapVertex')}</text>
            </g>;
          })()}
          {((tool?.kind === 'dimension' || tool?.kind === 'ordinate') || (!tool && !drag && hover?.feature)) &&
            [...(tool ? tool.picks.map((x) => x.feature) : []), ...(hover?.feature && (!tool || tool.kind === 'ordinate' || tool.picks.length < 2) ? [hover.feature.feature] : [])].map((f, k) => {
              const view = (tool?.picks[0]?.view ?? hover?.feature?.view)!;
              const placed = basePlaced.get(view);
              if (!placed) return null;
              const colour = tool && k < tool.picks.length ? 'var(--accent)' : 'var(--warn)';
              const box = viewLines.get(view)?.box;
              if (f.type === 'circle' || f.type === 'torus') {
                // a circle is drawn about its own middle, a fillet's arc about `at` (which is `major` off the torus's centre), both of the radius written
                const [fx, fy] = f.type === 'circle' ? f.centre : f.at;
                const c = toSheet(placed, fx, fy);
                return <circle key={k} data-pick={f.type} cx={c[0]} cy={sheet.height - c[1]} r={f.radius * placed.scale} fill="none" stroke={colour} strokeWidth={1.5 / (pan.zoom * PX)} />;
              }
              if (f.type === 'vertex') {
                if (f.curve) return <polyline key={k} data-pick="curve" points={Array.from({length:f.curve.length/2}, (_,i) => { const q=toSheet(placed,f.curve![2*i]!,f.curve![2*i+1]!); return `${q[0]},${sheet.height-q[1]}`; }).join(' ')} fill="none" stroke={colour} strokeWidth={1.5/(pan.zoom*PX)} />;
                const c = toSheet(placed, f.at[0], f.at[1]);
                return <circle key={k} data-pick="vertex" cx={c[0]} cy={sheet.height - c[1]} r={3 / (pan.zoom * PX)} fill={colour} stroke="var(--card)" strokeWidth={1 / (pan.zoom * PX)} />;
              }
              if (f.type === 'outline') {
                const sa = toSheet(placed, f.from[0], f.from[1]);
                const sb = toSheet(placed, f.to[0], f.to[1]);
                return <line key={k} data-pick="outline" x1={sa[0]} y1={sheet.height - sa[1]} x2={sb[0]} y2={sheet.height - sb[1]} stroke={colour} strokeWidth={1.5 / (pan.zoom * PX)} />;
              }
              if (f.type === 'edge') {
                const sa = toSheet(placed, f.a[0], f.a[1]);
                const sb = toSheet(placed, f.b[0], f.b[1]);
                return <line key={k} data-pick="edge" x1={sa[0]} y1={sheet.height - sa[1]} x2={sb[0]} y2={sheet.height - sb[1]} stroke={colour} strokeWidth={1.5 / (pan.zoom * PX)} />;
              }
              const [a, b] = f.type === 'plane' ? (f.axis === 'x' ? [[f.coord, box?.min[1] ?? 0], [f.coord, box?.max[1] ?? 0]] : [[box?.min[0] ?? 0, f.coord], [box?.max[0] ?? 0, f.coord]]) : [[f.at[0] - f.dir[0] * 15, f.at[1] - f.dir[1] * 15], [f.at[0] + f.dir[0] * 15, f.at[1] + f.dir[1] * 15]];
              const sa = toSheet(placed, a![0]!, a![1]!);
              const sb = toSheet(placed, b![0]!, b![1]!);
              return <line key={k} data-pick={f.type} x1={sa[0]} y1={sheet.height - sa[1]} x2={sb[0]} y2={sheet.height - sb[1]} stroke={colour} strokeWidth={1.5 / (pan.zoom * PX)} />;
            })}
          {plan && <Highlight pixel={pan.zoom * PX} items={built.scene.items.filter((i) => i.group === 'preview')} height={sheet.height} color="var(--accent)" />}
          {drawn && drawnPlaced && drawn.tool === 'detail' && <circle cx={drawn.from[0]} cy={sheet.height - drawn.from[1]} r={Math.hypot(drawn.to[0] - drawn.from[0], drawn.to[1] - drawn.from[1])} fill="none" stroke="var(--accent)" strokeWidth={0.5} strokeDasharray="2 1" />}
          {pathDraw && (() => {
            // the stepped or aligned line so far, and what the next click would add (D-I5)
            const pl = basePlaced.get(pathDraw.view);
            if (!pl) return null;
            const next = drawCursor ? nextPathPoints(pathDraw, toView(pl, drawCursor)) : null;
            const pts = (next ?? pathDraw.points).map(([x, y]) => toSheet(pl, x, y));
            return (
              <g data-path-preview={pathDraw.mode}>
                <polyline points={pts.map(([x, y]) => `${x},${sheet.height - y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={0.6} strokeDasharray="6 2 1 2" />
                {pts.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={sheet.height - y} r={0.8} fill="var(--accent)" />
                ))}
              </g>
            );
          })()}
          {drawn && drawnPlaced && (drawn.tool === 'section' || drawn.tool === 'auxiliary') && (() => {
            // an auxiliary view's fold line (B2.7) is always taken across the view, at whatever angle was dragged, as a slanted cut is
            if (drawn.slant || drawn.tool === 'auxiliary') {
              const box = { min: [drawnPlaced.at[0] - drawnPlaced.w / 2, drawnPlaced.at[1] - drawnPlaced.h / 2] as const, max: [drawnPlaced.at[0] + drawnPlaced.w / 2, drawnPlaced.at[1] + drawnPlaced.h / 2] as const };
              const across = Math.hypot(drawn.to[0] - drawn.from[0], drawn.to[1] - drawn.from[1]) >= 3 ? lineAcrossBox(drawn.from, drawn.to, box, 5) : null;
              return across ? <line data-slant-preview x1={across[0][0]} y1={sheet.height - across[0][1]} x2={across[1][0]} y2={sheet.height - across[1][1]} stroke="var(--accent)" strokeWidth={0.6} strokeDasharray="6 2 1 2" /> : null;
            }
            const horizontal = Math.max(Math.abs(drawn.to[0] - drawn.from[0]), Math.abs(drawn.to[1] - drawn.from[1])) >= 3 && Math.abs(drawn.to[0] - drawn.from[0]) > Math.abs(drawn.to[1] - drawn.from[1]);
            const half = (horizontal ? drawnPlaced.w : drawnPlaced.h) / 2 + 5;
            return horizontal ? (
              <line x1={drawnPlaced.at[0] - half} x2={drawnPlaced.at[0] + half} y1={sheet.height - drawn.from[1]} y2={sheet.height - drawn.from[1]} stroke="var(--accent)" strokeWidth={0.6} strokeDasharray="6 2 1 2" />
            ) : (
              <line y1={sheet.height - (drawnPlaced.at[1] - half)} y2={sheet.height - (drawnPlaced.at[1] + half)} x1={drawn.from[0]} x2={drawn.from[0]} stroke="var(--accent)" strokeWidth={0.6} strokeDasharray="6 2 1 2" />
            );
          })()}
          {ghost && (
            <g data-ghost opacity={0.75}>
              {ghost.lines.visible.map((l, k) => (
                <polyline key={k} points={Array.from({ length: l.length / 2 }, (_, j) => toSheet(ghost.placed, l[2 * j]!, l[2 * j + 1]!)).map(([x, y]) => `${x},${sheet.height - y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={0.3} />
              ))}
              <rect x={ghost.placed.at[0] - ghost.placed.w / 2 - 2} y={sheet.height - ghost.placed.at[1] - ghost.placed.h / 2 - 2} width={ghost.placed.w + 4} height={ghost.placed.h + 4} fill="none" stroke="var(--accent)" strokeWidth={0.3} strokeDasharray="2 1.5" />
              {ghost.label && (
                <text x={ghost.placed.at[0]} y={sheet.height - ghost.placed.at[1] + ghost.placed.h / 2 + 7} fontSize={4} textAnchor="middle" fill="var(--accent)">
                  {`${ghost.label}–${ghost.label}`}
                </text>
              )}
            </g>
          )}
          {cutPreview && (
            <g data-cut-preview>
              <line x1={cutPreview.a[0]} y1={sheet.height - cutPreview.a[1]} x2={cutPreview.b[0]} y2={sheet.height - cutPreview.b[1]} stroke={cutPreview.snapped ? 'var(--warn)' : 'var(--accent)'} strokeWidth={0.6} strokeDasharray="6 2 1 2" />
            </g>
          )}
          {placementCursor && <path d={`M ${placementCursor[0] - 2} ${sheet.height - placementCursor[1]} h 4 M ${placementCursor[0]} ${sheet.height - placementCursor[1] - 2} v 4`} fill="none" stroke="var(--accent)" strokeWidth={0.7} />}
        </svg>
        {selected && selected.w > 0 && (
          <div
            className="drawing-selection"
            data-selection
            style={{ left: (selected.at[0] - selected.w / 2) * PX - 4, top: (sheet.height - selected.at[1] - selected.h / 2) * PX - 4, width: selected.w * PX + 8, height: selected.h * PX + 8 }}
          >
            {/* the scale handle is not shown on a locked view (B2.1): there is no scale to drag there */}
            {!curPage.views.find((v) => v.id === selected.id)?.locked && (
              <span
                className="drawing-handle"
                data-scale-handle
                title={t('drawingUi.scaleHandle')}
                style={{ width: 12 / pan.zoom, height: 12 / pan.zoom, right: -6 / pan.zoom, bottom: -6 / pan.zoom, borderWidth: 1 / pan.zoom }}
              />
            )}
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
          <button className={!tool.slant && !tool.path && tool.vertical !== false ? 'active' : ''} data-action="sectionVertical" onClick={() => d.setTool({ kind: 'section', vertical: true })}>
            {t('drawingUi.sectionVertical')}
          </button>
          <button className={!tool.slant && !tool.path && tool.vertical === false ? 'active' : ''} data-action="sectionHorizontal" onClick={() => d.setTool({ kind: 'section', vertical: false })}>
            {t('drawingUi.sectionHorizontal')}
          </button>
          <button className={tool.slant ? 'active' : ''} data-action="sectionSlant" title={t('drawingUi.hint.sectionSlant')} onClick={() => d.setTool({ kind: 'section', slant: true })}>
            {t('drawingUi.sectionSlant')}
          </button>
          <button className={tool.path === 'stepped' ? 'active' : ''} data-action="sectionStepped" title={t('drawingUi.hint.sectionStepped')} onClick={() => d.setTool({ kind: 'section', path: 'stepped' })}>
            {t('drawingUi.sectionStepped')}
          </button>
          <button className={tool.path === 'aligned' ? 'active' : ''} data-action="sectionAligned" title={t('drawingUi.hint.sectionAligned')} onClick={() => d.setTool({ kind: 'section', path: 'aligned' })}>
            {t('drawingUi.sectionAligned')}
          </button>
        </div>
      )}
      {hint && (
        <div className="drawing-hint" data-hint>
          {hint}
        </div>
      )}
      {!bootMs && <div className="boot-overlay">{t('drawingUi.loadingKernel')}</div>}
      {menu && <DrawingMenu at={menu} onClose={() => setMenu(null)} />}
      <SheetTabs />
    </main>
  );
}
