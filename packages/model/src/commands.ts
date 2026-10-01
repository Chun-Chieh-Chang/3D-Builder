import { t } from '@3db/i18n';
import { current, produce, type Draft } from 'immer';
import { countersFor, type Id } from './ids';
import type { Variable, BlobRef, ChamferFeature, CombineFeature, HoleFeature, LoftFeature, RibFeature, SweepFeature, Draft as WallDraft, EndCondition, Thin, Expr, Feature, ImportedBodyFeature, AxisDefinition, CoordSysFeature, MirrorFeature, PartDoc, PatternDefinition, PatternFeature, PlaneDefinition, PointDefinition, Ref, RevolveCondition, SketchConstraint, SketchEntity, SketchFeature } from './schema';
import { isDatumPlaneName } from './datums';
import { canBeSeed } from './patterns';
import { mapRefs } from './refs';
import { bodyFeature, isBodyKey, isHideable } from './visibility';
import { dimensionName, Parameters, renameInDoc, resolveDoc, variableUsers, type ExprKind } from './params';
import type { NameRef } from './expr';
import { isDimension } from './schema';
import { ExprError } from './expr';
import { idsInUse, removalSet, sketchError } from './sketch-rules';

/** The point references of a curve that an edit may change. */
export type EntityRefs = Partial<Record<'p1' | 'p2' | 'start' | 'end' | 'center', Id>>;
/** The references of a relation or dimension that an edit may change (`undefined` takes one away: the optional second reference). */
export type ConstraintRefs = Partial<Record<'a' | 'b' | 'point' | 'line' | 'curve' | 'axis' | 'circle', Id | undefined>>;

/** What `editSketch` does to a sketch, in this order: `entities`, `constraints`, `remove`, `add`. */
export interface SketchEdit {
  /** Entities whose points change (a line that now ends elsewhere). */
  entities?: { id: Id; set: EntityRefs }[];
  /** Relations and dimensions that now refer to something else, or whose value changes. */
  constraints?: { id: Id; set: ConstraintRefs & { value?: Expr } }[];
  /** Deleted together with whatever depends on them. */
  remove?: Id[];
  add?: { entities: SketchEntity[]; constraints: SketchConstraint[] };
}

export interface PointPosition {
  id: Id;
  x: number;
  y: number;
}

export interface CircleRadius {
  id: Id;
  radius: number;
}

/**
 * Document commands (B7.1): the only way to change the SSOT.
 * UI, scripts, macro recording and future collaboration all go through this layer.
 * New objects carry their ids in the command, so applying a command stays a pure function.
 */
