/**
 * Feature recognition (F2.4, docs/design/feature-recognition/plan.md), the geometric half: an imported solid taken apart, outside in. First its rounds
 * and chamfers come off (Delete Face), then its holes, and what is left must be one turned body or a stack of extrusions along one direction. What
 * comes off is written down as plain numbers (where the sharp edge it left lies, the radius, the distances), what is left as the sketches and features
 * that build it. Nothing here touches a document: `reconstruct.ts` turns this into features and checks the result against the original.
 */
import { t } from '@3db/i18n';
import { KernelError, rethrowTrap, type FaceInfo, type Frame, type Kernel, type SectionEdge, type ShapeId, type SurfaceGeometry, type Topology, type Vec3 } from '@3db/kernel';
import type { Budget } from '../budget';
import { biarcEnvelope } from '../section/envelope';
import { chainLoops, LoopError, type Loop, type P2 } from '../section/loops';

/**
 * The user's choice to have a spline outline made of biarcs (ADR 0243): off unless asked for, since the result is then close to the original rather than the same. Filled in as it is used.
 */
export interface SplineApproximation {
  /** What each biarc is built to keep within (mm). */
  tolerance: number;
  /** The largest bound actually proved for a piece (mm); 0 when no spline was met. */
  bound: number;
  /** Whether a spline was met at all: without one the body is held to the exact check. */
  used: boolean;
}

export class RecognizeError extends Error {
  override readonly name = 'RecognizeError';
}

// ------------------------------------------------------------------ vectors
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const addv = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const parallel = (a: Vec3, b: Vec3, tol = 1e-9) => Math.abs(Math.abs(dot(unit(a), unit(b))) - 1) <= tol;
const square = (a: Vec3, b: Vec3, tol = 1e-9) => Math.abs(dot(unit(a), unit(b))) <= tol;
/** Distance from `p` to the line through `o` along unit `d`. */
const lineDistance = (p: Vec3, o: Vec3, d: Vec3) => {
  const v = sub(p, o);
  return len(sub(v, [d[0] * dot(v, d), d[1] * dot(v, d), d[2] * dot(v, d)]));
};

/** Length tolerance (mm) for "the same place" in the geometry the kernel reports. */
export const TOL = 1e-6;

// ------------------------------------------------------------------ records

/** The sharp edge a round or a chamfer was taken off, as it lies in the body without it: what the rebuilt body's edge must lie on. */
export type SharpEdge =
  | { kind: 'line'; origin: Vec3; dir: Vec3; ends: [Vec3, Vec3] }
  | { kind: 'circle'; center: Vec3; normal: Vec3; radius: number };

export interface FilletRecord {
  type: 'fillet';
  radius: number;
  edges: SharpEdge[];
}

export interface ChamferRecord {
  type: 'chamfer';
  /** Per sharp edge: the distance measured on each support face, and the surface of that face (to tell them apart on the rebuilt body). */
  edges: { edge: SharpEdge; distances: [number, number]; supports: [SurfaceGeometry, SurfaceGeometry] }[];
}

export type BlendRecord = FilletRecord | ChamferRecord;

export interface HoleRecord {
  kind: 'straight' | 'counterbore' | 'countersink';
  /** The centre of the hole where it enters, on the entrance face. */
  entrance: Vec3;
  /** The way the hole is drilled (into the material), a unit vector. */
  down: Vec3;
  radius: number;
  /** null: through. */
  depth: number | null;
  cbRadius?: number;
  cbDepth?: number;
  csRadius?: number;
  /** The included angle of a countersink (radians). */
  csAngle?: number;
  /**
   * A blind hole whose bottom is the point of a drill (a cone to a point) instead of a flat floor: its included angle (radians). `depth` is then where
   * the full diameter ends (the shoulder), and the point goes on below it.
   */
  tip?: number;
}

/** A profile in a plane: the plane (a point and its normal) and the loops in the plane's sketch frame. */
export interface PlanarProfile {
  frame: Frame;
  loops: Loop[];
  /** Drafted walls (an extrusion layer only): the angle (radians) they lean by, and whether the profile narrows along the extrusion. */
  draft?: { angle: number; inward: boolean };
}

/** The steepest wall taken for draft (radians): a face leaning more than this from the extrusion direction is not a drafted wall of it. */
export const MAX_DRAFT = (30 * Math.PI) / 180;

export type BaseRecord =
  | { type: 'revolve'; axis: { origin: Vec3; dir: Vec3 }; profile: PlanarProfile }
  /** Profiles per layer, bottom up: layer i is extruded from `levels[i]` to `levels[i + 1]` along `dir`. */
  | { type: 'extrude'; dir: Vec3; levels: number[]; layers: PlanarProfile[][] }
  /**
   * A body extruded along one direction with features along others (a boss on its side, a pocket cut into it): `base` is the body with those taken
   * off (Delete Face), each extra is what was taken off, a boss (material added back) or a cut (material taken away), extruded along its own direction.
   */
  | { type: 'composite'; base: BaseRecord; extras: { op: 'boss' | 'cut'; rec: Extract<BaseRecord, { type: 'extrude' }> }[] };

export interface Recognition {
  base: BaseRecord;
  holes: HoleRecord[];
  blends: BlendRecord[];
  /** Faces of the original body and how they were explained. */
  counts: { faces: number; blendFaces: number; holeFaces: number; baseFaces: number };
}

/** How a plane frame is chosen for a sketch: the caller decides (it knows the planes the document can make). */
export type FrameFor = (normal: Vec3, point: Vec3) => Frame;

const ANALYTIC = new Set(['plane', 'cylinder', 'cone', 'torus', 'sphere']);

function describe(topo: Topology, faces: number[]): string {
  return faces
    .slice(0, 6)
    .map((i) => `#${i + 1} ${topo.faces[i]!.surface} (${topo.faces[i]!.center.map((v) => v.toFixed(2)).join(', ')})`)
    .join('; ');
}

/** Neighbour faces of each face, and the edges between them. */
function adjacency(topo: Topology): Map<number, number[]>[] {
  const adj: Map<number, number[]>[] = topo.faces.map(() => new Map());
  topo.edges.forEach((e, ei) => {
    const fs = [...new Set(e.faces)];
    if (fs.length !== 2) return;
    const [a, b] = fs as [number, number];
    adj[a]!.set(b, [...(adj[a]!.get(b) ?? []), ei]);
    adj[b]!.set(a, [...(adj[b]!.get(a) ?? []), ei]);
  });
  return adj;
}

const coaxial = (o1: Vec3, d1: Vec3, o2: Vec3, d2: Vec3, tol = TOL) => parallel(d1, d2) && lineDistance(o2, o1, unit(d1)) <= tol;

/** Axis of a surface of revolution (cylinder, cone, torus), or null. */
function axisOf(g: SurfaceGeometry | undefined): { origin: Vec3; dir: Vec3 } | null {
  if (!g) return null;
  if (g.type === 'cylinder') return { origin: g.origin, dir: unit(g.axis) };
  if (g.type === 'cone') return { origin: g.apex, dir: unit(g.axis) };
  if (g.type === 'torus') return { origin: g.center, dir: unit(g.axis) };
  return null;
}

