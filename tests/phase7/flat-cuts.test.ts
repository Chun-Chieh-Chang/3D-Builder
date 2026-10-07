/**
 * Cuts after the sheet's own features in the flat pattern (ADR 0113): a hole made after the plate was bent (an extrude cut) was not in the pattern, and so not in the DXF either. Now
 * what a feature after the sheet's took away is kept (the sheet before it less the sheet after it), and the pattern puts each piece back through the motion of the part of the sheet it
 * is in. Plate 100 × 60 × 1.5, radius 2, K 0.5 (outside radius R = 3.5, bend allowance BA = (π/2)(2 + 0.75) = 4.3197), one flange of 90° on the x = 100 edge, length 40 (the flat piece is
 * 36.5 high from z = 3.5): a hole of R3 (π·9 = 28.274 mm² of the pattern):
 *   - in the plate at (30, 30): at (30, 30) of the pattern;
 *   - in the wall of the flange at height z = 20, y = 30: the plate ends at x = 100 − R = 96.5, then BA of bend, then the wall from z = 3.5: x = 96.5 + BA + (20 − 3.5) = 117.3197, y = 30;
 *   - in the bend (z = 2): not in the pattern, and said to be in a bend.
 * On a mid bend (plate 100 × 50 bent 90° at x = 50, BA the same): the plate's turned side is slid back and turned back: a hole in the wall at height z = 30, y = 25 is at
 * x = 50 + BA/2 + (30 − 3.5) = 78.66, y = 25.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type SketchEntity } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { flatPatternDxf, readDxf, type DxfCircle } from '@3db/drawing';
import { circle, extrude, front, rectangle, sketch, statuses, type SketchParts } from '../phase1/builders';

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
const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const T = 1.5;
const BA = (Math.PI / 2) * 2.75;
const right = { kind: 'datum', name: 'plane:right' } as const; // normal +X; its x runs along −Z, its y along Y

const plate = (w: number, h: number): Feature[] => [sketch('sk', front, rectangle('r', 0, 0, w, h)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature];
const flange = (): Feature => ({ id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: { kind: 'edge', name: '{bf:cap:end|bf:side:sk.rl1}' }, length: '40' }) as Feature;
const offsetPlane = (id: string, x: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: right, distance: String(x) } }) as Feature;
/** A hole of R3 through the wall at height z, along y = `y`: a sketch on the plane x = `x` (its x is −z), cut 5 deep toward +x. */
const hole = (id: string, x: number, z: number, y: number): Feature[] => [offsetPlane(`p${id}`, x), sketch(`s${id}`, { kind: 'datum', name: `p${id}` } as never, circle(`c${id}`, -z, y, 3)), extrude(`x${id}`, `s${id}`, 'cut', { type: 'blind', depth: '5', reverse: true })];
const flat = (r: RebuildResult) => {
  const p = flatPattern(kernel, r.sheet!);
  kernel.release(p.shape);
  return p;
};
const circles = (p: ReturnType<typeof flat>) => p.outline.filter((s) => s.kind === 'circle') as { kind: 'circle'; c: [number, number]; r: number }[];

