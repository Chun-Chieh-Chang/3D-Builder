import { t } from '@3db/i18n';
import { modelRefOf, type Id, type PlaneFrame, type Ref, type SketchEntity, type SketchFeature, type Vec3 } from '@3db/model';
import type { Topology } from '@3db/kernel';
import { edgeFingerprint, resolveRef, vertexFingerprint, type Candidate, type ElementNames } from '@3db/naming';

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
  | { kind: 'arc'; c: P2; r: number; start: P2; end: P2 }
  | { kind: 'spline'; points: P2[] };

/** A reference that cannot be followed: the message, and the reference itself when it is the model that no longer has it. */
export class ReferenceProblem extends Error {
  constructor(
    message: string,
    readonly unresolved?: { ref: Ref; reason: 'missing' | 'ambiguous'; candidates: Candidate[] }[],
  ) {
    super(message);
  }
}

/** The reference geometry built before the sketch (ADR 0172), by name: a default plane or axis of the part, or a feature id. */
export interface DatumScope {
  axis(name: string): { origin: Vec3; dir: Vec3 } | undefined;
  point(name: string): Vec3 | undefined;
  plane(name: string): PlaneFrame | undefined;
}

/** Where a curved model edge crosses the sketch plane (ADR 0173), from the kernel, which evaluates the curve: each place, and whether it is an end of the edge. */
export interface CurveScope {
  crossings(edge: number): { point: Vec3; end: boolean }[];
}

/**
 * The model the references are looked up in: its names and shapes, and the plane of the sketch; the reference geometry before it (ADR 0172); and, for a
 * pierce of a curved edge, where its curves cross the plane (ADR 0173).
 */
