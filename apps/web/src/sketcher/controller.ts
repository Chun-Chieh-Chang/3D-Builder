import {
  IdAllocator,
  idsInUse,
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
  | 'dimension';

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
  trial(sketch: SketchFeature): Promise<SketchSolvePayload>;
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
}

const PICK_PX = 7;
const DRAG_PX = 3;
/** How far (radians) a line may point away from an arc's tangent and still be made tangent. */
const TANGENT_TOLERANCE = (6 * Math.PI) / 180;

const HINTS: Record<ToolId, string[]> = {
  select: ['選取圖元或尺寸；拖曳圖元可移動定義不足的幾何；在空白處拖曳可方塊選取。'],
  line: ['按一下設定直線起點。', '按一下設定終點；連續畫線，按 Esc 或按兩下結束。'],
  centerline: ['按一下設定中心線起點。', '按一下設定終點；按 Esc 結束。'],
  rect: ['按一下設定第一個角落。', '按一下設定對角。'],
  centerRect: ['按一下設定矩形中心。', '按一下設定角落。'],
  circle: ['按一下設定圓心。', '按一下設定半徑。'],
  perimeterCircle: ['按一下圓周上的第一點。', '按一下第二點。', '按一下第三點。'],
  arc: ['按一下設定圓心。', '按一下設定起點（決定半徑）。', '按一下設定終點。'],
  tangentArc: ['按一下直線或圓弧的端點。', '按一下設定終點。'],
  threePointArc: ['按一下設定起點。', '按一下設定終點。', '按一下圓弧上的一點。'],
  point: ['按一下放置點。'],
  dimension: ['選擇要標註的圖元。', '選擇第二個圖元，或按一下放置尺寸。', '按一下放置尺寸。'],
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
  private inference: string | null = null;
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

  private snapshot(): ControllerView {
    const drawingLine = this.tool === 'line' || this.tool === 'centerline';
    const step = this.tool === 'dimension' ? Math.min(this.picks.length, 2) : drawingLine && this.chain ? 1 : this.clicks.length;
    const hints = HINTS[this.tool];
    return {
      tool: this.tool,
      selection: [...this.selection],
      hover: this.hover?.id ?? null,
      snap: this.snapTarget,
      inference: this.inference,
      preview: this.previewShapes(),
      picks: [...this.picks],
      cursor: this.cursor,
      hint: hints[Math.min(step, hints.length - 1)]!,
    };
  }

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
    this.tool = tool;
    this.resetTool();
    if (tool !== 'select') this.selection.clear();
    this.changed();
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
    if (this.clicks.length > 0 || this.chain || this.picks.length > 0) this.resetTool();
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
      this.host.notify('這個限制條件會使草圖過多定義，因此沒有加入', 'error');
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
    } else if (!press || !press.moved || this.clicks.length > 0 || this.chain || this.tool === 'point' || this.tool === 'dimension') {
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
    if (this.tool === 'dimension') {
      this.hover = hitTest(geometry, e.p, PICK_PX * e.px);
      this.snapTarget = null;
      this.inference = null;
      return;
    }
    let s = snap(geometry, e.p, PICK_PX * e.px, this.excluded());
    this.inference = s.kind === 'point' ? '重合' : s.kind === 'midpoint' ? '中點' : s.kind === 'curve' ? '在圖元上' : null;
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
        this.inference = '相切';
        this.tangentTo = arc.curve;
      } else {
        const hv = inferDirection(from, s.p);
        if (hv.direction) {
          s = { kind: 'free', p: hv.b };
          this.inference = hv.direction === 'horizontal' ? '水平' : '垂直';
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
    this.updateSnap(e);
    const s = this.snapTarget;
    if (!s) return;
    switch (this.tool) {
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
          if (this.tool === 'tangentArc' && !this.tangentStart(s)) return this.host.notify('切線弧必須從直線或圓弧的端點開始', 'info');
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
    if (this.inference === '水平' || this.inference === '垂直') b.relation({ type: this.inference === '水平' ? 'horizontal' : 'vertical', a: line });
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
        if (!circle3) return this.host.notify('三點共線，無法產生圓', 'info');
        const circle = b.circle(b.newPoint(circle3.c), circle3.r);
        for (const s of [c1, c2, c3]) if (s.kind === 'point') b.relation({ type: 'pointOnCurve', point: s.id, curve: circle });
        break;
      }
      case 'threePointArc': {
        const circle3 = circleThrough(c1.p, c2.p, c3.p);
        if (!circle3) return this.host.notify('三點共線，無法產生圓弧', 'info');
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

  private commit(b: Builder): boolean {
    if (b.entities.length === 0 && b.constraints.length === 0) return false;
    return this.host.execute({ type: 'addSketchItems', featureId: this.host.featureId, entities: b.entities, constraints: b.constraints });
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
    if (!proposal) return this.host.notify('無法標註這個組合', 'info');
    const id = this.allocator().take('d');
    const dimension = { id, ...proposal.body, value: fmt(proposal.value) } as SketchConstraint;
    const s = this.sketch();
    void this.host.trial({ ...s, constraints: [...s.constraints, dimension] }).then((r) => {
      if (r.status === 'over' || r.status === 'failed') {
        this.host.notify('這個尺寸會使草圖過多定義，因此沒有加入', 'error');
        return;
      }
      if (this.host.execute({ type: 'addSketchItems', featureId: this.host.featureId, entities: [], constraints: [dimension] })) {
        this.host.editDimension(id);
      }
    });
  }

  /** The dimension the tool would create now (for the preview label next to the cursor). */
  dimensionPreview(): { text: string; at: P2 } | null {
    if (this.tool !== 'dimension' || !this.cursor || this.picks.length === 0) return null;
    const hover = this.hover && this.picks.length === 1 && this.hover.id !== this.picks[0] ? [this.picks[0]!, this.hover.id] : this.picks;
    const proposal = smartDimension(this.geometry(), hover, this.cursor) ?? smartDimension(this.geometry(), this.picks, this.cursor);
    if (!proposal) return null;
    const kind = { distance: '', distanceX: '水平 ', distanceY: '垂直 ', radius: 'R', diameter: 'Ø', angle: '' }[proposal.body.type];
    return { text: `${kind}${fmt(proposal.value)}${proposal.unit === 'deg' ? '°' : ''}`, at: this.cursor };
  }

  // ------------------------------------------------------------------ previews

  private previewShapes(): PreviewShape[] {
    const shapes: PreviewShape[] = [];
    if (this.box) shapes.push({ kind: 'box', a: this.box.a, b: this.box.b });
    const cursor = this.snapTarget?.p ?? this.cursor;
    if (!cursor || this.tool === 'select' || this.tool === 'dimension') return shapes;
    const [c1, c2] = this.clicks;
    switch (this.tool) {
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
