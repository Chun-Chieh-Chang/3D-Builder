import { t, type PlainKey } from '@3db/i18n';
import {
  applyCommand,
  IdAllocator,
  idsInUse,
  isDimension,
  SKETCH_ORIGIN,
  type CircleRadius,
  type Command,
  type Id,
  type PartDoc,
  type PointPosition,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
} from '@3db/model';
import {
  add,
  circleThrough,
  dist,
  hitTest,
  inBox,
  inferDirection,
  measure,
  perp,
  scale,
  smartDimension,
  snap,
  sub,
  tangentArcCenter,
  unit,
  cross,
  dot,
  type Hit,
  type RelationBody,
  type Snap,
} from '@3db/sketch/interact';
import type { P2, SolvedGeometry } from '@3db/sketch';
import { checkSketch, repairSketch, type SketchIssue } from '@3db/sketch/check';
import { chamfer, extend, fillet, mergePoints, mirror, offset, polygon, referenceEntities, slot, trim, type ModelItem, type OpResult } from '@3db/sketch/ops';
import type { SketchSolvePayload } from '../worker/protocol';

export type ToolId =
  | 'select'
  | 'line'
  | 'centerline'
  | 'rect'
  | 'centerRect'
  | 'circle'
  | 'perimeterCircle'
  | 'arc'
  | 'tangentArc'
  | 'threePointArc'
  | 'point'
  | 'dimension'
  | 'slot'
  | 'polygon'
  | 'sketchFillet'
  | 'sketchChamfer'
  | 'trim'
  | 'extend'
  | 'offset'
  | 'mirror'
  | 'convert'
  | 'pierce';

/** The tools of C1.8–C1.19, whose hints and messages come from the message catalog. */
type OperationTool = 'slot' | 'polygon' | 'sketchFillet' | 'sketchChamfer' | 'trim' | 'extend' | 'offset' | 'mirror' | 'convert' | 'pierce';

/** Tools that pick existing geometry instead of placing points: no snapping, the element under the cursor is what counts. */
const PICK_TOOLS: ReadonlySet<ToolId> = new Set(['dimension', 'trim', 'extend', 'sketchFillet', 'sketchChamfer', 'offset', 'mirror']);

/** One way out of an over-defined sketch: delete this relation or dimension, or make this dimension a reference. */
export interface SketchFix {
  id: Id;
  kind: 'delete' | 'driven';
}

/** What the user sets for a tool before using it (shown in the PropertyManager). */
export interface ToolOptions {
  polygonSides: number;
  /** The second click of a polygon is the middle of a side, not a corner. */
  circumscribed: boolean;
  filletRadius: number;
  chamferDistance1: number;
  chamferDistance2: number;
  offsetDistance: number;
  /** 「修復草圖」 closes gaps up to this wide (mm). */
  gapTolerance: number;
}

const DEFAULT_OPTIONS: ToolOptions = { polygonSides: 6, circumscribed: false, filletRadius: 5, chamferDistance1: 5, chamferDistance2: 5, offsetDistance: 5, gapTolerance: 0.1 };

/** What the controller needs from the application. The store implements it; tests use a fake. */
export interface SketchHost {
  readonly featureId: Id;
  doc(): PartDoc;
  /** Latest solve of the sketch (or of the current drag frame). */
  solved(): SketchSolvePayload | null;
  execute(cmd: Command): boolean;
  /** Solves a drag frame for display only; null ends the preview. */
  dragPreview(options: { drag: { points?: PointPosition[]; radii?: CircleRadius[] }; initial: { points: PointPosition[]; radii: CircleRadius[] } } | null): void;
  /** Solves a candidate sketch without changing anything. */
  trial(sketch: SketchFeature, doc?: PartDoc): Promise<SketchSolvePayload>;
  notify(text: string, kind?: 'error' | 'info'): void;
  /** Opens the Modify box of a dimension (D6.1). */
  editDimension(constraintId: Id): void;
}

export interface PointerInput {
  /** Cursor on the sketch plane. */
  p: P2;
  /** One screen pixel in sketch units. */
  px: number;
  ctrl: boolean;
  shift: boolean;
}

/** Previewed geometry of the tool in progress (drawn by the overlay). */
export type PreviewShape =
  | { kind: 'line'; a: P2; b: P2; construction?: boolean }
  | { kind: 'circle'; c: P2; r: number }
  | { kind: 'arc'; c: P2; r: number; a0: number; a1: number }
  | { kind: 'box'; a: P2; b: P2 };

export interface ControllerView {
  tool: ToolId;
  selection: Id[];
  /** Element under the cursor (highlight). */
  hover: Id | null;
  /** Snap target of the drawing tool (highlight + inference symbol). */
  snap: Snap | null;
  /** Inferred relation shown next to the cursor while drawing. */
  inference: string | null;
  preview: PreviewShape[];
  /** Entities picked so far by the dimension tool. */
  picks: Id[];
  cursor: P2 | null;
  hint: string;
  /** Why the last button press did nothing (a tool that needs a selection pressed with none): shown in the sketch panel until the selection changes or a tool starts. */
  message: string | null;
  options: ToolOptions;
}

const PICK_PX = 7;
const DRAG_PX = 3;
/** How far (radians) a line may point away from an arc's tangent and still be made tangent. */
const TANGENT_TOLERANCE = (6 * Math.PI) / 180;

/** The hints of each tool, one per step (read when asked for, so they follow the language). */
const HINT_KEYS: Record<Exclude<ToolId, OperationTool>, PlainKey[]> = {
  select: ['hint.select'],
  line: ['hint.line1', 'hint.line2'],
  centerline: ['hint.centerline1', 'hint.centerline2'],
  rect: ['hint.rect1', 'hint.rect2'],
  centerRect: ['hint.centerRect1', 'hint.centerRect2'],
  circle: ['hint.circle1', 'hint.circle2'],
  perimeterCircle: ['hint.perimeter1', 'hint.perimeter2', 'hint.perimeter3'],
  arc: ['hint.arc1', 'hint.arc2', 'hint.arc3'],
  tangentArc: ['hint.tangentArc1', 'hint.tangentArc2'],
  threePointArc: ['hint.threePoint1', 'hint.threePoint2', 'hint.threePoint3'],
  point: ['hint.point'],
  dimension: ['hint.dimension1', 'hint.dimension2', 'hint.dimension3'],
};

const fmt = (v: number) => String(Number(v.toFixed(4)));

