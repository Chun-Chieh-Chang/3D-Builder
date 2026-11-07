/**
 * A spline outline made of biarcs, on the user's request (ADR 0243). Every part goes through a real STEP file. What is claimed is checked here without the comparison the product uses:
 * the original's section is read off its own Bézier spans and the rebuilt section off its own arcs, and the distance between them is worked out by the circle's formula.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region, type SectionEdge, type ShapeId } from '@3db/kernel';
import { frameFor, recognize, reconstructImported, RecognizeError, Regenerator, SPLINE_TOLERANCE } from '@3db/regen';
import { approximateReport } from '../../packages/regen/src/recognize/reconstruct';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
type P = [number, number];
const open = (top: P[]): Region => ({
  outer: [
    { kind: 'line', a: [0, 0], b: [28.72, 0], source: 'a' },
    { kind: 'line', a: [28.72, 0], b: top[0]!, source: 'b' },
    { kind: 'spline', points: top, source: 'c' },
    { kind: 'line', a: top[top.length - 1]!, b: [0, 0], source: 'd' },
  ],
  holes: [],
} as Region);
const GENTLE: P[] = [[28.72, 25], [14, 32], [0, 25]];
const S: P[] = [[28.72, 25], [21, 34], [14, 26], [7, 19], [0, 25]];
const ring = (n: number, r: (a: number) => number): Region => ({ outer: [{ kind: 'spline', closed: true, points: Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n; return [r(a) * Math.cos(a), r(a) * Math.sin(a)]; }), source: 'c' }], holes: [] } as Region);
const hole = (c: P, r: number, z0: number, h: number) => kernel.extrude({ ...XY, origin: [0, 0, z0] }, [{ outer: [{ kind: 'circle', c, r, source: 'h' }], holes: [] }], [0, 0, h]).shape;

async function recognizeIt(s: ShapeId, approximate: boolean | undefined) {
  const bytes = new TextEncoder().encode(kernel.exportStep(s, 'p'));
  const sha = await sha256Hex(bytes);
  const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    const out = reconstructImported(kernel, regen, doc, 'imp1', solver, undefined, approximate === undefined ? undefined : { approximateSplines: approximate });
    return { ...out, regen, before: doc };
  } catch (e) {
    regen.dispose();
    throw e;
  }
}

const RECT = { u0: -200, u1: 200, v0: -200, v1: 200 };
function bezierPoint(span: readonly (readonly number[])[], t: number): P {
  const q = span.map((p) => [p[0]!, p[1]!, p[3]!]);
  for (let n = q.length - 1; n > 0; n--) for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) q[i]![k] = q[i]![k]! * (1 - t) + q[i + 1]![k]! * t;
  return [q[0]![0]! / q[0]![2]!, q[0]![1]! / q[0]![2]!];
}
/** How far a point is from an arc of a circle: to the circle when its angle is within the arc, else to the nearer end. */
function toArc(p: P, e: Extract<SectionEdge, { kind: 'arc' }>): number {
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ang = (q: readonly number[]) => Math.atan2(q[1]! - e.c[1], q[0]! - e.c[0]);
  const ccw = norm(ang(e.mid) - ang(e.a)) < norm(ang(e.b) - ang(e.a));
  const inside = ccw ? norm(ang(p) - ang(e.a)) <= norm(ang(e.b) - ang(e.a)) : norm(ang(e.a) - ang(p)) <= norm(ang(e.a) - ang(e.b));
  if (inside) return Math.abs(Math.hypot(p[0] - e.c[0], p[1] - e.c[1]) - e.r);
  return Math.min(Math.hypot(p[0] - e.a[0], p[1] - e.a[1]), Math.hypot(p[0] - e.b[0], p[1] - e.b[1]));
}
/** The largest distance from the original spline to the rebuilt arcs, by formula. */
function splineToArcs(original: ShapeId, rebuilt: ShapeId, z: number): { farthest: number; arcs: number; splines: number } {
  const frame = { ...XY, origin: [0, 0, z] as [number, number, number] };
  const before = kernel.sectionEdges(original, frame, RECT).filter((e): e is Extract<SectionEdge, { kind: 'bezier' }> => e.kind === 'bezier');
  const after = kernel.sectionEdges(rebuilt, frame, RECT);
  const arcs = after.filter((e): e is Extract<SectionEdge, { kind: 'arc' }> => e.kind === 'arc');
  let farthest = 0;
  for (const e of before) {
    for (const span of e.spans) {
      for (let i = 0; i <= 40; i++) {
        const p = bezierPoint(span, i / 40);
        farthest = Math.max(farthest, Math.min(...arcs.map((a) => toArc(p, a))));
      }
    }
  }
  return { farthest, arcs: arcs.length, splines: before.length };
}

