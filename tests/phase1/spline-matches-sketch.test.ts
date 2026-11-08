/**
 * A spline's solid is the curve its sketch draws (ADR 0244). The drawn curve is taken from what the sketch package draws itself, through a real solve and its profiles; the solid's from a
 * section of it. Before this, the two were different curves: up to 180 mm apart on a closed spline, and the closed ones tied a knot at the seam in about half of a random set.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, SCHEMA_VERSION, serializePart, splinesRedrawn, type PartDoc } from '@3db/model';
import { readOldPartFile, readPartFile } from '@3db/io';
import { writeZip } from '../../packages/io/src/zip';
import { Kernel, type Frame, type Region, type SectionEdge, type ShapeId } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

type P = [number, number];
const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const RECT = { u0: -300, u1: 300, v0: -300, v1: 300 };
const ring = (radii: number[]): P[] => radii.map((r, i) => [r * Math.cos((2 * Math.PI * i) / radii.length), r * Math.sin((2 * Math.PI * i) / radii.length)]);
const closed = (points: P[]): Region => ({ outer: [{ kind: 'spline', points, closed: true, source: 'c' }], holes: [] });
const open = (top: P[], w: number): Region => ({
  outer: [
    { kind: 'line', a: [0, 0], b: [w, 0], source: 'a' },
    { kind: 'line', a: [w, 0], b: top[0]!, source: 'b' },
    { kind: 'spline', points: top, closed: false, source: 'c' },
    { kind: 'line', a: top[top.length - 1]!, b: [0, 0], source: 'd' },
  ],
  holes: [],
});
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The Catmull-Rom the sketch draws, written out here from its definition, not taken from the code under test. */
function drawn(points: P[], isClosed: boolean, steps = 64): P[] {
  const n = points.length;
  const get = (i: number): P => {
    if (isClosed) return points[((i % n) + n) % n]!;
    if (i < 0) return [2 * points[0]![0] - points[1]![0], 2 * points[0]![1] - points[1]![1]];
    if (i >= n) return [2 * points[n - 1]![0] - points[n - 2]![0], 2 * points[n - 1]![1] - points[n - 2]![1]];
    return points[i]!;
  };
  const out: P[] = [];
  for (let s = 0; s < (isClosed ? n : n - 1); s++) {
    const [a, b, c, d] = [get(s - 1), get(s), get(s + 1), get(s + 2)];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      out.push([0, 1].map((x) => 0.5 * (2 * b[x]! + (c[x]! - a[x]!) * t + (2 * a[x]! - 5 * b[x]! + 4 * c[x]! - d[x]!) * t * t + (3 * b[x]! - a[x]! - 3 * c[x]! + d[x]!) * t * t * t)) as P);
    }
  }
  return out;
}
function bezierPoint(span: readonly (readonly number[])[], t: number): P {
  const q = span.map((p) => [p[0]!, p[1]!, p[3]!]);
  for (let n = q.length - 1; n > 0; n--) for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) q[i]![k] = q[i]![k]! * (1 - t) + q[i + 1]![k]! * t;
  return [q[0]![0]! / q[0]![2]!, q[0]![1]! / q[0]![2]!];
}
/** The Catmull-Rom segment `s` at `t`, from its definition. */
function segmentAt(points: P[], isClosed: boolean, s: number, t: number): P {
  const n = points.length;
  const get = (i: number): P => {
    if (isClosed) return points[((i % n) + n) % n]!;
    if (i < 0) return [2 * points[0]![0] - points[1]![0], 2 * points[0]![1] - points[1]![1]];
    if (i >= n) return [2 * points[n - 1]![0] - points[n - 2]![0], 2 * points[n - 1]![1] - points[n - 2]![1]];
    return points[i]!;
  };
  const [a, b, c, d] = [get(s - 1), get(s), get(s + 1), get(s + 2)];
  return [0, 1].map((x) => 0.5 * (2 * b[x]! + (c[x]! - a[x]!) * t + (2 * a[x]! - 5 * b[x]! + 4 * c[x]! - d[x]!) * t * t + (3 * b[x]! - a[x]! - 3 * c[x]! + d[x]!) * t * t * t)) as P;
}
/** The nearest a point comes to a curve given piece by piece: a coarse walk, then narrowing round the best, so the answer has no chords in it. */
function nearest(p: P, pieces: number, at: (piece: number, t: number) => P): number {
  const off = (i: number, t: number) => { const q = at(i, t); return Math.hypot(q[0] - p[0], q[1] - p[1]); };
  // every piece narrowed round its own best, because the nearest point may lie just past the end of the piece holding the nearest sample
  let best = Infinity;
  for (let i = 0; i < pieces; i++) {
    let [bt, here] = [0, Infinity];
    for (let k = 0; k <= 24; k++) if (off(i, k / 24) < here) [bt, here] = [k / 24, off(i, k / 24)];
    if (here > best + 1) continue;
    let [lo, hi] = [Math.max(0, bt - 1 / 24), Math.min(1, bt + 1 / 24)];
    for (let n = 0; n < 60; n++) {
      const [m1, m2] = [lo + (hi - lo) / 3, hi - (hi - lo) / 3];
      if (off(i, m1) < off(i, m2)) hi = m2;
      else lo = m1;
    }
    best = Math.min(best, here, off(i, (lo + hi) / 2));
  }
  return best;
}
const splineEdges = (s: ShapeId, z: number) => kernel.sectionEdges(s, { ...XY, origin: [0, 0, z] }, RECT).filter((e): e is Extract<SectionEdge, { kind: 'bezier' }> => e.kind === 'bezier');

