/**
 * Phase 7-8 (docs/phase7-plan.md §驗收), the part of the acceptance that needs no sample of the user's: a golden bracket — a plate 120 × 60 × 1.5 (inside radius 2, K 0.5, two Ø5
 * holes) with a flange of 90° 40 high on the x = 120 edge that stops 10 short of each end with its relief, a flange of 135° 25 long on the y = 60 edge, 8 short of one end with its
 * relief, and a hem (gap 1, 7 folded back) on the y = 0 edge. The folded sheet, the flat pattern (its size, area, bend lines), the DXF read back and the manufacturability
 * checks are all against what is worked out by hand here; and the K-factor, the plate and the thickness are changed and everything follows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDxf, flatPatternDxf, readDxf, type DxfCircle, type DxfLine, type DxfText } from '@3db/drawing';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, sheetChecks, type FlatPattern, type RebuildResult } from '@3db/regen';
import { circle, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));

// ---- the bracket

const plateSketch = (length = 120, holeX = 40): Feature => sketch('sk', front, rectangle('r', 0, 0, length, 60), circle('h1', holeX, 20, 2.5), circle('h2', 40, 40, 2.5)) as Feature;
const baseFlange = (extra: Record<string, unknown> = {}): Feature => ({ id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', ...extra }) as Feature;

/** The edges of the plate the flanges are made on, as picked on the plate (with their fingerprints). */
function edges(length = 120): { a: Ref; b: Ref; hem: Ref } {
  const r = rebuild(build([plateSketch(length), baseFlange()]));
  const at = (mid: [number, number, number]): Ref => {
    const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
    expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
    return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
  };
  return { a: at([length, 30, 1.5]), b: at([length / 2, 60, 1.5]), hem: at([length / 2, 0, 1.5]) };
}
function build(features: Feature[]): PartDoc {
  return features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
}
const bracket = (length = 120, base: Record<string, unknown> = {}, holeX = 40): Feature[] => {
  const e = edges(length);
  return [
    plateSketch(length, holeX),
    baseFlange(base),
    { id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: e.a, length: '40', inset: { start: '10', end: '10' }, relief: { width: '1.5', depth: '1.5' } } as Feature,
    { id: 'fb', type: 'edgeFlange', name: 'fb', suppressed: false, edge: e.b, length: '25', angle: '135deg', inset: { start: '8', end: '0' }, relief: { width: '1.5', depth: '1.5' } } as Feature,
    { id: 'hm', type: 'hem', name: 'hm', suppressed: false, edge: e.hem, length: '7', gap: '1' } as Feature,
  ];
};

// ---- by hand

/** Everything the bracket should come to, from the parameters, worked out here (not read from the program). */
function byHand(T = 1.5, r = 2, k = 0.5, length = 120) {
  const Ro = r + T;
  const tan = Math.tan((3 * Math.PI) / 8); // tan 67.5° — the setback of a bend of 135°
  const A = { trim: Ro, straight: 40 - Ro, W: 40, BA: (Math.PI / 2) * (r + k * T), notches: 2 * 1.5 * (Ro + 1.5), angle: Math.PI / 2 };
  const setB = Ro * tan;
  const WB = length - 8;
  const B = { trim: setB, straight: 25 - setB, W: WB, BA: ((3 * Math.PI) / 4) * (r + k * T), notches: 1.5 * (setB + 1.5), angle: (3 * Math.PI) / 4 };
  const rh = 0.5;
  const H = { trim: rh + T, straight: 7, W: length, BA: Math.PI * (rh + k * T), angle: Math.PI };
  const holes = 2 * Math.PI * 2.5 * 2.5;
  const cut = holes + H.trim * H.W + A.trim * A.W + A.notches + B.trim * B.W + B.notches;
  const strips = H.W * (H.BA + H.straight) + A.W * (A.BA + A.straight) + B.W * (B.BA + B.straight);
  const area = length * 60 - cut + strips;
  const bendVolume = (x: { W: number; angle: number }, rr: number) => x.angle * T * x.W * (rr + T / 2);
  const folded = T * (length * 60 - cut) + bendVolume(A, r) + bendVolume(B, r) + bendVolume(H, rh) + T * (A.W * A.straight + B.W * B.straight + H.W * H.straight);
  return {
    A,
    B,
    H,
    area,
    folded,
    xMax: length - A.trim + A.BA + A.straight,
    yMax: 60 - B.trim + B.BA + B.straight,
    yMin: H.trim - H.BA - H.straight,
  };
}