describe('asked for', () => {
  it('off unless asked: refused as it always was, the option named, nothing changed', async () => {
    const s = kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape;
    for (const option of [undefined, false]) {
      const e = await recognizeIt(s, option).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RecognizeError);
      expect((e as Error).message).toContain('自由曲面');
      expect((e as Error).message).toContain('樣條輪廓用雙圓弧近似');
    }
  });

  it('a part with no spline: the exact check, no word of approximation, though the option is on', async () => {
    const plate: P[] = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const s = kernel.extrude(XY, [{ outer: plate.map((a, i) => ({ kind: 'line', a, b: plate[(i + 1) % 4]!, source: `e${i}` })), holes: [] }], [0, 0, 10]).shape;
    const { report } = await recognizeIt(s, true);
    expect(report.approximation).toBeUndefined();
    expect(report.volumeError).toBeLessThan(1e-9);
  });
});

describe('what comes of it', () => {
  it('a gentle open spline: arcs and lines only, each kept within the bound said, by a formula of its own', async () => {
    const s = kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape;
    const { doc, report, regen } = await recognizeIt(s, true);
    const a = report.approximation!;
    expect(a).toBeDefined();
    expect(a.sections).toBe(3);
    // the bound was proved, it is what it says, and it is not the tolerance copied
    expect(a.bound).toBeGreaterThan(0);
    expect(a.bound).toBeLessThan(SPLINE_TOLERANCE);
    expect(a.distance).toBeGreaterThan(0);
    expect(a.distance).toBeLessThanOrEqual(a.bound);
    // really approximate: claiming it the same would be false
    expect(report.volumeError).toBeGreaterThan(1e-7);

    const sketch = doc.features.find((f) => f.type === 'sketch');
    expect(sketch && sketch.type === 'sketch' && sketch.entities.filter((e) => e.type === 'arc').length).toBeGreaterThan(4);
    expect(sketch && sketch.type === 'sketch' && sketch.entities.some((e) => (e.type as string) === 'spline')).toBe(false);
    expect(doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude']);

    const res = regen.rebuild(doc);
    expect(res.features.every((f) => f.status === 'ok')).toBe(true);
    const walk = splineToArcs(s, res.body!.shape, 10);
    expect(walk.splines).toBeGreaterThan(0);
    expect(walk.arcs).toBeGreaterThan(4);
    expect(walk.farthest).toBeLessThanOrEqual(a.bound);
    expect(walk.farthest).toBeLessThan(SPLINE_TOLERANCE);
    // the volume, by the promise: no more than the bound over the wall of the spline, whichever side
    const [v0, v1] = [kernel.massProps(s).volume, kernel.massProps(res.body!.shape).volume];
    expect(Math.abs(v1 - v0)).toBeLessThanOrEqual(a.bound * 40 * 20);
    regen.dispose();
  });

  it('every sketch fully defined, as a recognized sketch is', async () => {
    const s = kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape;
    const { doc, regen } = await recognizeIt(s, true);
    expect(regen.rebuild(doc).features.filter((f) => f.sketch && f.sketch.dof !== 0).map((f) => f.id)).toEqual([]);
    regen.dispose();
  });

  it('an S curve, with a change of curvature within it', async () => {
    const s = kernel.extrude(XY, [open(S)], [0, 0, 20]).shape;
    const { doc, report, regen } = await recognizeIt(s, true);
    const walk = splineToArcs(s, regen.rebuild(doc).body!.shape, 7.3);
    expect(walk.farthest).toBeLessThanOrEqual(report.approximation!.bound);
    regen.dispose();
  });

  it('a closed spline', async () => {
    const s = kernel.extrude(XY, [ring(6, (a) => 25 + 2 * Math.cos(2 * a))], [0, 0, 20]).shape;
    expect(kernel.check(s).valid).toBe(true);
    const { doc, report, regen } = await recognizeIt(s, true);
    const walk = splineToArcs(s, regen.rebuild(doc).body!.shape, 3);
    expect(walk.splines).toBeGreaterThan(0);
    expect(walk.farthest).toBeLessThanOrEqual(report.approximation!.bound);
    regen.dispose();
  });

  it('with a hole: the hole is still a hole feature, its circle exact', async () => {
    const s = kernel.boolean('cut', kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape, hole([14, 10], 4, -1, 22)).shape;
    const { doc, report, regen } = await recognizeIt(s, true);
    expect(doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'sketch', 'hole']);
    expect(report.approximation!.distance).toBeLessThanOrEqual(report.approximation!.bound);
    regen.dispose();
  });

  it('a rebuilt part saved and rebuilt again is the same part', async () => {
    const s = kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape;
    const { doc, regen } = await recognizeIt(s, true);
    const [a, b] = [kernel.massProps(regen.rebuild(doc).body!.shape).volume, kernel.massProps(regen.rebuild(JSON.parse(JSON.stringify(doc)) as PartDoc).body!.shape).volume];
    expect(b).toBeCloseTo(a, 9);
    regen.dispose();
  });
});