// ------------------------------------------------------------------ blends

interface BlendCandidate {
  face: number;
  type: 'fillet' | 'chamfer';
  /** The two faces it joins. */
  supports: [number, number];
  radius?: number;
  /** For a chamfer: its boundary edges on each support. */
  rims?: [number[], number[]];
  /** For a round: the faces it is tangent to. */
  tangent?: number[];
}

function blendCandidates(topo: Topology, smooth: boolean[], adj: Map<number, number[]>[]): BlendCandidate[] {
  const out: BlendCandidate[] = [];
  topo.faces.forEach((f, i) => {
    const g = f.geometry;
    const across = [...adj[i]!.entries()];
    if (g && (g.type === 'cylinder' || g.type === 'torus' || g.type === 'sphere')) {
      // a round touches what it joins along its length: a cylinder along lines parallel to its axis, a torus along circles about its axis
      // (the end of a shaft's cylinder tangent to the round at its shoulder is not a round)
      const along = (e: number) => {
        const c = topo.edges[e]!.geometry;
        if (g.type === 'cylinder') return c?.type === 'line' && parallel(c.dir, g.axis);
        if (g.type === 'torus') return c?.type === 'circle' && coaxial(c.center, c.normal, g.center, g.axis);
        return true;
      };
      const tangent = across.filter(([, edges]) => edges.some((e) => smooth[e] && along(e))).map(([n]) => n);
      if (tangent.length < 2) return;
      const radius = g.type === 'torus' ? g.minor : g.radius;
      out.push({ face: i, type: 'fillet', supports: [-1, -1], radius, tangent });
      return;
    }
    if (across.some(([, edges]) => edges.some((e) => smooth[e]))) return;
    if (g?.type === 'cone' && g.convex) {
      // a chamfer on a round edge: the cone between a plane square to its axis and a cylinder about it
      const planes = across.filter(([n]) => {
        const h = topo.faces[n]!.geometry;
        return h?.type === 'plane' && parallel(h.normal, g.axis);
      });
      const cyls = across.filter(([n]) => {
        const h = topo.faces[n]!.geometry;
        return h?.type === 'cylinder' && h.convex && coaxial(h.origin, h.axis, g.apex, g.axis);
      });
      if (planes.length === 1 && cyls.length === 1 && across.length === 2) out.push({ face: i, type: 'chamfer', supports: [planes[0]![0], cyls[0]![0]], rims: [planes[0]![1], cyls[0]![1]] });
      return;
    }
    if (g?.type !== 'plane') return;
    // A small cap at the narrow end of a drafted profile can also look like a strip between two walls.
    // If the whole rim is surrounded by walls of the same draft, keep the cap for layer detection.
    if (across.length >= 3) {
      const leans = across.map(([n]) => wallLean(topo.faces[n]!, g.normal));
      const lean = leans[0];
      if (lean !== null && lean !== undefined && lean > 0 && leans.every((x) => x !== null && Math.abs(x - lean) <= 1e-7)) return;
    }
    // a chamfer on a straight edge: a strip whose two longest edges are parallel lines between two planes that would meet outside it
    const own = topo.edges.map((e, ei) => ({ e, ei })).filter(({ e }) => e.faces.includes(i));
    const lines = own.filter(({ e }) => e.curve === 'line' && e.dir).sort((a, b) => b.e.length - a.e.length);
    if (lines.length < 2) return;
    const [l1, l2] = [lines[0]!, lines[1]!];
    if (!parallel(l1.e.dir!, l2.e.dir!)) return;
    if (own.some(({ e, ei }) => ei !== l1.ei && ei !== l2.ei && e.length > l2.e.length - 1e-9)) return;
    const s1 = l1.e.faces.find((n) => n !== i);
    const s2 = l2.e.faces.find((n) => n !== i);
    if (s1 === undefined || s2 === undefined || s1 === s2) return;
    const g1 = topo.faces[s1]!.geometry;
    const g2 = topo.faces[s2]!.geometry;
    if (g1?.type !== 'plane' || g2?.type !== 'plane' || parallel(g1.normal, g2.normal) || parallel(g1.normal, g.normal) || parallel(g2.normal, g.normal)) return;
    // where the two support planes meet: must be on the outside of the strip (a convex chamfer)
    const dir = unit(cross(g1.normal, g2.normal));
    const corner = planesMeet(g1, g2, dir);
    if (dot(sub(corner, g.origin), g.normal) <= TOL) return;
    // both supports must keep some of themselves beyond the chamfer
    const keeps = (s: number, rim: number[]) => {
      const rimDist = Math.max(...rim.map((e) => lineDistance(topo.edges[e]!.mid, corner, dir)));
      const far = Math.max(...topo.vertices.filter((v) => v.faces.includes(s)).map((v) => lineDistance(v.point, corner, dir)));
      return far > rimDist + 1e-6;
    };
    const rim1 = adj[i]!.get(s1)!;
    const rim2 = adj[i]!.get(s2)!;
    if (!keeps(s1, rim1) || !keeps(s2, rim2)) return;
    // a chamfer is narrower than either face it joins (every face of a box is a strip between two others: only the narrow one is a chamfer)
    const lineOf = (ei: number) => ({ o: topo.edges[ei]!.mid, d: unit(topo.edges[ei]!.dir!) });
    const widthFrom = (face: number, ei: number) => {
      const { o, d } = lineOf(ei);
      return Math.max(...topo.vertices.filter((v) => v.faces.includes(face)).map((v) => lineDistance(v.point, o, d)));
    };
    const strip = lineDistance(l2.e.mid, l1.e.mid, unit(l1.e.dir!));
    if (!(strip < widthFrom(s1, l1.ei) - 1e-6 && strip < widthFrom(s2, l2.ei) - 1e-6)) return;
    out.push({ face: i, type: 'chamfer', supports: [s1, s2], rims: [rim1, rim2] });
  });
  // a triangle where three chamfers meet is a corner piece, as a ball is where rounds meet: taken off with them, with no edge of its own
  const chamfers = new Set(out.filter((c) => c.type === 'chamfer').map((c) => c.face));
  topo.faces.forEach((f, i) => {
    const around = [...adj[i]!.keys()];
    if (f.geometry?.type === 'plane' && !chamfers.has(i) && around.length === 3 && around.every((n) => chamfers.has(n))) out.push({ face: i, type: 'chamfer', supports: [-1, -1] });
  });
  // a round's supports are the faces it is tangent to that are not rounds themselves (a chain of rounds runs on into the next one);
  // with other than two, it is a corner piece: taken off with the rest, with no edge of its own
  // a ball is only ever a corner piece, where rounds meet: it stays when anything it touches is not a round
  const roundFaces = new Set(out.filter((c) => c.type === 'fillet' && topo.faces[c.face]!.geometry!.type !== 'sphere').map((c) => c.face));
  for (let k = out.length - 1; k >= 0; k--) {
    const c = out[k]!;
    if (c.type === 'fillet' && topo.faces[c.face]!.geometry!.type === 'sphere' && !c.tangent!.every((n) => roundFaces.has(n))) out.splice(k, 1);
  }
  const rounds = new Set(out.filter((c) => c.type === 'fillet').map((c) => c.face));
  for (const c of out) {
    if (c.type !== 'fillet') continue;
    const s = c.tangent!.filter((n) => !rounds.has(n));
    c.supports = s.length === 2 ? [s[0]!, s[1]!] : [-1, -1];
  }
  // a round joins two faces that would meet at the edge it took off: between two parallel planes (the round end of a slot) there is no such edge, so
  // it is part of the profile, not a round
  return out.filter((c) => {
    if (c.type !== 'fillet' || c.supports[0] < 0) return true;
    const [a, b] = c.supports.map((k) => topo.faces[k]!.geometry);
    return !(a?.type === 'plane' && b?.type === 'plane' && parallel(a.normal, b.normal));
  });
}

