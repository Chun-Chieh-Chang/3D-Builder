/**
 * Phase 3a-5a (C4.1, C4.3): thin features. A closed outline becomes a ring, an open one a ribbon; the wall goes inward, outward, half each way
 * or by two thicknesses. Every volume is the hand-calculated area times the depth (ADR 0027).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { SKETCH_ORIGIN, type Feature, type PartDoc, type Thin } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

const thin = (sk: Feature, th: Thin, depth = '10'): PartDoc => build(sk, { ...extrude('e1', sk.id, 'boss', { type: 'blind', depth }), thin: th } as Feature);
const rect = () => sketch('s1', front, rectangle('r', 0, 0, 20, 10));

describe('a thin extrusion of a closed outline (C4.1)', () => {
  it.each([
    ['inward 2', { mode: 'one', thickness: '2' }, 200 - 16 * 6],
    ['outward 2', { mode: 'one', thickness: '2', reverse: true }, 24 * 14 - 200],
    ['half each way (2 in all)', { mode: 'mid', thickness: '2' }, 22 * 12 - 18 * 8],
    ['2 inward and 1 outward', { mode: 'two', thickness: '2', thickness2: '1' }, 22 * 12 - 16 * 6],
  ] as const)('%s: the wall of a 20 × 10 rectangle is the ring between two rectangles', (_, th, area) => {
    const r = rebuild(thin(rect(), th as Thin));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(area * 10, 6);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(new Set(r.body!.names.faces).size).toBe(r.body!.names.faces.length); // every face has a name of its own
  });

  it('names the walls for the sides they came from: the outline keeps its names, the offset has a suffix', () => {
    const r = rebuild(thin(rect(), { mode: 'one', thickness: '2' }));
    const names = r.body!.names.faces;
    expect(names).toHaveLength(10);
    expect(names.filter((n) => n.endsWith('side:s1.rl0'))).toHaveLength(1); // one wall for the outline's edge …
    expect(names.some((n) => n.endsWith('rl0_i'))).toBe(true); // … and one for its offset
    expect(names).toContain('e1:cap:end');
    expect(names).toContain('e1:cap:start');
  });

  it('a circle is a tube: π (5² − 4²) × 10, and a line and arc outline an exact offset', () => {
    expect(volume(rebuild(thin(sketch('s1', front, circle('c', 0, 0, 5)), { mode: 'one', thickness: '1' })))).toBeCloseTo(9 * Math.PI * 10, 6);
    // a half disc of radius 5 on the x axis: the ring is the half disc less the one that is 1 smaller, its flat side moved up by 1
    const half = sketch('s1', front, {
      entities: [
        { id: 'c', type: 'point', x: 0, y: 0 }, { id: 'p', type: 'point', x: 5, y: 0 }, { id: 'q', type: 'point', x: -5, y: 0 },
        { id: 'a', type: 'arc', center: 'c', start: 'p', end: 'q' }, { id: 'l', type: 'line', p1: 'q', p2: 'p' },
      ],
      constraints: [{ id: 'f', type: 'coincident', a: 'c', b: SKETCH_ORIGIN }],
    } as never);
    const r = rebuild(thin(half, { mode: 'one', thickness: '1' }));
    expect(failures(r)).toEqual([]);
    const inner = 16 * Math.acos(1 / 4) - Math.sqrt(15);
    expect(volume(r)).toBeCloseTo(((25 * Math.PI) / 2 - inner) * 10, 5);
  });

  it('refuses a wall too thick to fit, and says what to do', () => {
    const r = rebuild(thin(rect(), { mode: 'one', thickness: '6' }));
    expect(failures(r)[0]).toContain('壁厚太大');
    expect(failures(rebuild(thin(rect(), { mode: 'one', thickness: '4' })))).toEqual([]); // 4 leaves a 12 × 2 slot
  });
});

describe('a thin extrusion of an open path (C4.1)', () => {
  const L = (): Feature =>
    sketch('s1', front, {
      entities: [
        { id: 'a', type: 'point', x: 0, y: 0 }, { id: 'b', type: 'point', x: 20, y: 0 }, { id: 'c', type: 'point', x: 20, y: 10 },
        { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
      ],
      constraints: [],
    } as never);

  it('an L makes a bent ribbon with a sharp corner, whichever side it is thickened to, or both: 56, 64 and 60 square millimetres', () => {
    const left = rebuild(thin(L(), { mode: 'one', thickness: '2' }));
    expect(failures(left)).toEqual([]);
    expect(volume(left)).toBeCloseTo((200 - 144) * 10, 6); // 20 × 10 less 18 × 8
    const right = rebuild(thin(L(), { mode: 'one', thickness: '2', reverse: true }));
    expect(volume(right)).toBeCloseTo((264 - 200) * 10, 6); // 22 × 12 less 20 × 10
    const mid = rebuild(thin(L(), { mode: 'mid', thickness: '2' }));
    expect(volume(mid)).toBeCloseTo((231 - 171) * 10, 6); // 21 × 11 less 19 × 9
    expect(kernel.isValid(mid.body!.shape)).toBe(true);
  });

  it('closed and open outlines in one sketch both get a wall', () => {
    const both = sketch('s1', front, rectangle('r', 0, 0, 20, 10), {
      entities: [{ id: 'a', type: 'point', x: 40, y: 0 }, { id: 'b', type: 'point', x: 60, y: 0 }, { id: 'l1', type: 'line', p1: 'a', p2: 'b' }],
      constraints: [],
    } as never);
    expect(volume(rebuild(thin(both, { mode: 'one', thickness: '2' })))).toBeCloseTo((104 + 20 * 2) * 10, 6);
  });
});

describe('thin revolve (C4.3)', () => {
  it('an open line turned about an axis is a tube: π (10² − 8²) × 20', () => {
    const tube = sketch('s1', front, {
      entities: [
        { id: 'o', type: 'point', x: 0, y: 0 }, { id: 'u', type: 'point', x: 0, y: 30 }, { id: 'ax', type: 'line', p1: 'o', p2: 'u', construction: true },
        { id: 'a', type: 'point', x: 10, y: 0 }, { id: 'b', type: 'point', x: 10, y: 20 }, { id: 'w', type: 'line', p1: 'a', p2: 'b' },
      ],
      constraints: [{ id: 'f', type: 'coincident', a: 'o', b: SKETCH_ORIGIN }, { id: 'v', type: 'vertical', a: 'ax' }],
    } as never);
    const doc = build(tube, { id: 'rv', type: 'revolve', name: 'rv', suppressed: false, sketch: 's1', axis: 'ax', op: 'boss', dir1: { type: 'blind', angle: '360deg' }, thin: { mode: 'one', thickness: '2' } } as Feature);
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(Math.PI * (100 - 64) * 20, 6);
  });
});