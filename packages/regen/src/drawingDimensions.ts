import { t } from '@3db/i18n';
import { edgeFingerprint, faceFingerprint, resolveRef, vertexFingerprint, type ElementNames } from '@3db/naming';
import type { Topology } from '@3db/kernel';
import { rightOf, type ElementFacts, type HoleInfo, type Ref, type ViewAxes, type ViewFeature } from '@3db/model';

/**
 * What a drawing's dimensions need to know of the part a view shows (C16.4): the elements a dimension points at, by persistent name, as numbers; and the
 * elements a view can be dimensioned from. Worked out from the part as built, in its own frame (a part is drawn alone, so that is the view's).
 */

type V3 = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const PARALLEL = 1 - 1e-6;
const parallel = (a: readonly number[], b: readonly number[]) => Math.abs(dot(a, b)) >= PARALLEL;

/** The two circular edges where a cylinder face ends, whole circles of its radius about its axis, the nearer to the axis' origin first; fewer than two when it does not end that way. */
function cylinderEnds(topology: Topology, face: number) {
  const g = topology.faces[face]!.geometry;
  if (g?.type !== 'cylinder') return [];
  const along = (p: readonly number[]) => (p[0]! - g.origin[0]) * g.axis[0] + (p[1]! - g.origin[1]) * g.axis[1] + (p[2]! - g.origin[2]) * g.axis[2];
  const tol = 1e-6 * Math.max(1, g.radius);
  const ends = topology.edges.flatMap((e) => {
    const c = e.geometry;
    if (c?.type !== 'circle' || !e.faces.includes(face) || Math.abs(c.radius - g.radius) > tol || !parallel(c.normal, g.axis)) return [];
    const t = along(c.center);
    const off = Math.hypot(c.center[0] - g.origin[0] - t * g.axis[0], c.center[1] - g.origin[1] - t * g.axis[1], c.center[2] - g.origin[2] - t * g.axis[2]);
    return off <= tol ? [{ edge: e, t, center: c.center }] : [];
  });
  // the same circle can appear once per side of a seam; one end for each place along the axis
  const distinct = ends.filter((x, i) => ends.findIndex((y) => Math.abs(y.t - x.t) <= tol) === i).sort((a, b) => a.t - b.t);
  return distinct;
}

/**
 * The concentric cylinder on the other side of the plane at a cylinder's end, when that plane is an annulus: the plane's other circular edge is about the same
 * axis and bigger (`bigger`) or smaller than the cylinder, and a concave cylinder of that radius is on its far side. Its face number, or null.
 */
function neighbour(topology: Topology, g: { origin: readonly number[]; axis: readonly number[]; radius: number }, end: { edge: Topology['edges'][number] }, own: number, bigger: boolean): number | null {
  const f = end.edge.faces.find((x) => x !== own);
  const plane = f === undefined ? undefined : topology.faces[f]!.geometry;
  if (f === undefined || plane?.type !== 'plane' || !parallel(plane.normal, g.axis)) return null;
  const tol = 1e-6 * Math.max(1, g.radius);
  for (const e2 of topology.edges) {
    const c = e2.geometry;
    if (c?.type !== 'circle' || e2 === end.edge || !e2.faces.includes(f) || !parallel(c.normal, g.axis)) continue;
    if (bigger ? c.radius <= g.radius + tol : c.radius >= g.radius - tol) continue;
    const rel = [c.center[0] - g.origin[0]!, c.center[1] - g.origin[1]!, c.center[2] - g.origin[2]!];
    const t = rel[0]! * g.axis[0]! + rel[1]! * g.axis[1]! + rel[2]! * g.axis[2]!;
    if (Math.hypot(rel[0]! - t * g.axis[0]!, rel[1]! - t * g.axis[1]!, rel[2]! - t * g.axis[2]!) > tol) continue;
    const wall = e2.faces.find((x) => x !== f);
    const wg = wall === undefined ? undefined : topology.faces[wall]!.geometry;
    if (wall !== undefined && wg?.type === 'cylinder' && !wg.convex && Math.abs(wg.radius - c.radius) <= 1e-6 * Math.max(1, c.radius)) return wall;
  }
  return null;
}

/**
 * What the model says of a hole (C16.5): a whole concave cylinder, how deep, through or blind (an end closed by a disc or a cone is blind), and a counterbore (the
 * annular plane at the mouth, with a bigger concentric cylinder beyond it). Null for what is not a hole: a convex cylinder, an arc, one closed at both ends, the
 * wall of a counterbore (it is part of the hole below it).
 */
export function holeInfo(topology: Topology, face: number): HoleInfo | null {
  const g = topology.faces[face]?.geometry;
  if (g?.type !== 'cylinder' || g.convex) return null;
  const ends = cylinderEnds(topology, face);
  if (ends.length !== 2) return null;
  if (ends.some((e) => neighbour(topology, g, e, face, false) !== null)) return null;
  const depth = ends[1]!.t - ends[0]!.t;
  const disc = Math.PI * g.radius * g.radius;
  const closed = ends.map((e) => {
    const f = e.edge.faces.find((x) => x !== face);
    const o = f === undefined ? undefined : topology.faces[f]!;
    if (!o?.geometry) return false;
    // a cone that comes to a point (one circular edge: the hole's) is a drill point; a chamfer or countersink (two circular edges) leaves the hole open
    if (o.geometry.type === 'cone') return topology.edges.filter((x) => x.geometry?.type === 'circle' && x.faces.includes(f!)).length <= 1;
    return o.geometry.type === 'plane' && parallel(o.geometry.normal, g.axis) && Math.abs(o.area - disc) <= 1e-3 * disc;
  });
  if (closed[0] && closed[1]) return null;
  const info: HoleInfo = { through: !closed[0] && !closed[1], depth };
  ends.forEach((e, i) => {
    if (closed[i] || info.counterbore) return;
    const wall = neighbour(topology, g, e, face, true);
    if (wall === null) return;
    const wg = topology.faces[wall]!.geometry;
    const wallEnds = cylinderEnds(topology, wall);
    if (wg?.type === 'cylinder' && wallEnds.length === 2) info.counterbore = { diameter: 2 * wg.radius, depth: wallEnds[1]!.t - wallEnds[0]!.t };
  });
  return info;
}