/** A point on the line where two planes meet (the line runs along `dir`). */
function planesMeet(a: Extract<SurfaceGeometry, { type: 'plane' }>, b: Extract<SurfaceGeometry, { type: 'plane' }>, dir: Vec3): Vec3 {
  const da = dot(a.normal, a.origin);
  const db = dot(b.normal, b.origin);
  // p = (da (nb × d) + db (d × na)) / (d · (na × nb))
  const den = dot(dir, cross(a.normal, b.normal));
  const p = addv(cross(b.normal, dir).map((v) => v * da) as Vec3, cross(dir, a.normal), db);
  return [p[0] / den, p[1] / den, p[2] / den];
}

/** Where `p` is from a sharp edge's curve (a line: to the line; a circle: to the circle). */
function distanceToSharp(p: Vec3, s: SharpEdge): number {
  if (s.kind === 'line') return lineDistance(p, s.origin, s.dir);
  const v = sub(p, s.center);
  const z = dot(v, s.normal);
  const rho = len(sub(v, [s.normal[0] * z, s.normal[1] * z, s.normal[2] * z]));
  return Math.hypot(rho - s.radius, z);
}

export { distanceToSharp };

function sharpOf(topo: Topology, ei: number): SharpEdge | null {
  const e = topo.edges[ei]!;
  const g = e.geometry;
  if (g?.type === 'line') {
    const ends = e.vertices.map((v) => topo.vertices[v]!.point);
    if (ends.length !== 2) return null;
    return { kind: 'line', origin: g.origin, dir: unit(g.dir), ends: [ends[0]!, ends[1]!] };
  }
  if (g?.type === 'circle') return { kind: 'circle', center: g.center, normal: unit(g.normal), radius: g.radius };
  return null;
}

/** Output faces of `deleteFaces` that come from input face `i`. */
function imagesOf(origins: { rel: string; kind?: string; index?: number }[][], i: number): number[] {
  return origins.flatMap((list, j) => (list.some((o) => (o.rel === 'same' || o.rel === 'modified') && o.kind === 'face' && o.index === i) ? [j] : []));
}

function removeBlends(kernel: Kernel, shape: ShapeId, topo: Topology, cands: BlendCandidate[]): { shape: ShapeId; records: BlendRecord[]; removed: number } | null {
  if (cands.length === 0) return null;
  let kept = cands;
  let r: ReturnType<Kernel['deleteFaces']> | null = null;
  try {
    r = kernel.deleteFaces(shape, kept.map((c) => c.face));
  } catch (e) {
    if (!(e instanceof KernelError)) throw e;
    // some of them cannot come off (a slot's round end has no corner to go back to), and some can alone but not together: add them one at a time, keep what still comes off, and leave the rest in the body
    kept = [];
    for (const c of cands) {
      try {
        const next = kernel.deleteFaces(shape, [...kept, c].map((x) => x.face));
        if (r) kernel.release(r.shape);
        r = next;
        kept = [...kept, c];
      } catch (err) {
        if (!(err instanceof KernelError)) throw err;
      }
    }
    if (!r) return null;
  }
  const after = kernel.topology(r.shape);
  const oldMids = topo.edges.map((e) => e.mid);
  const isNew = (ei: number) => !oldMids.some((m) => len(sub(m, after.edges[ei]!.mid)) <= TOL);
  const fillets = new Map<string, FilletRecord>();
  const chamfer: ChamferRecord = { type: 'chamfer', edges: [] };
  for (const c of kept) {
    if (c.supports[0] < 0) continue;
    const [a, b] = c.supports.map((s) => new Set(imagesOf(r!.faceOrigins as never, s))) as [Set<number>, Set<number>];
    const edges = after.edges.flatMap((e, ei) => {
      const fs = [...new Set(e.faces)];
      return fs.length === 2 && ((a.has(fs[0]!) && b.has(fs[1]!)) || (a.has(fs[1]!) && b.has(fs[0]!))) && isNew(ei) ? [ei] : [];
    });
    const sharp = edges.map((ei) => sharpOf(after, ei));
    if (sharp.length === 0 || sharp.some((s) => !s)) {
      kernel.release(r.shape);
      throw new RecognizeError(t('recognize.blendNoEdge', { faces: describe(topo, [c.face]) }));
    }
    if (c.type === 'fillet') {
      const key = c.radius!.toPrecision(12);
      const rec = fillets.get(key) ?? { type: 'fillet' as const, radius: c.radius!, edges: [] };
      rec.edges.push(...(sharp as SharpEdge[]));
      fillets.set(key, rec);
    } else {
      const g1 = topo.faces[c.supports[0]]!.geometry!;
      const g2 = topo.faces[c.supports[1]]!.geometry!;
      for (const s of sharp as SharpEdge[]) {
        const d1 = Math.max(...c.rims![0].map((e) => distanceToSharp(topo.edges[e]!.mid, s)));
        const d2 = Math.max(...c.rims![1].map((e) => distanceToSharp(topo.edges[e]!.mid, s)));
        chamfer.edges.push({ edge: s, distances: [d1, d2], supports: [g1, g2] });
      }
    }
  }
  const records: BlendRecord[] = [...(chamfer.edges.length ? [chamfer] : []), ...[...fillets.values()].sort((x, y) => y.radius - x.radius)];
  return { shape: r.shape, records, removed: kept.length };
}

// ------------------------------------------------------------------ holes