/** The edge the kernel built, read on the bottom face: same parameter, same point as the formula, to rounding. This is the curve itself. */
function builtOff(s: ShapeId, points: P[], isClosed: boolean): number {
  const spans = splineEdges(s, 0).flatMap((e) => e.spans);
  expect(spans.length).toBe(isClosed ? points.length : points.length - 1);
  let worst = 0;
  spans.forEach((span, i) => {
    for (let k = 0; k <= 16; k++) {
      const [q, r] = [bezierPoint(span, k / 16), segmentAt(points, isClosed, i, k / 16)];
      worst = Math.max(worst, Math.hypot(q[0] - r[0], q[1] - r[1]));
    }
  });
  return worst;
}
/**
 * A section partway up, which is OCCT's own intersection and carries its tolerance: the distance between it and the formula, both ways, with no chords. Measured up to 1.01e-3 mm, where the
 * edge it comes from is right to 1e-9 (`builtOff`): an error of the intersection, not of the curve, so the two are held to different limits (AGENTS 2026-10-19: truth in layers).
 */
function sectionOff(s: ShapeId, z: number, points: P[], isClosed: boolean): number {
  const spans = splineEdges(s, z).flatMap((e) => e.spans);
  expect(spans.length).toBeGreaterThan(0);
  const segments = isClosed ? points.length : points.length - 1;
  const onSection = (p: P) => nearest(p, spans.length, (i, t) => bezierPoint(spans[i]!, t));
  const onFormula = (p: P) => nearest(p, segments, (i, t) => segmentAt(points, isClosed, i, t));
  let worst = 0;
  for (const span of spans) for (let k = 0; k <= 4; k++) worst = Math.max(worst, onFormula(bezierPoint(span, k / 4)));
  for (let i = 0; i < segments; i++) for (let k = 0; k <= 4; k++) worst = Math.max(worst, onSection(segmentAt(points, isClosed, i, k / 4)));
  return worst;
}
const shoelace = (pl: P[]) => Math.abs(pl.reduce((s, p, i) => s + p[0] * pl[(i + 1) % pl.length]![1] - pl[(i + 1) % pl.length]![0] * p[1], 0)) / 2;

