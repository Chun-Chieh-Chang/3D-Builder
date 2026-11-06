/**
 * Feature recognition (F2.4), the document half: the features that build what `recognize` found, put in place of the imported body, and the result
 * checked against the body it replaces. All or nothing: any feature that does not rebuild, a round whose edge is not found, or a result that is not the
 * same solid is a `RecognizeError`, and the document is not changed.
 */
import { t } from '@3db/i18n';
import type { Frame, Kernel, ShapeId, SurfaceGeometry, Vec3 } from '@3db/kernel';
import {
  applyCommand,
  createEmptyPart,
  DATUM_PLANES,
  IdAllocator,
  idsInUse,
  planeFrame,
  type ChamferFeature,
  type Command,
  type DatumPlaneName,
  type Feature,
  type FilletFeature,
  type HoleFeature,
  type Id,
  type PartDoc,
  type Ref,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
} from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import type { Regenerator, RebuildResult } from '../engine';
import { addv, distanceToSharp, dot, len, recognize, RecognizeError, sub, TOL, unit, type BlendRecord, type HoleRecord, type Recognition, type SharpEdge } from './analyze';
import type { Loop, P2 } from './loops';

export { RecognizeError } from './analyze';

/** What came out: how many features of each kind, and how near the rebuilt solid is to the imported one. */
export interface ReconstructReport {
  features: Record<'sketch' | 'extrude' | 'revolve' | 'hole' | 'fillet' | 'chamfer' | 'datum', number>;
  /** Faces of the imported body, and of the body rebuilt from the features. */
  faces: [number, number];
  volume: number;
  /** |V' − V| / V, |A' − A| / A, and the volume the two solids do not share, over V. */
  volumeError: number;
  areaError: number;
  difference: number;
}

/** The relative error the rebuilt solid may have (volume, area, and the volume not shared). */
export const RECOGNIZE_TOLERANCE = 1e-6;

// ------------------------------------------------------------------ numbers and planes

/** A length or coordinate as an expression: to 1e-10 mm, never in exponent form. */
export function num(x: number): string {
  const r = Math.round(x * 1e10) / 1e10;
  const s = String(Object.is(r, -0) ? 0 : r);
  return s.includes('e') ? r.toFixed(10).replace(/\.?0+$/, '') : s;
}

const DATUMS: [DatumPlaneName, Vec3][] = [['plane:top', [0, 1, 0]], ['plane:front', [0, 0, 1]], ['plane:right', [1, 0, 0]]];

type PlaneSpec =
  | { kind: 'datum'; name: DatumPlaneName; h: number; flipped: boolean }
  | { kind: 'generic'; point: Vec3; normal: Vec3; flipped: false };

function planeSpec(normal: Vec3, point: Vec3): PlaneSpec {
  const n = unit(normal);
  for (const [name, d] of DATUMS) {
    const c = dot(n, d);
    if (Math.abs(Math.abs(c) - 1) <= 1e-12) return { kind: 'datum', name, h: dot(point, d), flipped: c < 0 };
  }
  // the point where the plane is nearest the origin, so that the plane does not depend on which point of it was given
  const k = dot(point, n);
  return { kind: 'generic', point: [n[0] * k, n[1] * k, n[2] * k], normal: n, flipped: false };
}

/** The sketch frame the plane of `planeSpec` gets in the rebuild (the default planes, their offsets, and `planeFrame` for a plane square to an axis). */
export function frameFor(normal: Vec3, point: Vec3): Frame {
  const s = planeSpec(normal, point);
  if (s.kind === 'datum') {
    const f = DATUM_PLANES[s.name];
    return { ...f, origin: addv(f.origin, f.normal, s.h) };
  }
  return planeFrame(s.point, s.normal);
}

// ------------------------------------------------------------------ building features

class Builder {
  readonly features: Feature[] = [];
  readonly counts: ReconstructReport['features'] = { sketch: 0, extrude: 0, revolve: 0, hole: 0, fillet: 0, chamfer: 0, datum: 0 };
  private readonly planes = new Map<string, Ref>();
  constructor(private readonly ids: IdAllocator) {}

  private feature<F extends Feature>(f: F): F {
    this.features.push(f);
    return f;
  }

  name(kind: keyof ReconstructReport['features']): string {
    this.counts[kind]++;
    return t(`recognize.name.${kind}` as 'recognize.name.sketch', { n: this.counts[kind] });
  }