function findHoles(topo: Topology, adj: Map<number, number[]>[]): { record: HoleRecord; faces: number[] }[] {
  const out: { record: HoleRecord; faces: number[] }[] = [];
  const taken = new Set<number>();
  topo.faces.forEach((f, i) => {
    const g = f.geometry;
    if (taken.has(i) || g?.type !== 'cylinder' || g.convex) return;
    const axis = { origin: g.origin, dir: unit(g.axis) };
    // the faces of the hole: concave cylinders and cones about the axis, and planes square to it bounded only by circles about it
    const member = (n: number) => {
      const h = topo.faces[n]!.geometry;
      if (!h) return false;
      if (h.type === 'cylinder') return !h.convex && coaxial(h.origin, h.axis, axis.origin, axis.dir);
      if (h.type === 'cone') return !h.convex && coaxial(h.apex, h.axis, axis.origin, axis.dir);
      if (h.type === 'plane') {
        if (!parallel(h.normal, axis.dir)) return false;
        // a floor of the hole (its bottom, the step of a counterbore): bounded only by circles about the axis, each against a wall of the hole.
        // The end of a boss the hole is drilled into is bounded by the boss's own (convex) wall, so it is where the hole enters, not part of it.
        return topo.edges.every((e, ei) => {
          if (!e.faces.includes(n)) return true;
          if (e.geometry?.type !== 'circle' || !coaxial(e.geometry.center, e.geometry.normal, axis.origin, axis.dir, TOL)) return false;
          const other = e.faces.find((k) => k !== n);
          const g = other === undefined ? undefined : topo.faces[other]!.geometry;
          return ei >= 0 && !!g && ((g.type === 'cylinder' && !g.convex && coaxial(g.origin, g.axis, axis.origin, axis.dir)) || (g.type === 'cone' && !g.convex && coaxial(g.apex, g.axis, axis.origin, axis.dir)));
        });
      }
      return false;
    };
    const group = new Set([i]);
    const queue = [i];
    while (queue.length) {
      const k = queue.pop()!;
      for (const n of adj[k]!.keys()) if (!group.has(n) && member(n)) (group.add(n), queue.push(n));
    }
    const faces = [...group];
    // the rims: circles where the hole meets the rest of the body
    const rims: { z: number; r: number; face: number; center: Vec3 }[] = [];
    const z = (p: Vec3) => dot(sub(p, axis.origin), axis.dir);
    for (const k of faces) for (const [n, edges] of adj[k]!) {
      if (group.has(n)) continue;
      for (const e of edges) {
        const c = topo.edges[e]!.geometry;
        if (c?.type !== 'circle') return;
        rims.push({ z: z(c.center), r: c.radius, face: n, center: c.center });
      }
    }
    const levels = [...new Map(rims.map((r) => [r.z.toFixed(6), r])).values()];
    if (levels.length < 1 || levels.length > 2) return;
    // the profile of the hole in (radius, depth), from each face
    type Piece = { z0: number; z1: number; r0: number; r1: number; plane: boolean };
    const pieces: Piece[] = [];
    for (const k of faces) {
      const circles = topo.edges.filter((e) => e.faces.includes(k) && e.geometry?.type === 'circle').map((e) => e.geometry as Extract<typeof e.geometry, { type: 'circle' }>);
      const zs = circles.map((c) => ({ z: z(c.center), r: c.radius }));
      // the point of a drill: a cone with one circle, its other end its apex (on the axis, radius 0)
      const g = topo.faces[k]!.geometry!;
      if (g.type === 'cone' && zs.length === 1 && lineDistance(g.apex, axis.origin, axis.dir) <= TOL) zs.push({ z: z(g.apex), r: 0 });
      if (zs.length === 0) return;
      const lo = zs.reduce((a, b) => (b.z < a.z ? b : a));
      const hi = zs.reduce((a, b) => (b.z > a.z ? b : a));
      const plane = topo.faces[k]!.geometry!.type === 'plane';
      pieces.push({ z0: lo.z, z1: hi.z, r0: plane ? Math.min(...zs.map((q) => q.r)) : lo.r, r1: plane ? Math.max(...zs.map((q) => q.r)) : hi.r, plane });
    }
    for (const entranceAt of levels) {
      const other = levels.find((l) => l !== entranceAt);
      const ef = topo.faces[entranceAt.face]!.geometry;
      if (ef?.type !== 'plane' || !parallel(ef.normal, axis.dir)) continue;
      // depth runs from the entrance into the material
      const sign = levels.length === 2 ? Math.sign(other!.z - entranceAt.z) : Math.sign(pieces.reduce((a, p) => a + (p.z0 + p.z1) / 2, 0) / pieces.length - entranceAt.z);
      if (sign === 0) continue;
      const down: Vec3 = [axis.dir[0] * sign, axis.dir[1] * sign, axis.dir[2] * sign];
      // the hole enters through a face that faces out against the way it is drilled (the material is behind it)
      if (dot(ef.normal, down) > -0.5) continue;
      const depthOf = (zz: number) => (zz - entranceAt.z) * sign;
      const walls = pieces.filter((p) => !p.plane).map((p) => {
        const a = { d: depthOf(p.z0), r: p.r0 };
        const b = { d: depthOf(p.z1), r: p.r1 };
        return a.d < b.d ? { d0: a.d, d1: b.d, r0: a.r, r1: b.r } : { d0: b.d, d1: a.d, r0: b.r, r1: a.r };
      }).sort((p, q) => p.d0 - q.d0);
      const floors = pieces.filter((p) => p.plane).map((p) => ({ d: depthOf(p.z0), rIn: p.r0, rOut: p.r1 }));
      // the walls follow one another from the entrance down
      if (walls.length === 0 || Math.abs(walls[0]!.d0) > TOL) continue;
      let ok = true;
      for (let k = 1; k < walls.length; k++) if (Math.abs(walls[k]!.d0 - walls[k - 1]!.d1) > TOL) ok = false;
      if (!ok) continue;
      const through = levels.length === 2;
      // a drill point at the bottom of a blind hole: the last wall narrows to the axis, from where the wall before it ends
      let tip: number | undefined;
      const point = walls[walls.length - 1]!;
      const before = walls[walls.length - 2];
      if (!through && before && Math.abs(point.r0 - point.r1) > TOL && point.r1 <= TOL && Math.abs(point.r0 - before.r1) <= TOL && point.d1 > point.d0 + TOL) {
        tip = 2 * Math.atan2(point.r0, point.d1 - point.d0);
        walls.pop();
      }
      const bottom = through || tip !== undefined ? 0 : 1;
      const last = walls[walls.length - 1]!;
      if (through && Math.abs(last.d1 - depthOf(other!.z)) > TOL) continue;
      // through: the far rim is where the hole leaves the body, so a plane there faces on along the hole; a floor facing back up it (with a pin
      // standing on it) is the bottom of a bore, not an exit
      const exit = through ? topo.faces[other!.face]!.geometry : undefined;
      if (exit?.type === 'plane' && dot(exit.normal, down) < 0.5) continue;
      // a blind hole's bottom needs no check of its own: with the hole's every rim at the entrance, the last wall ends on a floor of the group (a
      // disc), and anything standing in it (a pin) is a second rim, which makes the group not a blind hole (mutation-checked, DEV_LOG 2026-11-06)
      const cyl = (w: (typeof walls)[number]) => Math.abs(w.r0 - w.r1) <= TOL;
      const center = addv(axis.origin, axis.dir, entranceAt.z);
      const depth = through ? null : last.d1;
      let record: HoleRecord | null = null;
      if (walls.length === 1 && cyl(walls[0]!) && floors.length === bottom) {
        record = { kind: 'straight', entrance: center, down, radius: walls[0]!.r0, depth };
      } else if (walls.length === 2 && cyl(walls[0]!) && cyl(walls[1]!) && walls[0]!.r0 > walls[1]!.r0 + TOL) {
        const step = floors.find((fl) => Math.abs(fl.d - walls[0]!.d1) <= TOL && Math.abs(fl.rIn - walls[1]!.r0) <= TOL && Math.abs(fl.rOut - walls[0]!.r0) <= TOL);
        if (step && floors.length === bottom + 1) record = { kind: 'counterbore', entrance: center, down, radius: walls[1]!.r0, depth, cbRadius: walls[0]!.r0, cbDepth: walls[0]!.d1 };
      } else if (walls.length === 2 && !cyl(walls[0]!) && cyl(walls[1]!) && walls[0]!.r0 > walls[0]!.r1 + TOL && Math.abs(walls[0]!.r1 - walls[1]!.r0) <= TOL && floors.length === bottom) {
        const half = Math.atan2(walls[0]!.r0 - walls[0]!.r1, walls[0]!.d1 - walls[0]!.d0);
        record = { kind: 'countersink', entrance: center, down, radius: walls[1]!.r0, depth, csRadius: walls[0]!.r0, csAngle: 2 * half };
      }
      if (record) {
        if (tip !== undefined) record.tip = tip;
        for (const k of faces) taken.add(k);
        out.push({ record, faces });
        break;
      }
    }
  });
  return out;
}