describe('the solid is the drawn curve', () => {
  it('a closed spline that used to tie a knot at its seam', () => {
    const pts = ring([28, 12, 25, 9, 30, 14, 22, 8, 27, 16, 19, 11]);
    const s = kernel.extrude(XY, [closed(pts)], [0, 0, 20]).shape;
    expect(kernel.check(s).valid).toBe(true);
    expect(builtOff(s, pts, true)).toBeLessThan(1e-9);
    expect(sectionOff(s, 10, pts, true)).toBeLessThan(1e-3);
    // the drawn area, against a truth of its own: fine polyline by the shoelace, in a solid measured by the product's integral
    expect(Math.abs(kernel.massProps(s).volume - shoelace(drawn(pts, true, 400)) * 20) / kernel.massProps(s).volume).toBeLessThan(1e-4);
  });

  it('it passes through every point the user placed', () => {
    const pts = ring([28, 22, 25, 21, 30, 24, 22, 26, 27, 23, 26, 25]);
    const s = kernel.extrude(XY, [closed(pts)], [0, 0, 20]).shape;
    const spans = splineEdges(s, 0).flatMap((e) => e.spans);
    for (const p of pts) expect(nearest(p, spans.length, (i, t) => bezierPoint(spans[i]!, t))).toBeLessThan(1e-9);
  });

  it('smooth at the seam: the tangent leaving the first point is the tangent coming back to it', () => {
    const pts = ring([28, 12, 25, 9, 30, 14, 22, 8]);
    const s = kernel.extrude(XY, [closed(pts)], [0, 0, 20]).shape;
    const spans = splineEdges(s, 0).flatMap((e) => e.spans);
    const dir = (a: readonly number[], b: readonly number[]) => Math.atan2(b[1]! / b[3]! - a[1]! / a[3]!, b[0]! / b[3]! - a[0]! / a[3]!);
    const leaving = dir(spans[0]![0]!, spans[0]![1]!);
    const last = spans[spans.length - 1]!;
    const coming = dir(last[last.length - 2]!, last[last.length - 1]!);
    expect(Math.abs(Math.sin(leaving - coming))).toBeLessThan(1e-9);
  });

  it('an open spline, mirrored past its ends as the sketch does', () => {
    const pts: P[] = [[40, 25], [30, 40], [20, 12], [10, 44], [0, 25]];
    const s = kernel.extrude(XY, [open(pts, 40)], [0, 0, 20]).shape;
    expect(kernel.check(s).valid).toBe(true);
    expect(builtOff(s, pts, false)).toBeLessThan(1e-9);
    expect(sectionOff(s, 10, pts, false)).toBeLessThan(1e-3);
  });

  it('a spline of two points is the line between them', () => {
    const s = kernel.extrude(XY, [{ outer: [{ kind: 'line', a: [0, 0], b: [10, 0], source: 'a' }, { kind: 'spline', points: [[10, 0], [0, 10]], closed: false, source: 'b' }, { kind: 'line', a: [0, 10], b: [0, 0], source: 'c' }], holes: [] }], [0, 0, 5]).shape;
    expect(kernel.massProps(s).volume).toBeCloseTo(250, 6);
  });

  it('a spline with a hole in it, the hole also a spline', () => {
    const [outer, inner] = [ring([30, 28, 31, 27, 30, 29]), ring([10, 9, 11, 8, 10, 12])];
    const s = kernel.extrude(XY, [{ outer: closed(outer).outer, holes: [closed(inner).outer] }], [0, 0, 10]).shape;
    expect(kernel.check(s).valid).toBe(true);
    const truth = (shoelace(drawn(outer, true, 400)) - shoelace(drawn(inner, true, 400))) * 10;
    expect(Math.abs(kernel.massProps(s).volume - truth) / truth).toBeLessThan(1e-4);
  });
});

describe('what comes after it', () => {
  it('one face, one edge per curve, as before: what refers to the face still finds it', () => {
    const s = kernel.extrude(XY, [closed(ring([28, 12, 25, 9, 30, 14]))], [0, 0, 20]).shape;
    const topo = kernel.topology(s);
    expect(topo.faces.length).toBe(3);
    expect(topo.faces.filter((f) => f.surface === 'surfaceofextrusion').length).toBe(1);
  });

  it('through STEP: the same solid', () => {
    const s = kernel.extrude(XY, [closed(ring([28, 12, 25, 9, 30, 14, 22, 8]))], [0, 0, 20]).shape;
    const back = kernel.importStep(new TextEncoder().encode(kernel.exportStep(s, 'p'))).shape;
    expect(kernel.check(back).valid).toBe(true);
    expect(Math.abs(kernel.massProps(back).volume - kernel.massProps(s).volume) / kernel.massProps(s).volume).toBeLessThan(1e-6);
  });

  it('a shell of it holds, which the fitted curve never did on this set', () => {
    const r = rng(9001);
    const pts = ring(Array.from({ length: 9 }, () => 15 + r() * 15));
    const s = kernel.extrude(XY, [closed(pts)], [0, 0, 20]).shape;
    const top = kernel.topology(s).faces.findIndex((f) => f.surface === 'plane' && Math.abs(f.center[2] - 20) < 1e-6);
    const shelled = kernel.shell(s, [top], 1, false).shape;
    expect(kernel.check(shelled).valid).toBe(true);
    expect(kernel.massProps(shelled).volume).toBeLessThan(kernel.massProps(s).volume);
  });
});

