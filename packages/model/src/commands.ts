import { t } from '@3db/i18n';
import { current, produce, type Draft } from 'immer';
import { countersFor, type Id } from './ids';
import type { Variable, BlobRef, ChamferFeature, EndCondition, Expr, Feature, ImportedBodyFeature, PartDoc, PlaneDefinition, Ref, RevolveCondition, SketchConstraint, SketchEntity, SketchFeature } from './schema';
import { isDatumPlaneName } from './datums';
import { mapRefs } from './refs';
import { isHideable } from './visibility';
import { dimensionName, Parameters, renameInDoc, variableUsers, type ExprKind } from './params';
import type { NameRef } from './expr';
import { isDimension } from './schema';
import { ExprError } from './expr';
import { idsInUse, removalSet, sketchError } from './sketch-rules';

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
  | { type: 'setEndCondition'; featureId: Id; dir: 'dir1' | 'dir2'; value: EndCondition }
  | { type: 'setRevolveCondition'; featureId: Id; value: RevolveCondition }
  | { type: 'setRevolveAxis'; featureId: Id; axis: Id }
  | { type: 'setFilletRadius'; featureId: Id; value: Expr }
  /** Edges of an edge-based feature (fillet, chamfer). */
  | { type: 'setEdges'; featureId: Id; edges: Ref[] }
  | { type: 'setChamfer'; featureId: Id; value: Pick<ChamferFeature, 'mode' | 'distance' | 'second' | 'flip'> }
  /** Faces of a Delete Face feature (C10.2), and whether the rest of a hole goes with them. */
  | { type: 'setFaces'; featureId: Id; faces: Ref[]; hole?: boolean }
  /** How an imported body's surfaces are sewn (F2.2); without `sewTolerance` the default is used again. */
  | { type: 'setImportOptions'; featureId: Id; sewTolerance?: Expr }
  /** The face and the distance of a Move Face feature (C10.1). */
  | { type: 'setMoveFace'; featureId: Id; face: Ref; distance: Expr }
  | { type: 'setRefPlane'; featureId: Id; def: PlaneDefinition }
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
  if (value.type === 'upToFace' && value.face.kind !== 'face') throw new CommandError(t('cmd.upToFaceNeedsFace'));
}

/** The feature's sketch must come earlier in the history. */
function sketchBefore(doc: PartDoc, sketchId: Id, index: number, label: string): SketchFeature {
  const at = doc.features.findIndex((x) => x.id === sketchId);
  const s = doc.features[at];
  if (at < 0 || at >= index || s?.type !== 'sketch') throw new CommandError(t('cmd.needsEarlierSketch', { feature: label }));
  return s;
}

/** A plane reference names a default plane, a reference plane earlier in the history, or a model face. */
function planeRef(doc: PartDoc, ref: Ref, index: number): void {
  if (ref.kind === 'face') return;
  if (ref.kind !== 'datum') throw new CommandError(t('cmd.mustPickPlane'));
  if (isDatumPlaneName(ref.name)) return;
  const at = doc.features.findIndex((f) => f.id === ref.name);
  if (at < 0 || at >= index || doc.features[at]!.type !== 'refPlane') throw new CommandError(t('cmd.datumMustBeEarlier'));
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
      if (def.axis.kind !== 'edge') throw new CommandError(t('cmd.axisMustBeStraightEdge'));
      return;
    case 'threePoint':
      if (def.points.length > 3 || def.points.some((p) => p.kind !== 'vertex')) throw new CommandError(t('cmd.threePointNeedsVertices'));
      return;
  }
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
    case 'fillet':
      if (f.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.filletOnlyEdges'));
      return;
    case 'chamfer':
      if (f.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.chamferOnlyEdges'));
      return;
    case 'refPlane':
      planeDefinition(doc, f.def, index);
      return;
    case 'deleteFace':
      if (f.faces.some((r) => r.kind !== 'face')) throw new CommandError(t('cmd.deleteFaceOnlyFaces'));
      return;
    case 'moveFace':
      if (f.face.kind !== 'face') throw new CommandError(t('cmd.moveFaceOnlyFace'));
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
    case 'setEndCondition': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude') throw new CommandError(t('cmd.onlyExtrudeHasEnd'));
      endCondition(cmd.value);
      f[cmd.dir] = cmd.value;
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
    case 'setRefPlane': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'refPlane') throw new CommandError(t('cmd.onlyRefPlaneHasParams'));
      planeDefinition(draft as PartDoc, cmd.def, draft.features.findIndex((x) => x.id === f.id));
      f.def = cmd.def;
      checkExprs(draft as PartDoc, f as Feature);
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
    case 'setImportOptions': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'importedBody') throw new CommandError(t('cmd.onlyImportHasOptions'));
      if (cmd.sewTolerance === undefined) delete f.sewTolerance;
      else f.sewTolerance = cmd.sewTolerance;
      checkExprs(draft as PartDoc, f as Feature);
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