  /** The plane through `point` square to `normal`: a default plane, its offset, or (any other way) a plane square to an axis through two points. */
  plane(normal: Vec3, point: Vec3): { ref: Ref; flipped: boolean } {
    const s = planeSpec(normal, point);
    const key = s.kind === 'datum' ? `${s.name}@${num(s.h)}` : `${s.normal.map(num).join(',')}@${s.point.map(num).join(',')}`;
    const known = this.planes.get(key);
    if (known) return { ref: known, flipped: s.flipped };
    let ref: Ref;
    if (s.kind === 'datum' && Math.abs(s.h) <= 1e-10) ref = { kind: 'datum', name: s.name };
    else if (s.kind === 'datum') {
      const id = this.ids.take('plane');
      this.feature({ id, type: 'refPlane', name: this.name('datum'), suppressed: false, def: { mode: 'offset', plane: { kind: 'datum', name: s.name }, distance: num(Math.abs(s.h)), ...(s.h < 0 ? { reverse: true } : {}) } });
      ref = { kind: 'datum', name: id };
    } else {
      const [p, q] = [this.ids.take('point'), this.ids.take('point')];
      const far = addv(s.point, s.normal, 10);
      this.feature({ id: p, type: 'refPoint', name: this.name('datum'), suppressed: false, def: { mode: 'coords', x: num(s.point[0]), y: num(s.point[1]), z: num(s.point[2]) } });
      this.feature({ id: q, type: 'refPoint', name: this.name('datum'), suppressed: false, def: { mode: 'coords', x: num(far[0]), y: num(far[1]), z: num(far[2]) } });
      const axis = this.ids.take('axis');
      this.feature({ id: axis, type: 'refAxis', name: this.name('datum'), suppressed: false, def: { mode: 'twoPoints', points: [{ kind: 'datum', name: p }, { kind: 'datum', name: q }] } });
      const id = this.ids.take('plane');
      this.feature({ id, type: 'refPlane', name: this.name('datum'), suppressed: false, def: { mode: 'perpendicular', axis: { kind: 'datum', name: axis }, point: { kind: 'datum', name: p } } });
      ref = { kind: 'datum', name: id };
    }
    this.planes.set(key, ref);
    return { ref, flipped: s.flipped };
  }

  /** A sketch of closed loops (and free points, and a centerline), each corner one shared point. */
  sketch(plane: Ref, loops: Loop[], extra: { points?: P2[]; centerline?: [P2, P2] } = {}): { id: Id; centerline?: Id } {
    const entities: SketchEntity[] = [];
    const constraints: SketchConstraint[] = [];
    const pts: { id: Id; p: P2 }[] = [];
    const point = (p: P2, alone = false): Id => {
      if (!alone) {
        const found = pts.find((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) <= 1e-7);
        if (found) return found.id;
      }
      const id = this.ids.take('p');
      pts.push({ id, p });
      entities.push({ id, type: 'point', x: p[0], y: p[1] });
      return id;
    };
    for (const loop of loops) {
      for (const s of loop.segs) {
        if (s.kind === 'line') {
          entities.push({ id: this.ids.take('l'), type: 'line', p1: point(s.a), p2: point(s.b) });
        } else if (s.kind === 'arc') {
          const id = this.ids.take('a');
          const [from, to] = s.ccw ? [s.a, s.b] : [s.b, s.a];
          entities.push({ id, type: 'arc', center: point(s.c), start: point(from), end: point(to) });
          constraints.push({ id: this.ids.take('d'), type: 'radius', circle: id, value: num(s.r) });
        } else {
          const id = this.ids.take('c');
          entities.push({ id, type: 'circle', center: point(s.c), radius: s.r });
          constraints.push({ id: this.ids.take('d'), type: 'diameter', circle: id, value: num(2 * s.r) });
        }
      }
    }
    for (const p of extra.points ?? []) point(p, true);
    let centerline: Id | undefined;
    if (extra.centerline) {
      centerline = this.ids.take('l');
      const a = this.ids.take('p');
      const b = this.ids.take('p');
      entities.push({ id: a, type: 'point', x: extra.centerline[0][0], y: extra.centerline[0][1] }, { id: b, type: 'point', x: extra.centerline[1][0], y: extra.centerline[1][1] });
      entities.push({ id: centerline, type: 'line', p1: a, p2: b, construction: true });
    }
    const id = this.ids.take('sketch');
    this.feature<SketchFeature>({ id, type: 'sketch', name: this.name('sketch'), suppressed: false, plane, entities, constraints });
    return { id, ...(centerline ? { centerline } : {}) };
  }