/** What the element a reference points at is (a face, edge or vertex of the part), or why it cannot be told: it is gone, or the name fits more than one. */
export function elementFacts(topology: Topology, names: ElementNames, ref: Ref): ElementFacts | { error: string } {
  const r = resolveRef(ref, names, topology);
  if (!r.ok) return { error: t(r.reason === 'missing' ? 'drawing.refMissing' : 'drawing.refAmbiguous', { name: ref.name }) };
  if (ref.kind === 'vertex') return { kind: 'vertex', type: 'point', point: topology.vertices[r.index]!.point };
  if (ref.kind === 'edge') {
    const e = topology.edges[r.index]!;
    const g = e.geometry;
    if (g?.type === 'circle') return { kind: 'edge', type: 'circle', point: g.center, dir: g.normal, radius: g.radius };
    if (e.curve === 'line' && e.dir) return { kind: 'edge', type: 'line', point: e.mid, dir: e.dir };
    return { error: t('drawing.refKind', { name: ref.name }) };
  }
  if (ref.kind === 'face') {
    const f = topology.faces[r.index]!;
    const g = f.geometry;
    if (g?.type === 'plane') return { kind: 'face', type: 'plane', point: g.origin, dir: g.normal };
    if (g?.type === 'cylinder') {
      const hole = holeInfo(topology, r.index);
      return { kind: 'face', type: 'cylinder', point: g.origin, dir: g.axis, radius: g.radius, ...(hole ? { hole } : {}) };
    }
    if (g?.type === 'sphere') return { kind: 'face', type: 'sphere', point: g.center, radius: g.radius };
    return { error: t('drawing.refKind', { name: ref.name }) };
  }
  return { error: t('drawing.refKind', { name: ref.name }) };
}

/**
 * The elements of the part that a view looking from `axes` sees edge-on or as a circle, in the view's coordinates (x to its right, y up): the planes square to the
 * view's x or y, and the cylinders along its direction. `faceAllowed` leaves out faces (those of a workpiece that is only there for reference).
 */
export function viewFeatures(topology: Topology, names: ElementNames, axes: ViewAxes, faceAllowed: (face: number) => boolean = () => true): ViewFeature[] {
  const right = rightOf(axes);
  const up = axes.up;
  const out: ViewFeature[] = [];
  // the longest circular edge of each face tells whether a cylinder is whole or an arc
  const longest = new Map<number, number>();
  for (const e of topology.edges) if (e.geometry?.type === 'circle') for (const f of e.faces) longest.set(f, Math.max(longest.get(f) ?? 0, e.length));
  topology.faces.forEach((f, i) => {
    const g = f.geometry;
    if (!g || !faceAllowed(i)) return;
    const ref = (): Ref => ({ kind: 'face', name: names.faces[i]!, fingerprint: faceFingerprint(topology, i) });
    if (g.type === 'plane' && Math.abs(dot(g.normal, axes.dir)) < 1e-6) {
      if (parallel(g.normal, right)) out.push({ type: 'plane', ref: ref(), axis: 'x', coord: dot(g.origin, right), area: f.area });
      else if (parallel(g.normal, up)) out.push({ type: 'plane', ref: ref(), axis: 'y', coord: dot(g.origin, up), area: f.area });
    } else if (g.type === 'cylinder' && parallel(g.axis, axes.dir)) {
      const centre: [number, number] = [dot(g.origin, right), dot(g.origin, up)];
      const to: V3 = [f.center[0] - g.origin[0], f.center[1] - g.origin[1], f.center[2] - g.origin[2]];
      const full = (longest.get(i) ?? 0) >= 2 * Math.PI * g.radius * (1 - 1e-3);
      const hole = full ? holeInfo(topology, i) : null;
      out.push({
        type: 'circle',
        ref: ref(),
        centre,
        radius: g.radius,
        convex: g.convex,
        full,
        ...(hole ? { hole } : {}),
        // a whole circle has no middle of its arc: its leader goes up and to the right
        outward: full ? 45 : (Math.atan2(dot(to, up), dot(to, right)) * 180) / Math.PI,
      });
    } else if (g.type === 'cylinder' && Math.abs(dot(g.axis, axes.dir)) < 1e-6 && (longest.get(i) ?? 0) >= 2 * Math.PI * g.radius * (1 - 1e-3)) {
      // a whole cylinder seen from the side: its axis from end to end
      const ends = cylinderEnds(topology, i);
      if (ends.length === 2) {
        const at = (e: (typeof ends)[number]): [number, number] => [dot(e.center, right), dot(e.center, up)];
        out.push({ type: 'axis', ref: ref(), from: at(ends[0]!), to: at(ends[1]!), radius: g.radius });
      }
    }
  });
  return out;
}

/** A reference to an element by its place in the topology (what a picked or listed element is made into). */
export function refOf(topology: Topology, names: ElementNames, kind: 'face' | 'edge' | 'vertex', index: number): Ref {
  return kind === 'face'
    ? { kind, name: names.faces[index]!, fingerprint: faceFingerprint(topology, index) }
    : kind === 'edge'
      ? { kind, name: names.edges[index]!, fingerprint: edgeFingerprint(topology, index) }
      : { kind, name: names.vertices[index]!, fingerprint: vertexFingerprint(topology, index) };
}
