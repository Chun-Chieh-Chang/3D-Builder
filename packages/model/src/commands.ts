import { t } from '@3db/i18n';
import { current, produce, type Draft } from 'immer';
import { countersFor, type Id } from './ids';
import type { BlobRef, ChamferFeature, EndCondition, Expr, Feature, ImportedBodyFeature, PartDoc, PlaneDefinition, Ref, RevolveCondition, SketchConstraint, SketchEntity, SketchFeature } from './schema';
import { isDatumPlaneName } from './datums';
import { mapRefs } from './refs';
import { isHideable } from './visibility';
import { isDimension } from './schema';
import { evalAngle, evalLength, ExprError } from './expr';
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
  | { type: 'replaceRef'; featureId: Id; from: Ref; to: Ref };

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

function positiveLength(value: Expr): void {
  let v: number;
  try {
    v = evalLength(value);
  } catch (e) {
    throw new CommandError(e instanceof ExprError ? e.message : String(e));
  }
  if (!(v > 0)) throw new CommandError(t('cmd.mustBePositive', { value }));
}

function angleIn(value: Expr, min: number, max: number, label: string): void {
  let v: number;
  try {
    v = evalAngle(value);
  } catch (e) {
    throw new CommandError(e instanceof ExprError ? e.message : String(e));
  }
  if (!(v > min && v <= max + 1e-12)) throw new CommandError(t('cmd.angleOutOfRange', { label, value }));
}

function endCondition(value: EndCondition): void {
  if ('depth' in value) positiveLength(value.depth);
  if (value.type === 'upToFace' && value.face.kind !== 'face') throw new CommandError(t('cmd.upToFaceNeedsFace'));
}

function revolveCondition(value: RevolveCondition): void {
  angleIn(value.angle, 0, 2 * Math.PI, t('cmd.revolveAngleRange'));
}

function chamferParams(value: Pick<ChamferFeature, 'mode' | 'distance' | 'second'>): void {
  positiveLength(value.distance);
  if (value.mode === 'distanceDistance') positiveLength(value.second);
  else angleIn(value.second, 0, Math.PI / 2 - 1e-9, t('cmd.chamferAngleRange'));
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
      positiveLength(def.distance);
      return;
    case 'angle':
      planeRef(doc, def.plane, index);
      if (def.axis.kind !== 'edge') throw new CommandError(t('cmd.axisMustBeStraightEdge'));
      angleIn(def.angle, -1e-12, 2 * Math.PI, t('cmd.planeAngleRange'));
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
      revolveCondition(f.dir1);
      return;
    case 'fillet':
      if (f.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.filletOnlyEdges'));
      positiveLength(f.radius);
      return;
    case 'chamfer':
      if (f.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.chamferOnlyEdges'));
      chamferParams(f);
      return;
    case 'refPlane':
      planeDefinition(doc, f.def, index);
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
  if (draft.rollbackIndex !== null) draft.rollbackIndex += 1;
  countersFor(ids, draft.idCounters);
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
      if (c.type === 'angle') {
        try {
          evalAngle(cmd.value);
        } catch (e) {
          throw new CommandError(e instanceof ExprError ? e.message : String(e));
        }
      } else {
        positiveLength(cmd.value);
      }
      c.value = cmd.value;
      return;
    }
    case 'setEndCondition': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude') throw new CommandError(t('cmd.onlyExtrudeHasEnd'));
      endCondition(cmd.value);
      f[cmd.dir] = cmd.value;
      return;
    }
    case 'setRevolveCondition': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'revolve') throw new CommandError(t('cmd.onlyRevolveHasAngle'));
      revolveCondition(cmd.value);
      f.dir1 = cmd.value;
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
      return;
    }
    case 'setChamfer': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'chamfer') throw new CommandError(t('cmd.onlyChamferHasParams'));
      chamferParams(cmd.value);
      f.mode = cmd.value.mode;
      f.distance = cmd.value.distance;
      f.second = cmd.value.second;
      if (cmd.value.flip) f.flip = true;
      else delete f.flip;
      return;
    }
    case 'setFilletRadius': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet') throw new CommandError(t('cmd.onlyFilletHasRadius'));
      positiveLength(cmd.value);
      f.radius = cmd.value;
      return;
    }
    case 'setEdges': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet' && f.type !== 'chamfer') throw new CommandError(t('cmd.onlyEdgeFeaturesPickEdges'));
      if (cmd.edges.some((r) => r.kind !== 'edge')) throw new CommandError(t('cmd.mustPickEdges'));
      f.edges = cmd.edges;
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
      feature(draft, cmd.featureId).name = name;
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
      draft.features[at] = next as Draft<Feature>;
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
