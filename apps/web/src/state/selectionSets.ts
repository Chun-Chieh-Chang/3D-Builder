import { faceNamesOf } from '@3db/naming';
import type { MeshData } from '@3db/kernel';

/**
 * Selecting more than the element under the cursor (D5.6): the loop of edges round a face, the edges that continue one another smoothly, the faces that
 * meet smoothly. Worked out from what the rebuild gives the UI — the names of the faces and edges (an edge is named after the faces on its two sides)
 * and the mesh — so it needs no round trip to the kernel and no topology numbers beyond the ones the mesh already uses.
 */

type Vec = [number, number, number];

export interface TopologyInput {
  faceNames: string[];
  edgeNames: string[];
  mesh: Pick<MeshData, 'positions' | 'normals' | 'indices' | 'faceRanges' | 'edgePoints' | 'edgeRanges'>;
}

/**
 * Edges whose directions differ by less than this where they meet continue one another; faces whose normals differ by less than this meet smoothly.
 * Both are read off the mesh, where a curve or a surface is a run of flat pieces turning by up to 0.25 rad (14°) at a time, so what is measured at the
 * end of an arc is off by half of that: the angle has to be wider than that, and is narrower than anything a designer draws as an edge (a 15° draft).
 */
const SMOOTH = Math.cos((10 * Math.PI) / 180);

export class Topology {
  /** The faces on the two sides of each edge (one entry for an edge with the same face on both sides). */
  readonly edgeFaces: number[][];
  /** The edges round each face. */
  readonly faceEdges: number[][];
  /** Start and end of each edge that has a curve in the mesh, and the way the edge leaves each of them (pointing into the edge). */
  private readonly ends = new Map<number, { a: Vec; b: Vec; da: Vec; db: Vec; samples: Vec[] }>();
  /** Edges by the point they end at. */
  private readonly atPoint = new Map<string, number[]>();
  private readonly key: (p: Vec) => string;
  private readonly faceRange = new Map<number, [number, number]>();

  constructor(private readonly input: TopologyInput) {
    const { faceNames, edgeNames, mesh } = input;
    const index = new Map(faceNames.map((n, i) => [n, i]));
    this.edgeFaces = edgeNames.map((n) => [...new Set(faceNamesOf(n).flatMap((f) => (index.has(f) ? [index.get(f)!] : [])))]);
    this.faceEdges = faceNames.map(() => []);
    this.edgeFaces.forEach((faces, e) => faces.forEach((f) => this.faceEdges[f]!.push(e)));
    for (let r = 0; r < mesh.faceRanges.length; r += 3) this.faceRange.set(mesh.faceRanges[r + 2]!, [mesh.faceRanges[r]!, mesh.faceRanges[r + 1]!]);

    // points that are the same vertex to within a tiny fraction of the model's size are the same key
    let size = 1;
    for (let i = 0; i < mesh.edgePoints.length; i++) size = Math.max(size, Math.abs(mesh.edgePoints[i]!));
    const cell = size * 1e-6;
    this.key = (p) => `${Math.round(p[0] / cell)},${Math.round(p[1] / cell)},${Math.round(p[2] / cell)}`;

    const point = (i: number): Vec => [mesh.edgePoints[i * 3]!, mesh.edgePoints[i * 3 + 1]!, mesh.edgePoints[i * 3 + 2]!];
    for (let r = 0; r < mesh.edgeRanges.length; r += 3) {
      const start = mesh.edgeRanges[r]!;
      const count = mesh.edgeRanges[r + 1]!;
      const edge = mesh.edgeRanges[r + 2]!;
      if (count < 2) continue;
      const a = point(start);
      const b = point(start + count - 1);
      const samples = [a, point(start + Math.floor((count - 1) / 2)), b];
      this.ends.set(edge, { a, b, da: unit(sub(point(start + 1), a)), db: unit(sub(point(start + count - 2), b)), samples });
      for (const p of [a, b]) {
        const k = this.key(p);
        const list = this.atPoint.get(k);
        if (list) {
          if (!list.includes(edge)) list.push(edge);
        } else this.atPoint.set(k, [edge]);
      }
    }
  }