export type Command =
  /** Inserts a feature at `index` (at or above the rollback bar), like SolidWorks inserting at the bar. */
  | { type: 'insertFeature'; feature: Feature; index: number }
  | { type: 'setDimension'; featureId: Id; constraintId: Id; value: Expr }
  /** Makes a dimension driven (a reference that shows what is measured) or driving again; `value` is the new value when it drives again (C1.29). */
  | { type: 'setDimensionDriving'; featureId: Id; constraintId: Id; driving: boolean; value?: Expr }
  /** 
ull removes direction 2 (and its draft). */
  | { type: 'setEndCondition'; featureId: Id; dir: 'dir1' | 'dir2'; value: EndCondition | null }
  /** The draft of one direction of an extrusion; 
ull removes it. */
  | { type: 'setDraft'; featureId: Id; dir: 'dir1' | 'dir2'; draft: WallDraft | null }
  /** Makes an extrusion or a revolution a thin feature, or a solid one again (
ull). */
  | { type: 'setThin'; featureId: Id; thin: Thin | null }
  | { type: 'setRevolveCondition'; featureId: Id; value: RevolveCondition }
  | { type: 'setRevolveAxis'; featureId: Id; axis: Id }
  /** The sketch whose path a sweep follows (C4.4). */
  | { type: 'setSweepPath'; featureId: Id; path: Id }
  /** The sketches of a loft's sections, in order (C4.5). */
  | { type: 'setLoftSections'; featureId: Id; sections: Id[] }
  | { type: 'setFilletRadius'; featureId: Id; value: Expr }
  /** Edges of an edge-based feature (fillet, chamfer). */
  | { type: 'setEdges'; featureId: Id; edges: Ref[] }
  | { type: 'setChamfer'; featureId: Id; value: Pick<ChamferFeature, 'mode' | 'distance' | 'second' | 'flip'> }
  /** The hole wizard's settings (C4.8): everything but which sketch it drills at. */
  | { type: 'setHole'; featureId: Id; hole: Omit<HoleFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  /** A rib's thickness, where it goes, and which way it grows (C4.7). */
  | { type: 'setRib'; featureId: Id; rib: Omit<RibFeature, 'id' | 'type' | 'name' | 'suppressed' | 'sketch'> }
  /** What a draft leans and about which plane (C5.5). */
  | { type: 'setDraftFeature'; featureId: Id; neutral: Ref; faces: Ref[]; angle: Expr; reverse?: boolean }
  /** What a shell takes away and how thick the wall is (C5.4). */
  | { type: 'setShell'; featureId: Id; faces: Ref[]; thickness: Expr; outward?: boolean }
  /** Faces of a Delete Face feature (C10.2), and whether the rest of a hole goes with them. */
  | { type: 'setFaces'; featureId: Id; faces: Ref[]; hole?: boolean }
  /** How an imported body's surfaces are sewn (F2.2); without `sewTolerance` the default is used again. */
  | { type: 'setImportOptions'; featureId: Id; sewTolerance?: Expr }
  /** How a boss joins the bodies it touches (C7.1): merged with them (the default), or a body of its own. */
  | { type: 'setMerge'; featureId: Id; merge: boolean }
  /** The contours of its sketch a boss or cut uses (C1.34): each is the ids of the entities bounding one region; `null` is all of them. */
  | { type: 'setContours'; featureId: Id; contours: Id[][] | null }
  /** What a Combine feature does to which bodies (C7.2). */
  | { type: 'setCombine'; featureId: Id; op: CombineFeature['op']; main: Ref; tools: Ref[] }
  /** The name and the reference flag of a body (C7.1); an empty name or `false` takes the choice back. */
  | { type: 'setBody'; bodyId: Id; name?: string; reference?: boolean }
  /** The face and the distance of a Move Face feature (C10.1). */
  | { type: 'setMoveFace'; featureId: Id; face: Ref; distance: Expr }
  | { type: 'setRefPlane'; featureId: Id; def: PlaneDefinition }
  /** How a reference axis (C3.3), a reference point (C3.5) or a coordinate system (C3.4) is defined. */
  | { type: 'setRefAxis'; featureId: Id; def: AxisDefinition }
  | { type: 'setRefPoint'; featureId: Id; def: PointDefinition }
  /** What a pattern repeats and how (C6.1, C6.2); `skip` names the instances to leave out. */
  | { type: 'setPattern'; featureId: Id; seeds: Id[]; def: PatternDefinition; skip?: string[] }
  /** What a mirror reflects and across what (C6.3). */
  | { type: 'setMirror'; featureId: Id; value: Pick<MirrorFeature, 'target' | 'plane' | 'seeds' | 'bodies' | 'merge'> }
  | { type: 'setCoordSys'; featureId: Id; value: Pick<CoordSysFeature, 'origin' | 'x' | 'y' | 'flipX' | 'flipY'> }
  /** Adds imported data and the feature that uses it, as one step (F2.1). */
  | { type: 'importBody'; blob: BlobRef; feature: ImportedBodyFeature; index: number }
  /** Suppresses or unsuppresses several features at once; which ones follows from their dependencies (B2.6). */
  | { type: 'setSuppressed'; featureIds: Id[]; value: boolean }
  /** Deletes features (B2.8). Their ids stay issued; references to them become missing, never rebound. */
  | { type: 'deleteFeatures'; featureIds: Id[] }
  | { type: 'renameFeature'; featureId: Id; name: string }
  | { type: 'setRollback'; index: number | null }
  /** Sketch editing (C1): add geometry together with its relations and dimensions. */
  | { type: 'addSketchItems'; featureId: Id; entities: SketchEntity[]; constraints: SketchConstraint[] }
  /**
   * One edit of a sketch that changes things already there (a fillet shortens two lines, a trim moves the end of one): the
   * references of existing entities and relations are changed, then `remove` is deleted with what depends on it
   * (see removalSet), then `add` is added. One command, so one undo step.
   */
  | ({ type: 'editSketch'; featureId: Id } & SketchEdit)
  /** Deletes entities, relations or dimensions, and whatever depends on them (see removalSet). */
  | { type: 'removeSketchItems'; featureId: Id; ids: Id[] }
  /** Stores placement intent: where points are and how big circles are (e.g. after a drag). */
  | { type: 'setSketchGeometry'; featureId: Id; points: PointPosition[]; radii?: CircleRadius[] }
  | { type: 'setConstruction'; featureId: Id; ids: Id[]; value: boolean }
  /** Shows or hides sketches, reference planes, default planes or the origin (D4.6). */
  | { type: 'setVisibility'; keys: string[]; value: boolean }
  /**
   * Points the reference `from` of a feature at another element `to` of the same kind (B4.3), after it
   * stopped resolving. Only that reference changes; the feature is not rebuilt differently in any other way.
   */
  | { type: 'replaceRef'; featureId: Id; from: Ref; to: Ref }
  /** Global variables (B5.2): a name and an expression. New ids come in the command, as everywhere. */
  | { type: 'addVariable'; variable: Variable }
  /** Renaming rewrites every expression that uses the name; a new expression must not make a cycle. */
  | { type: 'setVariable'; id: Id; name?: string; expr?: Expr }
  /** Refused while an expression still uses the variable. */
  | { type: 'deleteVariable'; id: Id }
  /** File properties (B8.3): free text by name, e.g. a vendor or a part number. */
  | { type: 'setProperty'; name: string; value: string }
  | { type: 'deleteProperty'; name: string }
  /** Names a dimension of a sketch (`寬度@草圖1`); expressions that used the old name follow. An empty label goes back to `D<n>`. */
  | { type: 'setDimensionLabel'; featureId: Id; constraintId: Id; label: string };

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

function feature(draft: Draft<PartDoc>, id: Id): Draft<Feature> {
  const f = draft.features.find((x) => x.id === id);
  if (!f) throw new CommandError(t('cmd.featureNotFound', { id }));
  return f;
}

function sketchOf(draft: Draft<PartDoc>, id: Id): Draft<SketchFeature> {
  const f = feature(draft, id);
  if (f.type !== 'sketch') throw new CommandError(t('cmd.onlySketchEditable'));
  return f;
}

/** The number an expression stands for in this document; what is wrong with it is the command's error. */
function valueOf(p: Parameters, expr: Expr, kind: ExprKind): number {
  try {
    return p.evaluate(expr, kind);
  } catch (e) {
    throw new CommandError(e instanceof ExprError ? e.message : String(e));
  }
}

const positive = (p: Parameters, expr: Expr) => {
  if (!(valueOf(p, expr, 'length') > 0)) throw new CommandError(t('cmd.mustBePositive', { value: expr }));
};

/**
 * Every expression a feature holds must evaluate in this document (variables, dimensions of other sketches,
 * file properties, no cycle) and be a sensible value: the checks a value had before expressions existed,
 * now on what the expression comes to. `only` limits a sketch to some of its dimensions.
 */
function checkExprs(doc: PartDoc, f: Feature, only?: Set<Id>): void {
  const p = new Parameters(doc);
  switch (f.type) {
    case 'sketch':
      for (const c of f.constraints) {
        if (!isDimension(c) || (only && !only.has(c.id))) continue;
        if (c.type === 'angle') valueOf(p, c.value, 'angle');
        else positive(p, c.value);
      }
      return;
    default: {
      const { problem } = p.resolve(f);
      if (problem) throw new CommandError(problem);
    }
  }
}

function endCondition(value: EndCondition): void {
  if ((value.type === 'upToFace' || value.type === 'offsetFromFace') && value.face.kind !== 'face') throw new CommandError(t('cmd.upToFaceNeedsFace'));
  if (value.type === 'upToVertex' && value.vertex.kind !== 'vertex') throw new CommandError(t('cmd.upToVertexNeedsVertex'));
  if (value.type === 'upToBody' && value.body.kind !== 'body') throw new CommandError(t('cmd.upToBodyNeedsBody'));
}

/** The feature's sketch must come earlier in the history. */
function sketchBefore(doc: PartDoc, sketchId: Id, index: number, label: string): SketchFeature {
  const at = doc.features.findIndex((x) => x.id === sketchId);
  const s = doc.features[at];
  if (at < 0 || at >= index || s?.type !== 'sketch') throw new CommandError(t('cmd.needsEarlierSketch', { feature: label }));
  return s;
}

/** A reference to a feature of the history that makes `type` of datum (a plane, an axis, a point), made before the one at `index`. */
function datumFeature(doc: PartDoc, ref: Ref, index: number, type: 'refPlane' | 'refAxis' | 'refPoint'): void {
  const at = doc.features.findIndex((f) => f.id === ref.name);
  if (at < 0 || at >= index || doc.features[at]!.type !== type) throw new CommandError(t(`cmd.${type}MustBeEarlier`));
}

/** A plane reference names a default plane, a reference plane earlier in the history, or a model face. */
function planeRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'face') return;
  if (ref.kind !== 'datum') throw new CommandError(t('cmd.mustPickPlane'));
  if (isDatumPlaneName(ref.name)) return;
  datumFeature(doc, ref, index, 'refPlane');
}