export interface ReferenceScope {
  names: ElementNames;
  topology: Topology;
  frame: PlaneFrame;
  datums?: DatumScope;
  curves?: CurveScope;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const SAME = 1e-9;

const local = (frame: PlaneFrame, p: Vec3): P2 => {
  const d = sub(p, frame.origin);
  return [dot(d, frame.xDir), dot(d, frame.yDir)];
};

/** Projects model edge `index` onto the plane: a straight edge to a line, a circle or arc lying in a plane parallel to it to a circle or arc, or a freeform/slanted edge to a spline. */
export function projectEdge(topology: Topology, index: number, frame: PlaneFrame): Projected {
  const e = topology.edges[index];
  if (!e) throw new ReferenceProblem(t('reference.noEdge'));
  const points = e.vertices.map((v) => topology.vertices[v]!.point);
  if (e.curve === 'line' && e.geometry?.type === 'line') {
    if (Math.abs(dot(e.geometry.dir, frame.normal)) > 1 - SAME || points.length < 2) throw new ReferenceProblem(t('reference.endOn'));
    return { kind: 'line', a: local(frame, points[0]!), b: local(frame, points[1]!) };
  }
  if (e.curve === 'circle' && e.geometry?.type === 'circle') {
    if (Math.abs(Math.abs(dot(e.geometry.normal, frame.normal)) - 1) < 1e-6) {
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
    throw new ReferenceProblem(t('reference.notParallel'));
  }
  if (e.geometry?.type === 'bspline' && e.geometry.samples && e.geometry.samples.length >= 3) {
    const pts = e.geometry.samples.map((p) => local(frame, p));
    return { kind: 'spline', points: pts };
  }
  if (points.length >= 2) {
    const pts: P2[] = [local(frame, points[0]!), local(frame, e.mid), local(frame, points[1]!)];
    return { kind: 'spline', points: pts };
  }
  throw new ReferenceProblem(t('reference.notSimple', { curve: e.curve }));
}

/**
 * Every place where model edge `index` passes through the sketch plane (「貫穿」): a straight edge, extended, once (worked out here, as always); a curved one
 * where its curve crosses the plane, from the kernel (ADR 0173), its ends lying on the plane included. Throws when there is none, or no kernel to ask.
 */
export function piercePoints(scope: ReferenceScope, index: number): P2[] {
  const e = scope.topology.edges[index];
  if (!e) throw new ReferenceProblem(t('reference.noEdge'));
  if (e.curve === 'line' && e.geometry?.type === 'line') return [pierceEdge(scope.topology, index, scope.frame)];
  if (!scope.curves) throw new ReferenceProblem(t('reference.pierceStraight'));
  const at = scope.curves.crossings(index).map((c) => local(scope.frame, c.point));
  if (at.length === 0) throw new ReferenceProblem(t('reference.noPierce'));
  return at;
}

/** The pierce point of edge `index` nearest `near` (the point's stored place: where it was last), or the first (ADR 0173: a curve may cross several times). */
export function piercePoint(scope: ReferenceScope, index: number, near?: P2): P2 {
  const all = piercePoints(scope, index);
  if (!near) return all[0]!;
  return all.reduce((a, b) => (Math.hypot(b[0] - near[0], b[1] - near[1]) < Math.hypot(a[0] - near[0], a[1] - near[1]) ? b : a));
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

/** Where model vertex `index` lies on the plane, projected along its normal (ADR 0171), and how far it is from the plane. */
export function vertexPoint(topology: Topology, index: number, frame: PlaneFrame): { at: P2; off: number } {
  const v = topology.vertices[index];
  if (!v) throw new ReferenceProblem(t('reference.noVertex'));
  return { at: local(frame, v.point), off: Math.abs(dot(sub(v.point, frame.origin), frame.normal)) };
}

/** No model yet: a sketch that follows only reference geometry (ADR 0172) is looked up in these. */
export const NO_NAMES: ElementNames = { faces: [], edges: [], vertices: [] };
export const NO_TOPOLOGY: Topology = { faces: [], edges: [], vertices: [] };

/** Half the length a line made from reference geometry is drawn (ADR 0172): a convention, the same whatever the model; to the solver a line has no ends. */
export const DATUM_HALF_SPAN = 25;
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * What reference geometry looks like on the sketch plane (ADR 0172): a reference point projected along the normal; an axis projected, or where it passes
 * through the plane when it is square to it; a plane where it crosses the sketch plane. A line is DATUM_HALF_SPAN each way from the projection of the
 * axis's own origin (from the place on it nearest the sketch origin, for a plane). Throws when the datum is not there, or a plane is parallel to the sketch.
 */
export function datumItem(scope: ReferenceScope, ref: Ref): { line: [P2, P2] } | { point: P2 } {
  const { frame } = scope;
  const d = scope.datums;
  const line = (origin: Vec3, dir: Vec3): { line: [P2, P2] } => {
    const o = local(frame, origin);
    const u: P2 = [dot(dir, frame.xDir), dot(dir, frame.yDir)];
    const l = Math.hypot(u[0], u[1]);
    const h = DATUM_HALF_SPAN / l;
    return { line: [[o[0] - u[0] * h, o[1] - u[1] * h], [o[0] + u[0] * h, o[1] + u[1] * h]] };
  };
  const point = d?.point(ref.name);
  if (point) return { point: local(frame, point) };
  const axis = d?.axis(ref.name);
  if (axis) {
    const along = dot(axis.dir, frame.normal);
    const len = Math.hypot(...axis.dir);
    if (Math.abs(along) > (1 - SAME) * len) {
      // square to the plane: where it passes through
      const s = -dot(frame.normal, sub(axis.origin, frame.origin)) / along;
      return { point: local(frame, [axis.origin[0] + axis.dir[0] * s, axis.origin[1] + axis.dir[1] * s, axis.origin[2] + axis.dir[2] * s]) };
    }
    return line(axis.origin, axis.dir);
  }
  const plane = d?.plane(ref.name);
  if (plane) {
    const dir = cross3(plane.normal, frame.normal);
    if (Math.hypot(...dir) < 1e-9) throw new ReferenceProblem(t('reference.planeParallel', { name: ref.name }));
    // the place on both planes nearest the sketch origin: in the sketch plane, along its direction square to the line, as far as the other plane
    const across = cross3(frame.normal, dir);
    const s = dot(plane.normal, sub(plane.origin, frame.origin)) / dot(plane.normal, across);
    return line([frame.origin[0] + across[0] * s, frame.origin[1] + across[1] * s, frame.origin[2] + across[2] * s], dir);
  }
  throw new ReferenceProblem(t('reference.datumMissing', { name: ref.name }), [{ ref, reason: 'missing', candidates: [] }]);
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
  if (!sketch.entities.some((e) => modelRefOf(e))) return sketch;
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
      // a curve may cross the plane several times: the crossing nearest where the point was (ADR 0173)
      const at = piercePoint(scope, edgeIndex(scope, e.pierce), [e.x, e.y]);
      move.set(e.id, at);
      hold(e.id, 0, e.id);
      return e;
    }
    if (e.type === 'point' && e.ref?.kind === 'datum') {
      const item = datumItem(scope, e.ref);
      if (!('point' in item)) throw new ReferenceProblem(t('reference.changedKind', { id: e.id }));
      move.set(e.id, item.point);
      hold(e.id, 0, e.id);
      return e;
    }
    if (e.type === 'line' && e.ref?.kind === 'datum') {
      const item = datumItem(scope, e.ref);
      if (!('line' in item)) throw new ReferenceProblem(t('reference.changedKind', { id: e.id }));
      move.set(e.p1, item.line[0]);
      move.set(e.p2, item.line[1]);
      hold(e.id, 1, e.p1);
      hold(e.id, 2, e.p2);
      return e;
    }
    if (e.type === 'point' && e.ref) {
      move.set(e.id, vertexPoint(scope.topology, edgeIndex(scope, e.ref), scope.frame).at);
      hold(e.id, 0, e.id);
      return e;
    }
    if (e.type === 'point' || !('ref' in e) || !e.ref) return e;
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
    } else if (e.type === 'spline' && p.kind === 'spline') {
      p.points.forEach((pt, idx) => {
        const ptId = e.points[idx];
        if (ptId) {
          move.set(ptId, pt);
          hold(e.id, idx + 1, ptId);
        }
      });
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

/** One thing converted from the model, in sketch coordinates, with the edge (or vertex, ADR 0171) it came from. */
export type Converted = { ref: Ref; projected: Projected } | { ref: Ref; pierce: P2 } | { ref: Ref; vertex: P2; off?: number };

/** What 「轉換實體引用」 or 「貫穿」 would make of these edges (and, converted, vertices: a point each); `errors` says why the others cannot. */
export function convertEdges(scope: ReferenceScope, refs: Ref[], mode: 'convert' | 'pierce'): { items: Converted[]; errors: string[] } {
  const items: Converted[] = [];
  const errors: string[] = [];
  for (const ref of refs) {
    try {
      if (ref.kind === 'datum') {
        if (mode === 'pierce') throw new ReferenceProblem(t('reference.pierceStraight'));
        const item = datumItem(scope, ref);
        items.push('point' in item ? { ref, vertex: item.point } : { ref, projected: { kind: 'line', a: item.line[0], b: item.line[1] } });
        continue;
      }
      const index = edgeIndex(scope, ref);
      if (ref.kind === 'vertex') {
        if (mode === 'pierce') throw new ReferenceProblem(t('reference.pierceStraight'));
        items.push({ ref, vertex: vertexPoint(scope.topology, index, scope.frame).at });
        continue;
      }
      // a pierce point at each place the edge passes through the plane (a curve may several times, ADR 0173)
      if (mode === 'pierce') items.push(...piercePoints(scope, index).map((pierce) => ({ ref, pierce })));
      else items.push({ ref, projected: projectEdge(scope.topology, index, scope.frame) });
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

/**
 * Computes intersection curves between selected model faces and the sketch plane (C1.18, ADR 0162).
 * Intersects each face's boundary edges and geometry with the sketch plane.
 * Throws ReferenceProblem if a face is parallel or does not intersect the sketch plane.
 */
export function intersectFaces(scope: ReferenceScope, faces: Ref[]): Converted[] {
  const { topology, names, frame } = scope;
  const items: Converted[] = [];
  const TOL = 1e-6;
  const side = (p: Vec3) => dot(sub(p, frame.origin), frame.normal);

  for (const faceRef of faces) {
    const r = resolveRef(faceRef, names, topology);
    if (!r.ok) throw new ReferenceProblem(t('reference.lost'));
    const faceIndex = r.index;
    const face = topology.faces[faceIndex];
    if (!face) throw new ReferenceProblem(t('reference.lost'));

    // Collect face edges and unique vertices
    const faceEdgesList = topology.edges.filter((e) => e.faces.includes(faceIndex));
    const allVertices = Array.from(new Set(faceEdgesList.flatMap((e) => e.vertices))).map((vi) => topology.vertices[vi]!.point);

    // Cylindrical surface intersection: if cross-section is perpendicular, it's a circle
    if (face.surface === 'cylinder' && face.geometry?.type === 'cylinder') {
      const cyl = face.geometry;
      const axisDot = Math.abs(dot(cyl.axis, frame.normal));
      if (axisDot > 1 - 1e-5) {
        if (allVertices.length > 0) {
          const sides = allVertices.map(side);
          const minSide = Math.min(...sides);
          const maxSide = Math.max(...sides);
          if ((minSide > TOL && maxSide > TOL) || (minSide < -TOL && maxSide < -TOL)) {
            throw new ReferenceProblem(t('reference.noIntersection'));
          }
        }
        const sAxis = dot(sub(cyl.origin, frame.origin), frame.normal);
        const center3d: Vec3 = [cyl.origin[0] - cyl.axis[0] * sAxis, cyl.origin[1] - cyl.axis[1] * sAxis, cyl.origin[2] - cyl.axis[2] * sAxis];
        items.push({
          ref: { kind: 'edge', name: `int:${faceRef.name}` },
          projected: { kind: 'circle', c: local(frame, center3d), r: cyl.radius },
        });
        continue;
      }
    }

    if (allVertices.length === 0) throw new ReferenceProblem(t('reference.noIntersection'));

    const sides = allVertices.map(side);
    const minSide = Math.min(...sides);
    const maxSide = Math.max(...sides);

    // If completely to one side without crossing the plane
    if ((minSide > TOL && maxSide > TOL) || (minSide < -TOL && maxSide < -TOL)) {
      throw new ReferenceProblem(t('reference.noIntersection'));
    }

    // If parallel to the sketch plane:
    if (face.normal && Math.abs(Math.abs(dot(face.normal, frame.normal)) - 1) < 1e-5) {
      if (Math.abs(minSide) > TOL) {
        throw new ReferenceProblem(t('reference.noIntersection'));
      }
      // If coplanar, convert its boundary edges
      const outline = faceEdges(scope, faceRef, (i) => edgeFingerprint(topology, i));
      const res = convertEdges(scope, outline, 'convert');
      items.push(...res.items);
      continue;
    }

    // Find pierce points on the face boundary edges
    const piercePoints: P2[] = [];
    for (const edge of faceEdgesList) {
      if (edge.vertices.length < 2) continue;
      const p0 = topology.vertices[edge.vertices[0]!]!.point;
      const p1 = topology.vertices[edge.vertices[1]!]!.point;
      const s0 = side(p0);
      const s1 = side(p1);
      if ((s0 < -TOL && s1 > TOL) || (s0 > TOL && s1 < -TOL)) {
        const tVal = -s0 / (s1 - s0);
        const pInt: Vec3 = [
          p0[0] + tVal * (p1[0] - p0[0]),
          p0[1] + tVal * (p1[1] - p0[1]),
          p0[2] + tVal * (p1[2] - p0[2]),
        ];
        const pt = local(frame, pInt);
        if (!piercePoints.some((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < TOL)) {
          piercePoints.push(pt);
        }
      } else if (Math.abs(s0) <= TOL) {
        const pt = local(frame, p0);
        if (!piercePoints.some((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < TOL)) {
          piercePoints.push(pt);
        }
      } else if (Math.abs(s1) <= TOL) {
        const pt = local(frame, p1);
        if (!piercePoints.some((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < TOL)) {
          piercePoints.push(pt);
        }
      }
    }

    if (piercePoints.length < 2) {
      // Cylindrical or curved face intersection
      if (face.surface === 'cylinder' && face.geometry?.type === 'cylinder') {
        const cyl = face.geometry;
        const axisDot = Math.abs(dot(cyl.axis, frame.normal));
        if (axisDot > 1 - 1e-5) {
          // Cross-section is a circle
          const sAxis = dot(sub(cyl.origin, frame.origin), frame.normal);
          const center3d: Vec3 = [cyl.origin[0] - cyl.axis[0] * sAxis, cyl.origin[1] - cyl.axis[1] * sAxis, cyl.origin[2] - cyl.axis[2] * sAxis];
          items.push({
            ref: { kind: 'edge', name: `int:${faceRef.name}` },
            projected: { kind: 'circle', c: local(frame, center3d), r: cyl.radius },
          });
          continue;
        }
      }
      throw new ReferenceProblem(t('reference.noIntersection'));
    }

    // Connect pierce points into intersection curve segments
    if (piercePoints.length === 2) {
      items.push({
        ref: { kind: 'edge', name: `int:${faceRef.name}` },
        projected: { kind: 'line', a: piercePoints[0]!, b: piercePoints[1]! },
      });
    } else {
      for (let i = 0; i < piercePoints.length - 1; i += 2) {
        if (i + 1 < piercePoints.length) {
          items.push({
            ref: { kind: 'edge', name: `int:${faceRef.name}:${i / 2}` },
            projected: { kind: 'line', a: piercePoints[i]!, b: piercePoints[i + 1]! },
          });
        }
      }
    }
  }

  if (items.length === 0) throw new ReferenceProblem(t('reference.noIntersection'));
  return items;
}

/**
 * The model's edges that lie in the sketch plane (a straight edge with both ends on it, a circle or arc in it), projected, with the
 * edge each one is: what a sketch can snap to while drawing on that plane (D5.3b). Edges only near the plane or crossing it are left out,
 * and so is a curve that is not a line, circle or arc.
 */
export function planarEdgeItems(scope: ReferenceScope, fingerprintOf: (edge: number) => Ref['fingerprint']): Converted[] {
  const { topology, names, frame } = scope;
  const off = (p: Vec3) => Math.abs(dot(sub(p, frame.origin), frame.normal));
  const TOL = 1e-6;
  const items: Converted[] = [];
  topology.edges.forEach((e, i) => {
    const name = names.edges[i];
    if (!name) return;
    const points = e.vertices.map((v) => topology.vertices[v]!.point);
    const inPlane =
      e.curve === 'line' && e.geometry?.type === 'line'
        ? points.length >= 2 && points.every((p) => off(p) <= TOL)
        : e.curve === 'circle' && e.geometry?.type === 'circle'
          ? off(e.geometry.center) <= TOL && Math.abs(Math.abs(dot(e.geometry.normal, frame.normal)) - 1) < 1e-6
          : false;
    if (!inPlane) return;
    try {
      items.push({ ref: { kind: 'edge', name, fingerprint: fingerprintOf(i) }, projected: projectEdge(topology, i, frame) });
    } catch (err) {
      if (!(err instanceof ReferenceProblem)) throw err;
    }
  });
  return items;
}

/**
 * What a sketch can snap to on the model: an edge as it looks on the plane, with `off` when it was projected onto it from outside (how near it comes to
 * the plane, 0 when it passes through it), none when it lies in the plane; or where an edge passes through the plane.
 */
export type SnapItem = { ref: Ref; projected: Projected; off?: number } | { ref: Ref; pierce: P2 } | { ref: Ref; vertex: P2; off: number };

/**
 * Everything a sketch can snap to on the model (D5.3b; C1 of the decisions of 2026-10-14, as SolidWorks offers the model around the sketch): the edges in
 * its plane (planarEdgeItems), the other edges projected onto it along its normal (a straight edge not square to the plane, a circle or arc in a plane
 * parallel to it), and the points where straight edges pass through it. `off` of a projected edge is how near it comes to the plane: 0 when it passes
 * through it, else the distance of its nearer end (the distance of a circle). Edges that look the same on the plane are one item, the one nearest it, and
 * one that looks like an edge in the plane is left out; so is a pierce point where an item already has a corner or a center, and a seam (an edge between a
 * face and itself, which is not an edge anyone sees). In the plane first, then the rest from the nearest, then the pierce points.
 */
export function modelSnapItems(scope: ReferenceScope, fingerprintOf: (edge: number) => Ref['fingerprint']): SnapItem[] {
  const { topology, names, frame } = scope;
  const TOL = 1e-6;
  const side = (p: Vec3) => dot(sub(p, frame.origin), frame.normal);
  const inPlane = planarEdgeItems(scope, fingerprintOf).flatMap((i) => ('projected' in i ? [i] : []));
  const taken = new Set(inPlane.map((i) => i.ref.name));  // what an item looks like on the plane, to know two edges that look the same; the ends of a line either way round
  const r6 = (x: number) => (Math.round(x * 1e6) / 1e6 + 0).toFixed(6);
  const pt = (p: P2) => `${r6(p[0])},${r6(p[1])}`;
  const look = (q: Projected) =>
    q.kind === 'line'
      ? `l:${[pt(q.a), pt(q.b)].sort().join(';')}`
      : q.kind === 'circle'
        ? `c:${pt(q.c)};${r6(q.r)}`
        : q.kind === 'arc'
          ? `a:${pt(q.c)};${r6(q.r)};${pt(q.start)};${pt(q.end)}`
          : `sp:${q.points.map(pt).join(';')}`;
  const seen = new Map<string, Extract<SnapItem, { projected: Projected }>>();
  for (const i of inPlane) seen.set(look(i.projected), i);
  const pierces: Extract<SnapItem, { pierce: P2 }>[] = [];
  topology.edges.forEach((e, i) => {
    const name = names.edges[i];
    if (!name || taken.has(name) || new Set(e.faces).size < 2) return;
    const ref = (): Ref => ({ kind: 'edge', name, fingerprint: fingerprintOf(i) });
    let off: number;
    if (e.curve === 'line' && e.geometry?.type === 'line') {
      const ends = e.vertices.map((v) => side(topology.vertices[v]!.point));
      if (ends.length < 2) return;
      const [sa, sb] = ends as [number, number];
      const through = (sa < -TOL && sb > TOL) || (sa > TOL && sb < -TOL);
      if (through) pierces.push({ ref: ref(), pierce: pierceEdge(topology, i, frame) });
      if (Math.abs(dot(e.geometry.dir, frame.normal)) > 1 - SAME) return; // square to the plane: it looks like a point
      off = through ? 0 : Math.min(Math.abs(sa), Math.abs(sb));
    } else if (e.curve === 'circle' && e.geometry?.type === 'circle') {
      if (Math.abs(Math.abs(dot(e.geometry.normal, frame.normal)) - 1) >= 1e-6) return; // tilted: it would look like an ellipse
      off = Math.abs(side(e.geometry.center));
    } else return;
    const projected = projectEdge(topology, i, frame);
    const key = look(projected);
    const there = seen.get(key);
    if (!there || (there.off !== undefined && there.off > off)) seen.set(key, { ref: ref(), projected, off });
  });
  const items = [...seen.values()].sort((a, b) => (a.off ?? -1) - (b.off ?? -1));
  // a pierce point where an item already has a corner or a center adds nothing to snap to
  const corners = items.flatMap((i) =>
    i.projected.kind === 'line'
      ? [i.projected.a, i.projected.b]
      : i.projected.kind === 'circle'
        ? [i.projected.c]
        : i.projected.kind === 'arc'
          ? [i.projected.c, i.projected.start, i.projected.end]
          : i.projected.points,
  );
  // where curved edges pass through the plane (ADR 0173): the places inside an edge, from the kernel; an end on the plane is a vertex or a corner already.
  // Curve bodies (a helix, ADR 0168) have edges with no face at all, and count; a seam (a face against itself) does not
  if (scope.curves) {
    topology.edges.forEach((e, i) => {
      const name = names.edges[i];
      if (!name || e.curve === 'line' || e.curve === 'degenerated' || (e.faces.length > 0 && new Set(e.faces).size < 2)) return;
      for (const c of scope.curves!.crossings(i)) if (!c.end) pierces.push({ ref: { kind: 'edge', name, fingerprint: fingerprintOf(i) }, pierce: local(frame, c.point) });
    });
  }
  const fresh = pierces.filter((p, k) => !corners.some((c) => Math.hypot(c[0] - p.pierce[0], c[1] - p.pierce[1]) < TOL) && pierces.findIndex((q) => Math.hypot(q.pierce[0] - p.pierce[0], q.pierce[1] - p.pierce[1]) < TOL) === k);
  // the vertices nothing above lets the cursor reach (ADR 0171): those of edges square to the plane, of tilted circles and freeform edges, an apex. Where two
  // vertices look the same on the plane, the nearer one; a vertex whose projection is already a corner, a center or a pierce point adds nothing
  const reached = [...corners, ...fresh.map((p) => p.pierce)];
  // a vertex only closed edges start and end at (with seams and degenerate edges) is where the B-rep begins a loop, not a place of the design: the seam
  // vertex on the rim of a hole or on the base of a cone. An apex has no closed edge and stays
  const real = (e: Topology['edges'][number]) => e.curve !== 'degenerated' && new Set(e.faces).size >= 2;
  const onlyLoops = (v: number) => {
    const at = topology.edges.filter((e) => e.vertices.includes(v) && real(e));
    return at.length > 0 && at.every((e) => e.vertices.length === 1 || e.vertices[0] === e.vertices[e.vertices.length - 1]);
  };
  const vertices = new Map<string, Extract<SnapItem, { vertex: P2 }>>();
  topology.vertices.forEach((_, i) => {
    const name = names.vertices[i];
    if (!name || onlyLoops(i)) return;
    const { at, off } = vertexPoint(topology, i, frame);
    if (reached.some((c) => Math.hypot(c[0] - at[0], c[1] - at[1]) < TOL)) return;
    const key = pt(at);
    const there = vertices.get(key);
    if (!there || there.off > off) vertices.set(key, { ref: { kind: 'vertex', name, fingerprint: vertexFingerprint(topology, i) }, vertex: at, off });
  });
  return [...items, ...fresh, ...[...vertices.values()].sort((a, b) => a.off - b.off)];
}
