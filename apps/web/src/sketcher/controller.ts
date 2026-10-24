import { t, type PlainKey } from '@3db/i18n';
import {
  applyCommand,
  IdAllocator,
  idsInUse,
  isDimension,
  isSketchAxis,
  SKETCH_ORIGIN,
  type CircleRadius,
  type Command,
  type Id,
  type PartDoc,
  type PointPosition,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
  type SketchPlacement,
} from '@3db/model';
import {
  add,
  alignments,
  circleThrough,
  closestOnSegment,
  layoutDimension,
  dist,
  geometryOf,
  blockTargets,
  conditionEnds,
  hitTest,
  inBox,
  inferDirection,
  inferLine,
  measure,
  perp,
  scale,
  smartDimension,
  snap,
  snapModel,
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
import { angleStep, DEFAULT_SNAPS, extensionSnap, gridPoint, intersectionSnap, lengthStep, perpendicularSnap, quadrantSnap, quickSettings, tangentSnap, visibleGridSpacing, type SnapItem, type SnapSettings } from '@3db/sketch/snaps';
import { checkSketch, repairSketch, type SketchIssue } from '@3db/sketch/check';
import {
  anchorModel,
  anchorModelForSelection,
  applyTransform,
  chamfer,
  dissolveText,
  extend,
  fillet,
  isCurve,
  mergePoints,
  mirror,
  offset,
  patternEntities,
  patternProblem,
  patternTransforms,
  polygon,
  referenceEntities,
  relationCrossings,
  slot,
  transformEntities,
  transformProblem,
  trim,
  type Maker,
  type ModelItem,
  type OpResult,
  type PatternSpec,
  type Transform2,
  type TransformResult,
} from '@3db/sketch/ops';
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
  | 'text'
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
  | 'pierce'
  | 'silhouette'
  | 'intersect'
  | TransformTool;

/** 移動／複製／旋轉／縮放圖元 and the sketch patterns (ADR 0178): they act on the entities selected when the tool starts. */
export type TransformTool = 'stretchEntities' | 'moveEntities' | 'copyEntities' | 'rotateEntities' | 'scaleEntities' | 'linearPattern' | 'circularPattern';
export const TRANSFORM_TOOLS: readonly TransformTool[] = ['stretchEntities', 'moveEntities', 'copyEntities', 'rotateEntities', 'scaleEntities', 'linearPattern', 'circularPattern'];
const isTransformTool = (tool: ToolId): tool is TransformTool => (TRANSFORM_TOOLS as readonly ToolId[]).includes(tool);
/** The clicks each transform tool takes: base and target; center, from and to; a pattern's center. */
const TRANSFORM_CLICKS: Record<TransformTool, number> = { stretchEntities:2, moveEntities: 2, copyEntities: 2, rotateEntities: 3, scaleEntities: 3, linearPattern: 2, circularPattern: 1 };
const TRANSFORM_HINTS: Record<TransformTool, PlainKey[]> = {
  stretchEntities: ['sketch.hint.stretch','sketch.hint.xformTarget'],
  moveEntities: ['sketch.hint.xformBase', 'sketch.hint.xformTarget'],
  copyEntities: ['sketch.hint.xformBase', 'sketch.hint.xformTarget'],
  rotateEntities: ['sketch.hint.rotateCenter', 'sketch.hint.rotateFrom', 'sketch.hint.rotateTo'],
  scaleEntities: ['sketch.hint.scaleBase', 'sketch.hint.scaleFrom', 'sketch.hint.scaleTo'],
  linearPattern: ['sketch.hint.xformBase', 'sketch.hint.patternStep'],
  circularPattern: ['sketch.hint.circularCenter'],
};

/** The tools of C1.8–C1.19, whose hints and messages come from the message catalog. */
type OperationTool = 'slot' | 'polygon' | 'sketchFillet' | 'sketchChamfer' | 'trim' | 'extend' | 'offset' | 'mirror' | 'convert' | 'pierce' | 'intersect' | 'silhouette' | TransformTool;

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
  /**
   * The transform tools (ADR 0178): 「保持關係」, 「複製」 (rotate and scale), the values typed in (ΔX/ΔY, angle in degrees, factor; a pattern's step, copies and
   * total angle). Kept as typed, even when not a valid value: the operation says why it cannot use one, it is never quietly made into another (AGENTS.md §2.1).
   */
  keepRelations: boolean;
  transformCopy: boolean;
  moveX: number;
  moveY: number;
  rotateAngle: number;
  scaleFactor: number;
  patternX: number;
  patternY: number;
  patternCount: number;
  patternAngle: number;
  linkCopies:boolean;
  secondDirection:boolean;
  pattern2X:number;
  pattern2Y:number;
  pattern2Count:number;
}

const DEFAULT_OPTIONS: ToolOptions = {
  linkCopies:true,
  secondDirection:false,
  pattern2X:0,
  pattern2Y:10,
  pattern2Count:1,
  polygonSides: 6,
  circumscribed: false,
  filletRadius: 5,
  chamferDistance1: 5,
  chamferDistance2: 5,
  offsetDistance: 5,
  gapTolerance: 0.1,
  keepRelations: false,
  transformCopy: false,
  moveX: 10,
  moveY: 0,
  rotateAngle: 90,
  scaleFactor: 2,
  patternX: 20,
  patternY: 0,
  patternCount: 3,
  patternAngle: 360,
};