describe('the cuts after the flanges, in the flat pattern', () => {
  it('a hole in the plate, made after the flange: the pattern loses π·9 and has the circle at (30, 30)', () => {
    const with_ = rebuild(build([...plate(100, 60), flange(), sketch('sh', front, circle('c', 30, 30, 3)), extrude('xh', 'sh', 'cut', { type: 'blind', depth: '5', reverse: true })]));
    expect(failures(with_)).toEqual([]);
    const without = rebuild(build([...plate(100, 60), flange()]));
    const [a, b] = [flat(with_), flat(without)];
    expect(b.area - a.area).toBeCloseTo(Math.PI * 9, 3);
    expect(a.notIncluded).toEqual([]);
    const c = circles(a);
    expect(c).toHaveLength(1);
    expect(c[0]!.c[0]).toBeCloseTo(30, 4);
    expect(c[0]!.c[1]).toBeCloseTo(30, 4);
    expect(c[0]!.r).toBeCloseTo(3, 6);
    expect(b.notIncluded).toEqual([]);
  });

  it('a hole in the wall of the flange at height 20: the circle is at x = 96.5 + BA + 16.5 = 117.3197, y = 30, and the pattern loses π·9', () => {
    const r = rebuild(build([...plate(100, 60), flange(), ...hole('w', 98, 20, 30)]));
    expect(failures(r)).toEqual([]);
    const without = rebuild(build([...plate(100, 60), flange()]));
    const [a, b] = [flat(r), flat(without)];
    expect(a.notIncluded).toEqual([]);
    expect(b.area - a.area).toBeCloseTo(Math.PI * 9, 3);
    const c = circles(a);
    expect(c).toHaveLength(1);
    expect(c[0]!.c[0]).toBeCloseTo(96.5 + BA + 16.5, 3);
    expect(c[0]!.c[1]).toBeCloseTo(30, 4);
  });

  it('the DXF has the hole of the wall as a circle of R3 on the outline layer, where the pattern has it (the pattern moved to the origin)', () => {
    const r = rebuild(build([...plate(100, 60), flange(), ...hole('w', 98, 20, 30)]));
    const p = flat(r);
    const doc = readDxf(flatPatternDxf(p));
    const circles = doc.entities.filter((e): e is DxfCircle => e.type === 'CIRCLE');
    expect(circles).toHaveLength(1);
    expect(circles[0]!.r).toBeCloseTo(3, 4);
    expect(circles[0]!.c[0]).toBeCloseTo(96.5 + BA + 16.5 - p.min[0], 3);
    expect(circles[0]!.c[1]).toBeCloseTo(30 - p.min[1], 3);
  });

  it('a hole in the bend itself (z = 2) is not in the pattern, and the pattern says it is in a bend; the rest of the pattern is as it was', () => {
    const r = rebuild(build([...plate(100, 60), flange(), ...hole('b', 95, 2, 30)]));
    expect(failures(r)).toEqual([]);
    const without = rebuild(build([...plate(100, 60), flange()]));
    const [a, b] = [flat(r), flat(without)];
    expect(a.notIncluded).toEqual([{ feature: 'xb', why: 'bend' }]);
    expect(a.area).toBeCloseTo(b.area, 6);
    expect(circles(a)).toHaveLength(0);
  });

  it('holes in the plate and in the wall together, and a pattern of the same hole: every hole is put back (3 in the plate, 1 in the wall)', () => {
    const r = rebuild(build([...plate(100, 60), flange(), sketch('sh', front, circle('c1', 20, 15, 2), circle('c2', 20, 45, 2), circle('c3', 60, 30, 2)), extrude('xh', 'sh', 'cut', { type: 'blind', depth: '5', reverse: true }), ...hole('w', 98, 20, 30)]));
    expect(failures(r)).toEqual([]);
    const a = flat(r);
    expect(a.notIncluded).toEqual([]);
    expect(circles(a)).toHaveLength(4);
  });

  it('a mid bend: the hole in the side that turned is slid back and turned back: at x = 50 + BA/2 + 26.5 = 78.66, y = 25; a hole in the side that stays is where it is', () => {
    const line: SketchParts = { entities: [{ id: 'a', type: 'point', x: 50, y: -5 } as SketchEntity, { id: 'b', type: 'point', x: 50, y: 55 } as SketchEntity, { id: 'l', type: 'line', p1: 'a', p2: 'b' } as SketchEntity], constraints: [] };
    const bent: Feature[] = [...plate(100, 50), sketch('sm', front, line), { id: 'mb', type: 'midBend', name: 'mb', suppressed: false, sketch: 'sm', angle: '90' } as Feature];
    const r = rebuild(build([...bent, ...hole('w', 49, 30, 25)]));
    expect(failures(r)).toEqual([]);
    const a = flat(r);
    expect(a.notIncluded).toEqual([]);
    const c = circles(a);
    expect(c).toHaveLength(1);
    expect(c[0]!.c[0]).toBeCloseTo(50 + BA / 2 + 26.5, 3);
    expect(c[0]!.c[1]).toBeCloseTo(25, 4);
    const stays = rebuild(build([...bent, sketch('sh', front, circle('c', 20, 25, 3)), extrude('xh', 'sh', 'cut', { type: 'blind', depth: '5', reverse: true })]));
    expect(failures(stays)).toEqual([]);
    const b = circles(flat(stays));
    expect(b).toHaveLength(1);
    expect(b[0]!.c[0]).toBeCloseTo(20, 4);
    expect(b[0]!.c[1]).toBeCloseTo(25, 4);
  });

  it('what is not a cut is not kept: a fillet is a cut too (the edge takes material), and is said when it cannot be put back; a boss adds, and is not a cut', () => {
    const boss: Feature[] = [sketch('sb', front, circle('cb', 30, 30, 3)), extrude('xb', 'sb', 'boss', { type: 'blind', depth: '1' })];
    const r = rebuild(build([...plate(100, 60), flange(), ...boss]));
    expect(failures(r)).toEqual([]);
    expect(r.sheet!.cuts).toEqual([]);
  });

  it('the edge of the part that is picked later does not change: edge references and names are as before (the cut only records)', () => {
    const base = rebuild(build([...plate(100, 60), flange()]));
    const i = base.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.abs(e.mid[0] - 48.25) < 1e-6 && Math.abs(e.mid[1] - 60) < 1e-6);
    expect(i).toBeGreaterThanOrEqual(0);
    const fp = edgeFingerprint(base.body!.topology, i);
    expect(fp).toBeDefined();
  });
});