/**
 * Sketch editing (C1, D5): tools, selection, dragging and dimensions. Every change goes through
 * document commands; geometry shown comes from the solver (derived data).
 */
export class SketchController {
  private tool: ToolId = 'select';
  private selection = new Set<Id>();
  private hover: Hit | null = null;
  private snapTarget: Snap | null = null;
  /** Inferred relation shown next to the cursor while drawing. */
  private inference: 'coincident' | 'midpoint' | 'onCurve' | 'tangent' | 'horizontal' | 'vertical' | null = null;
  /** Arc the line being drawn is inferred to be tangent to. */
  private tangentTo: Id | null = null;
  private cursor: P2 | null = null;
  /** Points (as snaps) clicked so far by the drawing tool. */
  private clicks: Snap[] = [];
  /** Line tool: point the next segment starts from, and where the chain began. */
  private chain: { from: Id; first: Id } | null = null;
  /** Center-point arc: accumulated sweep of the cursor around the center (sign = direction). */
  private sweep = { total: 0, last: 0 };
  private picks: Id[] = [];
  private press: { p: P2; hit: Hit | null; moved: boolean } | null = null;
  private drag: { kind: 'points'; ids: Id[]; origin: P2; from: P2[] } | { kind: 'radius'; id: Id } | null = null;
  private box: { a: P2; b: P2 } | null = null;
  private options: ToolOptions = { ...DEFAULT_OPTIONS };
  /** An operation (trim, round, mirror …) being checked by the solver: clicks wait until it is done. */
  private busy = false;
  /** See ControllerView.message: the text and the selection it was said for. */
  private message: { text: string; selection: string } | null = null;
  private pending: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private view: ControllerView;

  constructor(private readonly host: SketchHost) {
    this.view = this.snapshot();
  }

  // ------------------------------------------------------------------ state for the UI

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getView = (): ControllerView => this.view;

  private changed(): void {
    this.view = this.snapshot();
    for (const fn of this.listeners) fn();
  }

  /** Says in the sketch panel why a button did nothing; it goes away when the selection changes or a tool starts. */
  notice(text: string): void {
    this.message = { text, selection: [...this.selection].join(',') };
    this.changed();
  }

  private snapshot(): ControllerView {
    if (this.message && (this.tool !== 'select' || this.message.selection !== [...this.selection].join(','))) this.message = null;
    const drawingLine = this.tool === 'line' || this.tool === 'centerline';
    const step = this.tool === 'dimension' ? Math.min(this.picks.length, 2) : drawingLine && this.chain ? 1 : this.clicks.length;
    return {
      tool: this.tool,
      selection: [...this.selection],
      hover: this.hover?.id ?? null,
      snap: this.snapTarget,
      inference: this.inference && t(`infer.${this.inference}`),
      preview: this.previewShapes(),
      picks: [...this.picks],
      cursor: this.cursor,
      hint: this.hint(step),
      message: this.message?.text ?? null,
      options: { ...this.options },
    };
  }

  private hint(step: number): string {
    const tool = this.tool;
    switch (tool) {
      case 'slot':
        return t(`sketch.hint.slot${Math.min(step, 2) + 1}` as PlainKey);
      case 'polygon':
        return t(step === 0 ? 'sketch.hint.polygon1' : this.options.circumscribed ? 'sketch.hint.polygonSide' : 'sketch.hint.polygonCorner');
      case 'sketchFillet':
      case 'sketchChamfer':
        return t(this.picks.length === 0 ? 'sketch.hint.corner1' : 'sketch.hint.corner2');
      case 'trim':
        return t('sketch.hint.trim');
      case 'extend':
        return t('sketch.hint.extend');
      case 'offset':
        return t('sketch.hint.offset');
      case 'mirror':
        return t('sketch.hint.mirror');
      case 'convert':
        return t('sketch.hint.convert');
      case 'pierce':
        return t('sketch.hint.pierce');
      default: {
        const hints = HINT_KEYS[tool];
        return t(hints[Math.min(step, hints.length - 1)]!);
      }
    }
  }

  setOption<K extends keyof ToolOptions>(key: K, value: ToolOptions[K]): void {
    this.options = { ...this.options, [key]: value };
    this.changed();
  }

  /** Resolves when the operation being checked is done (for tests and for the UI to wait on). */
  settled = (): Promise<void> => this.pending;

  private sketch(): SketchFeature {
    const f = this.host.doc().features.find((x) => x.id === this.host.featureId);
    if (f?.type !== 'sketch') throw new Error('not editing a sketch');
    return f;
  }

  private geometry(): ReadonlyMap<Id, SolvedGeometry> {
    return this.host.solved()?.geometry ?? new Map();
  }

  private allocator(): IdAllocator {
    const doc = this.host.doc();
    return new IdAllocator(doc.idCounters, idsInUse(doc));
  }

  // ------------------------------------------------------------------ tools

  setTool(tool: ToolId): void {
    // mirror and offset act on what is selected when the tool starts (SolidWorks takes a pre-selection too)
    const chosen = tool === 'mirror' ? this.mirrorTargets() : tool === 'offset' ? this.offsetTargets() : [];
    if ((tool === 'mirror' || tool === 'offset') && chosen.length === 0) {
      const why = t(tool === 'mirror' ? 'sketch.needMirrorSelection' : 'sketch.needOffsetSelection');
      this.host.notify(why, 'info');
      this.notice(why);
      return;
    }
    this.tool = tool;
    this.resetTool();
    this.picks = chosen;
    if (tool !== 'select') this.selection.clear();
    this.changed();
  }

  /** The selected entities that can be mirrored: points and curves, not dimensions or relations. */
  private mirrorTargets(): Id[] {
    const s = this.sketch();
    return s.entities.filter((e) => this.selection.has(e.id)).map((e) => e.id);
  }

  /** The selected lines, arcs and circles, and the curves joined to them end to end (a chain is offset as a whole). */
  private offsetTargets(): Id[] {
    const s = this.sketch();
    const curves = s.entities.filter((e) => e.type === 'line' || e.type === 'arc' || e.type === 'circle');
    const ends = (e: SketchEntity): Id[] => (e.type === 'line' ? [e.p1, e.p2] : e.type === 'arc' ? [e.start, e.end] : []);
    const chosen = new Set(curves.filter((e) => this.selection.has(e.id)).map((e) => e.id));
    for (let grew = true; grew; ) {
      grew = false;
      const used = new Map<Id, number>();
      for (const e of curves) for (const p of ends(e)) used.set(p, (used.get(p) ?? 0) + 1);
      for (const e of curves) {
        if (chosen.has(e.id)) continue;
        // joined to a chosen curve at a point only those two share: the chain goes on
        if (ends(e).some((p) => used.get(p) === 2 && curves.some((o) => chosen.has(o.id) && ends(o).includes(p)))) {
          chosen.add(e.id);
          grew = true;
        }
      }
    }
    return [...chosen];
  }