/** What the controller needs from the application. The store implements it; tests use a fake. */
export interface SketchHost {
  readonly featureId: Id;
  doc(): PartDoc;
  /** Latest solve of the sketch (or of the current drag frame). */
  solved(): SketchSolvePayload | null;
  execute(cmd: Command): boolean;
  /** Solves a drag frame for display only; null ends the preview. */
  dragPreview(options: { drag: { points?: PointPosition[]; radii?: CircleRadius[] }; initial: { points: PointPosition[]; radii: CircleRadius[] } } | null): void;
  /** Solves a candidate sketch without changing anything; dragged toward the targets of `options` when given (a move of entities, ADR 0178). */
  trial(sketch: SketchFeature, doc?: PartDoc, options?: { drag: { points?: PointPosition[]; radii?: CircleRadius[] }; initial: { points: PointPosition[]; radii: CircleRadius[] } }): Promise<SketchSolvePayload>;
  notify(text: string, kind?: 'error' | 'info'): void;
  /** Opens the Modify box of a dimension (D6.1). */
  editDimension(constraintId: Id): void;
  /** The model's edges in the sketch plane, projected (D5.3b): what the cursor can snap to besides the sketch itself. */
  modelItems?(): readonly ModelItem[];
  /** Which snaps are on (「啟用抓取」 and the choices under it); every one is when the host does not say. */
  snapSettings?(): SnapSettings;
  automaticRelations?(): boolean;
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
  dimensionDrag?: { id: Id; position: P2 };
  tool: ToolId;
  selection: Id[];
  /** Element under the cursor (highlight). */
  hover: Id | null;
  /** Snap target of the drawing tool (highlight + inference symbol). */
  snap: Snap | null;
  /** Inferred relation shown next to the cursor while drawing. */
  inference: string | null;
  /** The line the one being drawn is inferred collinear / parallel / perpendicular to (it is also the hover). */
  inferLine: { kind: 'collinear' | 'parallel' | 'perpendicular' | 'tangent'; line: Id } | null;
  /** The snap a 快速抓取 chose: only that one is on, until another is chosen or it is cleared. */
  quickSnap: SnapItem | null;
  /** The set grid spacing while the grid snap is on (it is drawn then, stepped up when zoomed out); null when it is off. */
  grid: number | null;
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
/** The picking tools that may take one of the sketch's axes (ADR 0170): a dimension to it, a mirror about it; never trim, extend, fillet or offset. */
const AXIS_TOOLS: ReadonlySet<ToolId> = new Set(['dimension', 'mirror']);
/** What the cursor says it found on the model, by the place of the edge (D5.3b; a pierce point, C1 2026-10-14). */
const modelInference = (part: Extract<Snap, { kind: 'model' }>['part']) =>
  part === 'curve' ? 'modelEdge' : part === 'mid' ? 'modelMid' : part === 'center' ? 'modelCenter' : part === 'pierce' ? 'modelPierce' : part === 'vertex' ? 'modelVertex' : 'modelPoint';
/** How close (screen pixels) the cursor must be to a sketch point in x or y to line up with it (D5.3a). */
const ALIGN_PX = 5;
/** A line leaving within this angle of another line's direction (or a quarter turn from it) is made collinear, parallel or perpendicular to it. */
const LINE_INFER_ANGLE = (3 * Math.PI) / 180;
/** Shorter than this (screen pixels) a line being drawn has no direction worth inferring from. */
const LINE_INFER_MIN_PX = 10;
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
  text: ['hint.text'],
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
  private inference: 'coincident' | 'midpoint' | 'onCurve' | 'tangent' | 'horizontal' | 'vertical' | 'horizontalPoint' | 'verticalPoint' | 'alignedPoints' | 'collinear' | 'parallel' | 'perpendicular' | 'modelPoint' | 'modelMid' | 'modelCenter' | 'modelEdge' | 'modelPierce' | 'modelVertex' | 'intersection' | 'quadrant' | 'onExtension' | null = null;
  /** Arc the line being drawn is inferred to be tangent to. */
  private tangentTo: Id | null = null;
  /** Line the one being drawn is inferred collinear / parallel / perpendicular to (D5.3a). */
  private lineTo: { kind: 'collinear' | 'parallel' | 'perpendicular' | 'tangent'; line: Id } | null = null;
  /** The snap a 快速抓取 chose (D5.3c), or none. */
  private quick: SnapItem | null = null;
  private cursor: P2 | null = null;
  /** Points (as snaps) clicked so far by the drawing tool. */
  private clicks: Snap[] = [];
  /** Line tool: point the next segment starts from, and where the chain began. */
  private chain: { from: Id; first: Id } | null = null;
  /** Center-point arc: accumulated sweep of the cursor around the center (sign = direction). */
  private sweep = { total: 0, last: 0 };
  private picks: Id[] = [];
  private press: { p: P2; hit: Hit | null; modelSnap?: Extract<Snap, { kind: 'model' }> | null; moved: boolean } | null = null;
  private drag: { kind: 'points'; ids: Id[]; origin: P2; from: P2[] } | { kind: 'radius'; id: Id } | null = null;
  private dimensionDrag: { id: Id; from: P2; text: P2; position: P2; moved: boolean } | null = null;
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
      dimensionDrag: this.dimensionDrag?.moved ? { id: this.dimensionDrag.id, position: this.dimensionDrag.position } : undefined,
      tool: this.tool,
      selection: [...this.selection],
      hover: this.hover?.id ?? null,
      snap: this.snapTarget,
      inference: this.inference && t(`infer.${this.inference}`),
      inferLine: this.lineTo,
      quickSnap: this.quick,
      grid: this.gridShown(),
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
      case 'silhouette': return t('sketch.hint.silhouette');
      case 'intersect':
        return t('sketch.hint.intersect');
      case 'stretchEntities':
      case 'moveEntities':
      case 'copyEntities':
      case 'rotateEntities':
      case 'scaleEntities':
      case 'linearPattern':
      case 'circularPattern': {
        const hints = TRANSFORM_HINTS[tool];
        return t(hints[Math.min(step, hints.length - 1)]!);
      }
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

  /** What a drawing action collects its entities in; it can make the entities that follow the model that a click on the model needs. */
  private builder(): Builder {
    return new Builder(this.allocator(), (made, snap) => anchorModel(this.sketch(), this.geometry(), made, snap.item, snap.part, snap.p), this.host.automaticRelations?.() ?? true);
  }

  private allocator(): IdAllocator {
    const doc = this.host.doc();
    return new IdAllocator(doc.idCounters, idsInUse(doc));
  }

  // ------------------------------------------------------------------ tools

