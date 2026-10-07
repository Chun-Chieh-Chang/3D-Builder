/**
 * 7-5 (docs/phase7-plan.md): the flat pattern (C11.3) worked out from the data the features recorded, against sizes worked out by hand: the length of a pattern is the plate less
 * the cut-back of each flange plus its bend allowance and flat piece (outside dimensions less 2(r + T) plus the allowance), the bend line is in the middle of the allowance, and at
 * K = 0.5 the volume of the pattern is the volume of the folded sheet (the sheet's volume is conserved). Plate 100 × 50 × 1.5, inside radius 2.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, FlatError, Regenerator, type FlatPattern, type RebuildResult } from '@3db/regen';
import { build, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const T = 1.5;
const Ro = 3.5;
const BA = (Math.PI / 2) * (2 + 0.5 * T); // a bend of 90° at K = 0.5
const baseOf = (k = '0.5'): Feature[] => [sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: k } as Feature];
const base = baseOf();

function edgeAt(r: RebuildResult, mid: [number, number, number]): Ref {
  const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
  expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
}
let topEdge: Ref;
beforeAll(() => {
  topEdge = edgeAt(rebuild(build(...base)), [100, 25, T]);
});
const flange = (extra: Record<string, unknown> = {}, edge: Ref = topEdge, id = 'ef'): Feature => ({ id, type: 'edgeFlange', name: id, suppressed: false, edge, length: '30', ...extra }) as Feature;
const hem = (extra: Record<string, unknown> = {}, edge: Ref = topEdge, id = 'hm'): Feature => ({ id, type: 'hem', name: id, suppressed: false, edge, length: '10', gap: '1', ...extra }) as Feature;

/** The pattern of a part, with the folded volume next to it; the solid is released. */
function flat(features: Feature[]): { pattern: FlatPattern; folded: number; result: RebuildResult } {
  const result = rebuild(build(...features));
  expect(failures(result)).toEqual([]);
  const pattern = flatPattern(kernel, result.sheet!);
  kernel.release(pattern.shape);
  return { pattern, folded: kernel.massProps(result.body!.shape).volume, result };
}
const near = (a: number, b: number, digits = 4) => expect(a).toBeCloseTo(b, digits);