/** An axis reference names a straight model edge or a reference axis earlier in the history. The box may still be empty while the user picks. */
function axisRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'edge') return;
  if (ref.kind !== 'datum') throw new CommandError(t('cmd.axisMustBeStraightEdge'));
  datumFeature(doc, ref, index, 'refAxis');
}

/** A point reference names a model vertex or a reference point earlier in the history. */
function pointRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'vertex') return;
  if (ref.kind !== 'datum') throw new CommandError(t('cmd.mustPickPoint'));
  datumFeature(doc, ref, index, 'refPoint');
}

/**
 * Structure of a reference plane definition (C3.2). References may still be empty while the user
 * picks them in the PropertyManager; the rebuild reports what is missing.
 */
function planeDefinition(doc: PartDoc, def: PlaneDefinition, index: number): void {
  switch (def.mode) {
    case 'offset':
      planeRef(doc, def.plane, index);
      return;
    case 'angle':
      planeRef(doc, def.plane, index);
      axisRef(doc, def.axis, index);
      return;
    case 'threePoint':
      if (def.points.length > 3) throw new CommandError(t('cmd.threePointNeedsVertices'));
      for (const p of def.points) pointRef(doc, p, index);
      return;
    case 'parallel':
      planeRef(doc, def.plane, index);
      pointRef(doc, def.point, index);
      return;
    case 'perpendicular':
      axisRef(doc, def.axis, index);
      pointRef(doc, def.point, index);
      return;
    case 'midplane':
      planeRef(doc, def.plane, index);
      planeRef(doc, def.plane2, index);
      return;
    case 'tangent':
      planeRef(doc, def.plane, index);
      if (def.face.kind !== 'face') throw new CommandError(t('cmd.tangentNeedsFace'));
      return;
  }
}

/** Structure of a reference axis definition (C3.3). */
function axisDefinition(doc: PartDoc, def: AxisDefinition, index: number): void {
  switch (def.mode) {
    case 'edge':
      if (def.edge.kind !== 'edge') throw new CommandError(t('cmd.axisMustBeStraightEdge'));
      return;
    case 'twoPoints':
      if (def.points.length > 2) throw new CommandError(t('cmd.twoPointsNeedsTwo'));
      for (const p of def.points) pointRef(doc, p, index);
      return;
    case 'cylinder':
      if (def.face.kind !== 'face') throw new CommandError(t('cmd.axisNeedsFace'));
      return;
    case 'planes':
      planeRef(doc, def.plane, index);
      planeRef(doc, def.plane2, index);
      return;
  }
}

/** Structure of a reference point definition (C3.5). */
function pointDefinition(doc: PartDoc, def: PointDefinition, index: number): void {
  switch (def.mode) {
    case 'coords':
      return;
    case 'center':
      if (def.element.kind !== 'edge' && def.element.kind !== 'face') throw new CommandError(t('cmd.centerNeedsEdgeOrFace'));
      return;
    case 'axisPlane':
      axisRef(doc, def.axis, index);
      planeRef(doc, def.plane, index);
      return;
  }
}

/** A direction is a straight edge, a reference axis, or a plane (its normal): a model face, a default plane, or a reference plane or axis earlier in the history. */
function directionRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'face' || (ref.kind === 'datum' && isDatumPlaneName(ref.name))) return;
  if (ref.kind === 'datum') {
    const at = doc.features.find((g) => g.id === ref.name);
    if (!at || doc.features.indexOf(at) >= index || (at.type !== 'refAxis' && at.type !== 'refPlane')) throw new CommandError(t('cmd.datumMustBeEarlier'));
  } else if (ref.kind !== 'edge') throw new CommandError(t('cmd.coordSysDirection'));
}

/** A coordinate system's origin is a point, its two directions are axes or planes (their normals). */
function coordSysRefs(doc: PartDoc, f: Pick<CoordSysFeature, 'origin' | 'x' | 'y'>, index: number): void {
  if (f.origin) pointRef(doc, f.origin, index);
  directionRef(doc, f.x, index);
  directionRef(doc, f.y, index);
}

/** A circular pattern turns about a straight edge, a reference axis, or the axis of a cylindrical face. */
function rotationAxisRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'face') return;
  axisRef(doc, ref, index);
}