describe('what it refuses', () => {
  const closedOf = (points: P[]) => () => kernel.extrude(XY, [closed(points)], [0, 0, 5]);
  it('a point that is no number', () => {
    expect(closedOf([[0, 0], [10, NaN], [0, 10]])).toThrow();
    expect(closedOf([[0, 0], [10, Infinity], [0, 10]])).toThrow();
  });
  it('a closed spline of two points, which encloses nothing', () => {
    expect(closedOf([[0, 0], [10, 0]])).toThrow();
  });
  it('two points in the same place', () => {
    expect(closedOf([[0, 0], [10, 0], [10, 0], [0, 10]])).toThrow();
  });
});

it('200 random stars: every one is a valid solid on the drawn curve (the fitted curve failed about half of them)', () => {
  let drawnProperly = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed);
    const pts = ring(Array.from({ length: 5 + Math.floor(r() * 12) }, () => 8 + r() * 22));
    const s = kernel.extrude(XY, [closed(pts)], [0, 0, 5 + r() * 20]).shape;
    expect(kernel.check(s).valid, `seed ${seed}`).toBe(true);
    expect(builtOff(s, pts, true), `seed ${seed}`).toBeLessThan(1e-9);
    if (seed % 10 === 0) expect(sectionOff(s, 3, pts, true), `seed ${seed}`).toBeLessThan(2e-3);
    drawnProperly++;
    kernel.release(s);
  }
  expect(drawnProperly).toBe(200);
}, 280_000);

describe('a file saved before this says so when it opens', () => {
  const versionBeforeSplineRedraw = 91;
  const sketch = (entities: unknown[], name = '草圖1') => ({ id: 'sketch1', type: 'sketch', name, suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities, constraints: [] });
  const old = (features: unknown[], version: number) => JSON.stringify({ ...JSON.parse(serializePart(createEmptyPart())), schemaVersion: version, features });
  const point = (id: string) => ({ id, type: 'point', x: 0, y: 0 });

  it('an older file with a spline: named, and the document comes up to date', () => {
    const text = old([sketch([point('p1'), point('p2'), { id: 's1', type: 'spline', points: ['p1', 'p2'] }])], versionBeforeSplineRedraw);
    expect(splinesRedrawn(text)).toEqual(['草圖1']);
    const file = readOldPartFile(new TextEncoder().encode(text));
    expect(file.warnings.join()).toContain('草圖1');
    expect(file.warnings.join()).toContain('樣條');
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('the same through a .3dbx archive', async () => {
    const text = old([sketch([{ id: 's1', type: 'spline', points: [] }], '外形')], versionBeforeSplineRedraw);
    const file = await readPartFile(await writeZip([{ name: 'document.json', data: new TextEncoder().encode(text) }]));
    expect(file.warnings.join()).toContain('外形');
  });

  it('nothing said when nothing changes: a file of this version, no spline, a Bézier, a construction line', () => {
    const spline = { id: 's1', type: 'spline', points: [] };
    expect(splinesRedrawn(old([sketch([spline])], SCHEMA_VERSION))).toEqual([]);
    expect(splinesRedrawn(old([sketch([spline])], 92))).toEqual([]);
    expect(splinesRedrawn(old([sketch([point('p1')])], versionBeforeSplineRedraw))).toEqual([]);
    expect(splinesRedrawn(old([sketch([{ ...spline, bezier: true }])], versionBeforeSplineRedraw))).toEqual([]);
    expect(splinesRedrawn(old([sketch([{ ...spline, construction: true }])], versionBeforeSplineRedraw))).toEqual([]);
    const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature: sketch([point('p1')]) as never });
    expect(readOldPartFile(new TextEncoder().encode(serializePart(doc))).warnings).toEqual([]);
  });
});