// ------------------------------------------------------------------ base body

/** The centre of the circle through three points, or null when they lie on a line. */
function circleThrough(a: readonly number[], m: readonly number[], b: readonly number[]): [number, number] | null {
  const [ax, ay, bx, by, cx, cy] = [a[0]!, a[1]!, m[0]!, m[1]!, b[0]!, b[1]!];
  const det = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(det) < 1e-14) return null;
  const [s1, s2, s3] = [ax * ax + ay * ay, bx * bx + by * by, cx * cx + cy * cy];
  return [(s1 * (by - cy) + s2 * (cy - ay) + s3 * (ay - by)) / det, (s1 * (cx - bx) + s2 * (ax - cx) + s3 * (bx - ax)) / det];
}

/** A section's splines as biarcs, with the bound that was proved kept in `approx`. */
function asBiarcs(edges: SectionEdge[], approx: SplineApproximation): SectionEdge[] {
  return edges.flatMap((e): SectionEdge[] => {
    if (e.kind !== 'bezier') return [e];
    approx.used = true;
    return e.spans.flatMap((span) => {
      const { pieces, maxBound } = biarcEnvelope(span, approx.tolerance);
      approx.bound = Math.max(approx.bound, maxBound);
      return pieces.map((p): SectionEdge => {
        const [a, b]: [P2, P2] = [[p.from[0], p.from[1]], [p.to[0], p.to[1]]];
        const c = p.kind === 'arc' ? circleThrough(p.from, p.mid, p.to) : null;
        return c ? { kind: 'arc', c, r: Math.hypot(a[0] - c[0], a[1] - c[1]), a, b, mid: [p.mid[0], p.mid[1]] } : { kind: 'line', a, b };
      });
    });
  });
}

function sectionRect(frame: Frame, box: { min: Vec3; max: Vec3 }, half: boolean) {
  const corners: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push([x, y, z]);
  const us = corners.map((c) => dot(sub(c, frame.origin), frame.xDir));
  const vs = corners.map((c) => dot(sub(c, frame.origin), frame.yDir));
  const pad = 1 + 0.01 * Math.hypot(...sub(box.max, box.min));
  return { u0: half ? 0 : Math.min(...us) - pad, u1: Math.max(...us) + pad, v0: Math.min(...vs) - pad, v1: Math.max(...vs) + pad };
}

function section(kernel: Kernel, shape: ShapeId, frame: Frame, box: { min: Vec3; max: Vec3 }, half = false, budget?: Budget, approx?: SplineApproximation): Loop[] {
  budget?.check();
  let edges: SectionEdge[];
  try {
    edges = kernel.sectionEdges(shape, frame, sectionRect(frame, box, half));
  } catch (e) {
    if (e instanceof KernelError) throw new RecognizeError(t('recognize.sectionFailed', { why: e.message }));
    throw e;
  }
  try {
    return chainLoops(approx ? asBiarcs(edges, approx) : edges, TOL * 10);
  } catch (e) {
    if (e instanceof LoopError) throw new RecognizeError(e.curve ? t('recognize.unsupportedCurve', { curve: e.curve }) : t('recognize.sectionOpen'));
    throw e;
  }
}

/** Every face is a surface of revolution about one axis (planes square to it): the axis, else null. */
function revolveAxis(topo: Topology): { origin: Vec3; dir: Vec3 } | null {
  let axis: { origin: Vec3; dir: Vec3 } | null = null;
  for (const f of topo.faces) {
    const a = axisOf(f.geometry);
    if (a) {
      if (!axis) axis = a;
      else if (!coaxial(axis.origin, axis.dir, a.origin, a.dir)) return null;
    }
  }
  if (!axis) return null;
  for (const f of topo.faces) {
    const g = f.geometry;
    if (!g) return null;
    if (g.type === 'plane' && !parallel(g.normal, axis.dir)) return null;
    if (g.type === 'sphere' && lineDistance(g.center, axis.origin, axis.dir) > TOL) return null;
  }
  return axis;
}

/** Signed lean in radians: positive where material narrows along `d`, zero for a straight wall, null for caps and non-walls. */
function wallLean(f: FaceInfo, d: Vec3): number | null {
  const g = f.geometry;
  if (g?.type === 'plane') {
    if (parallel(g.normal, d)) return null;
    const axial = dot(unit(g.normal), unit(d));
    const lean = Math.asin(Math.min(1, Math.abs(axial)));
    return lean <= 1e-9 ? 0 : lean <= MAX_DRAFT + 1e-12 ? Math.sign(axial) * lean : null;
  }
  if (g?.type === 'cylinder') return parallel(g.axis, d) ? 0 : null;
  if (g?.type === 'cone') {
    const lean = Math.abs(g.halfAngle);
    if (!parallel(g.axis, d) || lean > MAX_DRAFT + 1e-12) return null;
    // Radius grows away from the apex. A concave wall reverses the material side.
    return lean * Math.sign(dot(sub(f.center, g.apex), d)) * (g.convex ? -1 : 1);
  }
  return null;
}

/** A face with no simple surface that is a straight wall along a direction, when splines are to be approximated (ADR 0243). */
type FreeWall = (face: number, d: Vec3) => boolean;

function freeWalls(kernel: Kernel, shape: ShapeId, approx?: SplineApproximation): FreeWall | undefined {
  return approx ? (face, d) => kernel.faceRuledAlong(shape, face, d) : undefined;
}