  private resetTool(): void {
    this.clicks = [];
    this.chain = null;
    this.picks = [];
    this.snapTarget = null;
    this.inference = null;
    this.tangentTo = null;
    this.sweep = { total: 0, last: 0 };
  }

  /** Esc: ends the current chain or pick, then returns to selection (SolidWorks behaviour). */
  escape(): void {
    if (this.tool === 'mirror' || this.tool === 'offset') this.setTool('select');
    else if (this.clicks.length > 0 || this.chain || this.picks.length > 0) this.resetTool();
    else if (this.tool !== 'select') this.tool = 'select';
    else this.selection.clear();
    this.changed();
  }

  select(ids: Id[], additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) {
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.changed();
  }

  deleteSelection(): void {
    const s = this.sketch();
    const present = new Set([...s.entities.map((e) => e.id), ...s.constraints.map((c) => c.id)]);
    const ids = [...this.selection].filter((id) => present.has(id));
    if (ids.length === 0) return;
    if (this.host.execute({ type: 'removeSketchItems', featureId: this.host.featureId, ids })) this.selection.clear();
    this.changed();
  }

  setConstruction(value: boolean): void {
    const s = this.sketch();
    const ids = [...this.selection].filter((id) => s.entities.some((e) => e.id === id && e.type !== 'point'));
    if (ids.length > 0) this.host.execute({ type: 'setConstruction', featureId: this.host.featureId, ids, value });
    this.changed();
  }

  /** 「加入限制條件」 (C1.26): refused, like a dimension, when it would over-define the sketch. */
  async addRelation(body: RelationBody): Promise<boolean> {
    const relation = { id: this.allocator().take('c'), ...body } as SketchConstraint;
    const s = this.sketch();
    const r = await this.host.trial({ ...s, constraints: [...s.constraints, relation] });
    if (r.status === 'over' || r.status === 'failed') {
      this.host.notify(t('sketch.overDefinedRelation'), 'error');
      return false;
    }
    const ok = this.host.execute({ type: 'addSketchItems', featureId: this.host.featureId, entities: [], constraints: [relation] });
    this.changed();
    return ok;
  }

  // ------------------------------------------------------------------ pointer input

  pointerMove(e: PointerInput, pressed: boolean): void {
    this.cursor = e.p;
    if (this.tool === 'select') {
      this.selectMove(e, pressed);
    } else {
      this.updateSnap(e);
      if (this.tool === 'arc' && this.clicks.length === 2) this.trackSweep(e.p);
      if (pressed && this.press && dist(this.press.p, e.p) > DRAG_PX * e.px) this.press.moved = true;
    }
    this.changed();
  }

  pointerDown(e: PointerInput): void {
    this.cursor = e.p;
    const hit = hitTest(this.geometry(), e.p, PICK_PX * e.px);
    this.press = { p: e.p, hit, moved: false };
    if (this.tool !== 'select') this.updateSnap(e);
    this.changed();
  }

  pointerUp(e: PointerInput): void {
    const press = this.press;
    this.press = null;
    if (this.tool === 'select') {
      this.selectUp(e, press);
    } else if (!press || !press.moved || this.clicks.length > 0 || this.chain || this.tool === 'point' || PICK_TOOLS.has(this.tool)) {
      // click, or the release of a press-drag-release stroke (e.g. dragging out a line)
      this.click(e);
    } else {
      this.click({ ...e, p: press.p }); // press-drag: the press sets the first point …
      this.updateSnap(e);
      this.click(e); // … and the release the second
    }
    this.changed();
  }

  doubleClick(e: PointerInput): void {
    if (this.tool === 'line' || this.tool === 'centerline') {
      this.resetTool(); // SolidWorks ends a line chain on double-click
      this.changed();
      return;
    }
    if (this.tool === 'select') {
      const hit = hitTest(this.geometry(), e.p, PICK_PX * e.px);
      if (hit && this.sketch().constraints.some((c) => c.id === hit.id)) this.host.editDimension(hit.id);
    }
  }

  leave(): void {
    this.cursor = null;
    this.hover = null;
    this.snapTarget = null;
    this.changed();
  }

  // ------------------------------------------------------------------ selecting and dragging

  private selectMove(e: PointerInput, pressed: boolean): void {
    const press = this.press;
    if (!pressed || !press) {
      this.hover = hitTest(this.geometry(), e.p, PICK_PX * e.px);
      return;
    }
    if (!press.moved && dist(press.p, e.p) > DRAG_PX * e.px) {
      press.moved = true;
      if (press.hit && press.hit.id !== SKETCH_ORIGIN) this.startDrag(press.hit, press.p);
      else this.box = { a: press.p, b: e.p };
    }
    if (this.drag) this.dragTo(e.p);
    else if (this.box) this.box.b = e.p;
  }

  private startDrag(hit: Hit, at: P2): void {
    const g = this.geometry().get(hit.id);
    if (!g) return;
    if (g.type === 'point') this.drag = { kind: 'points', ids: [hit.id], origin: at, from: [g.p] };
    else if (g.type === 'line') this.drag = { kind: 'points', ids: [g.p1, g.p2], origin: at, from: [g.a, g.b] };
    else this.drag = { kind: 'radius', id: hit.id };
  }

  private dragTo(p: P2): void {
    const drag = this.drag;
    if (!drag) return;
    const geometry = this.geometry();
    const initial = { points: [] as PointPosition[], radii: [] as CircleRadius[] };
    for (const [id, g] of geometry) {
      if (g.type === 'point') initial.points.push({ id, x: g.p[0], y: g.p[1] });
      else if (g.type === 'circle') initial.radii.push({ id, radius: g.r });
    }
    if (drag.kind === 'points') {
      const d = sub(p, drag.origin);
      const points = drag.ids.map((id, i) => ({ id, x: drag.from[i]![0] + d[0], y: drag.from[i]![1] + d[1] }));
      this.host.dragPreview({ drag: { points }, initial });
    } else {
      const g = geometry.get(drag.id);
      if (g?.type !== 'circle' && g?.type !== 'arc') return;
      this.host.dragPreview({ drag: { radii: [{ id: drag.id, radius: Math.max(dist(g.c, p), 1e-6) }] }, initial });
    }
  }

