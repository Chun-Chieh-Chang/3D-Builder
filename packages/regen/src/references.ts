import { t } from '@3db/i18n';
import type { Id, PlaneFrame, Ref, SketchEntity, SketchFeature, Vec3 } from '@3db/model';
import type { Topology } from '@3db/kernel';
import { resolveRef, type Candidate, type ElementNames } from '@3db/naming';

/**
 * Sketch entities that follow the model (C1.18, C1.26): the projection of a model edge onto the sketch plane, and the point where a
 * straight edge pierces it. Where they lie is worked out here from the edge as the model has it now and fixed in the solver, so they
 * move when the model does; the sketch's own coordinates for them are only a first guess.
 */

type P2 = [number, number];

/** What an edge looks like on the sketch plane (sketch coordinates). */
export type Projected =
  | { kind: 'line'; a: P2; b: P2 }
  | { kind: 'circle'; c: P2; r: number }
  /** Counter-clockwise from `start` to `end`. */
  | { kind: 'arc'; c: P2; r: number; start: P2; end: P2 };

/** A reference that cannot be followed: the message, and the reference itself when it is the model that no longer has it. */
export class ReferenceProblem extends Error {
  constructor(
    message: string,
    readonly unresolved?: { ref: Ref; reason: 'missing' | 'ambiguous'; candidates: Candidate[] }[],
  ) {
    super(message);
  }
}