/** Faces that keep a direction from being an extrusion direction. */
function blockers(topo: Topology, d: Vec3, free?: FreeWall): number[] {
  return topo.faces.flatMap((f, i) => {
    const g = f.geometry;
    if (g?.type === 'plane' && parallel(g.normal, d)) return [];
    if (wallLean(f, d) !== null) return [];
    return !g && free?.(i, d) ? [] : [i];
  });
}

/** Where along `d` each face reaches (its vertices'): what layers it is a wall of. */
function extentAlong(topo: Topology, d: Vec3): [number, number][] {
  const out: [number, number][] = topo.faces.map(() => [Infinity, -Infinity]);
  for (const v of topo.vertices) {
    const h = dot(v.point, d);
    for (const i of v.faces) {
      out[i]![0] = Math.min(out[i]![0], h);
      out[i]![1] = Math.max(out[i]![1], h);
    }
  }
  return out;
}

/** Each piece of `b` moved on along the change from `a` to it by `k` times that change (a drafted layer's profile, linear in the height). */
function extrapolate(a: Loop[], b: Loop[], k: number): Loop[] | null {
  if (a.length !== b.length) return null;
  const lerp = (p: P2, q: P2): P2 => [q[0] + (q[0] - p[0]) * k, q[1] + (q[1] - p[1]) * k];
  const mid = (g: Loop['segs'][number]): P2 => (g.kind === 'circle' ? g.c : g.kind === 'arc' ? g.c : [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2]);
  const used = new Set<Loop>();
  const out: Loop[] = [];
  for (const lb of b) {
    // the loop of the other section it continues: the same pieces, nearest
    const la = a.filter((x) => !used.has(x) && x.segs.length === lb.segs.length).sort((x, y) => Math.hypot(...sub2(mid(x.segs[0]!), mid(lb.segs[0]!))) - Math.hypot(...sub2(mid(y.segs[0]!), mid(lb.segs[0]!))))[0];
    if (!la) return null;
    used.add(la);
    const segs: Loop['segs'] = [];
    for (const g of lb.segs) {
      const f = la.segs.filter((h) => h.kind === g.kind).sort((x, y) => Math.hypot(...sub2(mid(x), mid(g))) - Math.hypot(...sub2(mid(y), mid(g))))[0];
      if (!f) return null;
      if (g.kind === 'line' && f.kind === 'line') {
        // the two ends, each to the nearer end of the other section's piece
        const [fa, fb] = Math.hypot(...sub2(f.a, g.a)) <= Math.hypot(...sub2(f.b, g.a)) ? [f.a, f.b] : [f.b, f.a];
        segs.push({ kind: 'line', a: lerp(fa, g.a), b: lerp(fb, g.b) });
      } else if (g.kind === 'arc' && f.kind === 'arc') {
        const [fa, fb] = Math.hypot(...sub2(f.a, g.a)) <= Math.hypot(...sub2(f.b, g.a)) ? [f.a, f.b] : [f.b, f.a];
        segs.push({ kind: 'arc', c: lerp(f.c, g.c), r: g.r + (g.r - f.r) * k, a: lerp(fa, g.a), b: lerp(fb, g.b), ccw: g.ccw });
      } else if (g.kind === 'circle' && f.kind === 'circle') {
        segs.push({ kind: 'circle', c: lerp(f.c, g.c), r: g.r + (g.r - f.r) * k });
      } else return null;
    }
    out.push({ ...lb, segs });
  }
  return out;
}

const sub2 = (p: P2, q: P2): [number, number] => [p[0] - q[0], p[1] - q[1]];
const regionArea = (loops: Loop[]) => loops.reduce((a, l) => a + (l.depth % 2 === 0 ? Math.abs(l.area) : -Math.abs(l.area)), 0);

function uniformLean(leans: number[]): number | undefined {
  const angle = leans[0] ?? 0;
  return leans.every((x) => Math.abs(x - angle) <= 1e-7) ? angle : undefined;
}

function layerProfile(kernel: Kernel, shape: ShapeId, frame: Frame, d: Vec3, height: number, lean: number, budget?: Budget, approx?: SplineApproximation): PlanarProfile | null {
  const box = kernel.bounds(shape);
  const cut = (f: number) => section(kernel, shape, { ...frame, origin: addv(frame.origin, d, height * f) }, box, false, budget, approx);
  if (lean === 0) {
    const loops = cut(0.5);
    return loops.length ? { frame, loops } : null;
  }
  // Drafted walls change linearly with the height. Extrapolate the two interior sections to the bottom cap.
  const [q1, q3] = [cut(0.25), cut(0.75)];
  if (!q1.length) return null;
  const loops = extrapolate(q3, q1, 0.5);
  if (!loops) throw new RecognizeError(t('recognize.draftSection'));
  return { frame, loops, draft: { angle: Math.abs(lean), inward: regionArea(q3) < regionArea(q1) } };
}

/** The slab already made the bottom section. Use its analytic boundary without another boolean. */
function bottomLoops(topo: Topology, frame: Frame, d: Vec3): Loop[] | null {
  const caps = new Set(topo.faces.flatMap((f, i) => {
    const g = f.geometry;
    return g?.type === 'plane' && parallel(g.normal, d) && Math.abs(dot(sub(g.origin, frame.origin), d)) <= 1e-7 ? [i] : [];
  }));
  const local = (p: Vec3): P2 => {
    const v = sub(p, frame.origin);
    return [dot(v, frame.xDir), dot(v, frame.yDir)];
  };
  const edges: SectionEdge[] = [];
  for (const e of topo.edges) {
    // Edges between two coplanar cap faces are internal to the section.
    if ([...new Set(e.faces)].filter((i) => caps.has(i)).length !== 1) continue;
    const g = e.geometry;
    if (g?.type === 'circle' && Math.abs(e.length - 2 * Math.PI * g.radius) <= TOL) {
      edges.push({ kind: 'circle', c: local(g.center), r: g.radius });
      continue;
    }
    const [a, b] = e.vertices.map((i) => local(topo.vertices[i]!.point));
    if (!a || !b) return null;
    if (g?.type === 'line') edges.push({ kind: 'line', a, b });
    else if (g?.type === 'circle') edges.push({ kind: 'arc', a, b, c: local(g.center), r: g.radius, mid: local(e.mid) });
    else return null;
  }
  try {
    return chainLoops(edges, TOL * 10);
  } catch (e) {
    if (e instanceof LoopError) return null;
    throw e;
  }
}

