import { produce, type Draft } from 'immer';
import { countersFor, type Id } from './ids';
import type { ChamferFeature, EndCondition, Expr, Feature, PartDoc, Ref, RevolveCondition, SketchConstraint, SketchEntity, SketchFeature } from './schema';
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
  | { type: 'setConstruction'; featureId: Id; ids: Id[]; value: boolean };

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

function feature(draft: Draft<PartDoc>, id: Id): Draft<Feature> {
  const f = draft.features.find((x) => x.id === id);
  if (!f) throw new CommandError(`找不到特徵：${id}`);
  return f;
}

function sketchOf(draft: Draft<PartDoc>, id: Id): Draft<SketchFeature> {
  const f = feature(draft, id);
  if (f.type !== 'sketch') throw new CommandError('只有草圖可以這樣編輯');
  return f;
}

function positiveLength(value: Expr): void {
  let v: number;
  try {
    v = evalLength(value);
  } catch (e) {
    throw new CommandError(e instanceof ExprError ? e.message : String(e));
  }
  if (!(v > 0)) throw new CommandError(`數值必須大於 0：「${value}」`);
}

function angleIn(value: Expr, min: number, max: number, label: string): void {
  let v: number;
  try {
    v = evalAngle(value);
  } catch (e) {
    throw new CommandError(e instanceof ExprError ? e.message : String(e));
  }
  if (!(v > min && v <= max + 1e-12)) throw new CommandError(`${label}：「${value}」`);
}

function endCondition(value: EndCondition): void {
  if ('depth' in value) positiveLength(value.depth);
  if (value.type === 'upToFace' && value.face.kind !== 'face') throw new CommandError('「成形至某一面」需要選擇一個面');
}

function revolveCondition(value: RevolveCondition): void {
  angleIn(value.angle, 0, 2 * Math.PI, '旋轉角度必須在 0° 到 360° 之間');
}

function chamferParams(value: Pick<ChamferFeature, 'mode' | 'distance' | 'second'>): void {
  positiveLength(value.distance);
  if (value.mode === 'distanceDistance') positiveLength(value.second);
  else angleIn(value.second, 0, Math.PI / 2 - 1e-9, '導角角度必須在 0° 到 90° 之間');
}

/** The feature's sketch must come earlier in the history. */
function sketchBefore(doc: PartDoc, sketchId: Id, index: number, label: string): SketchFeature {
  const at = doc.features.findIndex((x) => x.id === sketchId);
  const s = doc.features[at];
  if (at < 0 || at >= index || s?.type !== 'sketch') throw new CommandError(`${label}需要一個在它之前的草圖`);
  return s;
}

function revolveAxis(sketch: SketchFeature, axis: Id): void {
  if (sketch.entities.find((e) => e.id === axis)?.type !== 'line') throw new CommandError('旋轉軸必須是草圖中的一條直線（通常是中心線）');
}

/** Ids a feature brings into the document: its own and, for a sketch, those of its contents. */
function featureIds(f: Feature): Id[] {
  return f.type === 'sketch' ? [f.id, ...f.entities.map((e) => e.id), ...f.constraints.map((c) => c.id)] : [f.id];
}

function assertFresh(doc: PartDoc, ids: Id[]): void {
  const inUse = new Set(idsInUse(doc));
  const seen = new Set<Id>();
  for (const id of ids) {
    if (inUse.has(id) || seen.has(id)) throw new CommandError(`ID 已被使用：${id}`);
    seen.add(id);
  }
}

function validateNewFeature(doc: PartDoc, f: Feature, index: number): void {
  if (!f.name.trim()) throw new CommandError('名稱不可空白');
  switch (f.type) {
    case 'sketch': {
      if (f.plane.kind !== 'datum' && f.plane.kind !== 'face') throw new CommandError('草圖必須放在基準面或平面上');
      const err = sketchError(f);
      if (err) throw new CommandError(err);
      return;
    }
    case 'extrude':
      sketchBefore(doc, f.sketch, index, '伸長');
      endCondition(f.dir1);
      if (f.dir2) endCondition(f.dir2);
      return;
    case 'revolve':
      revolveAxis(sketchBefore(doc, f.sketch, index, '旋轉'), f.axis);
      revolveCondition(f.dir1);
      return;
    case 'fillet':
      if (f.edges.some((r) => r.kind !== 'edge')) throw new CommandError('圓角只能選邊線');
      positiveLength(f.radius);
      return;
    case 'chamfer':
      if (f.edges.some((r) => r.kind !== 'edge')) throw new CommandError('導角只能選邊線');
      chamferParams(f);
      return;
  }
}