  private selectUp(e: PointerInput, press: { p: P2; hit: Hit | null; moved: boolean } | null): void {
    if (this.drag) {
      this.drag = null;
      // Keep what the user saw: store the last solved frame as the new placement intent.
      const points: PointPosition[] = [];
      const radii: CircleRadius[] = [];
      const stored = new Map(this.sketch().entities.map((x) => [x.id, x]));
      for (const [id, g] of this.geometry()) {
        if (g.type === 'point' && stored.get(id)?.type === 'point') points.push({ id, x: g.p[0], y: g.p[1] });
        else if (g.type === 'circle') radii.push({ id, radius: g.r });
      }
      this.host.dragPreview(null);
      this.host.execute({ type: 'setSketchGeometry', featureId: this.host.featureId, points, radii });
      return;
    }
    if (this.box) {
      const { a, b } = this.box;
      this.box = null;
      const lo: P2 = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
      const hi: P2 = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      this.select(inBox(this.geometry(), lo, hi), e.ctrl || e.shift);
      return;
    }
    const hit = press?.hit;
    if (hit) this.select([hit.id], e.ctrl || e.shift); // the origin can be selected for relations, not dragged
    else if (!e.ctrl && !e.shift) this.select([]);
  }

  // ------------------------------------------------------------------ drawing

  /** Points the current tool must not snap to (the point it is drawing from). */
  private excluded(): Set<Id> {
    const ex = new Set<Id>();
    if (this.chain) ex.add(this.chain.from);
    for (const c of this.clicks) if (c.kind === 'point') ex.add(c.id);
    return ex;
  }

  private updateSnap(e: PointerInput): void {
    const geometry = this.geometry();
    if (PICK_TOOLS.has(this.tool)) {
      this.hover = hitTest(geometry, e.p, PICK_PX * e.px);
      this.snapTarget = null;
      this.inference = null;
      return;
    }
    let s = snap(geometry, e.p, PICK_PX * e.px, this.excluded());
    this.inference = s.kind === 'point' ? 'coincident' : s.kind === 'midpoint' ? 'midpoint' : s.kind === 'curve' ? 'onCurve' : null;
    this.tangentTo = null;
    const from = this.lineStart();
    if ((this.tool === 'line' || this.tool === 'centerline') && from && s.kind === 'free') {
      // Leaving the end of an arc along its tangent → tangent (it wins over horizontal/vertical, so the
      // two are never added together and cannot over-define the sketch).
      const arc = this.arcAtLineStart();
      const d = sub(s.p, from);
      const along = arc ? dot(d, arc.dir) : 0;
      if (arc && along > 0 && Math.abs(cross(arc.dir, d)) <= Math.tan(TANGENT_TOLERANCE) * along) {
        s = { kind: 'free', p: add(from, scale(arc.dir, along)) };
        this.inference = 'tangent';
        this.tangentTo = arc.curve;
      } else {
        const hv = inferDirection(from, s.p);
        if (hv.direction) {
          s = { kind: 'free', p: hv.b };
          this.inference = hv.direction === 'horizontal' ? 'horizontal' : 'vertical';
        }
      }
    }
    this.snapTarget = s;
    this.hover = s.kind === 'point' ? { id: s.id, kind: 'point', q: s.p, d: 0 } : s.kind === 'curve' ? { id: s.id, kind: 'line', q: s.p, d: 0 } : null;
  }

  /** The arc whose end the line being drawn starts from, with the direction that continues it. */
  private arcAtLineStart(): { curve: Id; dir: P2 } | null {
    const start = this.chain?.from ?? (this.clicks[0]?.kind === 'point' ? this.clicks[0].id : null);
    if (!start) return null;
    const at = this.positionOf(start);
    const t = at && this.tangentStart({ kind: 'point', id: start, p: at });
    return t && this.geometry().get(t.curve)?.type === 'arc' ? t : null;
  }

  /** Where the line being drawn starts (chain point or first click). */
  private lineStart(): P2 | null {
    if (this.chain) return this.positionOf(this.chain.from);
    return this.clicks[0]?.p ?? null;
  }

  private positionOf(id: Id): P2 | null {
    if (id === SKETCH_ORIGIN) return [0, 0];
    const g = this.geometry().get(id);
    return g?.type === 'point' ? g.p : null;
  }

  private trackSweep(p: P2): void {
    const c = this.clicks[0]!.p;
    const a = Math.atan2(p[1] - c[1], p[0] - c[0]);
    let d = a - this.sweep.last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    this.sweep.total += d;
    this.sweep.last = a;
  }

  private click(e: PointerInput): void {
    if (this.tool === 'dimension') return void this.dimensionClick(e);
    if (PICK_TOOLS.has(this.tool)) return this.operationClick(e);
    this.updateSnap(e);
    const s = this.snapTarget;
    if (!s) return;
    switch (this.tool) {
      case 'slot':
      case 'polygon':
        this.clicks.push(s);
        if (this.clicks.length === (this.tool === 'slot' ? 3 : 2)) {
          this.finishShape();
          this.clicks = [];
        }
        return;
      case 'line':
      case 'centerline':
        return this.lineClick(s);
      case 'point':
        this.commit(new Builder(this.allocator()).point(s));
        return;
      case 'rect':
      case 'centerRect':
      case 'circle':
      case 'tangentArc':
        if (this.clicks.length === 0) {
          if (this.tool === 'tangentArc' && !this.tangentStart(s)) return this.host.notify(t('sketch.tangentFromEnd'), 'info');
          this.clicks.push(s);
          return;
        }
        this.finishTwoClick(s);
        this.clicks = [];
        return;
      case 'perimeterCircle':
      case 'threePointArc':
      case 'arc':
        this.clicks.push(s);
        if (this.tool === 'arc' && this.clicks.length === 2) {
          const c = this.clicks[0]!.p;
          this.sweep = { total: 0, last: Math.atan2(s.p[1] - c[1], s.p[0] - c[0]) };
        }
        if (this.clicks.length === 3) {
          this.finishThreeClick();
          this.clicks = [];
        }
        return;
    }
  }