/** The slab removes connections through other layers. Each remaining solid must have its own uniform draft. */
function mixedLayer(kernel: Kernel, shape: ShapeId, frame: Frame, d: Vec3, height: number, leans: number[], budget?: Budget, approx?: SplineApproximation): PlanarProfile[] {
  const deg = [...new Set(leans.map((x) => ((x * 180) / Math.PI).toFixed(2)))].join('°, ');
  const refusal = new RecognizeError(t('recognize.mixedDraft', { angles: `${deg}°` }));
  const made: ShapeId[] = [];
  try {
    budget?.check();
    const { u0, u1, v0, v1 } = sectionRect(frame, kernel.bounds(shape), false);
    const points: P2[] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const outer = points.map((a, i) => ({ kind: 'line' as const, a, b: points[(i + 1) % 4]!, source: `slab${i}` }));
    const slab = kernel.extrude(frame, [{ outer, holes: [] }], addv([0, 0, 0], d, height));
    made.push(slab.shape);
    const clipped = kernel.common(shape, slab.shape, 0).shape;
    if (clipped === null) throw refusal;
    made.push(clipped);
    const pieces = kernel.splitSolids({ shape: clipped, faceOrigins: [] });
    made.push(...pieces.map((p) => p.shape));
    if (pieces.length < 2) throw refusal;
    return pieces.map((p) => {
      budget?.check();
      const topo = kernel.topology(p.shape);
      const free = freeWalls(kernel, p.shape, approx);
      if (blockers(topo, d, free).length) throw refusal;
      const lean = uniformLean(topo.faces.flatMap((f, i) => {
        const lean = wallLean(f, d);
        return lean !== null ? [lean] : !f.geometry && free?.(i, d) ? [0] : [];
      }));
      if (lean === undefined) throw refusal;
      const loops = bottomLoops(topo, frame, d);
      if (loops?.length) return { frame, loops, ...(lean !== 0 ? { draft: { angle: Math.abs(lean), inward: lean > 0 } } : {}) };
      if (approx && free) {
        const profile = layerProfile(kernel, p.shape, frame, d, height, lean, budget, approx);
        if (profile) return profile;
      }
      throw refusal;
    });
  } catch (e) {
    if (e instanceof KernelError) throw refusal;
    throw e;
  } finally {
    for (const id of made.reverse()) kernel.release(id);
  }
}

const CANONICAL: Vec3[] = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];

function canonical(d: Vec3): Vec3 {
  const u = unit(d);
  const k = Math.abs(u[0]) > 1e-12 ? 0 : Math.abs(u[1]) > 1e-12 ? 1 : 2;
  return u[k]! < 0 ? [-u[0], -u[1], -u[2]] : u;
}

/** How far down a body taken apart along several directions may go: a feature on a feature on the base. */
const MAX_SIDE_DEPTH = 3;

/**
 * The base of a body: one extrusion direction if there is one, else (side bosses and pockets) the best direction with the faces in the way taken off by
 * Delete Face, and each piece that made or took away recognized as an extrusion along its own direction.
 */
function baseOf(kernel: Kernel, shape: ShapeId, topo: Topology, frameFor: FrameFor, depth = 0, budget?: Budget, approx?: SplineApproximation): BaseRecord {
  try {
    return extrudeBase(kernel, shape, topo, frameFor, budget, approx);
  } catch (first) {
    rethrowTrap(first);
    if (!(first instanceof RecognizeError) || depth >= MAX_SIDE_DEPTH) throw first;
    const best = bestDirection(topo, freeWalls(kernel, shape, approx));
    if (!best || best.blocking.length === 0) throw first;
    // the faces in the way, and every face that only they (and faces already taken) surround: the end of a boss, the floor of a pocket
    const adj = adjacency(topo);
    const group = new Set(best.blocking);
    for (let grown = true; grown; ) {
      grown = false;
      topo.faces.forEach((_, i) => {
        if (group.has(i)) return;
        const around = [...adj[i]!.keys()];
        if (around.length > 0 && around.every((n) => group.has(n))) {
          group.add(i);
          grown = true;
        }
      });
    }
    const made: ShapeId[] = [];
    try {
      let rest: ShapeId;
      try {
        rest = kernel.deleteFaces(shape, [...group]).shape;
      } catch (e) {
        if (e instanceof KernelError) throw first;
        throw e;
      }
      made.push(rest);
      const base = baseOf(kernel, rest, kernel.topology(rest), frameFor, depth + 1, budget, approx);
      const extras: Extract<BaseRecord, { type: 'composite' }>['extras'] = [];
      const size = kernel.massProps(shape).volume;
      for (const [op, a, b] of [['boss', shape, rest], ['cut', rest, shape]] as const) {
        const diff = kernel.boolean('cut', a, b);
        made.push(diff.shape);
        for (const piece of kernel.splitSolids(diff)) {
          made.push(piece.shape);
          if (kernel.massProps(piece.shape).volume <= 1e-9 * size) continue;
          let rec: BaseRecord;
          try {
            rec = extrudeBase(kernel, piece.shape, kernel.topology(piece.shape), frameFor, budget, approx);
          } catch (e) {
            if (e instanceof RecognizeError) throw first;
            throw e;
          }
          extras.push({ op, rec: rec as Extract<BaseRecord, { type: 'extrude' }> });
        }
      }
      if (extras.length === 0) throw first;
      return { type: 'composite', base, extras };
    } finally {
      for (const id of made) kernel.release(id);
    }
  }
}

/** The extrusion direction most faces fit, with the faces that do not (null when there are no planes or cylinders at all). */
function bestDirection(topo: Topology, free?: FreeWall): { d: Vec3; blocking: number[] } | null {
  const candidates: Vec3[] = [];
  const add = (d: Vec3) => {
    const c = canonical(d);
    if (!candidates.some((x) => parallel(x, c))) candidates.push(c);
  };
  for (const c of CANONICAL) add(c);
  for (const f of topo.faces) {
    if (f.geometry?.type === 'plane') add(f.geometry.normal);
    if (f.geometry?.type === 'cylinder') add(f.geometry.axis);
  }
  // fewest faces in the way, then the most area along it (the main body), then the default directions first
  let best: { d: Vec3; blocking: number[]; area: number } | null = null;
  for (const d of candidates) {
    const blocking = blockers(topo, d, free);
    const a = topo.faces.reduce((sum, f, i) => (blocking.includes(i) ? sum : sum + f.area), 0);
    if (!best || blocking.length < best.blocking.length || (blocking.length === best.blocking.length && a > best.area + 1e-9)) best = { d, blocking, area: a };
  }
  return best && { d: best.d, blocking: best.blocking };
}