/** The model the references are looked up in: its names and shapes, and the plane of the sketch. */
export interface ReferenceScope {
  names: ElementNames;
  topology: Topology;
  frame: PlaneFrame;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const SAME = 1e-9;

const local = (frame: PlaneFrame, p: Vec3): P2 => {
  const d = sub(p, frame.origin);
  return [dot(d, frame.xDir), dot(d, frame.yDir)];
};

/** Projects model edge `index` onto the plane: a straight edge to a line, a circle or arc lying in a plane parallel to it to a circle or arc. */
export function projectEdge(topology: Topology, index: number, frame: PlaneFrame): Projected {
  const e = topology.edges[index];
  if (!e) throw new ReferenceProblem(t('reference.noEdge'));
  const points = e.vertices.map((v) => topology.vertices[v]!.point);
  if (e.curve === 'line' && e.geometry?.type === 'line') {
    if (Math.abs(dot(e.geometry.dir, frame.normal)) > 1 - SAME || points.length < 2) throw new ReferenceProblem(t('reference.endOn'));
    return { kind: 'line', a: local(frame, points[0]!), b: local(frame, points[1]!) };
  }
  if (e.curve === 'circle' && e.geometry?.type === 'circle') {
    if (Math.abs(dot(e.geometry.normal, frame.normal)) < 1 - 1e-6) throw new ReferenceProblem(t('reference.notParallel'));
    const c = local(frame, e.geometry.center);
    const r = e.geometry.radius;
    const [p0, p1] = [points[0], points[1]];
    if (!p0 || !p1 || Math.hypot(...sub(p0, p1)) < 1e-9) return { kind: 'circle', c, r };
    const [s, f, m] = [local(frame, p0), local(frame, p1), local(frame, e.mid)];
    const angle = (p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    // the arc runs counter-clockwise from the first end to the second when the middle of the edge is on that sweep
    const ccw = norm(angle(m) - angle(s)) < norm(angle(f) - angle(s));
    return ccw ? { kind: 'arc', c, r, start: s, end: f } : { kind: 'arc', c, r, start: f, end: s };
  }
  throw new ReferenceProblem(t('reference.notSimple', { curve: e.curve }));
}

/** Where a straight edge, extended, passes through the plane (「貫穿」). */
export function pierceEdge(topology: Topology, index: number, frame: PlaneFrame): P2 {
  const e = topology.edges[index];
  if (!e) throw new ReferenceProblem(t('reference.noEdge'));
  if (e.curve !== 'line' || e.geometry?.type !== 'line') throw new ReferenceProblem(t('reference.pierceStraight'));
  const denom = dot(frame.normal, e.geometry.dir);
  if (Math.abs(denom) < SAME) throw new ReferenceProblem(t('reference.parallel'));
  const s = -dot(frame.normal, sub(e.geometry.origin, frame.origin)) / denom;
  return local(frame, [e.geometry.origin[0] + e.geometry.dir[0] * s, e.geometry.origin[1] + e.geometry.dir[1] * s, e.geometry.origin[2] + e.geometry.dir[2] * s]);
}

function edgeIndex(scope: ReferenceScope, ref: Ref): number {
  if (!ref.name) throw new ReferenceProblem(t('reference.empty'));
  const r = resolveRef(ref, scope.names, scope.topology);
  if (!r.ok) throw new ReferenceProblem(t('reference.lost'), [{ ref, reason: r.reason, candidates: r.candidates }]);
  return r.index;
}

/**
 * The sketch with its projected entities and pierce points put where the model has them, and held there: the points' coordinates
 * are replaced and "fixed" relations (a circle's radius, an arc's chord) added, none of which is stored. Throws `ReferenceProblem`.
 */
export function followReferences(sketch: SketchFeature, scope: ReferenceScope): SketchFeature {
  if (!sketch.entities.some((e) => (e.type === 'point' ? e.pierce : e.ref))) return sketch;
  const move = new Map<Id, P2>();
  const held = new Set<Id>();
  const constraints: SketchFeature['constraints'] = [...sketch.constraints];
  const hold = (owner: Id, n: number, point: Id) => {
    if (held.has(point)) return;
    held.add(point);
    constraints.push({ id: `ref:${owner}:${n}`, type: 'fix', point });
  };
  const entities: SketchEntity[] = sketch.entities.map((e) => {
    if (e.type === 'point' && e.pierce) {
      const at = pierceEdge(scope.topology, edgeIndex(scope, e.pierce), scope.frame);
      move.set(e.id, at);
      hold(e.id, 0, e.id);
      return e;
    }
    if (e.type === 'point' || !e.ref) return e;
    const p = projectEdge(scope.topology, edgeIndex(scope, e.ref), scope.frame);
    if (e.type === 'line' && p.kind === 'line') {
      move.set(e.p1, p.a);
      move.set(e.p2, p.b);
      hold(e.id, 1, e.p1);
      hold(e.id, 2, e.p2);
    } else if (e.type === 'circle' && p.kind === 'circle') {
      move.set(e.center, p.c);
      hold(e.id, 1, e.center);
      constraints.push({ id: `ref:${e.id}:r`, type: 'radius', circle: e.id, value: String(p.r) });
      return { ...e, radius: p.r };
    } else if (e.type === 'arc' && p.kind === 'arc') {
      move.set(e.center, p.c);
      move.set(e.start, p.start);
      move.set(e.end, p.end);
      hold(e.id, 1, e.center);
      hold(e.id, 2, e.start);
      constraints.push({ id: `ref:${e.id}:chord`, type: 'distance', a: e.start, b: e.end, value: String(Math.hypot(p.end[0] - p.start[0], p.end[1] - p.start[1])) });
    } else throw new ReferenceProblem(t('reference.changedKind', { id: e.id }));
    return e;
  });
  return {
    ...sketch,
    entities: entities.map((e) => {
      const at = e.type === 'point' ? move.get(e.id) : undefined;
      return at ? { ...e, x: at[0], y: at[1] } : e;
    }),
    constraints,
  };
}

/** One thing converted from the model, in sketch coordinates, with the edge it came from. */
export type Converted = { ref: Ref; projected: Projected } | { ref: Ref; pierce: P2 };

/** What 「轉換實體引用」 or 「貫穿」 would make of these edges; `errors` says why the others cannot. */
export function convertEdges(scope: ReferenceScope, refs: Ref[], mode: 'convert' | 'pierce'): { items: Converted[]; errors: string[] } {
  const items: Converted[] = [];
  const errors: string[] = [];
  for (const ref of refs) {
    try {
      const index = edgeIndex(scope, ref);
      items.push(mode === 'pierce' ? { ref, pierce: pierceEdge(scope.topology, index, scope.frame) } : { ref, projected: projectEdge(scope.topology, index, scope.frame) });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { items, errors };
}

/** The edges around a planar face (its outline and its holes), as references. */
export function faceEdges(scope: Pick<ReferenceScope, 'names' | 'topology'>, face: Ref, fingerprintOf: (edge: number) => Ref['fingerprint']): Ref[] {
  const r = resolveRef(face, scope.names, scope.topology);
  if (!r.ok) throw new ReferenceProblem(t('reference.lost'));
  return scope.topology.edges.flatMap((e, i) => (e.faces.includes(r.index) ? [{ kind: 'edge' as const, name: scope.names.edges[i]!, fingerprint: fingerprintOf(i) }] : []));
}