  private lineClick(s: Snap): void {
    const construction = this.tool === 'centerline';
    if (!this.chain && this.clicks.length === 0) {
      this.clicks = [s];
      return;
    }
    const b = new Builder(this.allocator());
    const from = this.chain ? ({ kind: 'point', id: this.chain.from, p: this.positionOf(this.chain.from) ?? s.p } as Snap) : this.clicks[0]!;
    const p1 = b.pointFor(from);
    const p2 = b.pointFor(s);
    if (p1 === p2) return;
    const line = b.line(p1, p2, construction);
    if (this.inference === 'horizontal' || this.inference === 'vertical') b.relation({ type: this.inference, a: line });
    if (this.tangentTo) b.relation({ type: 'tangent', a: this.tangentTo, b: line });
    if (!this.commit(b)) return;
    const first = this.chain?.first ?? p1;
    this.clicks = [];
    // Closing the loop on the first point ends the chain, like SolidWorks.
    this.chain = p2 === first ? null : { from: p2, first };
  }

  /** Tangent arcs start at the end of a line or arc: returns the curve and the outgoing direction. */
  private tangentStart(s: Snap): { curve: Id; dir: P2 } | null {
    if (s.kind !== 'point' || s.id === SKETCH_ORIGIN) return null;
    for (const [id, g] of this.geometry()) {
      if (g.type === 'line' && (g.p1 === s.id || g.p2 === s.id)) {
        return { curve: id, dir: g.p2 === s.id ? unit(sub(g.b, g.a)) : unit(sub(g.a, g.b)) };
      }
      if (g.type === 'arc' && (g.start === s.id || g.end === s.id)) {
        const radial = unit(sub(s.p, g.c));
        return { curve: id, dir: g.end === s.id ? perp(radial) : scale(perp(radial), -1) };
      }
    }
    return null;
  }

  private finishTwoClick(s: Snap): void {
    const first = this.clicks[0]!;
    const b = new Builder(this.allocator());
    const [a, q] = [first.p, s.p];
    switch (this.tool) {
      case 'rect': {
        if (Math.abs(q[0] - a[0]) < 1e-9 || Math.abs(q[1] - a[1]) < 1e-9) return;
        b.rectangle([b.pointFor(first), b.newPoint([q[0], a[1]]), b.pointFor(s), b.newPoint([a[0], q[1]])]);
        break;
      }
      case 'centerRect': {
        const opposite: P2 = [2 * a[0] - q[0], 2 * a[1] - q[1]];
        if (Math.abs(q[0] - a[0]) < 1e-9 || Math.abs(q[1] - a[1]) < 1e-9) return;
        const center = b.pointFor(first);
        const corners = [b.pointFor(s), b.newPoint([opposite[0], q[1]]), b.newPoint(opposite), b.newPoint([q[0], opposite[1]])];
        b.rectangle(corners);
        const diagonal = b.line(corners[0]!, corners[2]!, true);
        b.line(corners[1]!, corners[3]!, true);
        b.relation({ type: 'midpoint', point: center, line: diagonal });
        break;
      }
      case 'circle': {
        const r = dist(a, q);
        if (r < 1e-9) return;
        const circle = b.circle(b.pointFor(first), r);
        if (s.kind === 'point') b.relation({ type: 'pointOnCurve', point: s.id, curve: circle });
        break;
      }
      case 'tangentArc': {
        const start = this.tangentStart(first);
        if (!start || first.kind !== 'point') return;
        const center = tangentArcCenter(a, start.dir, q);
        if (!center) return;
        const ccw = cross(start.dir, sub(center, a)) > 0;
        const end = b.pointFor(s);
        if (end === first.id) return;
        const arc = ccw ? b.arc(b.newPoint(center), first.id, end) : b.arc(b.newPoint(center), end, first.id);
        b.relation({ type: 'tangent', a: start.curve, b: arc });
        break;
      }
    }
    this.commit(b);
  }

  private finishThreeClick(): void {
    const [c1, c2, c3] = this.clicks as [Snap, Snap, Snap];
    const b = new Builder(this.allocator());
    switch (this.tool) {
      case 'perimeterCircle': {
        const circle3 = circleThrough(c1.p, c2.p, c3.p);
        if (!circle3) return this.host.notify(t('sketch.collinearCircle'), 'info');
        const circle = b.circle(b.newPoint(circle3.c), circle3.r);
        for (const s of [c1, c2, c3]) if (s.kind === 'point') b.relation({ type: 'pointOnCurve', point: s.id, curve: circle });
        break;
      }
      case 'threePointArc': {
        const circle3 = circleThrough(c1.p, c2.p, c3.p);
        if (!circle3) return this.host.notify(t('sketch.collinearArc'), 'info');
        // counter-clockwise from start to end when the third point lies on that sweep
        const ccw = cross(sub(c2.p, c1.p), sub(c3.p, c1.p)) < 0;
        const [s, e] = [b.pointFor(c1), b.pointFor(c2)];
        if (s === e) return;
        const center = b.newPoint(circle3.c);
        if (ccw) b.arc(center, s, e);
        else b.arc(center, e, s);
        break;
      }
      case 'arc': {
        const c = c1.p;
        const r = dist(c, c2.p);
        if (r < 1e-9) return;
        const endAngle = Math.atan2(c3.p[1] - c[1], c3.p[0] - c[0]);
        const center = b.pointFor(c1);
        const start = b.pointFor(c2);
        // A free end goes onto the circle; a snapped one keeps its relation and the solver settles the radius.
        const end = c3.kind === 'free' ? b.newPoint(add(c, scale([Math.cos(endAngle), Math.sin(endAngle)], r))) : b.pointFor(c3);
        if (start === end) return;
        if (this.sweep.total >= 0) b.arc(center, start, end);
        else b.arc(center, end, start);
        break;
      }
    }
    this.commit(b);
  }

  // ------------------------------------------------------------------ slot, polygon, trim, round, offset, mirror (C1.8–C1.19)

  private finishShape(): void {
    const [c1, c2, c3] = this.clicks as [Snap, Snap, Snap | undefined];
    const place = (s: Snap) => ({ p: s.p, ...(s.kind === 'point' && s.id !== SKETCH_ORIGIN ? { id: s.id } : {}) });
    if (this.tool === 'slot') {
      const axis = sub(c2.p, c1.p);
      const width = c3 ? Math.abs(cross(unit(axis), sub(c3.p, c1.p))) : 0;
      this.run(slot(this.allocator(), place(c1), place(c2), width));
    } else {
      this.run(polygon(this.allocator(), place(c1), c2.p, this.options.polygonSides, this.options.circumscribed));
    }
  }

