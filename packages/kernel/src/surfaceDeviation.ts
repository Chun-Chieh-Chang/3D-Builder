/**
 * How far one solid's boundary is from another's, without a boolean (ADR 0248). Two near-equal solids with B-spline faces (an imported round and the
 * exact round that rebuilt it) make `BOPAlgo_CellsBuilder` trap ("memory access out of bounds") or run for minutes; the comparison after a rebuild
 * must not depend on it.
 *
 * Measure: the volume between two near-equal solids is, to first order, the integral over one boundary of the distance to the other,
 * V(A △ B) ≈ ∫∂A d(p, ∂B) dA. `surfaceDeviation(A, B)` is that integral: points on every face of A in its own parameters (the face's triangulation
 * read in (u, v), each triangle cut into k² and the point at each piece's middle), each weighted by the area it stands for, |Su × Sv| times the
 * piece's (u, v) area; so the points are on the exact surface and the weights are its area element, not the mesh's. Every face of A has points, so
 * a face of A that B lacks (a hole, a boss) is measured; asked both ways, so is one of B that A lacks.
 *
 * Distance to ∂B: B's triangulation only says which faces are near (a bounding-volume tree, every triangle within the nearest one's distance plus
 * twice the mesh's tolerance); the distance itself is to each such face's exact surface by Newton from the (u, v) of the nearest point of its nearest
 * triangle, kept when the foot is inside the face (a classifier), else to the face's edges' curves. Everything native is made once per call and
 * deleted at its end; derivatives are read through `sD1` (C2.14d).
 */
import { sD1 } from './exactRound';
import type { Bvh } from './rays';
import { buildBvh } from './rays';

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** One face's triangulation: node xyz (placed), node (u, v), triangles (node numbers from 0). */
interface FaceMesh {
  xyz: number[];
  uv: number[];
  tris: number[];
}

/** The triangulation of each face (read after meshing; a face without one, or without (u, v) at its nodes, has none). */
function faceMeshes(oc: any, faces: readonly any[]): (FaceMesh | null)[] {
  return faces.map((face) => {
    const loc = new oc.TopLoc_Location();
    const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
    try {
      if (!tri || !tri.HasUVNodes()) return null;
      const trsf = loc.Transformation();
      const m: FaceMesh = { xyz: [], uv: [], tris: [] };
      for (let n = 1; n <= tri.NbNodes(); n++) {
        const node = tri.Node(n);
        const p = node.Transformed(trsf);
        m.xyz.push(p.X(), p.Y(), p.Z());
        p.delete();
        node.delete();
        const q = tri.UVNode(n);
        m.uv.push(q.X(), q.Y());
        q.delete();
      }
      for (let k = 1; k <= tri.NbTriangles(); k++) {
        const t = tri.Triangle(k);
        const { theN1, theN2, theN3 } = t.Get();
        t.delete();
        m.tris.push(theN1 - 1, theN2 - 1, theN3 - 1);
      }
      trsf.delete();
      return m;
    } finally {
      tri?.delete?.();
      loc.delete();
    }
  });
}

/** The closest point of triangle abc to p: its barycentric weights for a, b, c and the distance (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): { w: V3; d: number } {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const at = (w: V3) => {
    const q: V3 = [w[0] * a[0] + w[1] * b[0] + w[2] * c[0], w[0] * a[1] + w[1] * b[1] + w[2] * c[1], w[0] * a[2] + w[1] * b[2] + w[2] * c[2]];
    return { w, d: len(sub(p, q)) };
  };
  if (d1 <= 0 && d2 <= 0) return at([1, 0, 0]);
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at([0, 1, 0]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at([1 - v, v, 0]); }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at([0, 0, 1]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at([1 - w, 0, w]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return at([0, 1 - w, w]); }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return at([1 - v - w, v, w]);
}

/** Distance from p to a node's box (0 inside). */
function boxDistance(bvh: Bvh, node: number, p: V3): number {
  const b = bvh.bounds;
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const lo = b[6 * node + k]!, hi = b[6 * node + 3 + k]!;
    const e = p[k]! < lo ? lo - p[k]! : p[k]! > hi ? p[k]! - hi : 0;
    s += e * e;
  }
  return Math.sqrt(s);
}