describe('what it does not take', () => {
  const refusal = async (s: ShapeId) => {
    const e = await recognizeIt(s, true).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RecognizeError);
    return (e as Error).message;
  };

  it('a face curved along every direction is no wall: refused, and the option not offered again', async () => {
    const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
    const profile = { outer: [{ kind: 'line', a: [0, 0], b: [20, 0], source: 'a' }, { kind: 'spline', points: [[20, 0], [24, 10], [15, 20], [0, 22]], source: 'b' }, { kind: 'line', a: [0, 22], b: [0, 0], source: 'c' }], holes: [] } as Region;
    const m = await refusal(kernel.revolve(XZ, [profile], { origin: [0, 0, 0], dir: [0, 0, 1] }, 2 * Math.PI).shape);
    expect(m).toContain('自由曲面');
    expect(m).not.toContain('樣條輪廓用雙圓弧近似');
  });

  it('a round along the spline: its surface is no wall, refused', async () => {
    const s = kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape;
    const topo = kernel.topology(s);
    const top = topo.edges.findIndex((e) => e.curve !== 'line' && Math.abs(e.mid[2] - 20) < 1e-6);
    expect(top).toBeGreaterThanOrEqual(0);
    await refusal(kernel.fillet(s, [top], 1).shape);
  });

  it('too many arcs for one sketch: refused, and the count said', async () => {
    const m = await refusal(kernel.extrude(XY, [ring(24, (a) => 25 + 3 * Math.cos(3 * a))], [0, 0, 20]).shape);
    expect(m).toMatch(/\d+ 段圓弧/);
  });

  it('a solid the kernel itself calls invalid (a bow tie, drawn crossing itself): refused, no crash', async () => {
    const s = kernel.extrude(XY, [{ outer: [{ kind: 'spline', points: [[0, 0], [20, 20], [20, 0], [0, 20]], closed: true, source: 'c' }], holes: [] } as Region], [0, 0, 20]).shape;
    expect(kernel.check(s).valid).toBe(false);
    await refusal(s);
  });
});