  /** The edges of `face` that join `edge` end to end: the loop `edge` is on (the outline of the face, or one of its holes). */
  loop(face: number, edge: number): number[] {
    const on = new Set(this.faceEdges[face] ?? []);
    if (!on.has(edge)) return [edge];
    return this.flood(edge, (_from, to) => on.has(to));
  }

  /** The edges that continue `edge` smoothly — end to end, with the direction carrying on — however far that goes (D5.6 「選取相切」). */
  tangentEdges(edge: number): number[] {
    return this.flood(edge, (from, to, at) => {
      const f = this.leaving(from, at);
      const t = this.leaving(to, at);
      // both directions point away from the shared end: carrying on means they are opposite
      return !!f && !!t && dot(f, t) <= -SMOOTH;
    });
  }

  /** The faces that meet `face` smoothly (a fillet and the faces it blends, a cylinder in two halves), and the ones those meet, and so on. */
  tangentFaces(face: number): number[] {
    const seen = new Set([face]);
    const queue = [face];
    while (queue.length > 0) {
      const f = queue.pop()!;
      for (const e of this.faceEdges[f] ?? []) {
        const faces = this.edgeFaces[e]!;
        if (faces.length !== 2) continue;
        const other = faces[0] === f ? faces[1]! : faces[0]!;
        if (seen.has(other) || !this.smoothAcross(e, f, other)) continue;
        seen.add(other);
        queue.push(other);
      }
    }
    return [...seen];
  }

  /** Is the surface smooth across the edge between the two faces: do their normals agree along it? */
  smoothAcross(edge: number, f1: number, f2: number): boolean {
    const samples = this.ends.get(edge)?.samples;
    if (!samples) return false;
    return samples.every((p) => {
      const n1 = this.normalAt(f1, p);
      const n2 = this.normalAt(f2, p);
      return !!n1 && !!n2 && dot(n1, n2) >= SMOOTH;
    });
  }

  /** The direction `edge` goes in from the end of it that is at `point` (pointing into the edge). */
  private leaving(edge: number, at: string): Vec | null {
    const e = this.ends.get(edge);
    if (!e) return null;
    if (this.key(e.a) === at) return e.da;
    if (this.key(e.b) === at) return e.db;
    return null;
  }

  /** The edges reached from `seed` through ends they share, as far as `step` allows. */
  private flood(seed: number, step: (from: number, to: number, at: string) => boolean): number[] {
    const seen = new Set([seed]);
    const queue = [seed];
    while (queue.length > 0) {
      const from = queue.pop()!;
      const e = this.ends.get(from);
      if (!e) continue;
      for (const p of [e.a, e.b]) {
        const at = this.key(p);
        for (const to of this.atPoint.get(at) ?? []) {
          if (seen.has(to) || !step(from, to, at)) continue;
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return [...seen];
  }

  /** The surface normal of `face` at the mesh vertex nearest to `p` (the vertices on an edge are the edge's own, so this is the normal along it). */
  private normalAt(face: number, p: Vec): Vec | null {
    const range = this.faceRange.get(face);
    if (!range) return null;
    const { indices, positions, normals } = this.input.mesh;
    let best = Infinity;
    let at = -1;
    for (let k = range[0]; k < range[0] + range[1]; k++) {
      const v = indices[k]!;
      const d = (positions[v * 3]! - p[0]) ** 2 + (positions[v * 3 + 1]! - p[1]) ** 2 + (positions[v * 3 + 2]! - p[2]) ** 2;
      if (d < best) {
        best = d;
        at = v;
      }
    }
    return at < 0 ? null : unit([normals[at * 3]!, normals[at * 3 + 1]!, normals[at * 3 + 2]!]);
  }
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec): Vec => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