/** Every triangle within `reach(nearest)` of p, with its closest point; the nearest found first by pruning boxes farther than the best so far. */
function trianglesNear(bvh: Bvh, p: V3, slack: number): { tri: number; w: V3; d: number }[] {
  const corner = (t: number, k: number): V3 => [bvh.corners[9 * t + 3 * k]!, bvh.corners[9 * t + 3 * k + 1]!, bvh.corners[9 * t + 3 * k + 2]!];
  const visit = (limit: () => number, take: (t: number, w: V3, d: number) => void) => {
    const stack = [0];
    while (stack.length) {
      const n = stack.pop()!;
      if (boxDistance(bvh, n, p) > limit()) continue;
      if (bvh.left[n]! < 0) {
        for (let i = bvh.start[n]!; i < bvh.start[n]! + bvh.count[n]!; i++) {
          const t = bvh.order[i]!;
          const c = closestOnTriangle(p, corner(t, 0), corner(t, 1), corner(t, 2));
          take(t, c.w, c.d);
        }
      } else stack.push(bvh.left[n]!, bvh.right[n]!);
    }
  };
  let best = Infinity;
  visit(() => best, (_t, _w, d) => { if (d < best) best = d; });
  const out: { tri: number; w: V3; d: number }[] = [];
  const reach = best + slack;
  visit(() => reach, (tri, w, d) => { if (d <= reach) out.push({ tri, w, d }); });
  return out;
}

export interface Deviation {
  /** ∫ d dA over the first solid's boundary (mm³): to first order, the volume between the two solids seen from this side */
  integral: number;
  /** the largest distance of a point (mm) */
  max: number;
  /** the sum of the weights: the first solid's area as sampled (mm²) */
  area: number;
  samples: number;
}

/**
 * ∫∂A d(p, ∂B) dA (see the module's comment). `facesA`/`facesB` are the solids' faces, already meshed with deflection `tolerance`; `perFace`: at least
 * about this many points on each face of A.
 */