  /** The line a click picks, or null. */
  private pickedCurve(e: PointerInput): { id: Id; g: SolvedGeometry } | null {
    const hit = hitTest(this.geometry(), e.p, PICK_PX * e.px);
    const g = hit && this.geometry().get(hit.id);
    return hit && g && g.type !== 'point' ? { id: hit.id, g } : null;
  }

  private operationClick(e: PointerInput): void {
    const geometry = this.geometry();
    const sketch = this.sketch();
    const ids = this.allocator();
    switch (this.tool) {
      case 'trim':
      case 'extend': {
        const hit = this.pickedCurve(e);
        if (hit) this.run((this.tool === 'trim' ? trim : extend)(sketch, geometry, ids, hit.id, e.p));
        return;
      }
      case 'sketchFillet':
      case 'sketchChamfer': {
        const hit = hitTest(geometry, e.p, PICK_PX * e.px);
        const g = hit && geometry.get(hit.id);
        if (!hit || !g) return;
        let pair: [Id, Id] | null = null;
        if (g.type === 'point') {
          const lines = [...geometry].filter(([, x]) => x.type === 'line' && (x.p1 === hit.id || x.p2 === hit.id)).map(([id]) => id);
          if (lines.length !== 2) return this.host.notify(t('sketch.cornerPick'), 'info');
          pair = [lines[0]!, lines[1]!];
        } else if (g.type === 'line') {
          if (this.picks.length === 0) {
            this.picks = [hit.id];
            return;
          }
          pair = [this.picks[0]!, hit.id];
          this.picks = [];
        }
        if (!pair) return;
        const o = this.options;
        this.run(
          this.tool === 'sketchFillet'
            ? fillet(sketch, geometry, ids, pair[0], pair[1], o.filletRadius)
            : chamfer(sketch, geometry, ids, pair[0], pair[1], o.chamferDistance1, o.chamferDistance2),
        );
        return;
      }
      case 'offset':
        this.run(offset(sketch, geometry, ids, this.picks, this.options.offsetDistance, e.p), () => this.setTool('select'));
        return;
      case 'mirror': {
        const hit = this.pickedCurve(e);
        if (hit) this.run(mirror(sketch, geometry, ids, this.picks, hit.id), () => this.setTool('select'));
        return;
      }
    }
  }

  /**
   * Applies the result of an operation as one command (one undo step), after the solver agrees the sketch is not
   * over-defined by it, like a dimension or a relation.
   */
  private run(r: OpResult, done?: () => void): void {
    if ('error' in r) return this.host.notify(r.error, 'info');
    this.submit({ type: 'editSketch', featureId: this.host.featureId, ...r.edit } as Command, done);
  }

  /** Trial-solves what the command would make of the sketch and, if it is not over-defined, executes it. */
  private submit(cmd: Command, done?: () => void): void {
    if (this.busy) return;
    let next: PartDoc;
    try {
      next = applyCommand(this.host.doc(), cmd);
    } catch (e) {
      return this.host.notify(t('sketch.opFailed', { reason: e instanceof Error ? e.message : String(e) }), 'error');
    }
    const candidate = next.features.find((f) => f.id === this.host.featureId) as SketchFeature;
    this.busy = true;
    this.pending = this.host
      .trial(candidate, next)
      .then((solved) => {
        if (solved.status === 'over' || solved.status === 'failed') this.host.notify(t('sketch.opOverDefined'), 'error');
        else if (this.host.execute(cmd)) done?.();
      })
      .catch((e: unknown) => this.host.notify(t('sketch.opFailed', { reason: e instanceof Error ? e.message : String(e) }), 'error'))
      .finally(() => {
        this.busy = false;
        this.changed();
      });
  }

  private commit(b: Builder): boolean {
    if (b.entities.length === 0 && b.constraints.length === 0) return false;
    return this.host.execute({ type: 'addSketchItems', featureId: this.host.featureId, entities: b.entities, constraints: b.constraints });
  }

  // ------------------------------------------------------------------ over-definition diagnosis (A2.5, D7.2)

  /**
   * What would cure an over-defined sketch: of the relations and dimensions the solver names as conflicting or redundant,
   * those whose deletion (a dimension: becoming a reference) leaves a sketch that is not over-defined. Each is checked by
   * the solver, so what is offered works.
   */
  async diagnose(): Promise<SketchFix[]> {
    const solved = this.host.solved();
    if (!solved || solved.status !== 'over') return [];
    const sketch = this.sketch();
    const named = new Set([...solved.conflicting, ...solved.redundant]);
    const fixes: SketchFix[] = [];
    for (const c of sketch.constraints.filter((k) => named.has(k.id))) {
      const driven = isDimension(c);
      const constraints = sketch.constraints.flatMap((k) => (k.id !== c.id ? [k] : driven ? [{ ...k, driving: false } as SketchConstraint] : []));
      const r = await this.host.trial({ ...sketch, constraints });
      if (r.status !== 'over' && r.status !== 'failed') fixes.push({ id: c.id, kind: driven ? 'driven' : 'delete' });
    }
    return fixes;
  }

  applyFix(fix: SketchFix): void {
    if (fix.kind === 'driven') this.host.execute({ type: 'setDimensionDriving', featureId: this.host.featureId, constraintId: fix.id, driving: false });
    else this.host.execute({ type: 'removeSketchItems', featureId: this.host.featureId, ids: [fix.id] });
    this.changed();
  }

  // ------------------------------------------------------------------ entities that follow the model (C1.18, C1.26)

  /** Adds what the model's edges look like on this sketch's plane (the worker projected them) as entities that follow them. */
  addReferences(items: ModelItem[]): void {
    this.run(referenceEntities(this.sketch(), this.allocator(), items), () => this.host.notify(t('reference.added', { n: items.length }), 'info'));
  }

  // ------------------------------------------------------------------ check and repair (C1.35)

  /** What keeps the sketch from making a profile, as found in what the solver shows now. */
  issues(): SketchIssue[] {
    const solved = this.host.solved();
    return solved ? checkSketch(this.sketch(), solved.geometry, this.options.gapTolerance) : [];
  }