  base(rec: Recognition, merge: boolean | undefined): void {
    const b = rec.base;
    if (b.type === 'revolve') {
      const frame = b.profile.frame;
      const plane = this.plane(frame.normal, b.axis.origin);
      const to = (p: Vec3): P2 => [dot(sub(p, frame.origin), frame.xDir), dot(sub(p, frame.origin), frame.yDir)];
      const { id, centerline } = this.sketch(plane.ref, b.profile.loops, { centerline: [to(b.axis.origin), to(addv(b.axis.origin, b.axis.dir, 10))] });
      this.feature({ id: this.ids.take('revolve'), type: 'revolve', name: this.name('revolve'), suppressed: false, sketch: id, axis: centerline!, op: 'boss', ...(merge === false ? { merge: false } : {}), dir1: { type: 'blind', angle: '360deg' } });
      return;
    }
    let first = true;
    b.layers.forEach((layer, i) => {
      if (!layer) return;
      const h = b.levels[i]!;
      const plane = this.plane(b.dir, [b.dir[0] * h, b.dir[1] * h, b.dir[2] * h]);
      const { id } = this.sketch(plane.ref, layer.loops);
      const depth = b.levels[i + 1]! - h;
      this.feature({
        id: this.ids.take('extrude'),
        type: 'extrude',
        name: this.name('extrude'),
        suppressed: false,
        sketch: id,
        op: 'boss',
        ...(first && merge === false ? { merge: false } : {}),
        dir1: { type: 'blind', depth: num(depth), ...(plane.flipped ? { reverse: true } : {}) },
      });
      first = false;
    });
  }

  holes(holes: HoleRecord[]): void {
    const groups = new Map<string, HoleRecord[]>();
    for (const h of holes) {
      const out: Vec3 = [-h.down[0], -h.down[1], -h.down[2]];
      const s = planeSpec(out, h.entrance);
      const plane = s.kind === 'datum' ? `${s.name}@${num(s.h)}:${s.flipped}` : `${s.normal.map(num).join(',')}@${s.point.map(num).join(',')}`;
      const key = [plane, h.kind, num(h.radius), h.depth === null ? 'through' : num(h.depth), num(h.cbRadius ?? 0), num(h.cbDepth ?? 0), num(h.csRadius ?? 0), num(h.csAngle ?? 0)].join('|');
      groups.set(key, [...(groups.get(key) ?? []), h]);
    }
    for (const group of groups.values()) {
      const h = group[0]!;
      const out: Vec3 = [-h.down[0], -h.down[1], -h.down[2]];
      const frame = frameFor(out, h.entrance);
      const plane = this.plane(out, h.entrance);
      const at = (p: Vec3): P2 => [dot(sub(p, frame.origin), frame.xDir), dot(sub(p, frame.origin), frame.yDir)];
      const { id } = this.sketch(plane.ref, [], { points: group.map((g) => at(g.entrance)) });
      const hole: HoleFeature = {
        id: this.ids.take('hole'),
        type: 'hole',
        name: this.name('hole'),
        suppressed: false,
        sketch: id,
        kind: h.kind,
        diameter: num(2 * h.radius),
        end: h.depth === null ? { type: 'throughAll' } : { type: 'blind', depth: num(h.depth) },
        ...(h.kind === 'counterbore' ? { cbDiameter: num(2 * h.cbRadius!), cbDepth: num(h.cbDepth!) } : {}),
        ...(h.kind === 'countersink' ? { csDiameter: num(2 * h.csRadius!), csAngle: `${num((h.csAngle! * 180) / Math.PI)}deg` } : {}),
        // the hole goes against the sketch's normal; the plane of the entrance face points out of the material, unless the plane had to be the other way round
        ...(plane.flipped ? { reverse: true } : {}),
      };
      this.feature(hole);
    }
  }
}

// ------------------------------------------------------------------ rounds and chamfers on the rebuilt body