export function surfaceDeviation(oc: any, facesA: readonly any[], facesB: readonly any[], tolerance: number, perFace = 100): Deviation {
  const meshA = faceMeshes(oc, facesA), meshB = faceMeshes(oc, facesB);
  // B's triangles, all faces in one tree; per triangle its face and the (u, v) of its corners
  const positions: number[] = [], indices: number[] = [], triFace: number[] = [], triUv: number[] = [];
  meshB.forEach((m, f) => {
    if (!m) return;
    const base = positions.length / 3;
    positions.push(...m.xyz);
    for (let i = 0; i < m.tris.length; i += 3) {
      indices.push(base + m.tris[i]!, base + m.tris[i + 1]!, base + m.tris[i + 2]!);
      triFace.push(f);
      for (let k = 0; k < 3; k++) triUv.push(m.uv[2 * m.tris[i + k]!]!, m.uv[2 * m.tris[i + k]! + 1]!);
    }
  });
  if (meshA.some((m) => !m) || meshB.some((m) => !m) || indices.length === 0) throw new Error('surfaceDeviation: a face has no triangulation with (u, v) nodes');
  const bvh = buildBvh(positions, indices);

  // what is made once per face of B: its surface, a classifier, its edges' curves with a projector each
  const made: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(x: T): T => { made.push(x); return x; };
  const uv2 = own(new oc.gp_Pnt2d(0, 0));
  const g = own(new oc.gp_Pnt(0, 0, 0));
  const IN = oc.TopAbs_State.TopAbs_IN, ON = oc.TopAbs_State.TopAbs_ON;
  const bFace = new Map<number, { ad: any; cl: any; edges: { pr: any; ends: V3[] }[] }>();
  const faceOfB = (f: number) => {
    let x = bFace.get(f);
    if (x) return x;
    const face = facesB[f];
    const ad = own(new oc.BRepAdaptor_Surface(face, true));
    const cl = own(new oc.BRepClass_FaceClassifier());
    const edges: { pr: any; ends: V3[] }[] = [];
    for (const ex = own(new oc.TopExp_Explorer(face, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)); ex.More(); ex.Next()) {
      const cur = ex.Current();
      const e = own(oc.TopoDS.Edge(cur));
      cur.delete();
      if (oc.BRep_Tool.Degenerated(e)) continue;
      const ca = own(new oc.BRepAdaptor_Curve(e));
      const got = oc.BRep_Tool.Curve(e, 0, 0);
      const curve = got?.returnValue ?? got;
      if (!curve || (typeof curve.IsNull === 'function' && curve.IsNull())) continue;
      own(curve);
      const pr = own(new oc.GeomAPI_ProjectPointOnCurve());
      pr.Init(curve, ca.FirstParameter(), ca.LastParameter());
      const ends = [ca.FirstParameter(), ca.LastParameter()].map((t) => { const q = ca.Value(t); const o: V3 = [q.X(), q.Y(), q.Z()]; q.delete(); return o; });
      edges.push({ pr, ends });
    }
    x = { ad, cl, edges };
    bFace.set(f, x);
    return x;
  };
  /** distance from p to face f of B, starting Newton at (u, v) */
  const toFace = (f: number, p: V3, u0: number, v0: number): number => {
    const { ad, cl, edges } = faceOfB(f);
    let [u, v] = [u0, v0];
    for (let it = 0; it < 30; it++) {
      const e = sD1(oc, ad, u, v);
      const r = sub(p, e.p as V3);
      const a = dot(e.du as V3, e.du as V3), b = dot(e.du as V3, e.dv as V3), c = dot(e.dv as V3, e.dv as V3);
      const ru = dot(e.du as V3, r), rv = dot(e.dv as V3, r);
      const det = a * c - b * b;
      if (!(Math.abs(det) > 0)) break;
      const du = (ru * c - rv * b) / det, dv = (a * rv - b * ru) / det;
      u += du;
      v += dv;
      if (Math.hypot(du * Math.sqrt(a), dv * Math.sqrt(c)) < 1e-14) break;
    }
    uv2.SetX(u);
    uv2.SetY(v);
    cl.Perform(facesB[f], uv2, 1e-9);
    const s = cl.State();
    if (s === IN || s === ON || String(s) === String(IN) || String(s) === String(ON)) return len(sub(p, sD1(oc, ad, u, v).p as V3));
    // the nearest point of the face is on its boundary
    let d = Infinity;
    g.SetCoord(p[0], p[1], p[2]);
    for (const { pr, ends } of edges) {
      pr.Perform(g);
      if (pr.NbPoints() > 0) d = Math.min(d, pr.LowerDistance());
      for (const q of ends) d = Math.min(d, len(sub(p, q)));
    }
    return d;
  };

  try {
    const out: Deviation = { integral: 0, max: 0, area: 0, samples: 0 };
    const slack = 2 * tolerance + 1e-9;
    meshA.forEach((m, f) => {
      const ad = own(new oc.BRepAdaptor_Surface(facesA[f], true));
      const nTri = m!.tris.length / 3;
      const k = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(perFace / Math.max(1, nTri)))));
      for (let i = 0; i < m!.tris.length; i += 3) {
        const c = [0, 1, 2].map((j) => [m!.uv[2 * m!.tris[i + j]!]!, m!.uv[2 * m!.tris[i + j]! + 1]!] as [number, number]);
        const e1 = [c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]], e2 = [c[2]![0] - c[0]![0], c[2]![1] - c[0]![1]];
        const uvArea = Math.abs(e1[0]! * e2[1]! - e1[1]! * e2[0]!) / 2 / (k * k);
        if (!(uvArea > 0)) continue;
        const sample = (a: number, b: number) => {
          const u = c[0]![0] + (e1[0]! * a + e2[0]! * b) / k, v = c[0]![1] + (e1[1]! * a + e2[1]! * b) / k;
          const s = sD1(oc, ad, u, v);
          const w = len(cross(s.du as V3, s.dv as V3)) * uvArea;
          const p = s.p as V3;
          let d = Infinity;
          // per face of B near p, its nearest triangle: Newton from there
          const near = new Map<number, { tri: number; w: V3; d: number }>();
          for (const t of trianglesNear(bvh, p, slack)) {
            const q = near.get(triFace[t.tri]!);
            if (!q || t.d < q.d) near.set(triFace[t.tri]!, t);
          }
          for (const [fb, t] of near) {
            const o = 6 * t.tri;
            const u0 = t.w[0] * triUv[o]! + t.w[1] * triUv[o + 2]! + t.w[2] * triUv[o + 4]!;
            const v0 = t.w[0] * triUv[o + 1]! + t.w[1] * triUv[o + 3]! + t.w[2] * triUv[o + 5]!;
            d = Math.min(d, toFace(fb, p, u0, v0));
          }
          out.integral += w * d;
          out.area += w;
          out.max = Math.max(out.max, d);
          out.samples++;
        };
        for (let a = 0; a < k; a++) for (let b = 0; b < k - a; b++) {
          sample(a + 1 / 3, b + 1 / 3);
          if (b < k - a - 1) sample(a + 2 / 3, b + 2 / 3);
        }
      }
    });
    return out;
  } finally {
    for (let i = made.length - 1; i >= 0; i--) made[i]!.delete();
  }
}