  setTool(tool: ToolId): void {
    // mirror, offset and the transforms act on what is selected when the tool starts (SolidWorks takes a pre-selection too)
    const chosen = tool==='stretchEntities' ? [...this.selection].filter(id=>this.sketch().entities.some(e=>e.id===id&&e.type==='point')) : tool === 'mirror' || isTransformTool(tool) ? this.mirrorTargets() : tool === 'offset' ? this.offsetTargets() : [];
    if ((tool === 'mirror' || tool === 'offset' || isTransformTool(tool)) && chosen.length === 0) {
      const why = t(tool==='stretchEntities'?'sketch.hint.stretch':tool === 'mirror' ? 'sketch.needMirrorSelection' : tool === 'offset' ? 'sketch.needOffsetSelection' : 'sketch.needTransformSelection');
      this.host.notify(why, 'info');
      this.notice(why);
      return;
    }
    this.tool = tool;
    this.quick = null;
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
    if (this.dimensionDrag) { this.dimensionDrag = null; this.press = null; }
    else if (this.tool === 'mirror' || this.tool === 'offset' || isTransformTool(this.tool)) this.setTool('select');
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

  /**
   * A right click in the sketch (ADR 0176): what is under the pointer — an entity, else one of the sketch's axes — becomes the selection, unless it is
   * already part of it (then the selection is kept, and the menu's commands work on all of it). Nothing under the pointer: the selection is kept as it is.
   * Returns what was under the pointer.
   */
  contextPick(e: PointerInput): Id | null {
    const hit = hitTest(this.geometry(), e.p, PICK_PX * e.px) ?? this.axisAt(e);
    if (hit && !this.selection.has(hit.id)) {
      this.selection.clear();
      this.selection.add(hit.id);
      this.changed();
    }
    return hit?.id ?? null;
  }

  /** 「選擇鏈」 (ADR 0176): the selected lines, arcs and circles and every curve joined to them end to end become the selection. */
  selectChain(): void {
    const chain = this.offsetTargets();
    if (chain.length === 0) return;
    this.selection = new Set(chain);
    this.changed();
  }

  /**
   * 「智慧型尺寸」 from the right-click menu (ADR 0176): the tool starts with what was selected as its picks — one entity, or two when the pair can be
   * dimensioned — so the next click places the dimension (or, with one, picks the second entity), as the tool does after its own clicks.
   */
  startDimension(): void {
    const geometry = this.geometry();
    const ids = [...this.selection].filter((id) => geometryOf(geometry, id) != null).slice(0, 2);
    const seed = ids.length === 2 && !smartDimension(geometry, ids, this.cursor ?? [0, 0]) ? ids.slice(0, 1) : ids;
    this.setTool('dimension');
    this.picks = seed;
    this.changed();
  }

  selectUnderdefined(): void {
    const statuses = this.host.solved()?.entityStatus;
    if (!statuses) return this.host.notify(t('sketch.analysisPending'), 'info');
    this.setTool('select');
    this.selection = new Set(this.sketch().entities.filter(e=>statuses.get(e.id)==='under').map(e=>e.id));
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

  /** Stores the displayed dimension text location without changing the constraint's value or references. */
  moveDimensionLabel(constraintId: Id, position: P2): void {
    const c = this.sketch().constraints.find((x) => x.id === constraintId);
    if (!c || !isDimension(c)) return;
    this.host.execute({ type: 'setDimensionPosition', featureId: this.host.featureId, constraintId, position: [position[0], position[1]] });
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
    const s = this.sketch();
    // 「固定」 of curves holds each of the selected that is not held yet, one relation for each, in one step (ADR 0182)
    // one allocator for all of them: each call of `allocator()` starts from what the document has, so two would hand out the same id twice
    const ids = this.allocator();
    const relations =
      body.type === 'block'
        ? blockTargets(this.geometry(), [...this.selection], s).map((entity) => ({ id: ids.take('c'), type: 'block', entity }) as SketchConstraint)
        : [{ id: ids.take('c'), ...body } as SketchConstraint];
    if (relations.length === 0) return false;
    const relation = relations[0]!;
    // 「交錯」 names the point where two curves meet; say that they do not meet rather than let the solver call it over-defined (C6.2)
    if (relation.type === 'intersection') {
      const g = this.geometry();
      const [a, b] = [g.get(relation.a), g.get(relation.b)];
      if (isCurve(a) && isCurve(b) && relationCrossings(a, b).length === 0) {
        this.host.notify(t('sketch.noCrossingRelation'), 'error');
        return false;
      }
    }
    const r = await this.host.trial({ ...s, constraints: [...s.constraints, ...relations] });
    if (r.status === 'over' || r.status === 'failed') {
      this.host.notify(t('sketch.overDefinedRelation'), 'error');
      return false;
    }
    const ok = this.host.execute({ type: 'addSketchItems', featureId: this.host.featureId, entities: [], constraints: relations });
    this.changed();
    return ok;
  }

  // ------------------------------------------------------------------ pointer input

  pointerMove(e: PointerInput, pressed: boolean): void {
    this.cursor = e.p;
    if (this.dimensionDrag && pressed) {
      const drag = this.dimensionDrag;
      drag.moved ||= dist(drag.from, e.p) > DRAG_PX * e.px;
      drag.position = add(drag.text, sub(e.p, drag.from));
    } else if (this.tool === 'select') {
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
    if (this.tool === 'select') {
      const hit = this.dimensionAt(e);
      if (hit) {
        this.dimensionDrag = { id: hit.id, from: e.p, text: hit.text, position: hit.text, moved: false };
        this.press = null;
        this.changed();
        return;
      }
    }
    let hit = hitTest(this.geometry(), e.p, PICK_PX * e.px);
    const modelSnap = !hit && this.tool === 'select' && this.host.modelItems ? snapModel(this.host.modelItems(), e.p, PICK_PX * e.px) : null;
    // the sketch's axes last of all (ADR 0170): what was drawn and the model's edges come first
    if (!hit && !modelSnap && this.tool === 'select') hit = this.axisAt(e);
    this.press = { p: e.p, hit, modelSnap, moved: false };
    if (this.tool !== 'select') this.updateSnap(e);
    this.changed();
  }

  pointerUp(e: PointerInput): void {
    if (this.dimensionDrag) {
      const drag = this.dimensionDrag;
      this.dimensionDrag = null;
      if (drag.moved) this.moveDimensionLabel(drag.id, add(drag.text, sub(e.p, drag.from)));
      else this.select([drag.id], e.ctrl || e.shift);
      this.changed();
      return;
    }
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
      const dim = this.dimensionAt(e);
      if (dim) { this.host.editDimension(dim.id); return; }
      const hit = hitTest(this.geometry(), e.p, PICK_PX * e.px);
      if (hit && this.sketch().constraints.some((c) => c.id === hit.id)) this.host.editDimension(hit.id);
    }
  }

  leave(): void {
    if (this.dimensionDrag) { this.dimensionDrag = null; this.press = null; }
    this.cursor = null;
    this.hover = null;
    this.snapTarget = null;
    this.changed();
  }

  // ------------------------------------------------------------------ selecting and dragging

  /** Uses the same derived segments as the overlay, in sketch units at the current zoom. */
  private dimensionAt(e: PointerInput): { id: Id; text: P2 } | null {
    const geometry = this.geometry();
    const points = [...geometry.values()].flatMap(g => g.type === 'point' ? [g.p] : []);
    const center: P2 = points.length ? [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length] : [0, 0];
    let best: { id: Id; text: P2; distance: number } | null = null;
    for (const constraint of this.sketch().constraints) {
      if (!isDimension(constraint)) continue;
      const layout = layoutDimension(constraint, geometry, e.px, center);
      if (!layout) continue;
      const distance = Math.min(...layout.segments.map(([a, b]) => dist(e.p, closestOnSegment(e.p, a, b))));
      if (distance <= PICK_PX * e.px && (!best || distance < best.distance)) best = { id: constraint.id, text: layout.text, distance };
    }
    // A real sketch point/curve under the pointer takes priority over an overlapping extension line.
    return hitTest(geometry, e.p, PICK_PX * e.px) ? null : best;
  }

  private selectMove(e: PointerInput, pressed: boolean): void {
    const press = this.press;
    if (!pressed || !press) {
      this.hover = hitTest(this.geometry(), e.p, PICK_PX * e.px);
      if (!this.hover && this.host.modelItems) {
        const snap = snapModel(this.host.modelItems(), e.p, PICK_PX * e.px);
        this.snapTarget = snap;
        this.inference = snap ? modelInference(snap.part) : null;
        if (!snap) this.hover = this.axisAt(e);
      } else if (!this.hover) {
        this.hover = this.axisAt(e);
        this.snapTarget = null;
        this.inference = null;
      } else {
        this.snapTarget = null;
        this.inference = null;
      }
      return;
    }
    if (!press.moved && dist(press.p, e.p) > DRAG_PX * e.px) {
      press.moved = true;
      // the origin and the sketch's axes (ADR 0170) never move: dragging from them draws a selection box
      if (press.hit && press.hit.id !== SKETCH_ORIGIN && !isSketchAxis(press.hit.id)) this.startDrag(press.hit, press.p);
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

  private selectUp(e: PointerInput, press: { p: P2; hit: Hit | null; modelSnap?: Extract<Snap, { kind: 'model' }> | null; moved: boolean } | null): void {
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
    if (hit) {
      this.select([hit.id], e.ctrl || e.shift); // the origin can be selected for relations, not dragged
    } else if (press?.modelSnap) {
      const snap = press.modelSnap;
      // In select mode: clicking along the edge (even near its midpoint) selects the edge curve itself.
      // Endpoints (start/end) and circle centers remain points.
      const part = snap.part === 'mid' ? 'curve' : snap.part;
      const made: Maker = { ids: this.allocator(), entities: [], constraints: [] };
      const targetId = anchorModelForSelection(this.sketch(), this.geometry(), made, snap.item, part, snap.p);
      if (made.entities.length > 0 || made.constraints.length > 0) {
        this.host.execute({ type: 'addSketchItems', featureId: this.host.featureId, entities: made.entities, constraints: made.constraints });
      }
      this.select([targetId], e.ctrl || e.shift);
    } else if (!e.ctrl && !e.shift) {
      this.select([]);
    }
  }

  // ------------------------------------------------------------------ drawing

  /** Points the current tool must not snap to (the point it is drawing from). */
  private excluded(): Set<Id> {
    const ex = new Set<Id>();
    if (this.chain) ex.add(this.chain.from);
    for (const c of this.clicks) if (c.kind === 'point') ex.add(c.id);
    return ex;
  }

  /** The snaps in force: the quick snap's when one is chosen, else the settings of the person (all on when the host has none). */
  private settings(): SnapSettings {
    return this.quick ? quickSettings(this.quick) : (this.host.snapSettings?.() ?? DEFAULT_SNAPS);
  }

  /** The grid spacing to draw: the grid snap's, while it is on (and snapping is). */
  private gridShown(): number | null {
    const cfg = this.settings();
    return cfg.enabled && cfg.grid ? cfg.gridSpacing : null;
  }

  /** Chooses a 快速抓取 (only that snap is on), or ends it (null). It ends with the tool. */
  setQuickSnap(item: SnapItem | null): void {
    this.quick = item;
    this.changed();
  }

  /** The curves that start at `id` (its ends, its center): a line from there cannot be made tangent to or square to them. */
  private curvesAt(id: Id): Set<Id> {
    const out = new Set<Id>();
    for (const [cid, g] of this.geometry()) {
      if ((g.type === 'line' && (g.p1 === id || g.p2 === id)) || (g.type === 'circle' && g.center === id) || (g.type === 'arc' && (g.center === id || g.start === id || g.end === id))) out.add(cid);
    }
    return out;
  }

  private updateSnap(e: PointerInput): void {
    const geometry = this.geometry();
    if (PICK_TOOLS.has(this.tool)) {
      this.hover = hitTest(geometry, e.p, PICK_PX * e.px, undefined, AXIS_TOOLS.has(this.tool) && (this.tool !== 'dimension' || this.axisPickable(geometry, e.p)));
      this.snapTarget = null;
      this.inference = null;
      return;
    }
    const cfg = this.settings();
    const tol = PICK_PX * e.px;
    this.tangentTo = null;
    this.lineTo = null;
    this.inference = null;
    if (!cfg.enabled || e.ctrl) {
      // nothing snaps, and nothing is added by itself; Ctrl does it for as long as it is held (SolidWorks: hold Ctrl while sketching to keep
      // automatic relations from being added)
      this.snapTarget = { kind: 'free', p: e.p };
      this.hover = null;
      return;
    }
    const excluded = this.excluded();
    const makes = this.aligns();
    const from = this.lineStart();
    const drawingLine = (this.tool === 'line' || this.tool === 'centerline') && !!from;
    const fromId = this.chain?.from ?? (this.clicks[0]?.kind === 'point' ? this.clicks[0].id : null);
    const label = (s: Snap) => {
      this.inference =
        s.kind === 'point' ? 'coincident' : s.kind === 'midpoint' ? 'midpoint' : s.kind === 'curve' ? 'onCurve' : s.kind === 'intersection' ? 'intersection' : s.kind === 'quadrant' ? 'quadrant' : this.inference;
    };
    // In the order of what is meant: the sketch's own points and middles, the model's ends and centers, a crossing, a quarter point, where a line touches
    // a circle or meets a line square, anywhere on a curve of the sketch, anywhere on an edge of the model
    let s: Snap = snap(geometry, e.p, tol, excluded, { point: cfg.point, midpoint: cfg.midpoint, curve: false });
    label(s);
    const open = () => s.kind === 'free' && !this.lineTo; // a tangent or a square foot has been found when a line to follow is set
    if (open() && makes && cfg.model) {
      const model = snapModel(this.host.modelItems?.() ?? [], e.p, tol, true);
      if (model) {
        s = model;
        this.inference = modelInference(model.part);
      }
    }
    if (open() && makes && cfg.intersection) {
      const x = intersectionSnap(geometry, e.p, tol, excluded);
      if (x) {
        s = { kind: 'intersection', p: x.p, a: x.a, b: x.b };
        label(s);
      }
    }
    if (open() && makes && cfg.quadrant) {
      const q = quadrantSnap(geometry, e.p, tol, excluded);
      if (q) {
        s = { kind: 'quadrant', p: q.p, curve: q.curve, center: q.center, axis: q.axis };
        label(s);
      }
    }
    if (open() && drawingLine && from && cfg.tangent) {
      const near = fromId ? this.curvesAt(fromId) : new Set<Id>();
      const t1 = tangentSnap(geometry, from, e.p, tol, near);
      if (t1) {
        s = { kind: 'free', p: t1.p };
        this.inference = 'tangent';
        this.lineTo = { kind: 'tangent', line: t1.curve };
      }
    }
    if (open() && drawingLine && from && cfg.perpendicular) {
      const near = fromId ? this.curvesAt(fromId) : new Set<Id>();
      const f1 = perpendicularSnap(geometry, from, e.p, tol, near);
      if (f1) {
        s = { kind: 'curve', id: f1.line, p: f1.p };
        this.inference = 'perpendicular';
        this.lineTo = { kind: 'perpendicular', line: f1.line };
      }
    }
    if (open() && cfg.curve) {
      const c = snap(geometry, e.p, tol, excluded, { point: false, midpoint: false, curve: true });
      if (c.kind === 'curve') {
        s = c;
        label(s);
      }
    }
    if (open() && makes && cfg.model) {
      const model = snapModel(this.host.modelItems?.() ?? [], e.p, tol, false);
      if (model) {
        s = model;
        this.inference = modelInference(model.part);
      }
    }
    // What a line leaving its start says: tangent to the arc it leaves, horizontal or vertical, collinear or parallel or square to another line
    if (drawingLine && from && s.kind === 'free' && !this.lineTo) {
      // Leaving the end of an arc along its tangent → tangent (it wins over horizontal/vertical, so the
      // two are never added together and cannot over-define the sketch).
      const arc = cfg.tangent ? this.arcAtLineStart() : null;
      const d = sub(s.p, from);
      const along = arc ? dot(d, arc.dir) : 0;
      if (arc && along > 0 && Math.abs(cross(arc.dir, d)) <= Math.tan(TANGENT_TOLERANCE) * along) {
        s = { kind: 'free', p: add(from, scale(arc.dir, along)) };
        this.inference = 'tangent';
        this.tangentTo = arc.curve;
      } else {
        const hv = cfg.horizontalVertical ? inferDirection(from, s.p) : { b: s.p, direction: null };
        if (hv.direction) {
          s = { kind: 'free', p: hv.b };
          this.inference = hv.direction === 'horizontal' ? 'horizontal' : 'vertical';
        } else if (cfg.lineRelations) {
          // Not horizontal or vertical: perhaps in line with, alongside or square to another line
          const other = inferLine(geometry, from, s.p, undefined, LINE_INFER_ANGLE, ALIGN_PX * e.px, LINE_INFER_MIN_PX * e.px);
          if (other) {
            s = { kind: 'free', p: other.b };
            this.inference = other.kind;
            this.lineTo = { kind: other.kind, line: other.line };
          }
        }
      }
    }
    const inferred = this.inference === 'tangent' || this.inference === 'horizontal' || this.inference === 'vertical' || !!this.lineTo;
    // In line with other sketch points (D5.3a): only where the click makes a new point, and only in the direction a line has not already fixed
    if (s.kind === 'free' && makes && cfg.alignment && this.inference !== 'tangent' && !this.lineTo) {
      const lineHv = this.inference === 'horizontal' || this.inference === 'vertical';
      const found = alignments(geometry, s.p, ALIGN_PX * e.px, excluded, { h: this.inference !== 'horizontal', v: this.inference !== 'vertical' });
      if (found) {
        s = { kind: 'free', p: found.p, align: found.align };
        const both = found.align.h && found.align.v;
        if (!lineHv) this.inference = both ? 'alignedPoints' : found.align.h ? 'horizontalPoint' : 'verticalPoint';
      }
    }
    // On the extension of a line (FreeCAD's line extension auto-constraint): last of the snaps, only for a place nothing else has taken, so a line's own
    // horizontal, vertical or collinear and the points it lines up with come first and are never added with it
    if (s.kind === 'free' && !s.align && !inferred && this.inference === null && makes && cfg.extension) {
      const x = extensionSnap(geometry, e.p, tol, excluded);
      if (x) {
        s = { kind: 'extension', p: x.p, line: x.line, from: x.from };
        this.inference = 'onExtension';
      }
    }
    // The steps that ask for nothing of the sketch: the length (Shift), the angle, the grid; only for a place nothing else has taken
    if (s.kind === 'free' && !s.align && !inferred && this.inference === null) {
      if (drawingLine && from && e.shift) s = { kind: 'free', p: lengthStep(from, s.p, cfg.gridSpacing) };
      else if (drawingLine && from && cfg.angle) s = { kind: 'free', p: angleStep(from, s.p, cfg.angleStep) };
      else if (cfg.grid && makes) s = { kind: 'free', p: gridPoint(s.p, visibleGridSpacing(cfg.gridSpacing, e.px)) }; // the grid that is drawn
    }
    this.snapTarget = s;
    this.hover = this.lineTo
      ? { id: this.lineTo.line, kind: 'line', q: s.p, d: 0 }
      : s.kind === 'point'
        ? { id: s.id, kind: 'point', q: s.p, d: 0 }
        : s.kind === 'curve'
          ? { id: s.id, kind: 'line', q: s.p, d: 0 }
          : s.kind === 'extension'
            ? { id: s.line, kind: 'line', q: s.p, d: 0 }
            : null;
  }

  /** Whether the click about to be made puts a new point where the cursor is (so it may line up with other points). */
  private aligns(): boolean {
    const step = this.clicks.length;
    switch (this.tool) {
      case 'line':
      case 'centerline':
      case 'point':
      case 'text':
      case 'rect':
      case 'centerRect':
        return true;
      case 'threePointArc':
        return step < 2; // the point on the arc is only passed through
      case 'circle':
      case 'arc':
        return step === 0; // the later clicks only set a radius or a sweep
      default:
        return false;
    }
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
    if (isTransformTool(this.tool)) return this.transformClick(this.tool, s);
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
        this.commit(this.builder().point(s));
        return;
      case 'text': {
        const b = this.builder();
        const pt = b.pointFor(s);
        const txtId = b.text(pt);
        if (this.commit(b)) {
          this.setTool('select');
          this.select([txtId]);
        }
        return;
      }
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
    const b = this.builder();
    const from = this.chain ? ({ kind: 'point', id: this.chain.from, p: this.positionOf(this.chain.from) ?? s.p } as Snap) : this.clicks[0]!;
    const p1 = this.chain ? this.chain.from : b.pointFor(from);
    const p2 = b.pointFor(s);
    if (p1 === p2) return;
    const line = b.line(p1, p2, construction);
    if ((this.host.automaticRelations?.() ?? true) && (this.inference === 'horizontal' || this.inference === 'vertical')) b.relation({ type: this.inference, a: line });
    if ((this.host.automaticRelations?.() ?? true) && this.tangentTo) b.relation({ type: 'tangent', a: this.tangentTo, b: line });
    if ((this.host.automaticRelations?.() ?? true) && this.lineTo) b.relation({ type: this.lineTo.kind, a: line, b: this.lineTo.line });
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
    const b = this.builder();
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
        if ((this.host.automaticRelations?.() ?? true) && s.kind === 'point') b.relation({ type: 'pointOnCurve', point: s.id, curve: circle });
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
    const b = this.builder();
    switch (this.tool) {
      case 'perimeterCircle': {
        const circle3 = circleThrough(c1.p, c2.p, c3.p);
        if (!circle3) return this.host.notify(t('sketch.collinearCircle'), 'info');
        const circle = b.circle(b.newPoint(circle3.c), circle3.r);
        for (const s of [c1, c2, c3]) if ((this.host.automaticRelations?.() ?? true) && s.kind === 'point') b.relation({ type: 'pointOnCurve', point: s.id, curve: circle });
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

  /** One of the sketch's axes under the cursor (ADR 0170), and nothing else: the last thing the select tool looks for. */
  private axisAt(e: PointerInput): Hit | null {
    return hitTest(new Map(), e.p, PICK_PX * e.px, new Set([SKETCH_ORIGIN]), true);
  }

  /** The line a click picks, or null; one of the sketch's axes only when `axes` (ADR 0170: a mirror line, never something to trim). */
  private pickedCurve(e: PointerInput, axes = false): { id: Id; g: SolvedGeometry } | null {
    const hit = hitTest(this.geometry(), e.p, PICK_PX * e.px, undefined, axes);
    const g = hit && geometryOf(this.geometry(), hit.id);
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
        const hit = this.pickedCurve(e, true);
        if (hit) this.run(mirror(sketch, geometry, ids, this.picks, hit.id), () => this.setTool('select'));
        return;
      }
    }
  }

  // ------------------------------------------------------------------ move, copy, rotate, scale, sketch patterns (ADR 0178)

  /** A click of a transform tool: the clicks gather until the tool has its last one, which applies it. */
  private transformClick(tool: TransformTool, s: Snap): void {
    this.clicks.push(s);
    if (this.clicks.length < TRANSFORM_CLICKS[tool]) return;
    const points = this.clicks.map((c) => c.p);
    this.clicks = [];
    if (tool === 'linearPattern' || tool === 'circularPattern') return this.finishTransform(tool, this.patternResult(this.patternSpec(tool, points)));
    const transforms = this.transformsThrough(tool, points);
    if ('error' in transforms) return this.host.notify(transforms.error, 'info');
    this.finishTransform(tool, this.transformResult(tool, transforms));
  }

  /** A pattern from its clicks: the step from the first to the second (linear), the center (circular); the copies and the angle as set. */
  private patternSpec(tool: 'linearPattern' | 'circularPattern', p: P2[]): PatternSpec {
    const o = this.options;
    return tool === 'linearPattern' ? { kind: 'linear', step: sub(p[1]!, p[0]!), count: o.patternCount, ...(o.secondDirection?{second:{step:[o.pattern2X,o.pattern2Y],count:o.pattern2Count}}:{}) } : { kind: 'circular', c: p[0]!, angle: o.patternAngle, count: o.patternCount };
  }

  /**
   * 「套用」 in the PropertyManager: the values typed in instead of the clicks. A move, a copy and a linear pattern need nothing else; a rotation and a
   * scale need their center clicked first (a circular pattern is applied by the click on its center).
   */
  applyToolValues(): void {
    const tool = this.tool;
    if (!isTransformTool(tool)) return;
    const o = this.options;
    const center = this.clicks[0]?.p;
    let r: TransformResult;
    if (tool === 'stretchEntities' || tool === 'moveEntities' || tool === 'copyEntities') r = this.transformResult(tool, [{ kind: 'translate', d: [o.moveX, o.moveY] }]);
    else if (tool === 'linearPattern') r = this.patternResult({ kind: 'linear', step: [o.patternX, o.patternY], count: o.patternCount });
    else if (!center) return this.host.notify(t('sketch.xformNeedCenter'), 'info');
    else if (tool === 'rotateEntities') r = this.transformResult(tool, [{ kind: 'rotate', c: center, angle: o.rotateAngle }]);
    else if (tool === 'scaleEntities') r = this.transformResult(tool, [{ kind: 'scale', c: center, k: o.scaleFactor }]);
    else r = this.patternResult({ kind: 'circular', c: center, angle: o.patternAngle, count: o.patternCount });
    this.clicks = [];
    this.finishTransform(tool, r);
  }

  /** The transforms the clicked points (and, for the preview, the cursor as the last of them) make; a pattern's copies. */
  private transformsThrough(tool: TransformTool, p: P2[]): Transform2[] | { error: string } {
    switch (tool) {
      case 'stretchEntities':
      case 'moveEntities':
      case 'copyEntities':
        return [{ kind: 'translate', d: sub(p[1]!, p[0]!) }];
      case 'linearPattern':
      case 'circularPattern': {
        const spec = this.patternSpec(tool, p);
        const problem = patternProblem(spec);
        return problem ? { error: problem } : patternTransforms(spec);
      }
      case 'rotateEntities':
      case 'scaleEntities': {
        const [from, to] = [sub(p[1]!, p[0]!), sub(p[2]!, p[0]!)];
        if (Math.hypot(...from) < 1e-9 || Math.hypot(...to) < 1e-9) return { error: t('sketch.xformPickApart') };
        if (tool === 'scaleEntities') return [{ kind: 'scale', c: p[0]!, k: Math.hypot(...to) / Math.hypot(...from) }];
        return [{ kind: 'rotate', c: p[0]!, angle: (Math.atan2(cross(from, to), dot(from, to)) * 180) / Math.PI }];
      }
    }
  }

  private transformResult(tool: TransformTool, transforms: Transform2[]): TransformResult {
    const copy = tool === 'copyEntities' || ((tool === 'rotateEntities' || tool === 'scaleEntities') && this.options.transformCopy);
    return transformEntities(this.sketch(), this.geometry(), this.allocator(), this.picks, transforms[0]!, { keepRelations: this.options.keepRelations, copy });
  }

  private patternResult(spec: PatternSpec): TransformResult {
    const o=this.options;
    const grid:PatternSpec=spec.kind==='linear'&&o.secondDirection?{...spec,second:{step:[o.pattern2X,o.pattern2Y],count:o.pattern2Count}}:spec;
    return patternEntities(this.sketch(), this.geometry(), this.allocator(), this.picks, grid, o.keepRelations, o.linkCopies);
  }

  /** After the transform: back to selecting, with what was moved (in place) still selected. */
  private finishTransform(tool: TransformTool, r: TransformResult): void {
    const moved = this.picks;
    const inPlace = tool==='stretchEntities' || tool === 'moveEntities' || ((tool === 'rotateEntities' || tool === 'scaleEntities') && !this.options.transformCopy);
    this.runTransform(r, () => {
      this.setTool('select');
      if (inPlace) this.select(moved);
      if (!('error' in r) && r.removed > 0) this.host.notify(t('sketch.xformRemoved', { n: r.removed }), 'info');
    });
  }

  /**
   * A transform as one command (one undo step), checked by the solver like any operation. The moved points and circles are dragged to where the
   * transform takes them (the rest of the sketch starts where it is shown), and what the solver makes of it is stored, as after dragging: with
   * 「保持關係」 the relations to the rest may hold the selection back, or bring the rest with it.
   */
  private runTransform(r: TransformResult, done?: () => void): void {
    if ('error' in r) return this.host.notify(r.error, 'info');
    if (this.busy) return;
    const base = { type: 'editSketch', featureId: this.host.featureId, ...r.edit } as Extract<Command, { type: 'editSketch' }>;
    let next: PartDoc;
    try {
      next = applyCommand(this.host.doc(), base);
    } catch (e) {
      return this.host.notify(t('sketch.opFailed', { reason: e instanceof Error ? e.message : String(e) }), 'error');
    }
    const candidate = next.features.find((f) => f.id === this.host.featureId) as SketchFeature;
    const targets = new Set(r.targets.map((p) => p.id));
    const sized = new Set(r.radii.map((x) => x.id));
    const initial = { points: [...r.targets], radii: [...r.radii] };
    for (const [id, g] of this.geometry()) {
      if (g.type === 'point' && !targets.has(id)) initial.points.push({ id, x: g.p[0], y: g.p[1] });
      else if (g.type === 'circle' && !sized.has(id)) initial.radii.push({ id, radius: g.r });
    }
    this.busy = true;
    this.pending = this.host
      .trial(candidate, next, { drag: { points: r.targets, radii: r.radii }, initial })
      // the drag toward the targets can find no way when the relations kept to the rest pull against it (a turn of two lines that end on a line
      // kept vertical): then the sketch is solved from the targets without the pull, and the relations have their way, as they do when they only hold it back
      .then((dragged) => (dragged.status === 'failed' ? this.host.trial(candidate, next, { drag: {}, initial }) : dragged))
      .then((solved) => {
        if (solved.status === 'over') return this.host.notify(t('sketch.opOverDefined'), 'error');
        // the relations kept to the rest of the sketch cannot follow the transform (with 保持關係): said as such, not as an over-defined sketch
        if (solved.status === 'failed') return this.host.notify(t('sketch.xformBlocked'), 'error');
        const at = (id: Id): P2 | null => {
          const g = solved.geometry.get(id);
          return g?.type === 'point' ? g.p : null;
        };
        const radius = (id: Id): number | null => {
          const g = solved.geometry.get(id);
          return g?.type === 'circle' ? g.r : null;
        };
        const added = new Set((r.edit.add?.entities ?? []).map((e) => e.id));
        // what the solver made of it is stored, as after a drag: the new places of the existing points and circles …
        const place: SketchPlacement[] = (r.edit.place ?? []).flatMap(({ x: _x, y: _y, radius: _r, ...rest }) => (Object.keys(rest).length > 1 ? [rest] : []));
        for (const e of candidate.entities) {
          if (added.has(e.id)) continue;
          const p = e.type === 'point' ? at(e.id) : null;
          const rr = e.type === 'circle' ? radius(e.id) : null;
          if (p) place.push({ id: e.id, x: p[0], y: p[1] });
          if (rr !== null) place.push({ id: e.id, radius: rr });
        }
        // … and of the new ones
        const entities = (r.edit.add?.entities ?? []).map((e): SketchEntity => {
          const p = e.type === 'point' ? at(e.id) : null;
          const rr = e.type === 'circle' ? radius(e.id) : null;
          return p && e.type === 'point' ? { ...e, x: p[0], y: p[1] } : rr !== null && e.type === 'circle' ? { ...e, radius: rr } : e;
        });
        const cmd: Command = { ...base, place, add: { entities, constraints: r.edit.add?.constraints ?? [] } };
        if (this.host.execute(cmd)) done?.();
      })
      .catch((e: unknown) => this.host.notify(t('sketch.opFailed', { reason: e instanceof Error ? e.message : String(e) }), 'error'))
      .finally(() => {
        this.busy = false;
        this.changed();
      });
  }

  /** What the transform tool shows before its last click: the selection where the cursor would take it (each copy of a pattern), and the line from the first click. */
  private transformPreview(tool: TransformTool, cursor: P2): PreviewShape[] {
    const need = TRANSFORM_CLICKS[tool];
    const points = [...this.clicks.map((c) => c.p), cursor];
    const shapes: PreviewShape[] = this.clicks.slice(1).map((c) => ({ kind: 'line', a: this.clicks[0]!.p, b: c.p, construction: true }));
    if (this.clicks.length > 0) shapes.push({ kind: 'line', a: this.clicks[0]!.p, b: cursor, construction: true });
    if (points.length < need) return shapes;
    const transforms = this.transformsThrough(tool, points);
    if ('error' in transforms || transforms.some((m) => transformProblem(m))) return shapes;
    const geometry = this.geometry();
    for (const m of transforms) for (const id of this.picks) shapes.push(...transformedShapes(geometry.get(id), m));
    return shapes;
  }

  /**
   * Applies the result of an operation as one command (one undo step), after the solver agrees the sketch is not
   * over-defined by it, like a dimension or a relation.
   */
  private run(r: OpResult, done?: () => void): void {
    if ('error' in r) return this.host.notify(r.error, 'info');
    this.submit({ type: 'editSketch', featureId: this.host.featureId, ...r.edit } as Command, () => { if(r.message)this.host.notify(r.message,'info');done?.(); });
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

  /** Dissolves a sketch text entity into standard line entities. */
  dissolveText(textId: Id): void {
    const sketch = this.sketch();
    const geometry = this.geometry();
    const ids = this.allocator();
    this.run(dissolveText(sketch, geometry, textId, ids), () => {
      this.select([]);
    });
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

  /**
   * 「圓弧條件」 of a distance (ADR 0183): measured to the nearest or the farthest points of a circle or an arc, or from the center again. The value becomes
   * what is measured under the new condition, so nothing moves (SolidWorks does the same); a condition that cannot be measured now (the two cross, or there
   * is no direction) is refused, and says why.
   */
  setDistanceCondition(constraintId: Id, condition: 'min' | 'max' | null): void {
    const c = this.sketch().constraints.find((x) => x.id === constraintId);
    if (c?.type !== 'distance' || c.b === undefined) return;
    const g = this.geometry();
    let value: number | null = null;
    if (c.driving !== false) {
      if (condition === null) {
        const { condition: _was, ...plain } = c;
        value = measure(plain, g);
      } else {
        const m = conditionEnds(g, c.a, c.b, condition);
        if (m && 'error' in m) return void this.host.notify(t(m.error === 'crossing' ? 'sketch.conditionCrossing' : 'sketch.conditionNoDirection'), 'error');
        value = m ? m.value : null;
      }
    }
    this.submit({ type: 'setDistanceCondition', featureId: this.host.featureId, constraintId, condition, ...(value === null ? {} : { value: fmt(value) }) });
  }

  // ------------------------------------------------------------------ smart dimension (C1.28)

  /**
   * Whether a click of the dimension tool may pick one of the sketch's axes (ADR 0170): as the first pick, or after one that cannot be dimensioned by
   * itself (a point). After a line, circle or arc the next click is where the dimension goes, and an infinite axis must not take it: parts are drawn
   * around the origin, so that place is often on x = 0 or y = 0. For the angle of a line to an axis, the axis is picked first.
   */
  private axisPickable(geometry: ReturnType<SketchController['geometry']>, p: P2): boolean {
    return this.picks.length === 0 || smartDimension(geometry, [this.picks[0]!], p) === null;
  }

  private dimensionClick(e: PointerInput): void {
    const geometry = this.geometry();
    const hit = hitTest(geometry, e.p, PICK_PX * e.px, undefined, this.axisPickable(geometry, e.p));
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
    if (isTransformTool(this.tool)) return [...shapes, ...this.transformPreview(this.tool, cursor)];
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

/** How an entity looks where a transform takes it (ADR 0178 preview): lines, circles and arcs exactly; ellipses and splines as polylines; points and texts not at all. */
function transformedShapes(g: SolvedGeometry | undefined, m: Transform2): PreviewShape[] {
  const k = m.kind === 'scale' ? m.k : 1;
  const turn = m.kind === 'rotate' ? (m.angle * Math.PI) / 180 : 0;
  const polyline = (pts: P2[], closed: boolean): PreviewShape[] => {
    const q = pts.map((p) => applyTransform(m, p));
    return q.slice(0, closed ? q.length : q.length - 1).map((a, i) => ({ kind: 'line', a, b: q[(i + 1) % q.length]! }));
  };
  switch (g?.type) {
    case 'line':
      return [{ kind: 'line', a: applyTransform(m, g.a), b: applyTransform(m, g.b), construction: g.construction }];
    case 'circle':
      return [{ kind: 'circle', c: applyTransform(m, g.c), r: g.r * k }];
    case 'arc':
      return [{ kind: 'arc', c: applyTransform(m, g.c), r: g.r * k, a0: g.a0 + turn, a1: g.a1 + turn }];
    case 'ellipse': {
      const pts = Array.from({ length: 48 }, (_, i): P2 => {
        const u = (2 * Math.PI * i) / 48;
        const [x, y] = [g.majorRadius * Math.cos(u), g.minorRadius * Math.sin(u)];
        return [g.c[0] + x * Math.cos(g.angle) - y * Math.sin(g.angle), g.c[1] + x * Math.sin(g.angle) + y * Math.cos(g.angle)];
      });
      return polyline(pts, true);
    }
    case 'spline':
      return polyline(g.points, g.closed);
    default:
      return [];
  }
}

/** Collects the entities and relations of one drawing action (one command, one undo step). */
class Builder {
  readonly entities: SketchEntity[] = [];
  readonly constraints: SketchConstraint[] = [];

  constructor(
    readonly ids: IdAllocator,
    private readonly onModel: (made: Builder, snap: Extract<Snap, { kind: 'model' }>) => Id,
    private readonly automaticRelations = true,
  ) {}

  newPoint(p: P2): Id {
    const id = this.ids.take('p');
    this.entities.push({ id, type: 'point', x: p[0], y: p[1] });
    return id;
  }

  /** The point a snap stands for: an existing point is reused (merged); otherwise a new point with its relation. */
  pointFor(s: Snap): Id {
    if (!this.automaticRelations) return this.newPoint(s.p);
    if (s.kind === 'point' && s.id !== SKETCH_ORIGIN) return s.id;
    if (s.kind === 'model') return this.onModel(this, s);
    const id = this.newPoint(s.p);
    if (s.kind === 'intersection') {
      this.relation({ type: 'intersection', point: id, a: s.a, b: s.b });
      return id;
    }
    if (s.kind === 'quadrant') {
      this.relation({ type: 'pointOnCurve', point: id, curve: s.curve });
      this.relation({ type: s.axis, a: id, b: s.center });
      return id;
    }
    if (s.kind === 'free' && s.align) {
      if (s.align.h) this.relation({ type: 'horizontal', a: id, b: s.align.h.id });
      if (s.align.v) this.relation({ type: 'vertical', a: id, b: s.align.v.id });
    } else if (s.kind === 'point') this.relation({ type: 'coincident', a: id, b: SKETCH_ORIGIN });
    else if (s.kind === 'midpoint') this.relation({ type: 'midpoint', point: id, line: s.line });
    else if (s.kind === 'curve') this.relation({ type: 'pointOnCurve', point: id, curve: s.id });
    else if (s.kind === 'extension') this.relation({ type: 'pointOnCurve', point: id, curve: s.line });
    return id;
  }

  /** A point drawn with the Point tool: a snap onto an existing point adds nothing. */
  point(s: Snap): this {
    if (!this.automaticRelations || !(s.kind === 'point' && s.id !== SKETCH_ORIGIN)) this.pointFor(s);
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

  text(at: Id, text = 'Text', size = 10, angle = 0): Id {
    const id = this.ids.take('txt');
    this.entities.push({ id, type: 'text', at, text, size, angle, align: 'left' });
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