function onSharp(r: RebuildResult, s: SharpEdge): number[] {
  const body = r.body;
  if (!body) return [];
  return body.topology.edges.flatMap((e, i) => {
    if (s.kind === 'line') {
      if (e.curve !== 'line' || !e.dir || Math.abs(Math.abs(dot(unit(e.dir), s.dir)) - 1) > 1e-9) return [];
      if (distanceToSharp(e.mid, s) > TOL * 10) return [];
      const k = dot(sub(e.mid, s.ends[0]), s.dir);
      const span = dot(sub(s.ends[1], s.ends[0]), s.dir);
      return k >= Math.min(0, span) - TOL && k <= Math.max(0, span) + TOL ? [i] : [];
    }
    const g = e.geometry;
    if (g?.type !== 'circle' || Math.abs(g.radius - s.radius) > TOL * 10 || len(sub(g.center, s.center)) > TOL * 10 || Math.abs(Math.abs(dot(unit(g.normal), s.normal)) - 1) > 1e-9) return [];
    return [i];
  });
}

function sameSurface(a: SurfaceGeometry | undefined, b: SurfaceGeometry): boolean {
  if (!a || a.type !== b.type) return false;
  if (a.type === 'plane' && b.type === 'plane') return Math.abs(dot(unit(a.normal), unit(b.normal)) - 1) <= 1e-9 && Math.abs(dot(sub(a.origin, b.origin), unit(b.normal))) <= TOL * 10;
  if (a.type === 'cylinder' && b.type === 'cylinder') {
    const d = unit(b.axis);
    const v = sub(a.origin, b.origin);
    return Math.abs(a.radius - b.radius) <= TOL * 10 && Math.abs(Math.abs(dot(unit(a.axis), d)) - 1) <= 1e-9 && len(sub(v, [d[0] * dot(v, d), d[1] * dot(v, d), d[2] * dot(v, d)])) <= TOL * 10;
  }
  return false;
}

function blendFeature(rec: BlendRecord, r: RebuildResult, ids: IdAllocator, b: Builder): Feature[] {
  const body = r.body!;
  const ref = (i: number): Ref => ({ kind: 'edge', name: body.names.edges[i]!, fingerprint: edgeFingerprint(body.topology, i) });
  const find = (s: SharpEdge) => {
    const found = onSharp(r, s);
    if (found.length === 0) throw new RecognizeError(t('recognize.edgeNotFound', { kind: t(rec.type === 'fillet' ? 'recognize.name.fillet' : 'recognize.name.chamfer', { n: '' }).trim() }));
    return found;
  };
  if (rec.type === 'fillet') {
    const edges = [...new Set(rec.edges.flatMap(find))];
    const f: FilletFeature = { id: ids.take('fillet'), type: 'fillet', name: b.name('fillet'), suppressed: false, edges: edges.map(ref), radius: num(rec.radius) };
    return [f];
  }
  // a chamfer's first distance is on the face of the edge whose name sorts first (`flip`: the other one); edges are grouped by the distances that gives
  const groups = new Map<string, { first: number; second: number; edges: Set<number> }>();
  for (const e of rec.edges) {
    for (const i of find(e.edge)) {
      const faces = [...new Set(body.topology.edges[i]!.faces)].sort((x, y) => (body.names.faces[x]! < body.names.faces[y]! ? -1 : 1));
      const g = body.topology.faces[faces[0]!]?.geometry;
      const firstIsOne = sameSurface(g, e.supports[0]) ? true : sameSurface(g, e.supports[1]) ? false : null;
      if (firstIsOne === null) throw new RecognizeError(t('recognize.edgeNotFound', { kind: t('recognize.name.chamfer', { n: '' }).trim() }));
      const [first, second] = firstIsOne ? e.distances : [e.distances[1], e.distances[0]];
      const key = `${num(first)}|${num(second)}`;
      const grp = groups.get(key) ?? { first, second, edges: new Set<number>() };
      grp.edges.add(i);
      groups.set(key, grp);
    }
  }
  return [...groups.values()].map(
    (g): ChamferFeature => ({ id: ids.take('chamfer'), type: 'chamfer', name: b.name('chamfer'), suppressed: false, edges: [...g.edges].map(ref), mode: 'distanceDistance', distance: num(g.first), second: num(g.second) }),
  );
}

// ------------------------------------------------------------------ the whole

function failedOf(r: RebuildResult, ids: Iterable<Id>): string | null {
  for (const id of ids) {
    const f = r.features.find((x) => x.id === id);
    if (!f || f.status !== 'ok') return f?.message ?? `${id}: ${f?.status ?? 'missing'}`;
  }
  return null;
}

