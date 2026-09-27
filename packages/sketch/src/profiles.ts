import { SKETCH_ORIGIN, type Id, type SketchFeature } from '@3db/model';
import type { Loop2, P2, ProfileResult, Region2, Segment2, SolvedSketch } from './types';

const TOL = 1e-6;

/** Union-find over point ids: coincident relations and geometric coincidence join nodes. */
class Nodes {
  private parent = new Map<Id, Id>();
  find(id: Id): Id {
    let p = this.parent.get(id) ?? id;
    if (p !== id) {
      p = this.find(p);
      this.parent.set(id, p);
    }
    return p;
  }
  union(a: Id, b: Id): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

interface Edge {
  source: Id;
  from: Id;
  to: Id;
  make(forward: boolean): Segment2;
}

const polar = (c: P2, r: number, a: number): P2 => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];

/** Polygonal approximation used only for area and containment tests. */
function sample(loop: Loop2): P2[] {
  const pts: P2[] = [];
  for (const s of loop) {
    if (s.kind === 'line') {
      pts.push(s.a);
    } else if (s.kind === 'circle') {
      for (let i = 0; i < 64; i++) pts.push(polar(s.c, s.r, (2 * Math.PI * i) / 64));
    } else {
      const a0 = Math.atan2(s.from[1] - s.c[1], s.from[0] - s.c[0]);
      let a1 = Math.atan2(s.to[1] - s.c[1], s.to[0] - s.c[0]);
      if (s.ccw && a1 <= a0) a1 += 2 * Math.PI;
      if (!s.ccw && a1 >= a0) a1 -= 2 * Math.PI;
      for (let i = 0; i < 16; i++) pts.push(polar(s.c, s.r, a0 + ((a1 - a0) * i) / 16));
    }
  }
  return pts;
}

function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function contains(poly: P2[], p: P2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function reverse(loop: Loop2): Loop2 {
  return loop
    .slice()
    .reverse()
    .map((s): Segment2 => {
      if (s.kind === 'line') return { ...s, a: s.b, b: s.a };
      if (s.kind === 'arc') return { ...s, from: s.to, to: s.from, ccw: !s.ccw };
      return s;
    });
}

/**
 * Closed-profile detection (C1.33): walks non-construction curves into loops and nests them
 * into regions (outer CCW, holes CW). Branches and open ends are reported, not guessed.
 */
export function findProfiles(sketch: SketchFeature, solved: SolvedSketch): ProfileResult {
  const nodes = new Nodes();
  const pointPos = new Map<Id, P2>([[SKETCH_ORIGIN, [0, 0]]]);
  for (const [id, g] of solved.geometry) if (g.type === 'point') pointPos.set(id, g.p);
  for (const c of sketch.constraints) if (c.type === 'coincident') nodes.union(c.a, c.b);
  const ids = [...pointPos.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = pointPos.get(ids[i]!)!;
      const b = pointPos.get(ids[j]!)!;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < TOL) nodes.union(ids[i]!, ids[j]!);
    }
  }

  const loops: Loop2[] = [];
  const edges: Edge[] = [];
  for (const e of sketch.entities) {
    const g = solved.geometry.get(e.id);
    if (!g || g.type === 'point' || g.construction) continue;
    if (g.type === 'circle') {
      loops.push([{ kind: 'circle', c: g.c, r: g.r, source: e.id }]);
    } else if (g.type === 'line') {
      if (Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) < TOL) continue;
      edges.push({
        source: e.id,
        from: nodes.find(g.p1),
        to: nodes.find(g.p2),
        make: (fwd) => ({ kind: 'line', a: fwd ? g.a : g.b, b: fwd ? g.b : g.a, source: e.id }),
      });
    } else {
      const s = polar(g.c, g.r, g.a0);
      const t = polar(g.c, g.r, g.a1);
      edges.push({
        source: e.id,
        from: nodes.find(g.start),
        to: nodes.find(g.end),
        make: (fwd) => ({ kind: 'arc', c: g.c, r: g.r, from: fwd ? s : t, to: fwd ? t : s, ccw: fwd, source: e.id }),
      });
    }
  }

  const problems: string[] = [];
  const incident = new Map<Id, Edge[]>();
  for (const e of edges) {
    for (const n of [e.from, e.to]) incident.set(n, [...(incident.get(n) ?? []), e]);
  }
  for (const [n, list] of incident) {
    if (list.length === 1) problems.push(`開放端點（圖元 ${list[0]!.source}）`);
    else if (list.length > 2) problems.push(`分支點：${list.map((e) => e.source).join('、')} 交會於同一點（節點 ${n}）`);
  }
  if (problems.length > 0) return { regions: [], problems };

  const used = new Set<Edge>();
  for (const start of edges) {
    if (used.has(start)) continue;
    const loop: Loop2 = [];
    let edge = start;
    let node = start.from;
    for (;;) {
      used.add(edge);
      const fwd = edge.from === node;
      loop.push(edge.make(fwd));
      node = fwd ? edge.to : edge.from;
      const next = incident.get(node)!.find((e) => !used.has(e));
      if (!next) break;
      edge = next;
    }
    loops.push(loop);
  }

  // Nesting: sort by |area|; each loop's parent is the smallest larger loop containing it.
  const info = loops.map((loop) => {
    const poly = sample(loop);
    return { loop, poly, area: Math.abs(signedArea(poly)), ccw: signedArea(poly) > 0, probe: poly[0]! };
  });
  info.sort((a, b) => b.area - a.area);
  const depth: number[] = [];
  const parent: number[] = [];
  info.forEach((li, i) => {
    let p = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (contains(info[j]!.poly, li.probe) && (p === -1 || info[j]!.area < info[p]!.area)) p = j;
    }
    parent.push(p);
    depth.push(p === -1 ? 0 : depth[p]! + 1);
  });
  const regions: Region2[] = [];
  const regionOf = new Map<number, Region2>();
  info.forEach((li, i) => {
    if (depth[i]! % 2 === 0) {
      const r: Region2 = { outer: li.ccw ? li.loop : reverse(li.loop), holes: [] };
      regionOf.set(i, r);
      regions.push(r);
    } else {
      regionOf.get(parent[i]!)!.holes.push(li.ccw ? reverse(li.loop) : li.loop);
    }
  });
  return { regions, problems: [] };
}