function extrudeBase(kernel: Kernel, shape: ShapeId, topo: Topology, frameFor: FrameFor, budget?: Budget, approx?: SplineApproximation): BaseRecord {
  const free = freeWalls(kernel, shape, approx);
  const candidates: Vec3[] = [];
  const addCandidate = (d: Vec3) => {
    const c = canonical(d);
    if (!candidates.some((x) => parallel(x, c))) candidates.push(c);
  };
  for (const c of CANONICAL) addCandidate(c);
  for (const f of topo.faces) {
    if (f.geometry?.type === 'plane') addCandidate(f.geometry.normal);
    if (f.geometry?.type === 'cylinder') addCandidate(f.geometry.axis);
  }
  type Option = { d: Vec3; levels: number[]; cap: number; blocking: number[]; rank: number };
  const options: Option[] = candidates.map((d) => {
    const caps = topo.faces.filter((f) => f.geometry?.type === 'plane' && parallel(f.geometry.normal, d));
    const levels = [...new Set(caps.map((f) => dot(f.center, d).toFixed(7)))].map(Number).sort((a, b) => a - b);
    const rank = CANONICAL.findIndex((c) => parallel(c, d));
    return { d, levels, cap: caps.reduce((a, f) => a + f.area, 0), blocking: blockers(topo, d, free), rank: rank < 0 ? 9 : rank };
  });
  const valid = options.filter((o) => o.blocking.length === 0 && o.levels.length >= 2);
  if (valid.length === 0) {
    const best = options.reduce((a, b) => (b.blocking.length < a.blocking.length ? b : a));
    throw new RecognizeError(t('recognize.noBase', { n: best.blocking.length, faces: describe(topo, best.blocking) }));
  }
  valid.sort((a, b) => a.levels.length - b.levels.length || b.cap - a.cap || a.rank - b.rank);
  const { d, levels } = valid[0]!;
  // exact heights of the caps (the rounding above only grouped them)
  const exact = levels.map((l) => {
    const hs = topo.faces.filter((f) => f.geometry?.type === 'plane' && parallel(f.geometry.normal, d)).map((f) => dot(f.center, d)).filter((h) => Math.abs(h - l) <= 1e-6);
    return hs.reduce((a, b) => a + b, 0) / hs.length;
  });
  const extent = extentAlong(topo, d);
  const layers = exact.slice(0, -1).map((h, i) => {
    const top = exact[i + 1]!;
    const frame = frameFor(d, [d[0] * h, d[1] * h, d[2] * h]);
    // The walls of this layer, and how they lean.
    const leans = topo.faces.flatMap((f, k) => {
      const [lo, hi] = extent[k]!;
      if (!(lo < top - 1e-7 && hi > h + 1e-7)) return [];
      const lean = wallLean(f, d);
      if (lean === null) return !f.geometry && free?.(k, d) ? [0] : [];
      return [lean];
    });
    const angle = uniformLean(leans);
    if (angle === undefined) return mixedLayer(kernel, shape, frame, d, top - h, leans, budget, approx);
    const profile = layerProfile(kernel, shape, frame, d, top - h, angle, budget, approx);
    return profile ? [profile] : [];
  });
  return { type: 'extrude', dir: d, levels: exact, layers };
}

function revolveBase(kernel: Kernel, shape: ShapeId, axis: { origin: Vec3; dir: Vec3 }, planeNormal: Vec3, frameFor: FrameFor, budget?: Budget): BaseRecord {
  const frame = frameFor(planeNormal, axis.origin);
  // the half of the plane on one side of the axis: x across the axis in the plane, y along it
  const across = unit(cross(frame.normal, axis.dir));
  const half: Frame = { origin: axis.origin, xDir: across, yDir: axis.dir, normal: cross(across, axis.dir) };
  const loops = section(kernel, shape, half, kernel.bounds(shape), true, budget);
  // the loops in the sketch frame
  const to = (p: P2): P2 => {
    const q = addv(addv(half.origin, half.xDir, p[0]), half.yDir, p[1]);
    const v = sub(q, frame.origin);
    return [dot(v, frame.xDir), dot(v, frame.yDir)];
  };
  const mirror = dot(cross(frame.xDir, frame.yDir), half.normal) < 0;
  const moved = loops.map((l) => ({
    ...l,
    segs: l.segs.map((s) => (s.kind === 'line' ? { ...s, a: to(s.a), b: to(s.b) } : s.kind === 'arc' ? { ...s, c: to(s.c), a: to(s.a), b: to(s.b), ccw: mirror ? !s.ccw : s.ccw } : { ...s, c: to(s.c) })),
  }));
  return { type: 'revolve', axis, profile: { frame, loops: moved } };
}

/** A plane through the axis: square to one of the default planes' normals when it can be, else to any direction across it. */
export function planeThroughAxis(dir: Vec3): Vec3 {
  for (const n of [[0, 0, 1], [0, 1, 0], [1, 0, 0]] as Vec3[]) if (square(n, dir, 1e-12)) return n;
  const helper: Vec3 = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(dir, helper));
}

// ------------------------------------------------------------------ the whole

/**
 * Takes `shape` apart. The shapes made on the way are released; `shape` is not. Throws `RecognizeError` with a message for the user when some part of
 * the body is none of the features this recognizes.
 */
export function recognize(kernel: Kernel, shape: ShapeId, frameFor: FrameFor, budget?: Budget, approx?: SplineApproximation): Recognition {
  if (kernel.solidCount(shape) !== 1) throw new RecognizeError(t('recognize.oneSolid', { n: kernel.solidCount(shape) }));
  const made: ShapeId[] = [];
  try {
    const topo0 = kernel.topology(shape);
    const odd = topo0.faces.flatMap((f, i) => (ANALYTIC.has(f.surface) && f.geometry ? [] : [i]));
    if (odd.length) {
      // asked to, faces like these may be the walls of an extrusion; they must all be walls along one direction, the direction some plane of the body faces
      const free = freeWalls(kernel, shape, approx);
      const along = (d: Vec3) => odd.every((i) => !!free?.(i, d));
      const walls = free && topo0.faces.some((f) => f.geometry?.type === 'plane' && along(f.geometry.normal));
      if (!walls) throw new RecognizeError(`${t('recognize.freeform', { n: odd.length, faces: describe(topo0, odd) })}${approx ? '' : ` ${t('recognize.freeformHint')}`}`);
    }
    const smooth = kernel.smoothEdges(shape, topo0.edges.map((_, i) => i));
    const cands = blendCandidates(topo0, smooth, adjacency(topo0));
    const blends = removeBlends(kernel, shape, topo0, cands);
    let current = shape;
    if (blends) made.push((current = blends.shape));
    const topo1 = kernel.topology(current);
    let holes = findHoles(topo1, adjacency(topo1));
    let holeFaces = 0;
    if (holes.length) {
      let r: ReturnType<Kernel['deleteFaces']> | null = null;
      try {
        r = kernel.deleteFaces(current, holes.flatMap((h) => h.faces));
      } catch (e) {
        if (!(e instanceof KernelError)) throw e;
        holes = holes.filter((h) => {
          try {
            kernel.release(kernel.deleteFaces(current, h.faces).shape);
            return true;
          } catch (err) {
            if (err instanceof KernelError) return false;
            throw err;
          }
        });
        if (holes.length) r = kernel.deleteFaces(current, holes.flatMap((h) => h.faces));
      }
      if (r) {
        made.push((current = r.shape));
        holeFaces = holes.reduce((a, h) => a + h.faces.length, 0);
      }
    }
    const topo2 = kernel.topology(current);
    const axis = revolveAxis(topo2);
    const base = axis ? revolveBase(kernel, current, axis, planeThroughAxis(axis.dir), frameFor, budget) : baseOf(kernel, current, topo2, frameFor, 0, budget, approx);
    return {
      base,
      holes: holes.map((h) => h.record),
      blends: blends?.records ?? [],
      counts: { faces: topo0.faces.length, blendFaces: blends?.removed ?? 0, holeFaces, baseFaces: topo2.faces.length },
    };
  } finally {
    for (const id of made) kernel.release(id);
  }
}

export type { FaceInfo };
