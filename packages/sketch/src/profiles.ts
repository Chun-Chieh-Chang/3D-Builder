import { t } from '@3db/i18n';
import { SKETCH_ORIGIN, type Id, type SketchFeature } from '@3db/model';
import { textContours } from './font';
import type { Loop2, P2, ProfileResult, Region2, Segment2, SolvedSketch } from './types';

export const TOL = 1e-6;

/** Union-find over point ids: coincident relations and geometric coincidence join nodes. */
export class Nodes {
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

function sampleSpline(points: P2[], closed: boolean): P2[] {
  if (points.length < 2) return points;
  const n = points.length;
  const getP = (i: number): P2 => {
    if (closed) return points[((i % n) + n) % n]!;
    if (i < 0) {
      const p0 = points[0]!;
      const p1 = points[1]!;
      return [2 * p0[0] - p1[0], 2 * p0[1] - p1[1]];
    }
    if (i >= n) {
      const pn1 = points[n - 1]!;
      const pn2 = points[n - 2]!;
      return [2 * pn1[0] - pn2[0], 2 * pn1[1] - pn2[1]];
    }
    return points[i]!;
  };

  const out: P2[] = [];
  const segments = closed ? n : n - 1;
  const stepsPerSeg = 16;
  for (let s = 0; s < segments; s++) {
    const p0 = getP(s - 1);
    const p1 = getP(s);
    const p2 = getP(s + 1);
    const p3 = getP(s + 2);
    for (let i = 0; i < stepsPerSeg; i++) {
      const t = i / stepsPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        2 * p1[0] +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
      );
      const y = 0.5 * (
        2 * p1[1] +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
      );
      out.push([x, y]);
    }
  }
  if (!closed) out.push(points[n - 1]!);
  return out;
}

/** Polygonal approximation used only for area and containment tests. */
function sample(loop: Loop2): P2[] {
  const pts: P2[] = [];
  for (const s of loop) {
    if (s.kind === 'line') {
      pts.push(s.a);
    } else if (s.kind === 'circle') {
      for (let i = 0; i < 64; i++) pts.push(polar(s.c, s.r, (2 * Math.PI * i) / 64));
    } else if (s.kind === 'ellipse') {
      const cosA = Math.cos(s.angle);
      const sinA = Math.sin(s.angle);
      for (let i = 0; i < 64; i++) {
        const theta = (2 * Math.PI * i) / 64;
        const u = s.rx * Math.cos(theta);
        const v = s.ry * Math.sin(theta);
        pts.push([s.c[0] + u * cosA - v * sinA, s.c[1] + u * sinA + v * cosA]);
      }
    } else if (s.kind === 'spline') {
      const sampled = sampleSpline(s.points, s.closed);
      for (const p of sampled) pts.push(p);
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

/** The area a loop encloses, positive when it is walked counter-clockwise. */
export function signedAreaOf(loop: Loop2): number {
  if (loop.length === 1 && loop[0]!.kind === 'circle') return Math.PI * loop[0]!.r * loop[0]!.r;
  if (loop.length === 1 && loop[0]!.kind === 'ellipse') return Math.PI * loop[0]!.rx * loop[0]!.ry;
  return signedArea(sample(loop));
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
      if (s.kind === 'spline') return { ...s, points: [...s.points].reverse() };
      return s;
    });
}

// ---------------------------------------------------------------- contour selection (C1.34)

/** The entities that bound a region from outside: how a selected contour is remembered (ids stay when geometry changes). */
export function contourIds(region: Region2): Id[] {
  return [...new Set(region.outer.map((s) => s.source))].sort();
}

/** One region of a sketch as the contour list shows it. */
export interface ContourChoice {
  ids: Id[];
  /** Area inside the outer boundary and outside the holes, mm². */
  area: number;
  center: P2;
  holes: number;
}

export function contourChoices(regions: Region2[]): ContourChoice[] {
  /** Area of a closed loop: a circle exactly, anything else from its outline as a polygon. */
  const areaOf = (loop: Loop2): number => {
    const only = loop.length === 1 ? loop[0] : undefined;
    if (only?.kind === 'circle') return Math.PI * only.r * only.r;
    if (only?.kind === 'ellipse') return Math.PI * only.rx * only.ry;
    return Math.abs(signedArea(sample(loop)));
  };
  return regions.map((r) => {
    const outer = sample(r.outer);
    const area = areaOf(r.outer) - r.holes.reduce((a, h) => a + areaOf(h), 0);
    const xs = outer.map((p) => p[0]);
    const ys = outer.map((p) => p[1]);
    return { ids: contourIds(r), area, center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], holes: r.holes.length };
  });
}

/**
 * The regions a feature uses: each remembered contour picks the region whose boundary shares most entities with it (at least half of
 * them, so a fillet that adds an arc to a selected rectangle does not lose it). A contour with no such region is `missing`.
 */
export function selectContours(regions: Region2[], wanted: readonly (readonly Id[])[]): { regions: Region2[]; missing: number } {
  const chosen = new Set<Region2>();
  let missing = 0;
  for (const ids of wanted) {
    let best: { region: Region2; score: number } | null = null;
    for (const region of regions) {
      const have = new Set(contourIds(region));
      const shared = ids.filter((id) => have.has(id)).length;
      const score = shared / (new Set([...ids, ...have]).size || 1);
      if (shared > 0 && score >= 0.5 && (!best || score > best.score)) best = { region, score };
    }
    if (best) chosen.add(best.region);
    else missing++;
  }
  return { regions: regions.filter((r) => chosen.has(r)), missing };
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
    } else if (g.type === 'ellipse') {
      loops.push([{ kind: 'ellipse', c: g.c, rx: g.majorRadius, ry: g.minorRadius, angle: g.angle, source: e.id }]);
    } else if (g.type === 'spline') {
      if (g.closed) {
        loops.push([{ kind: 'spline', points: g.points, closed: true, source: e.id }]);
      } else if (g.points.length >= 2 && g.pointIds.length >= 2) {
        edges.push({
          source: e.id,
          from: nodes.find(g.pointIds[0]!),
          to: nodes.find(g.pointIds[g.pointIds.length - 1]!),
          make: (fwd) => ({
            kind: 'spline',
            points: fwd ? g.points : [...g.points].reverse(),
            closed: false,
            source: e.id,
          }),
        });
      }
    } else if (g.type === 'line') {
      if (Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) < TOL) continue;
      edges.push({
        source: e.id,
        from: nodes.find(g.p1),
        to: nodes.find(g.p2),
        make: (fwd) => ({ kind: 'line', a: fwd ? g.a : g.b, b: fwd ? g.b : g.a, source: e.id }),
      });
    } else if (g.type === 'text') {
      const textLoops = textContours(g.text, {
        size: g.size,
        at: g.at,
        angle: g.angle,
        align: g.align,
        bold: g.bold,
        italic: g.italic,
        source: e.id,
      });
      for (const loop of textLoops) loops.push(loop);
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
    if (list.length === 1) problems.push(t('profile.openEnd', { source: list[0]!.source }));
    else if (list.length > 2) problems.push(t('profile.branch', { sources: list.map((e) => e.source).join(t('cmd.listSeparator')), n }));
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
