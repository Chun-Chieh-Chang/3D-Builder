import type { FaceOrigin, SurfaceGeometry, Topology } from './types';

/** How far apart (mm) two surfaces may be and still be the one surface: the kernel's tolerance. */
const LENGTH = 1e-7;
/** How far from parallel (as 1 − |cos|) two directions may be and still be the one direction. */
const PARALLEL = 1e-12;

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const parallel = (a: V, b: V) => 1 - Math.abs(dot(a, b)) / (len(a) * len(b)) <= PARALLEL;
/** How far `p` is from the line through `o` along `d`. */
const offLine = (p: V, o: V, d: V) => {
  const w = sub(p, o);
  const t = dot(w, d) / dot(d, d);
  return len(sub(w, [d[0] * t, d[1] * t, d[2] * t]));
};

/**
 * Whether two faces lie on one analytic surface, whichever way round it is parametrized (an axis or a normal the other way counts): the same plane,
 * the same cylinder, cone or sphere. Tori and freeform surfaces are not compared: never the same.
 */
export function sameSurface(a: SurfaceGeometry | undefined, b: SurfaceGeometry | undefined): boolean {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'plane' && b.type === 'plane') return parallel(a.normal, b.normal) && Math.abs(dot(sub(b.origin, a.origin), a.normal)) / len(a.normal) <= LENGTH;
  if (a.type === 'cylinder' && b.type === 'cylinder') return Math.abs(a.radius - b.radius) <= LENGTH && parallel(a.axis, b.axis) && offLine(b.origin, a.origin, a.axis) <= LENGTH;
  if (a.type === 'cone' && b.type === 'cone') return a.convex === b.convex && len(sub(a.apex, b.apex)) <= 1e-5 && parallel(a.axis, b.axis) && Math.abs(Math.abs(a.halfAngle) - Math.abs(b.halfAngle)) <= 1e-6;
  if (a.type === 'sphere' && b.type === 'sphere') return Math.abs(a.radius - b.radius) <= LENGTH && len(sub(a.center, b.center)) <= LENGTH;
  return false;
}

/**
 * After a boolean and the merge of faces on one surface: a face whose origins have no face of the body (`isBody`) — a piece the tool made — but that
 * touches, through faces on the same surface, a face that has one, gets those body faces as origins too, after its own, each once, in order of index.
 * It is what the merge would have given it had it joined them, which OCCT does most of the time but not always (its order depends on memory): with it
 * the piece keeps the body face's name every time (B3.1). Faces with a body origin, and pieces that touch none on their surface, are left as they are.
 */
export function inheritBodySurface(origins: FaceOrigin[][], topology: Topology, isBody: (o: FaceOrigin) => boolean): FaceOrigin[][] {
  const n = topology.faces.length;
  const near: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const e of topology.edges) {
    const [a, b] = e.faces;
    if (a === undefined || b === undefined || a === b) continue;
    if (sameSurface(topology.faces[a]?.geometry, topology.faces[b]?.geometry)) {
      near[a]!.add(b);
      near[b]!.add(a);
    }
  }
  const hasBody = (i: number) => (origins[i] ?? []).some(isBody);
  return origins.map((own, i) => {
    if (hasBody(i) || near[i]!.size === 0) return own;
    // every face reachable on this surface, and the body faces among their origins
    const seen = new Set([i]);
    const queue = [i];
    const found: FaceOrigin[] = [];
    while (queue.length > 0) {
      const f = queue.shift()!;
      for (const o of origins[f] ?? []) if (isBody(o)) found.push(o);
      for (const g of near[f]!) {
        if (seen.has(g)) continue;
        seen.add(g);
        queue.push(g);
      }
    }
    const key = (o: FaceOrigin) => JSON.stringify(o);
    const unique = [...new Map(found.map((o) => [key(o), o])).values()].sort((x, y) => ('index' in x ? x.index : 0) - ('index' in y ? y.index : 0));
    return unique.length === 0 ? own : [...own, ...unique.filter((o) => !own.some((m) => key(m) === key(o)))];
  });
}