/** A mirror reflects features that are earlier in the history and can be repeated, or bodies; across a plane. */
function mirrorRefs(doc: PartDoc, f: Pick<MirrorFeature, 'target' | 'plane' | 'seeds' | 'bodies'>, index: number): void {
  planeRef(doc, f.plane, index);
  if (f.bodies.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.combineOnlyBodies'));
  if (f.target === 'features') patternSeeds(doc, f.seeds, index);
}

/** A pattern repeats features that are earlier in the history and can be repeated; which direction and where it turns is for the rebuild to check. */
function patternSeeds(doc: PartDoc, seeds: Id[], index: number): void {
  if (new Set(seeds).size !== seeds.length) throw new CommandError(t('cmd.patternSeedTwice'));
  for (const id of seeds) {
    const at = doc.features.findIndex((g) => g.id === id);
    if (at < 0 || at >= index) throw new CommandError(t('cmd.patternSeedEarlier'));
    if (!canBeSeed(doc.features[at]!)) throw new CommandError(t('cmd.patternSeedType', { name: doc.features[at]!.name }));
  }
}

function patternRefs(doc: PartDoc, f: Pick<PatternFeature, 'seeds' | 'def'>, index: number): void {
  patternSeeds(doc, f.seeds, index);
  if (f.def.mode === 'linear') {
    directionRef(doc, f.def.dir1.ref, index);
    if (f.def.dir2) directionRef(doc, f.def.dir2.ref, index);
  } else rotationAxisRef(doc, f.def.axis, index);
}

/** A Combine takes bodies, and its main body is not one of its tools. The boxes may still be empty while the user picks. */
function combineRefs(main: Ref, tools: Ref[]): void {
  if ((main.name && main.kind !== 'body') || tools.some((r) => r.kind !== 'body')) throw new CommandError(t('cmd.combineOnlyBodies'));
  if (main.name && tools.some((r) => r.name === main.name)) throw new CommandError(t('cmd.combineMainIsTool'));
}

/** A sweep's profile and path are two different sketches, both earlier in the history. */
function sweepSketches(doc: PartDoc, f: SweepFeature, index: number): void {
  const label = t('feature.sweep');
  sketchBefore(doc, f.sketch, index, label);
  sketchBefore(doc, f.path, index, label);
  if (f.path === f.sketch) throw new CommandError(t('cmd.sweepPathIsProfile'));
}

/** A loft's sections are different sketches, all earlier in the history (how many is for the rebuild to say: the PropertyManager adds them one by one). */
function loftSections(doc: PartDoc, f: LoftFeature, index: number): void {
  const label = t('feature.loft');
  for (const id of f.sections) sketchBefore(doc, id, index, label);
  if (new Set(f.sections).size !== f.sections.length) throw new CommandError(t('cmd.loftSectionTwice'));
}

function revolveAxis(sketch: SketchFeature, axis: Id): void {
  if (sketch.entities.find((e) => e.id === axis)?.type !== 'line') throw new CommandError(t('cmd.revolveAxisMustBeLine'));
}

/** Ids a feature brings into the document: its own and, for a sketch, those of its contents. */
function featureIds(f: Feature): Id[] {
  return f.type === 'sketch' ? [f.id, ...f.entities.map((e) => e.id), ...f.constraints.map((c) => c.id)] : [f.id];
}

function assertFresh(doc: PartDoc, ids: Id[]): void {
  const inUse = new Set(idsInUse(doc));
  const seen = new Set<Id>();
  for (const id of ids) {
    if (inUse.has(id) || seen.has(id)) throw new CommandError(t('cmd.idInUse', { id }));
    seen.add(id);
  }
}

function validateNewFeature(doc: PartDoc, f: Feature, index: number): void {
  if (!f.name.trim()) throw new CommandError(t('cmd.nameEmpty'));
  switch (f.type) {
    case 'sketch': {
      if (f.plane.kind !== 'datum' && f.plane.kind !== 'face') throw new CommandError(t('cmd.sketchNeedsPlane'));
      planeRef(doc, f.plane, index);
      const err = sketchError(f);
      if (err) throw new CommandError(err);
      return;
    }
    case 'extrude':
      sketchBefore(doc, f.sketch, index, t('feature.extrude'));
      endCondition(f.dir1);
      if (f.dir2) endCondition(f.dir2);
      return;
    case 'revolve':
      revolveAxis(sketchBefore(doc, f.sketch, index, t('feature.revolve')), f.axis);
      return;
    case 'sweep':
      sweepSketches(doc, f, index);
      return;
    case 'loft':
      loftSections(doc, f, index);
      return;
    case 'rib':
      sketchBefore(doc, f.sketch, index, t('feature.rib'));
      return;
    case 'fillet':
      if (f.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.filletOnlyEdges'));
      return;
    case 'chamfer':
      if (f.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.chamferOnlyEdges'));
      return;
    case 'refPlane':
      planeDefinition(doc, f.def, index);
      return;
    case 'refAxis':
      axisDefinition(doc, f.def, index);
      return;
    case 'refPoint':
      pointDefinition(doc, f.def, index);
      return;
    case 'coordSys':
      coordSysRefs(doc, f, index);
      return;
    case 'pattern':
      patternRefs(doc, f, index);
      return;
    case 'mirror':
      mirrorRefs(doc, f, index);
      return;
    case 'deleteFace':
      if (f.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.deleteFaceOnlyFaces'));
      return;
    case 'moveFace':
      if (f.face.kind !== 'face') throw new CommandError(t('cmd.moveFaceOnlyFace'));
      return;
    case 'combine':
      combineRefs(f.main, f.tools);
      return;
    case 'importedBody':
      if (!doc.blobs.some((b) => b.id === f.blob)) throw new CommandError(t('cmd.importDataNotFound', { id: f.blob }));
      return;
  }
}

/** Inserts a feature at `index` (at or above the rollback bar) after checking it. */
function insert(draft: Draft<PartDoc>, feature: Feature, index: number): void {
  const limit = draft.rollbackIndex ?? draft.features.length;
  if (!Number.isInteger(index) || index < 0 || index > limit) throw new CommandError(t('cmd.insertOutOfRange', { index }));
  const ids = featureIds(feature);
  assertFresh(draft as PartDoc, ids);
  validateNewFeature(draft as PartDoc, feature, index);
  draft.features.splice(index, 0, feature as Draft<Feature>);
  checkExprs(draft as PartDoc, feature); // in place, so a sketch's own dimensions can refer to each other
  if (draft.rollbackIndex !== null) draft.rollbackIndex += 1;
  countersFor(ids, draft.idCounters);
}

/** A name an expression can use bare: letters, digits and underscores, not starting with a digit. */
const NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** Rewrites the names in every expression of the document (variables' and features'). */
function rewriteNames(draft: Draft<PartDoc>, map: (ref: NameRef) => NameRef | null): void {
  const next = renameInDoc(current(draft) as PartDoc, map);
  draft.variables = next.variables as Draft<PartDoc['variables']>;
  draft.features = next.features as Draft<PartDoc['features']>;
}

/** A variable must evaluate: no unknown name, no cycle through it. */
function checkVariable(doc: PartDoc, id: Id): void {
  const v = doc.variables.find((x) => x.id === id)!;
  const r = new Parameters(doc).variableValue(v);
  if ('error' in r) throw new CommandError(r.error);
}

/** Immer recipe: mutates the draft or throws CommandError (the document is then left untouched). */
export function mutate(draft: Draft<PartDoc>, cmd: Command): void {
  switch (cmd.type) {
    case 'insertFeature':
      return insert(draft, cmd.feature, cmd.index);
    case 'importBody': {
      const { blob, feature } = cmd;
      if (!/^[0-9a-f]{64}$/.test(blob.sha256)) throw new CommandError(t('cmd.importHashInvalid'));
      if (feature.blob !== blob.id) throw new CommandError(t('cmd.importBodyMustUseData'));
      assertFresh(draft as PartDoc, [blob.id]);
      draft.blobs.push(blob);
      countersFor([blob.id], draft.idCounters);
      return insert(draft, feature, cmd.index); // throws before anything is kept if the feature is wrong
    }
    case 'setDimension': {
      const f = sketchOf(draft, cmd.featureId);
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || !isDimension(c)) throw new CommandError(t('cmd.dimensionNotFound', { id: cmd.constraintId }));
      c.value = cmd.value;
      checkExprs(draft as PartDoc, f as Feature, new Set([c.id])); // after the change, so a cycle through it is seen
      return;
    }
    case 'setDimensionDriving': {
      const f = sketchOf(draft, cmd.featureId);
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || !isDimension(c)) throw new CommandError(t('cmd.dimensionNotFound', { id: cmd.constraintId }));
      if (cmd.driving) {
        delete c.driving;
        if (cmd.value !== undefined) c.value = cmd.value;
        checkExprs(draft as PartDoc, f as Feature, new Set([c.id]));
        return;
      }
      // a driven dimension has no value of its own, so nothing may still use it
      const before = resolveDoc(current(draft) as PartDoc).problems;
      c.driving = false;
      const after = resolveDoc(current(draft) as PartDoc).problems;
      for (const id of after.keys()) if (!before.has(id)) throw new CommandError(t('cmd.dimensionStillUsed', { name: dimensionName(c) }));
      return;
    }
    case 'setEndCondition': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude') throw new CommandError(t('cmd.onlyExtrudeHasEnd'));
      if (cmd.value === null) {
        if (cmd.dir === 'dir1') throw new CommandError(t('cmd.dir1Stays'));
        delete f.dir2;
        delete f.draft2;
        return;
      }
      endCondition(cmd.value);
      f[cmd.dir] = cmd.value;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setDraft': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude') throw new CommandError(t('cmd.onlyExtrudeHasEnd'));
      const key = cmd.dir === 'dir1' ? 'draft1' : 'draft2';
      if (cmd.draft === null) delete f[key];
      else f[key] = { angle: cmd.draft.angle, ...(cmd.draft.inward ? { inward: true } : {}) };
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setThin': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude' && f.type !== 'revolve') throw new CommandError(t('cmd.onlyExtrudeRevolveThin'));
      if (cmd.thin === null) delete f.thin;
      else f.thin = { mode: cmd.thin.mode, thickness: cmd.thin.thickness, ...(cmd.thin.thickness2 === undefined ? {} : { thickness2: cmd.thin.thickness2 }), ...(cmd.thin.reverse ? { reverse: true } : {}) };
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setRevolveCondition': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'revolve') throw new CommandError(t('cmd.onlyRevolveHasAngle'));
      f.dir1 = cmd.value;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setRevolveAxis': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'revolve') throw new CommandError(t('cmd.onlyRevolveHasAxis'));
      const sketch = draft.features.find((x) => x.id === f.sketch);
      if (sketch?.type !== 'sketch') throw new CommandError(t('cmd.revolveSketchNotFound'));
      revolveAxis(sketch as SketchFeature, cmd.axis);
      f.axis = cmd.axis;
      return;
    }
    case 'setSweepPath': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'sweep') throw new CommandError(t('cmd.onlySweepHasPath'));
      sweepSketches(draft as PartDoc, { ...(f as SweepFeature), path: cmd.path }, draft.features.findIndex((x) => x.id === f.id));
      f.path = cmd.path;
      return;
    }
    case 'setLoftSections': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'loft') throw new CommandError(t('cmd.onlyLoftHasSections'));
      loftSections(draft as PartDoc, { ...(f as LoftFeature), sections: cmd.sections }, draft.features.findIndex((x) => x.id === f.id));
      f.sections = [...cmd.sections];
      return;
    }
    case 'setRefPlane': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'refPlane') throw new CommandError(t('cmd.onlyRefPlaneHasParams'));
      planeDefinition(draft as PartDoc, cmd.def, draft.features.findIndex((x) => x.id === f.id));
      f.def = cmd.def;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setRefAxis': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'refAxis') throw new CommandError(t('cmd.onlyRefAxisHasParams'));
      axisDefinition(draft as PartDoc, cmd.def, draft.features.findIndex((x) => x.id === f.id));
      f.def = cmd.def;
      return;
    }
    case 'setRefPoint': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'refPoint') throw new CommandError(t('cmd.onlyRefPointHasParams'));
      pointDefinition(draft as PartDoc, cmd.def, draft.features.findIndex((x) => x.id === f.id));
      f.def = cmd.def;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setMirror': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'mirror') throw new CommandError(t('cmd.onlyMirrorHasParams'));
      mirrorRefs(draft as PartDoc, cmd.value, draft.features.findIndex((x) => x.id === f.id));
      f.target = cmd.value.target;
      f.plane = cmd.value.plane;
      f.seeds = [...cmd.value.seeds];
      f.bodies = [...cmd.value.bodies];
      if (cmd.value.merge === false) f.merge = false;
      else delete f.merge;
      return;
    }
    case 'setPattern': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'pattern') throw new CommandError(t('cmd.onlyPatternHasParams'));
      patternRefs(draft as PartDoc, cmd, draft.features.findIndex((x) => x.id === f.id));
      f.seeds = [...cmd.seeds];
      f.def = cmd.def;
      if (cmd.skip && cmd.skip.length > 0) f.skip = [...cmd.skip];
      else delete f.skip;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setCoordSys': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'coordSys') throw new CommandError(t('cmd.onlyCoordSysHasParams'));
      coordSysRefs(draft as PartDoc, cmd.value, draft.features.findIndex((x) => x.id === f.id));
      const v = cmd.value;
      if (v.origin) f.origin = v.origin;
      else delete f.origin;
      f.x = v.x;
      f.y = v.y;
      if (v.flipX) f.flipX = true;
      else delete f.flipX;
      if (v.flipY) f.flipY = true;
      else delete f.flipY;
      return;
    }
    case 'setChamfer': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'chamfer') throw new CommandError(t('cmd.onlyChamferHasParams'));
      f.mode = cmd.value.mode;
      f.distance = cmd.value.distance;
      f.second = cmd.value.second;
      if (cmd.value.flip) f.flip = true;
      else delete f.flip;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setFilletRadius': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet') throw new CommandError(t('cmd.onlyFilletHasRadius'));
      f.radius = cmd.value;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setEdges': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet' && f.type !== 'chamfer') throw new CommandError(t('cmd.onlyEdgeFeaturesPickEdges'));
      if (cmd.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.mustPickEdges'));
      f.edges = cmd.edges;
      return;
    }
    case 'setFaces': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'deleteFace') throw new CommandError(t('cmd.onlyDeleteFaceHasFaces'));
      if (cmd.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.deleteFaceOnlyFaces'));
      f.faces = cmd.faces;
      if (cmd.hole) f.hole = true;
      else delete f.hole;
      return;
    }
    case 'setHole': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'hole') throw new CommandError(t('cmd.onlyHoleHasParams'));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed, sketch: f.sketch } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.hole);
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setRib': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'rib') throw new CommandError(t('cmd.onlyRibHasParams'));
      const keep = { id: f.id, type: f.type, name: f.name, suppressed: f.suppressed, sketch: f.sketch } as const;
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, keep, cmd.rib);
      if (f.flip === undefined) delete f.flip;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setDraftFeature': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'draft') throw new CommandError(t('cmd.onlyDraftHasParams'));
      if (cmd.neutral.kind !== 'face' && cmd.neutral.kind !== 'datum') throw new CommandError(t('cmd.draftNeutralKind'));
      if (cmd.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.draftOnlyFaces'));
      f.neutral = cmd.neutral;
      f.faces = cmd.faces;
      f.angle = cmd.angle;
      if (cmd.reverse) f.reverse = true;
      else delete f.reverse;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setShell': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'shell') throw new CommandError(t('cmd.onlyShellHasParams'));
      if (cmd.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.shellOnlyFaces'));
      f.faces = cmd.faces;
      f.thickness = cmd.thickness;
      if (cmd.outward) f.outward = true;
      else delete f.outward;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setImportOptions': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'importedBody') throw new CommandError(t('cmd.onlyImportHasOptions'));
      if (cmd.sewTolerance === undefined) delete f.sewTolerance;
      else f.sewTolerance = cmd.sewTolerance;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setMerge': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude' && f.type !== 'revolve' && f.type !== 'sweep' && f.type !== 'loft' && f.type !== 'importedBody') throw new CommandError(t('cmd.onlyBossMerges'));
      if (cmd.merge) delete f.merge;
      else f.merge = false;
      return;
    }
    case 'setContours': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude' && f.type !== 'revolve' && f.type !== 'sweep') throw new CommandError(t('cmd.onlyExtrudeRevolveContours'));
      if (cmd.contours === null) {
        delete f.contours;
        return;
      }
      if (cmd.contours.length === 0 || cmd.contours.some((c) => c.length === 0 || c.some((id) => typeof id !== 'string' || id === ''))) throw new CommandError(t('cmd.contoursEmpty'));
      f.contours = cmd.contours.map((c) => [...c]);
      return;
    }
    case 'setCombine': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'combine') throw new CommandError(t('cmd.onlyCombineHasBodies'));
      combineRefs(cmd.main, cmd.tools);
      f.op = cmd.op;
      f.main = cmd.main;
      f.tools = cmd.tools;
      return;
    }
    case 'setBody': {
      if (!cmd.bodyId) throw new CommandError(t('cmd.bodyIdEmpty'));
      const props = { ...(draft.bodies[cmd.bodyId] ?? {}) };
      if (cmd.name !== undefined) {
        const name = cmd.name.trim();
        if (name) props.name = name;
        else delete props.name;
      }
      if (cmd.reference !== undefined) {
        if (cmd.reference) props.reference = true;
        else delete props.reference;
      }
      if (Object.keys(props).length === 0) delete draft.bodies[cmd.bodyId];
      else draft.bodies[cmd.bodyId] = props;
      return;
    }
    case 'setMoveFace': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'moveFace') throw new CommandError(t('cmd.onlyMoveFaceHasParams'));
      if (cmd.face.kind !== 'face') throw new CommandError(t('cmd.moveFaceOnlyFace'));
      f.face = cmd.face;
      f.distance = cmd.distance;
      checkExprs(draft as PartDoc, f as Feature);
      return;
    }
    case 'setSuppressed': {
      const targets = cmd.featureIds.map((id) => feature(draft, id)); // all exist, or nothing changes
      for (const f of targets) f.suppressed = cmd.value;
      return;
    }
    case 'deleteFeatures': {
      const ids = new Set(cmd.featureIds);
      for (const id of ids) feature(draft, id);
      if (ids.size === 0) return;
      const doomed = draft.features.filter((f) => ids.has(f.id)) as Feature[];
      countersFor(doomed.flatMap(featureIds), draft.idCounters); // deleted ids are never handed out again
      if (draft.rollbackIndex !== null) {
        draft.rollbackIndex -= draft.features.slice(0, draft.rollbackIndex).filter((f) => ids.has(f.id)).length;
      }
      draft.features = draft.features.filter((f) => !ids.has(f.id));
      for (const id of ids) delete draft.visibility[id];
      // what was said about the bodies a deleted feature made goes with it (their ids are the feature's, `<id>#2` …)
      for (const body of Object.keys(draft.bodies)) if (ids.has(bodyFeature(body))) delete draft.bodies[body];
      for (const key of Object.keys(draft.visibility)) if (isBodyKey(key) && ids.has(bodyFeature(key.slice('body:'.length)))) delete draft.visibility[key];
      if (draft.rollbackIndex !== null && draft.rollbackIndex >= draft.features.length) draft.rollbackIndex = null;
      // Imported data no feature uses any more is dropped too (its id stays issued).
      const used = new Set(draft.features.flatMap((f) => (f.type === 'importedBody' ? [f.blob] : [])));
      draft.blobs = draft.blobs.filter((b) => used.has(b.id));
      return;
    }
    case 'renameFeature': {
      const name = cmd.name.trim();
      if (!name) throw new CommandError(t('cmd.nameEmpty'));
      const target = feature(draft, cmd.featureId);
      const old = target.name;
      target.name = name;
      if (target.type === 'sketch' && old !== name) rewriteNames(draft, (r) => (r.kind === 'dimension' && r.owner === old ? { ...r, owner: name } : null));
      return;
    }
    case 'setRollback': {
      const n = draft.features.length;
      if (cmd.index !== null && (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index > n)) {
        throw new CommandError(t('cmd.rollbackOutOfRange', { index: cmd.index }));
      }
      draft.rollbackIndex = cmd.index === n ? null : cmd.index;
      return;
    }
    case 'addSketchItems': {
      const f = sketchOf(draft, cmd.featureId);
      const ids = [...cmd.entities.map((e) => e.id), ...cmd.constraints.map((c) => c.id)];
      if (ids.length === 0) return;
      assertFresh(draft as PartDoc, ids);
      const err = sketchError({ entities: [...f.entities, ...cmd.entities], constraints: [...f.constraints, ...cmd.constraints] });
      if (err) throw new CommandError(err);
      f.entities.push(...(cmd.entities as Draft<SketchEntity>[]));
      f.constraints.push(...(cmd.constraints as Draft<SketchConstraint>[]));
      checkExprs(draft as PartDoc, f as Feature, new Set(ids));
      countersFor(ids, draft.idCounters);
      return;
    }
    case 'editSketch': {
      const f = sketchOf(draft, cmd.featureId);
      for (const patch of cmd.entities ?? []) {
        const e = f.entities.find((x) => x.id === patch.id);
        if (!e) throw new CommandError(t('cmd.sketchItemNotFound', { id: patch.id }));
        for (const [field, value] of Object.entries(patch.set)) {
          if (!(field in e)) throw new CommandError(t('cmd.sketchEditField', { id: patch.id, field }));
          (e as unknown as Record<string, Id>)[field] = value;
        }
      }
      for (const patch of cmd.constraints ?? []) {
        const c = f.constraints.find((x) => x.id === patch.id);
        if (!c) throw new CommandError(t('cmd.sketchItemNotFound', { id: patch.id }));
        for (const [field, value] of Object.entries(patch.set)) {
          if (value === undefined) delete (c as unknown as Record<string, unknown>)[field];
          else (c as unknown as Record<string, unknown>)[field] = value;
        }
      }
      // Order: patch, add, then remove — so what the new entities use is not taken for an orphan by the removal.
      const added = cmd.add ?? { entities: [], constraints: [] };
      const ids = [...added.entities.map((e) => e.id), ...added.constraints.map((c) => c.id)];
      if (ids.length > 0) assertFresh(draft as PartDoc, ids);
      f.entities.push(...(added.entities as Draft<SketchEntity>[]));
      f.constraints.push(...(added.constraints as Draft<SketchConstraint>[]));
      if (cmd.remove && cmd.remove.length > 0) {
        const present = new Set<Id>([...f.entities.map((e) => e.id), ...f.constraints.map((c) => c.id)]);
        for (const id of cmd.remove) if (!present.has(id)) throw new CommandError(t('cmd.sketchItemNotFound', { id }));
        const removed = removalSet(f as SketchFeature, cmd.remove);
        countersFor(removed, draft.idCounters);
        f.entities = f.entities.filter((e) => !removed.has(e.id));
        f.constraints = f.constraints.filter((c) => !removed.has(c.id));
      }
      const err = sketchError(f as SketchFeature);
      if (err) throw new CommandError(err);
      checkExprs(draft as PartDoc, f as Feature);
      countersFor(ids, draft.idCounters);
      return;
    }
    case 'removeSketchItems': {
      const f = sketchOf(draft, cmd.featureId);
      const present = new Set<Id>([...f.entities.map((e) => e.id), ...f.constraints.map((c) => c.id)]);
      for (const id of cmd.ids) if (!present.has(id)) throw new CommandError(t('cmd.sketchItemNotFound', { id }));
      if (cmd.ids.length === 0) return;
      const removed = removalSet(f as SketchFeature, cmd.ids);
      countersFor(removed, draft.idCounters); // deleted ids stay issued and are never handed out again
      f.entities = f.entities.filter((e) => !removed.has(e.id));
      f.constraints = f.constraints.filter((c) => !removed.has(c.id));
      return;
    }
    case 'setSketchGeometry': {
      const f = sketchOf(draft, cmd.featureId);
      const byId = new Map(f.entities.map((e) => [e.id, e]));
      for (const p of cmd.points) {
        const e = byId.get(p.id);
        if (e?.type !== 'point') throw new CommandError(t('cmd.notSketchPoint', { id: p.id }));
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new CommandError(t('cmd.pointCoordinateInvalid', { id: p.id }));
        e.x = p.x;
        e.y = p.y;
      }
      for (const r of cmd.radii ?? []) {
        const e = byId.get(r.id);
        if (e?.type !== 'circle') throw new CommandError(t('cmd.notCircle', { id: r.id }));
        if (!(Number.isFinite(r.radius) && r.radius > 0)) throw new CommandError(t('cmd.radiusMustBePositive', { id: r.id }));
        e.radius = r.radius;
      }
      return;
    }
    case 'setVisibility': {
      for (const key of cmd.keys) if (!isHideable(draft as PartDoc, key)) throw new CommandError(t('cmd.cannotHide', { key }));
      for (const key of cmd.keys) draft.visibility[key] = cmd.value;
      return;
    }
    case 'replaceRef': {
      const at = draft.features.findIndex((f) => f.id === cmd.featureId);
      if (at < 0) throw new CommandError(t('cmd.featureNotFound', { id: cmd.featureId }));
      const { from, to } = cmd;
      if (from.kind !== 'face' && from.kind !== 'edge' && from.kind !== 'vertex') throw new CommandError(t('cmd.replaceOnlyElements'));
      if (to.kind !== from.kind) throw new CommandError(t('cmd.replaceSameKind'));
      const { feature: next, replaced } = mapRefs(current(draft.features[at]!) as Feature, (r) => (r.kind === from.kind && r.name === from.name ? to : r));
      if (replaced === 0) throw new CommandError(t('cmd.replaceRefMissing', { name: from.name }));
      // Two edges of a fillet may now name the same edge: keep one.
      if (next.type === 'fillet' || next.type === 'chamfer') next.edges = next.edges.filter((r, i) => next.edges.findIndex((x) => x.kind === r.kind && x.name === r.name) === i);
      if (next.type === 'deleteFace') next.faces = next.faces.filter((r, i) => next.faces.findIndex((x) => x.name === r.name) === i);
      draft.features[at] = next as Draft<Feature>;
      return;
    }
    case 'addVariable': {
      const { variable } = cmd;
      if (!NAME.test(variable.name)) throw new CommandError(t('cmd.variableNameInvalid', { name: variable.name }));
      if (draft.variables.some((v) => v.name === variable.name)) throw new CommandError(t('cmd.variableNameTaken', { name: variable.name }));
      assertFresh(draft as PartDoc, [variable.id]);
      draft.variables.push(variable as Draft<Variable>);
      countersFor([variable.id], draft.idCounters);
      checkVariable(draft as PartDoc, variable.id);
      return;
    }
    case 'setVariable': {
      const at = draft.variables.findIndex((v) => v.id === cmd.id);
      if (at < 0) throw new CommandError(t('cmd.variableNotFound', { id: cmd.id }));
      const old = draft.variables[at]!.name;
      if (cmd.name !== undefined && cmd.name !== old) {
        if (!NAME.test(cmd.name)) throw new CommandError(t('cmd.variableNameInvalid', { name: cmd.name }));
        if (draft.variables.some((v) => v.name === cmd.name)) throw new CommandError(t('cmd.variableNameTaken', { name: cmd.name }));
        const name = cmd.name;
        draft.variables[at]!.name = name;
        rewriteNames(draft, (r) => (r.kind === 'variable' && r.name === old ? { kind: 'variable', name } : null));
      }
      if (cmd.expr !== undefined) draft.variables[at]!.expr = cmd.expr;
      checkVariable(draft as PartDoc, cmd.id);
      return;
    }
    case 'deleteVariable': {
      const v = draft.variables.find((x) => x.id === cmd.id);
      if (!v) throw new CommandError(t('cmd.variableNotFound', { id: cmd.id }));
      const users = variableUsers(draft as PartDoc, v.name);
      const names = [...users.variables, ...users.features.map((id) => draft.features.find((f) => f.id === id)?.name ?? id)];
      if (names.length > 0) throw new CommandError(t('cmd.variableInUse', { name: v.name, users: names.join(t('cmd.listSeparator')) }));
      countersFor([v.id], draft.idCounters);
      draft.variables = draft.variables.filter((x) => x.id !== cmd.id);
      return;
    }
    case 'setProperty': {
      const name = cmd.name.trim();
      if (!name) throw new CommandError(t('cmd.propertyNameEmpty'));
      draft.properties[name] = cmd.value;
      return;
    }
    case 'deleteProperty': {
      if (!(cmd.name in draft.properties)) throw new CommandError(t('cmd.propertyNotFound', { name: cmd.name }));
      delete draft.properties[cmd.name];
      return;
    }
    case 'setDimensionLabel': {
      const f = sketchOf(draft, cmd.featureId);
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || !isDimension(c)) throw new CommandError(t('cmd.dimensionNotFound', { id: cmd.constraintId }));
      const before = dimensionName(c);
      const label = cmd.label.trim();
      if (label) {
        if (!NAME.test(label)) throw new CommandError(t('cmd.dimensionLabelInvalid', { name: label }));
        if (f.constraints.some((x) => x.id !== c.id && isDimension(x) && dimensionName(x) === label)) throw new CommandError(t('cmd.dimensionLabelTaken', { name: label }));
        c.label = label;
      } else delete c.label;
      const after = dimensionName(c as SketchConstraint);
      if (after !== before) rewriteNames(draft, (r) => (r.kind === 'dimension' && r.name === before && r.owner === f.name ? { ...r, name: after } : null));
      return;
    }
    case 'setConstruction': {
      const f = sketchOf(draft, cmd.featureId);
      for (const id of cmd.ids) {
        const e = f.entities.find((x) => x.id === id);
        if (!e || e.type === 'point') throw new CommandError(t('cmd.constructionOnlyCurves', { id }));
        if (cmd.value) e.construction = true;
        else delete e.construction;
      }
      return;
    }
  }
}

/** Pure command application: returns a new document, the input is never modified. */
export function applyCommand(doc: PartDoc, cmd: Command): PartDoc {
  return produce(doc, (d) => mutate(d, cmd));
}
