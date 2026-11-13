/**
 * A drafted extrusion of a sketch with a spline, through the features (ADR 0251). Before, the draft of such a profile failed ("cannot draft face 2");
 * now it is drafted wire by wire. Each case against the same sketch extruded straight: the walls keep the names of the plain extrusion, a narrowing
 * draft takes material away and a widening one adds it, in either direction and with an end condition; a cut with a draft is the boss's complement.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Feature, PartDoc, SketchConstraint, SketchEntity } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, pin, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape, { eps: 1e-10 }).volume, 0);
/** The area of the walls with no simple surface: where a drafted body may differ from the draft by the accepted 1e-4 mm. */
const splineArea = (r: RebuildResult) => r.bodies.reduce((a, b) => a + kernel.topology(b.shape).faces.reduce((s, f) => s + (f.geometry ? 0 : f.area), 0), 0);

/** Three lines and a spline over the top, the spline's ends shared with the lines (the C1 test outline), every point pinned. */
function outline(id: string, dx = 0, dy = 0) {
  const at: Record<string, [number, number]> = { a: [0, 0], b: [28.72, 0], c: [28.72, 25], m: [14, 32], d: [0, 25] };
  const entities: SketchEntity[] = Object.entries(at).map(([k, [x, y]]) => ({ id: `${id}${k}`, type: 'point', x: x + dx, y: y + dy }));
  entities.push(
    { id: `${id}l0`, type: 'line', p1: `${id}a`, p2: `${id}b` },
    { id: `${id}l1`, type: 'line', p1: `${id}b`, p2: `${id}c` },
    { id: `${id}s`, type: 'spline', points: [`${id}c`, `${id}m`, `${id}d`], closed: false },
    { id: `${id}l2`, type: 'line', p1: `${id}d`, p2: `${id}a` },
  );
  const constraints: SketchConstraint[] = Object.entries(at).flatMap(([k, [x, y]]) => pin(`${id}${k}`, `${id}${k}`, x + dx, y + dy) ?? []);
  return { entities, constraints };
}

const boss = (extra: Partial<Extract<Feature, { type: 'extrude' }>>): PartDoc =>
  build(sketch('s1', front, outline('o')), { ...extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }), ...extra } as Feature);

describe('draft of an extrusion whose sketch has a spline', () => {
  it('narrows inward and widens outward, valid, with the names of the plain extrusion', () => {
    const plain = rebuild(boss({}));
    const out = rebuild(boss({ draft1: { angle: '2deg' } }));
    const inn = rebuild(boss({ draft1: { angle: '2deg', inward: true } }));
    expect(failures(plain)).toEqual([]);
    expect(failures(out)).toEqual([]);
    expect(failures(inn)).toEqual([]);
    expect(volume(out)).toBeGreaterThan(volume(plain));
    expect(volume(inn)).toBeLessThan(volume(plain));
    expect(kernel.isValid(out.body!.shape)).toBe(true);
    expect(kernel.isValid(inn.body!.shape)).toBe(true);
    // the same names (MakeDraft lists the faces in another order; a reference goes by name)
    const sorted = (r: RebuildResult) => [...r.body!.names.faces].sort();
    expect(sorted(out)).toEqual(sorted(plain));
    expect(sorted(inn)).toEqual(sorted(plain));
    // the premise: the spline's wall is there, and it leans (no simple surface)
    expect(kernel.topology(inn.body!.shape).faces.filter((f) => !f.geometry)).toHaveLength(1);
  });

  it('in the second direction too: both halves lean, the body is the two drafted halves', () => {
    const one = rebuild(boss({ draft1: { angle: '2deg', inward: true } }));
    const both = rebuild(boss({ draft1: { angle: '2deg', inward: true }, dir2: { type: 'blind', depth: '5' }, draft2: { angle: '2deg', inward: true } }));
    const down = rebuild(build(sketch('s1', front, outline('o')), { ...extrude('e1', 's1', 'boss', { type: 'blind', depth: '5', reverse: true }), draft1: { angle: '2deg', inward: true } } as unknown as Feature));
    expect(failures(both)).toEqual([]);
    expect(failures(down)).toEqual([]);
    // each half's spline wall is drafted again on its own, within 1e-4 mm of the draft (ADR 0251)
    expect(Math.abs(volume(both) - (volume(one) + volume(down)))).toBeLessThan(1e-4 * splineArea(both));
  });

  it('a cut with a draft takes away what the same boss adds', () => {
    const plate = build(sketch('s0', front, rectangle('r', -10, -10, 50, 50)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '20' }));
    const cutDoc: PartDoc = { ...plate, features: [...plate.features, sketch('s1', front, outline('o')), { ...extrude('e1', 's1', 'cut', { type: 'blind', depth: '10', reverse: true }), draft1: { angle: '2deg', inward: true } } as unknown as Feature] };
    const cut = rebuild(cutDoc);
    const bossAlone = rebuild(build(sketch('s1', front, outline('o')), { ...extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }), draft1: { angle: '2deg', inward: true } } as Feature));
    expect(failures(cut)).toEqual([]);
    expect(kernel.isValid(cut.body!.shape)).toBe(true);
    // the cut's tool and the boss are drafted apart, each within 1e-4 mm of the draft (ADR 0251)
    expect(Math.abs(50 * 50 * 20 - volume(cut) - volume(bossAlone))).toBeLessThan(1e-4 * splineArea(bossAlone));
  });

  it('with an end condition the walls lean and are then trimmed: up to the next face', () => {
    const below = build(
      sketch('s0', front, rectangle('r', -10, -10, 50, 50)),
      { ...extrude('e0', 's0', 'boss', { type: 'blind', depth: '2' }) } as Feature,
    );
    const doc: PartDoc = {
      ...below,
      features: [
        ...below.features,
        { id: 'p1', type: 'refPlane', name: 'p1', suppressed: false, def: { mode: 'offset', plane: front, distance: '12' } } as Feature,
        sketch('s1', { kind: 'datum', name: 'p1' }, outline('o')),
        { ...extrude('e1', 's1', 'boss', { type: 'upToNext', reverse: true }), draft1: { angle: '2deg', inward: true } } as unknown as Feature,
      ],
    };
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    // the drafted piece is the 10 mm from the plane at 12 down to the plate's top at 2
    const ten = rebuild(build(sketch('s1', front, outline('o')), { ...extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }), draft1: { angle: '2deg', inward: true } } as Feature));
    // both spline walls are MakeDraft's approximation, made to different lengths (this one long enough to pass the plate, then trimmed): they
    // may differ by the accepted 1e-4 mm (ADR 0251) over the spline wall, about 30 × 10 mm², i.e. 0.03 mm³ of 8160 (3.7e-6); measured 1.45e-7
    const wall = kernel.topology(ten.body!.shape).faces.find((f) => !f.geometry)!.area;
    expect(Math.abs(volume(r) - 50 * 50 * 2 - volume(ten)) / volume(ten)).toBeLessThan((1e-4 * wall) / volume(ten));
  });
});