describe('the golden bracket, folded (7-8)', () => {
  let r: RebuildResult;
  const hand = byHand();
  beforeAll(() => {
    r = rebuild(build(bracket()));
  });

  it('① every feature is ok, one valid solid; its volume is the plate less the holes, the cut-backs and the notches, plus three bends and three flat pieces — by hand', () => {
    expect(failures(r)).toEqual([]);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(hand.folded, 3);
    const b = kernel.bounds(r.body!.shape);
    expect([b.min[0], b.max[0], b.min[1], b.max[1], b.min[2], b.max[2]].map((x) => Math.round(x * 1e4) / 1e4 + 0)).toEqual([0, 120, 0, 60, 0, 40]);
    expect(new Set(r.body!.names.faces).size).toBe(r.body!.names.faces.length);
  });

  it('② the sheet data: four bends (the base has none) of 90°, 135° and 180°, the inside radii 2, 2 and 0.5, the allowances θ(r + K·T), the widths 40, 112 and 120', () => {
    const bends = r.sheet!.bends;
    expect(bends.map((x) => [x.feature, +((x.angle * 180) / Math.PI).toFixed(6), x.radius, +x.width.toFixed(6)])).toEqual([['fa', 90, 2, 40], ['fb', 135, 2, 112], ['hm', 180, 0.5, 120]]);
    expect(bends.map((x) => x.allowance)).toEqual([expect.closeTo(hand.A.BA, 9), expect.closeTo(hand.B.BA, 9), expect.closeTo(hand.H.BA, 9)]);
    expect(r.sheet!.flanges.map((f) => f.parent)).toEqual([-1, -1, -1]);
  });
});

describe('the golden bracket, flat (7-8)', () => {
  let pattern: FlatPattern;
  const hand = byHand();
  beforeAll(() => {
    const r = rebuild(build(bracket()));
    pattern = flatPattern(kernel, r.sheet!);
    kernel.release(pattern.shape);
  });

  it('① the size: from the end of the hem to the end of the 90° flange, from the end of the hem to the end of the 135° one — and the area and the volume are the folded sheet\'s', () => {
    expect(pattern.width).toBeCloseTo(hand.xMax, 4);
    expect(pattern.height).toBeCloseTo(hand.yMax - hand.yMin, 4);
    expect(pattern.area).toBeCloseTo(hand.area, 3);
    expect(pattern.volume).toBeCloseTo(hand.folded, 3); // K 0.5: the volume of a sheet is conserved
    expect(pattern.volume).toBeCloseTo(pattern.area * 1.5, 6);
  });

  it('② the bend lines: the hem\'s at y = trim − BA/2 across the whole width, the 90° one at x = 120 − 3.5 + BA/2 from y 10 to 50, the 135° one at y = 60 − setback + BA/2 from x 0 to 112 — all bending up', () => {
    expect(pattern.bends).toHaveLength(3);
    const byFeature = new Map(pattern.bends.map((b) => [b.feature, b]));
    const a = byFeature.get('fa')!;
    const b = byFeature.get('fb')!;
    const h = byFeature.get('hm')!;
    expect(a.a[0]).toBeCloseTo(120 - hand.A.trim + hand.A.BA / 2, 4);
    expect([Math.min(a.a[1], a.b[1]), Math.max(a.a[1], a.b[1])]).toEqual([expect.closeTo(10, 4), expect.closeTo(50, 4)]);
    expect(b.a[1]).toBeCloseTo(60 - hand.B.trim + hand.B.BA / 2, 4);
    expect([Math.min(b.a[0], b.b[0]), Math.max(b.a[0], b.b[0])]).toEqual([expect.closeTo(0, 4), expect.closeTo(112, 4)]);
    expect(h.a[1]).toBeCloseTo(hand.H.trim - hand.H.BA / 2, 4);
    expect(Math.abs(h.b[0] - h.a[0])).toBeCloseTo(120, 4);
    for (const x of pattern.bends) expect(x.direction).toBe('up');
  });

  it('③ the holes are in the pattern, two circles of radius 2.5 where they were', () => {
    const circles = pattern.outline.filter((s) => s.kind === 'circle');
    expect(circles).toHaveLength(2);
    expect(circles.map((c) => (c.kind === 'circle' ? [c.c[0], c.c[1] - 0, c.r] : [])).sort((p, q) => p[1]! - q[1]!)).toEqual([[expect.closeTo(40, 4), expect.closeTo(20, 4), 2.5], [expect.closeTo(40, 4), expect.closeTo(40, 4), 2.5]]);
  });
});

describe('the DXF of the golden bracket, read back (7-8)', () => {
  const hand = byHand();
  it('the checker has nothing to say; the lines on OUTLINE cover the size of the pattern from the origin (4 places), three bend lines on BEND, two circles, the notes of the bends', () => {
    const r = rebuild(build(bracket()));
    const pattern = flatPattern(kernel, r.sheet!);
    kernel.release(pattern.shape);
    const doc = readDxf(flatPatternDxf(pattern));
    expect(checkDxf(doc)).toEqual([]);
    const outline = doc.entities.filter((e): e is DxfLine => e.type === 'LINE' && e.layer === 'OUTLINE');
    const xs = outline.flatMap((l) => [l.a[0], l.b[0]]);
    const ys = outline.flatMap((l) => [l.a[1], l.b[1]]);
    expect(Math.min(...xs)).toBeCloseTo(0, 4);
    expect(Math.max(...xs)).toBeCloseTo(hand.xMax, 4);
    expect(Math.min(...ys)).toBeCloseTo(0, 4);
    expect(Math.max(...ys)).toBeCloseTo(hand.yMax - hand.yMin, 4);
    expect(doc.entities.filter((e) => e.type === 'LINE' && e.layer === 'BEND')).toHaveLength(3);
    const circles = doc.entities.filter((e): e is DxfCircle => e.type === 'CIRCLE');
    expect(circles).toHaveLength(2);
    expect(circles.map((c) => c.c[1]).sort((p, q) => p - q)).toEqual([expect.closeTo(20 - hand.yMin, 4), expect.closeTo(40 - hand.yMin, 4)]);
    const notes = doc.entities.filter((e): e is DxfText => e.type === 'TEXT').map((e) => e.text);
    expect(notes).toEqual(expect.arrayContaining(['UP 90° R2', 'UP 135° R2', 'UP 180° R0.5', 'T=1.5  K=0.5']));
  });
});