describe('the pattern of a plate and of a plate with flanges', () => {
  it('a plate by itself is the plate: 100 × 50, 5000 mm², four lines, no bends', () => {
    const { pattern } = flat(base);
    near(pattern.width, 100);
    near(pattern.height, 50);
    near(pattern.area, 5000);
    near(pattern.volume, 7500);
    expect(pattern.outline).toHaveLength(4);
    expect(pattern.bends).toEqual([]);
  });

  it('a flange of 90°, 30 from the outside, material inside: 100 − 2(r + T) + 30 + BA long = 127.3197, the bend line in the middle of the allowance at x = 96.5 + BA/2, bending up; at K 0.5 the volume is the folded sheet\'s', () => {
    const { pattern, folded } = flat([...base, flange()]);
    near(pattern.width, 100 - 2 * Ro + 30 + BA);
    near(pattern.width, 127.31969);
    near(pattern.height, 50);
    near(pattern.area, 50 * (100 - 2 * Ro + 30 + BA));
    near(pattern.volume, folded, 3);
    expect(pattern.bends).toHaveLength(1);
    const b = pattern.bends[0]!;
    near(b.a[0], 100 - Ro + BA / 2);
    near(b.b[0], 100 - Ro + BA / 2);
    near(Math.min(b.a[1], b.b[1]), 0);
    near(Math.max(b.a[1], b.b[1]), 50);
    expect(b.direction).toBe('up');
    near(b.angle, Math.PI / 2, 9);
    near(b.allowance, BA, 9);
  });

  it('the K-factor moves the length and nothing else: K 0.4 → BA = (π/2)(2 + 0.6) and the pattern is shorter by (π/2)·0.1·T', () => {
    const { pattern } = flat([...baseOf('0.4'), flange()]);
    near(pattern.width, 100 - 2 * Ro + 30 + (Math.PI / 2) * (2 + 0.6));
    near(pattern.width, 127.08407, 4);
  });

  it('bend outside: the plate is whole, 100 + BA + (30 − 3.5) = 130.8197; bent the other way the bend line says down', () => {
    near(flat([...base, flange({ position: 'bendOutside' })]).pattern.width, 100 + BA + 30 - Ro);
    expect(flat([...base, flange({ flip: true })]).pattern.bends[0]!.direction).toBe('down');
  });

  it('45°: 100 + 30 − 2·(r + T)·tan 22.5° + BA(45°) = 129.2604, and K 0.5 volume conserved', () => {
    const { pattern, folded } = flat([...base, flange({ angle: '45deg' })]);
    near(pattern.width, 100 + 30 - 2 * Ro * Math.tan(Math.PI / 8) + (Math.PI / 4) * (2 + 0.75));
    near(pattern.width, 129.26035, 4);
    near(pattern.volume, folded, 3);
    near(pattern.bends[0]!.angle, Math.PI / 4, 9);
  });

  it('a hem (gap 1, 10 folded back): 100 − (0.5 + 1.5) + π(0.5 + 0.75) + 10 = 111.927 long', () => {
    const { pattern, folded } = flat([...base, hem()]);
    near(pattern.width, 100 - 2 + Math.PI * (0.5 + 0.75) + 10);
    near(pattern.width, 111.92699);
    near(pattern.volume, folded, 3);
    near(pattern.bends[0]!.angle, Math.PI, 9);
  });

  it('a flange on a flange (a hem on the end of a 90° flange): the lip goes on at the end of the first flange\'s flat piece, 137.2467 long, volume conserved', () => {
    const first = rebuild(build(...base, flange()));
    const end = edgeAt(first, [98.5, 25, 30]);
    const { pattern, folded, result } = flat([...base, flange(), hem({ length: '8' }, end)]);
    near(pattern.width, 100 - Ro + BA + (30 - Ro - 2) + Math.PI * (0.5 + 0.75) + 8);
    near(pattern.width, 137.24668);
    near(pattern.volume, folded, 3);
    expect(result.sheet!.flanges.map((f) => f.parent)).toEqual([-1, 0]);
    expect(pattern.bends).toHaveLength(2);
    expect(pattern.bends[0]!.direction).toBe('up');
    expect(pattern.bends[1]!.direction).toBe('up');
  });

  it('a flange that stops short, with its relief: the ears stay to the edge and the notches are cut — 5000 − 3.5·35 − 2·1.5·5 + (BA + 26.5)·35 = 5941.19 mm²', () => {
    const { pattern, folded } = flat([...base, flange({ inset: { start: '10', end: '5' }, relief: { width: '1.5', depth: '1.5' } })]);
    near(pattern.area, 5000 - Ro * 35 - 2 * 1.5 * 5 + (BA + 30 - Ro) * 35, 3);
    near(pattern.width, 100 - Ro + BA + 30 - Ro);
    near(pattern.height, 50);
    near(pattern.volume, folded, 3);
    expect(pattern.outline.length).toBeGreaterThan(8);
    // the bend line is as wide as the flange: y 10 to 45
    near(Math.min(pattern.bends[0]!.a[1], pattern.bends[0]!.b[1]), 10);
    near(Math.max(pattern.bends[0]!.a[1], pattern.bends[0]!.b[1]), 45);
  });

  it('flanges on two neighbouring edges with a gap at the corner: 127.32 along x and 77.32 along y (the second grows from y = 46.5), no overlap, volume conserved', () => {
    const first = rebuild(build(...base, flange({ inset: { start: '0', end: '3' } })));
    const next = edgeAt(first, [50, 50, T]);
    const { pattern, folded } = flat([...base, flange({ inset: { start: '0', end: '3' } }), flange({ inset: { start: '4', end: '0' } }, next, 'ef2')]);
    near(pattern.width, 100 - Ro + BA + 30 - Ro);
    near(pattern.height, 50 - Ro + BA + 30 - Ro);
    near(pattern.volume, folded, 3);
    expect(pattern.bends).toHaveLength(2);
  });
});

describe('the pattern of a bent base flange', () => {
  const U = { ...sketch('sk', front), entities: [[0, 20], [0, 0], [60, 0], [60, 20]].flatMap(([x, y], i) => [{ id: `p${i}`, type: 'point', x, y }, ...(i > 0 ? [{ id: String.fromCharCode(96 + i), type: 'line', p1: `p${i - 1}`, p2: `p${i}` }] : [])]) } as Feature;
  const channel = { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', depth: '40' } as Feature;

  it('the U channel unrolled: 94.639 × 40, the bend lines in the middle of the allowances at 16.5 + BA/2 and 16.5 + BA + 53 + BA/2, both bending away (the path is the outside)', () => {
    const { pattern, folded } = flat([U, channel]);
    near(pattern.width, 2 * (20 - Ro) + (60 - 2 * Ro) + 2 * BA);
    near(pattern.width, 94.63938);
    near(pattern.height, 40);
    near(pattern.volume, folded, 3);
    expect(pattern.bends.map((b) => b.a[0])).toEqual([expect.closeTo(16.5 + BA / 2, 6), expect.closeTo(16.5 + BA + 53 + BA / 2, 6)]);
    expect(pattern.bends.map((b) => b.direction)).toEqual(['down', 'down']);
  });

  it('a flange that says it is on a piece of the bent base that is not there is said, not made wrong; a part with no base flange has no pattern', () => {
    const r = rebuild(build(U, channel));
    const sheet = r.sheet!;
    expect(() => flatPattern(kernel, { ...sheet, flanges: [{ feature: 'x', parent: -1, host: 9 } as never] })).toThrow(FlatError);
    expect(() => flatPattern(kernel, { ...sheet, base: null })).toThrow(FlatError);
  });
});