/** Immer recipe: mutates the draft or throws CommandError (the document is then left untouched). */
export function mutate(draft: Draft<PartDoc>, cmd: Command): void {
  switch (cmd.type) {
    case 'insertFeature': {
      const limit = draft.rollbackIndex ?? draft.features.length;
      if (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index > limit) {
        throw new CommandError(`插入位置超出範圍：${cmd.index}`);
      }
      const ids = featureIds(cmd.feature);
      assertFresh(draft as PartDoc, ids);
      validateNewFeature(draft as PartDoc, cmd.feature, cmd.index);
      draft.features.splice(cmd.index, 0, cmd.feature as Draft<Feature>);
      if (draft.rollbackIndex !== null) draft.rollbackIndex += 1;
      countersFor(ids, draft.idCounters);
      return;
    }
    case 'setDimension': {
      const f = sketchOf(draft, cmd.featureId);
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || !isDimension(c)) throw new CommandError(`找不到尺寸：${cmd.constraintId}`);
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
      if (f.type !== 'extrude') throw new CommandError('只有伸長特徵有終止型態');
      endCondition(cmd.value);
      f[cmd.dir] = cmd.value;
      return;
    }
    case 'setRevolveCondition': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'revolve') throw new CommandError('只有旋轉特徵有旋轉角度');
      revolveCondition(cmd.value);
      f.dir1 = cmd.value;
      return;
    }
    case 'setRevolveAxis': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'revolve') throw new CommandError('只有旋轉特徵有旋轉軸');
      const sketch = draft.features.find((x) => x.id === f.sketch);
      if (sketch?.type !== 'sketch') throw new CommandError('找不到旋轉特徵的草圖');
      revolveAxis(sketch as SketchFeature, cmd.axis);
      f.axis = cmd.axis;
      return;
    }
    case 'setChamfer': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'chamfer') throw new CommandError('只有導角特徵有這些參數');
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
      if (f.type !== 'fillet') throw new CommandError('只有圓角特徵有半徑');
      positiveLength(cmd.value);
      f.radius = cmd.value;
      return;
    }
    case 'setEdges': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet' && f.type !== 'chamfer') throw new CommandError('只有圓角與導角特徵可選邊線');
      if (cmd.edges.some((r) => r.kind !== 'edge')) throw new CommandError('只能選邊線');
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
      if (draft.rollbackIndex !== null && draft.rollbackIndex >= draft.features.length) draft.rollbackIndex = null;
      return;
    }
    case 'renameFeature': {
      const name = cmd.name.trim();
      if (!name) throw new CommandError('名稱不可空白');
      feature(draft, cmd.featureId).name = name;
      return;
    }
    case 'setRollback': {
      const n = draft.features.length;
      if (cmd.index !== null && (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index > n)) {
        throw new CommandError(`回溯位置超出範圍：${cmd.index}`);
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
      for (const id of cmd.ids) if (!present.has(id)) throw new CommandError(`草圖中找不到：${id}`);
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
        if (e?.type !== 'point') throw new CommandError(`不是草圖點：${p.id}`);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new CommandError(`點 ${p.id} 的座標無效`);
        e.x = p.x;
        e.y = p.y;
      }
      for (const r of cmd.radii ?? []) {
        const e = byId.get(r.id);
        if (e?.type !== 'circle') throw new CommandError(`不是圓：${r.id}`);
        if (!(Number.isFinite(r.radius) && r.radius > 0)) throw new CommandError(`圓 ${r.id} 的半徑必須大於 0`);
        e.radius = r.radius;
      }
      return;
    }
    case 'setConstruction': {
      const f = sketchOf(draft, cmd.featureId);
      for (const id of cmd.ids) {
        const e = f.entities.find((x) => x.id === id);
        if (!e || e.type === 'point') throw new CommandError(`只有直線、圓、圓弧可以設為幾何建構線：${id}`);
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