/**
 * Replaces imported body `featureId` of `doc` by the features that build it (F2.4). `regen` is the regenerator of the document (its kernel and the
 * document's blobs). Returns the new document; throws `RecognizeError` and leaves nothing changed when the body cannot be rebuilt the same.
 */
export function reconstructImported(kernel: Kernel, regen: Regenerator, doc: PartDoc, featureId: Id): { doc: PartDoc; commands: Command[]; report: ReconstructReport } {
  const index = doc.features.findIndex((f) => f.id === featureId);
  const imported = doc.features[index];
  if (!imported || imported.type !== 'importedBody') throw new RecognizeError(t('recognize.notImported'));
  if (imported.suppressed) throw new RecognizeError(t('recognize.suppressed'));
  const blob = doc.blobs.find((b) => b.id === imported.blob);
  if (!blob) throw new RecognizeError(t('recognize.notImported'));
  const keep: ShapeId[] = [];
  try {
    const before = regen.rebuild(doc);
    const okBefore = before.features.filter((f) => f.status === 'ok').map((f) => f.id);
    if (!okBefore.includes(featureId) || !before.body) throw new RecognizeError(t('recognize.importFailed'));
    const whole = kernel.copy(before.body.shape);
    keep.push(whole);
    // the imported body by itself
    const alone = applyCommand(createEmptyPart(), { type: 'importBody', blob, feature: { ...imported, merge: undefined }, index: 0 });
    const solo = regen.rebuild(alone);
    if (!solo.body || failedOf(solo, [featureId])) throw new RecognizeError(t('recognize.importFailed'));
    const shape = kernel.copy(solo.body.shape);
    keep.push(shape);
    const facesBefore = solo.body.topology.faces.length;
    const rec = recognize(kernel, shape, frameFor);

    const ids = new IdAllocator(doc.idCounters, idsInUse(doc));
    const b = new Builder(ids);
    b.base(rec, imported.merge);
    b.holes(rec.holes);
    // the commands, as the app applies them in one undoable step
    const commands: Command[] = [];
    let next = doc;
    const run = (cmd: Command) => {
      commands.push(cmd);
      next = applyCommand(next, cmd);
    };
    b.features.forEach((f, k) => run({ type: 'insertFeature', feature: f, index: index + 1 + k }));
    run({ type: 'deleteFeatures', featureIds: [featureId] });
    let end = index + b.features.length;
    const made = b.features.map((f) => f.id);
    for (const blend of rec.blends) {
      const r = regen.rebuild(next, { until: end });
      const failed = failedOf(r, made);
      if (failed) throw new RecognizeError(t('recognize.featureFailed', { why: failed }));
      for (const f of blendFeature(blend, r, ids, b)) {
        run({ type: 'insertFeature', feature: f, index: end });
        made.push(f.id);
        end++;
      }
    }
    const after = regen.rebuild(next);
    const failed = failedOf(after, [...made, ...okBefore.filter((id) => id !== featureId)]);
    if (failed) throw new RecognizeError(t('recognize.featureFailed', { why: failed }));
    if (!after.body) throw new RecognizeError(t('recognize.featureFailed', { why: '—' }));
    const m0 = kernel.massProps(whole);
    const m1 = kernel.massProps(after.body.shape);
    const shared = kernel.common(whole, after.body.shape, 0);
    if (shared.shape !== null) kernel.release(shared.shape);
    const volumeError = Math.abs(m1.volume - m0.volume) / m0.volume;
    const areaError = Math.abs(m1.area - m0.area) / m0.area;
    const difference = Math.max(0, m0.volume + m1.volume - 2 * shared.volume) / m0.volume;
    const report: ReconstructReport = { features: { ...b.counts }, faces: [facesBefore, after.body.topology.faces.length], volume: m0.volume, volumeError, areaError, difference };
    if (!(volumeError <= RECOGNIZE_TOLERANCE && areaError <= RECOGNIZE_TOLERANCE && difference <= RECOGNIZE_TOLERANCE)) {
      throw new RecognizeError(t('recognize.notSame', { volume: volumeError.toExponential(2), area: areaError.toExponential(2), difference: difference.toExponential(2) }));
    }
    return { doc: next, commands, report };
  } finally {
    for (const id of keep) kernel.release(id);
  }
}

export { recognize };
export type { Recognition };