describe('the manufacturability checks of the golden bracket (7-8)', () => {
  it('with the limits at their starting values every check passes but one — the inside radius of the hem, 0.5 against 1.5 — and with that limit at 0.3 thicknesses all pass', () => {
    const r = rebuild(build(bracket()));
    const checks = sheetChecks(kernel, r.sheet!);
    // three bends and three flat pieces, two reliefs (the hem is the whole width), two holes
    expect(checks.map((c) => c.rule).sort()).toEqual(['bendRadius', 'bendRadius', 'bendRadius', 'flangeLength', 'flangeLength', 'flangeLength', 'holeToBend', 'holeToBend', 'reliefMissing', 'reliefMissing']);
    expect(checks.filter((c) => !c.ok).map((c) => [c.rule, c.feature, c.value, c.limit])).toEqual([['bendRadius', 'hm', 0.5, 1.5]]);
    expect(sheetChecks(kernel, r.sheet!, { radius: 0.3, flange: 4, hole: 2 }).every((c) => c.ok)).toBe(true);
    // a hole moved to x = 112 is 2.0 from the zone of the 90° bend (120 − 3.5 − 112 − 2.5 = 2): not enough, 2 thicknesses (3) are wanted
    const near = rebuild(build(bracket(120, {}, 112)));
    expect(failures(near)).toEqual([]);
    const holes = sheetChecks(kernel, near.sheet!).filter((c) => c.rule === 'holeToBend');
    expect(holes.map((c) => c.ok).sort()).toEqual([false, true]);
    expect(holes.find((c) => !c.ok)!.value).toBeCloseTo(120 - 3.5 - 112 - 2.5, 4);
  });
});

describe('the golden bracket follows the model (7-8)', () => {
  it('the K-factor 0.4 from a gauge row: the folded sheet is the same, each allowance is θ(r + 0.4·T) and the pattern is shorter by them — to the hand numbers', () => {
    let d = build(bracket());
    d = applyCommand(d, { type: 'setSheetGauges', gauges: [{ name: '1.5 mm K0.4', thickness: 1.5, radius: 2, kFactor: 0.4 }] });
    const g = d.sheetGauges![0]!;
    d = applyCommand(d, { type: 'setBaseFlange', featureId: 'bf', flange: { thickness: String(g.thickness), radius: String(g.radius), kFactor: String(g.kFactor) } });
    const r = rebuild(d);
    expect(failures(r)).toEqual([]);
    const hand = byHand(1.5, 2, 0.4);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(byHand().folded, 3);
    const pattern = flatPattern(kernel, r.sheet!);
    kernel.release(pattern.shape);
    expect(pattern.width).toBeCloseTo(hand.xMax, 4);
    expect(pattern.height).toBeCloseTo(hand.yMax - hand.yMin, 4);
    expect(pattern.area).toBeCloseTo(hand.area, 3);
    expect(pattern.width).toBeLessThan(byHand().xMax);
  });

  it('the plate made 140 long: the 90° flange moves with its edge, the pattern is 20 longer, the names are the same', () => {
    const base = rebuild(build(bracket()));
    const r = rebuild(build(bracket(140)));
    expect(failures(r)).toEqual([]);
    expect(r.body!.names.faces.filter((n) => /^(fa|fb|hm):/.test(n)).sort()).toEqual(base.body!.names.faces.filter((n) => /^(fa|fb|hm):/.test(n)).sort());
    const hand = byHand(1.5, 2, 0.5, 140);
    const pattern = flatPattern(kernel, r.sheet!);
    kernel.release(pattern.shape);
    expect(pattern.width).toBeCloseTo(hand.xMax, 4);
    expect(pattern.area).toBeCloseTo(hand.area, 3);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(hand.folded, 3);
  });

  it('the thickness 2 (and the radius 2.5): everything is made again, volumes and sizes by hand', () => {
    const r = rebuild(build(bracket(120, { thickness: '2', radius: '2.5' })));
    expect(failures(r)).toEqual([]);
    const hand = byHand(2, 2.5, 0.5);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(hand.folded, 3);
    const pattern = flatPattern(kernel, r.sheet!);
    kernel.release(pattern.shape);
    expect(pattern.width).toBeCloseTo(hand.xMax, 4);
    expect(pattern.height).toBeCloseTo(hand.yMax - hand.yMin, 4);
    expect(pattern.area).toBeCloseTo(hand.area, 3);
  });
});