  /** 「修復草圖」: duplicates and zero-length lines go, gaps within the tolerance close; one undo step. */
  repair(): void {
    const solved = this.host.solved();
    if (!solved) return;
    const r = repairSketch(this.sketch(), solved.geometry, this.options.gapTolerance);
    if ('error' in r) return this.host.notify(r.error, 'info');
    this.submit({ type: 'editSketch', featureId: this.host.featureId, ...r.edit } as Command, () => this.host.notify(t('sketch.repairDone', { fixed: r.fixed, skipped: r.skipped }), 'info'));
  }

  // ------------------------------------------------------------------ merge, arc length, driven dimensions (C1.26, C1.28, C1.29)

  /** 「合併」 of the two selected points. */
  mergeSelection(): void {
    const [a, b] = [...this.selection];
    if (this.selection.size !== 2 || a === undefined || b === undefined) return this.host.notify(t('sketch.mergeTwoPoints'), 'info');
    this.run(mergePoints(this.sketch(), a, b), () => {
      this.selection.clear();
    });
  }

  /** The length of the selected arc as a dimension. */
  dimensionArcLength(arcId: Id): void {
    const g = this.geometry().get(arcId);
    if (g?.type !== 'arc') return;
    const value = measure({ id: '', type: 'arcLength', circle: arcId, value: '0' }, this.geometry());
    if (value !== null) this.placeDimension({ type: 'arcLength', circle: arcId } as SketchConstraint, value);
  }

  /** A dimension that is a reference shows what is measured; one that drives again takes the value measured now (SolidWorks does the same). */
  setDriven(constraintId: Id, driven: boolean): void {
    const c = this.sketch().constraints.find((x) => x.id === constraintId);
    if (!c || !isDimension(c)) return;
    if (driven) {
      this.host.execute({ type: 'setDimensionDriving', featureId: this.host.featureId, constraintId, driving: false });
      return void this.changed();
    }
    const value = measure(c, this.geometry());
    this.submit({ type: 'setDimensionDriving', featureId: this.host.featureId, constraintId, driving: true, ...(value === null ? {} : { value: fmt(value) }) });
  }

  // ------------------------------------------------------------------ smart dimension (C1.28)

  private dimensionClick(e: PointerInput): void {
    const geometry = this.geometry();
    const hit = hitTest(geometry, e.p, PICK_PX * e.px);
    if (this.picks.length === 0) {
      if (hit) this.picks = [hit.id];
      return;
    }
    if (this.picks.length === 1 && hit && hit.id !== this.picks[0] && smartDimension(geometry, [this.picks[0]!, hit.id], e.p)) {
      this.picks.push(hit.id);
      return;
    }
    const proposal = smartDimension(geometry, this.picks, e.p);
    this.picks = [];
    if (!proposal) return this.host.notify(t('sketch.cannotDimension'), 'info');
    this.placeDimension(proposal.body as SketchConstraint, proposal.value);
  }

  /**
   * Adds a driving dimension, refused (like a relation) when the solver says it over-defines the sketch; in that case it
   * is added as a driven one instead, a reference that shows the measured value (C1.29), as SolidWorks offers.
   */
  private placeDimension(body: SketchConstraint, value: number): void {
    const id = this.allocator().take('d');
    const dimension = { ...body, id, value: fmt(value) } as SketchConstraint;
    const s = this.sketch();
    void this.host.trial({ ...s, constraints: [...s.constraints, dimension] }).then((r) => {
      const add = (c: SketchConstraint) => this.host.execute({ type: 'addSketchItems', featureId: this.host.featureId, entities: [], constraints: [c] });
      if (r.status === 'failed') this.host.notify(t('sketch.opOverDefined'), 'error');
      else if (r.status === 'over') {
        if (add({ ...dimension, driving: false } as SketchConstraint)) this.host.notify(t('sketch.dimensionDriven'), 'info');
      } else if (add(dimension)) this.host.editDimension(id);
      this.changed();
    });
  }

  /** The dimension the tool would create now (for the preview label next to the cursor). */
  dimensionPreview(): { text: string; at: P2 } | null {
    if (this.tool !== 'dimension' || !this.cursor || this.picks.length === 0) return null;
    const hover = this.hover && this.picks.length === 1 && this.hover.id !== this.picks[0] ? [this.picks[0]!, this.hover.id] : this.picks;
    const proposal = smartDimension(this.geometry(), hover, this.cursor) ?? smartDimension(this.geometry(), this.picks, this.cursor);
    if (!proposal) return null;
    const kind = { distance: '', distanceX: t('dimension.prefixX'), distanceY: t('dimension.prefixY'), radius: 'R', diameter: 'Ø', arcLength: '⌒', angle: '' }[proposal.body.type];
    return { text: `${kind}${fmt(proposal.value)}${proposal.unit === 'deg' ? '°' : ''}`, at: this.cursor };
  }

  // ------------------------------------------------------------------ previews