describe('Kernel.faceRuledAlong', () => {
  it('an extrusion surface and a B-spline surface are walls along their direction and no other', () => {
    const s = kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape;
    const i = kernel.topology(s).faces.findIndex((f) => f.surface === 'surfaceofextrusion');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(kernel.faceRuledAlong(s, i, [0, 0, 1])).toBe(true);
    expect(kernel.faceRuledAlong(s, i, [0, 0, -1])).toBe(true);
    expect(kernel.faceRuledAlong(s, i, [1, 0, 0])).toBe(false);
    expect(kernel.faceRuledAlong(s, i, [0, Math.sin(0.01), Math.cos(0.01)])).toBe(false);
    const b = kernel.toBSpline(s);
    const topo = kernel.topology(b);
    const j = topo.faces.findIndex((f) => f.surface === 'bsplinesurface' && Math.abs(f.center[2] - 10) < 1e-6 && f.center[1] > 26);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(kernel.faceRuledAlong(b, j, [0, 0, 1])).toBe(true);
    expect(kernel.faceRuledAlong(b, j, [0, 1, 0])).toBe(false);
  });

  it('a sphere is a wall along nothing', () => {
    const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
    const half = { outer: [{ kind: 'arc', c: [0, 0], r: 10, from: [0, -10], to: [0, 10], ccw: true, source: 'a' }, { kind: 'line', a: [0, 10], b: [0, -10], source: 'b' }], holes: [] } as Region;
    const s = kernel.revolve(XZ, [half], { origin: [0, 0, 0], dir: [0, 0, 1] }, 2 * Math.PI).shape;
    const i = kernel.topology(s).faces.findIndex((f) => f.surface === 'sphere');
    for (const d of [[0, 0, 1], [1, 0, 0], [0, 1, 0]] as [number, number, number][]) expect(kernel.faceRuledAlong(s, i, d)).toBe(false);
  });

  it('a face that is not there is said', () => {
    const s = kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape;
    expect(() => kernel.faceRuledAlong(s, 99, [0, 0, 1])).toThrow();
  });
});

it('leaves no shape of its own behind, refused or done', async () => {
  const s = kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape;
  const a = await recognizeIt(s, true);
  a.regen.dispose();
  const before = kernel.liveShapes;
  for (let i = 0; i < 3; i++) {
    const r = await recognizeIt(s, true);
    r.regen.dispose();
    expect(kernel.liveShapes).toBe(before);
    await recognizeIt(s, false).catch(() => undefined);
  }
});

describe('the check catches a result that is not close', () => {
  const report = (other: ShapeId, s: ShapeId) => {
    const approx = { tolerance: SPLINE_TOLERANCE, bound: 0, used: false };
    const rec = recognize(kernel, s, frameFor, undefined, approx);
    expect(approx.used).toBe(true);
    return { run: () => approximateReport(kernel, s, other, rec, approx, { features: { sketch: 0, extrude: 0, revolve: 0, hole: 0, fillet: 0, chamfer: 0, datum: 0 }, faces: [0, 0] }), approx };
  };
  const through = (s: ShapeId) => kernel.importStep(new TextEncoder().encode(kernel.exportStep(s, 'p'))).shape;

  it('the same solid passes', () => {
    const s = through(kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape);
    expect(report(s, s).run().approximation!.distance).toBeLessThan(1e-3);
  });

  it('the outline a tenth of a millimetre off, ten times what was promised: refused', () => {
    const s = through(kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape);
    const off = kernel.extrude(XY, [open(GENTLE.map(([x, y]) => [x, y + 0.1] as P))], [0, 0, 20]).shape;
    expect(report(off, s).run).toThrow(/差太多/);
  });

  it('just past the bound, by 3e-3 (the slack of the check is 1e-3): refused', () => {
    const s = through(kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape);
    const r = report(s, s);
    const off = kernel.extrude(XY, [open(GENTLE.map(([x, y]) => [x, y + r.approx.bound + 3e-3] as P))], [0, 0, 20]).shape;
    expect(report(off, s).run).toThrow(/差太多/);
  });

  it('a wall in a different place, with the same area: the area alone would not have told', () => {
    const s = through(kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape);
    const moved = kernel.extrude({ ...XY, origin: [0.5, 0, 0] }, [open(GENTLE)], [0, 0, 20]).shape;
    expect(report(moved, s).run).toThrow(/差太多/);
  });

  it('no section to compare is no check', () => {
    const s = through(kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape);
    const approx = { tolerance: SPLINE_TOLERANCE, bound: 0.01, used: true };
    const rec = recognize(kernel, s, frameFor, undefined, { ...approx });
    const empty = { ...rec, base: { type: 'extrude', dir: [0, 0, 1], levels: [0], layers: [] } } as typeof rec;
    expect(() => approximateReport(kernel, s, s, empty, approx, { features: { sketch: 0, extrude: 0, revolve: 0, hole: 0, fillet: 0, chamfer: 0, datum: 0 }, faces: [0, 0] })).toThrow(/無法比對/);
  });
});