  private previewShapes(): PreviewShape[] {
    const shapes: PreviewShape[] = [];
    if (this.box) shapes.push({ kind: 'box', a: this.box.a, b: this.box.b });
    const cursor = this.snapTarget?.p ?? this.cursor;
    if (!cursor || this.tool === 'select' || PICK_TOOLS.has(this.tool)) return shapes;
    const [c1, c2] = this.clicks;
    switch (this.tool) {
      case 'slot':
        if (c1 && c2) {
          const theta = Math.atan2(c2.p[1] - c1.p[1], c2.p[0] - c1.p[0]);
          const r = Math.abs(cross(unit(sub(c2.p, c1.p)), sub(cursor, c1.p)));
          const n: P2 = [-Math.sin(theta) * r, Math.cos(theta) * r];
          shapes.push(
            { kind: 'line', a: add(c1.p, n), b: add(c2.p, n) },
            { kind: 'line', a: sub(c1.p, n), b: sub(c2.p, n) },
            { kind: 'arc', c: c2.p, r, a0: theta - Math.PI / 2, a1: theta + Math.PI / 2 },
            { kind: 'arc', c: c1.p, r, a0: theta + Math.PI / 2, a1: theta + (3 * Math.PI) / 2 },
          );
        } else if (c1) shapes.push({ kind: 'line', a: c1.p, b: cursor, construction: true });
        break;
      case 'polygon':
        if (c1) {
          const { polygonSides: n, circumscribed } = this.options;
          const pick = dist(c1.p, cursor);
          if (pick > 1e-9 && Number.isInteger(n) && n >= 3 && n <= 100) {
            const radius = circumscribed ? pick / Math.cos(Math.PI / n) : pick;
            const turn = Math.atan2(cursor[1] - c1.p[1], cursor[0] - c1.p[0]) - (circumscribed ? Math.PI / n : 0);
            const corners = Array.from({ length: n }, (_, i): P2 => [c1.p[0] + radius * Math.cos(turn + (2 * Math.PI * i) / n), c1.p[1] + radius * Math.sin(turn + (2 * Math.PI * i) / n)]);
            shapes.push(...corners.map((a, i) => ({ kind: 'line' as const, a, b: corners[(i + 1) % n]! })), { kind: 'circle', c: c1.p, r: radius });
          }
        }
        break;
      case 'line':
      case 'centerline': {
        const from = this.lineStart();
        if (from) shapes.push({ kind: 'line', a: from, b: cursor, construction: this.tool === 'centerline' });
        break;
      }
      case 'rect':
        if (c1) {
          const [a, q] = [c1.p, cursor];
          shapes.push(...rectLines([a, [q[0], a[1]], q, [a[0], q[1]]]));
        }
        break;
      case 'centerRect':
        if (c1) {
          const [m, q] = [c1.p, cursor];
          const o: P2 = [2 * m[0] - q[0], 2 * m[1] - q[1]];
          shapes.push(...rectLines([q, [o[0], q[1]], o, [q[0], o[1]]]), { kind: 'line', a: q, b: o, construction: true });
        }
        break;
      case 'circle':
        if (c1) shapes.push({ kind: 'circle', c: c1.p, r: dist(c1.p, cursor) });
        break;
      case 'perimeterCircle':
        if (c1 && c2) {
          const k = circleThrough(c1.p, c2.p, cursor);
          if (k) shapes.push({ kind: 'circle', c: k.c, r: k.r });
        } else if (c1) shapes.push({ kind: 'line', a: c1.p, b: cursor, construction: true });
        break;
      case 'arc':
        if (c1 && c2) {
          const r = dist(c1.p, c2.p);
          const a0 = Math.atan2(c2.p[1] - c1.p[1], c2.p[0] - c1.p[0]);
          const a1 = Math.atan2(cursor[1] - c1.p[1], cursor[0] - c1.p[0]);
          shapes.push(this.sweep.total >= 0 ? { kind: 'arc', c: c1.p, r, a0, a1 } : { kind: 'arc', c: c1.p, r, a0: a1, a1: a0 });
        } else if (c1) shapes.push({ kind: 'line', a: c1.p, b: cursor, construction: true });
        break;
      case 'threePointArc':
        if (c1 && c2) {
          const k = circleThrough(c1.p, c2.p, cursor);
          if (k) {
            const ccw = cross(sub(c2.p, c1.p), sub(cursor, c1.p)) < 0;
            const [s, e] = ccw ? [c1.p, c2.p] : [c2.p, c1.p];
            shapes.push({ kind: 'arc', c: k.c, r: k.r, a0: Math.atan2(s[1] - k.c[1], s[0] - k.c[0]), a1: Math.atan2(e[1] - k.c[1], e[0] - k.c[0]) });
          }
        } else if (c1) shapes.push({ kind: 'line', a: c1.p, b: cursor, construction: true });
        break;
      case 'tangentArc':
        if (c1) {
          const start = this.tangentStart(c1);
          const center = start && tangentArcCenter(c1.p, start.dir, cursor);
          if (start && center) {
            const r = dist(center, c1.p);
            const [s, e] = cross(start.dir, sub(center, c1.p)) > 0 ? [c1.p, cursor] : [cursor, c1.p];
            shapes.push({ kind: 'arc', c: center, r, a0: Math.atan2(s[1] - center[1], s[0] - center[0]), a1: Math.atan2(e[1] - center[1], e[0] - center[0]) });
          }
        }
        break;
    }
    return shapes;
  }
}

function rectLines(corners: P2[]): PreviewShape[] {
  return corners.map((a, i) => ({ kind: 'line' as const, a, b: corners[(i + 1) % 4]! }));
}

/** Collects the entities and relations of one drawing action (one command, one undo step). */
class Builder {
  readonly entities: SketchEntity[] = [];
  readonly constraints: SketchConstraint[] = [];

  constructor(private readonly ids: IdAllocator) {}

  newPoint(p: P2): Id {
    const id = this.ids.take('p');
    this.entities.push({ id, type: 'point', x: p[0], y: p[1] });
    return id;
  }

  /** The point a snap stands for: an existing point is reused (merged); otherwise a new point with its relation. */
  pointFor(s: Snap): Id {
    if (s.kind === 'point' && s.id !== SKETCH_ORIGIN) return s.id;
    const id = this.newPoint(s.p);
    if (s.kind === 'point') this.relation({ type: 'coincident', a: id, b: SKETCH_ORIGIN });
    else if (s.kind === 'midpoint') this.relation({ type: 'midpoint', point: id, line: s.line });
    else if (s.kind === 'curve') this.relation({ type: 'pointOnCurve', point: id, curve: s.id });
    return id;
  }

  /** A point drawn with the Point tool: a snap onto an existing point adds nothing. */
  point(s: Snap): this {
    if (!(s.kind === 'point' && s.id !== SKETCH_ORIGIN)) this.pointFor(s);
    return this;
  }

  line(p1: Id, p2: Id, construction = false): Id {
    const id = this.ids.take('l');
    this.entities.push({ id, type: 'line', p1, p2, ...(construction ? { construction: true } : {}) });
    return id;
  }

  circle(center: Id, radius: number): Id {
    const id = this.ids.take('ci');
    this.entities.push({ id, type: 'circle', center, radius });
    return id;
  }

  arc(center: Id, start: Id, end: Id): Id {
    const id = this.ids.take('a');
    this.entities.push({ id, type: 'arc', center, start, end });
    return id;
  }

  /** Four lines through the corners in order, with horizontal/vertical relations on the sides. */
  rectangle(corners: Id[]): void {
    const lines = corners.map((c, i) => this.line(c, corners[(i + 1) % 4]!));
    this.relation({ type: 'horizontal', a: lines[0]! });
    this.relation({ type: 'vertical', a: lines[1]! });
    this.relation({ type: 'horizontal', a: lines[2]! });
    this.relation({ type: 'vertical', a: lines[3]! });
  }

  relation(body: Record<string, unknown> & { type: SketchConstraint['type'] }): void {
    this.constraints.push({ id: this.ids.take('c'), ...body } as SketchConstraint);
  }
}
