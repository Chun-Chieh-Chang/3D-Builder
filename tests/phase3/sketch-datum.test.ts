/**
 * Reference geometry in a sketch (G3, ADR 0172): a reference plane, axis and point followed by a sketch, the planes seen edge-on as lines, an axis square to
 * the sketch as a point; and the sketch's parents in the history (its plane and everything its entities follow). The front plane's sketch coordinates are
 * the part's x and y (checked below), so the truths are written by hand.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type Ref, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { referenceEntities } from '@3db/sketch/ops';
import { IdAllocator } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { convertEdges, DATUM_HALF_SPAN, datumItem, parentsOf, Regenerator, NO_NAMES, NO_TOPOLOGY, type ReferenceScope } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
const regen = () => new Regenerator(kernel, solver, new Map());

const right: Ref = { kind: 'datum', name: 'plane:right' };
const top: Ref = { kind: 'datum', name: 'plane:top' };
const datum = (name: string): Ref => ({ kind: 'datum', name });
/** 基準面1: the right plane moved `d` along x. 基準軸1: where it meets the front plane (the line x = d, z = 0, along y). 點1 at (3, 4, 5). */
const datums = (d: number): Feature[] => [
  { id: 'pl1', type: 'refPlane', name: '基準面1', suppressed: false, def: { mode: 'offset', plane: right, distance: String(d) } } as Feature,
  { id: 'ax1', type: 'refAxis', name: '基準軸1', suppressed: false, def: { mode: 'planes', plane: front, plane2: datum('pl1') } } as Feature,
  { id: 'pt1', type: 'refPoint', name: '點1', suppressed: false, def: { mode: 'coords', x: '3', y: '4', z: '5' } } as Feature,
];
const line = (id: string, ref: Ref): SketchEntity[] => [
  { id: `${id}a`, type: 'point', x: 0, y: 0 },
  { id: `${id}b`, type: 'point', x: 1, y: 1 },
  { id, type: 'line', p1: `${id}a`, p2: `${id}b`, construction: true, ref },
];
const solvedPoint = (r: ReturnType<Regenerator['rebuild']>, sketchId: string, id: string) => {
  const g = r.sketches.get(sketchId)?.solved.geometry.get(id);
  return g?.type === 'point' ? g.p : null;
};
const close = (p: [number, number] | null, x: number, y: number) => !!p && Math.hypot(p[0] - x, p[1] - y) < 1e-9;

describe('reference geometry seen from a sketch (datumItem)', () => {
  /** The scope a sketch on `plane` sees after the datums of `datums(10)`, with no model at all. */
  const scopeOn = (plane: Ref): ReferenceScope => {
    const r = regen().rebuild(build(...datums(10), sketch('s', plane)));
    expect(statuses(r).every((s) => s.endsWith('=ok'))).toBe(true);
    const planes = new Map([['plane:front', front], ['plane:right', right], ['plane:top', top]]);
    return {
      names: NO_NAMES,
      topology: NO_TOPOLOGY,
      frame: r.frames.get('s')!,
      datums: { axis: (n) => r.axes.get(n), point: (n) => r.points.get(n), plane: (n) => (planes.has(n) ? undefined : r.frames.get(n)) },
    };
  };

  it('the front plane is the part x, y', () => {
    const f = scopeOn(front).frame;
    expect(f.xDir.map(Math.abs)).toEqual([1, 0, 0]);
    expect(f.yDir.map(Math.abs)).toEqual([0, 1, 0]);
  });

  it('on the front plane: the offset plane is the line x = 10, the axis the same line, the point (3, 4); a line is ±25 long', () => {
    const s = scopeOn(front);
    const sx = Math.sign(s.frame.xDir[0]);
    const sy = Math.sign(s.frame.yDir[1]);
    for (const name of ['pl1', 'ax1']) {
      const item = datumItem(s, datum(name));
      if (!('line' in item)) throw new Error(`${name} should be a line`);
      for (const p of item.line) expect(p[0]).toBeCloseTo(10 * sx, 9);
      expect(Math.hypot(item.line[1][0] - item.line[0][0], item.line[1][1] - item.line[0][1])).toBeCloseTo(2 * DATUM_HALF_SPAN, 9);
    }
    expect(datumItem(s, datum('pt1'))).toEqual({ point: [expect.closeTo(3 * sx, 9), expect.closeTo(4 * sy, 9)] });
  });

  it('on the top plane the axis is square to the sketch: a point where it passes through (x = 10)', () => {
    const s = scopeOn(top);
    const item = datumItem(s, datum('ax1'));
    if (!('point' in item)) throw new Error('should be a point');
    const at = [s.frame.origin[0] + s.frame.xDir[0] * item.point[0] + s.frame.yDir[0] * item.point[1], s.frame.origin[2] + s.frame.xDir[2] * item.point[0] + s.frame.yDir[2] * item.point[1]];
    expect(at[0]).toBeCloseTo(10, 9);
    expect(at[1]).toBeCloseTo(0, 9);
  });

  it('a plane parallel to the sketch, and a datum that is not there, are refused with a reason', () => {
    const s = scopeOn(right);
    expect(() => datumItem(s, datum('pl1'))).toThrow(/基準面|pl1|parallel|平行/);
    expect(() => datumItem(s, datum('nothing'))).toThrow(/nothing/);
    expect(convertEdges(s, [datum('pl1')], 'convert').errors).toHaveLength(1);
    expect(convertEdges(s, [datum('ax1')], 'pierce').items).toEqual([]);
  });
});

describe('a sketch that follows reference geometry', () => {
  const doc = (d: number): PartDoc =>
    build(
      ...datums(d),
      sketch('s1', front, {
        entities: [...line('L', datum('ax1')), { id: 'P', type: 'point', x: 0, y: 0, ref: datum('pt1') }, { id: 'q', type: 'point', x: 2, y: 2 }],
        // a free point held on the axis line, 6 above the reference point
        constraints: [{ id: 'on', type: 'pointOnCurve', point: 'q', curve: 'L' }, { id: 'dy', type: 'distanceY', a: 'P', b: 'q', value: '6' }],
      } as never),
    );

  it('solves with no model at all, and the free point sits on the axis 6 above the point', () => {
    const r = regen().rebuild(doc(10));
    expect(statuses(r)).toEqual(['pl1=ok', 'ax1=ok', 'pt1=ok', 's1=ok']);
    expect(close(solvedPoint(r, 's1', 'P'), 3, 4)).toBe(true);
    const q = solvedPoint(r, 's1', 'q')!;
    expect(q[0]).toBeCloseTo(10, 9);
    expect(Math.abs(q[1] - 4)).toBeCloseTo(6, 9);
  });

  it('follows the plane when it moves (10 → 17): the axis line and the point on it go to x = 17', () => {
    const q = solvedPoint(regen().rebuild(doc(17)), 's1', 'q')!;
    expect(q[0]).toBeCloseTo(17, 9);
  });

  it('a reference plane seen edge-on is a construction line that follows it', () => {
    const r = regen().rebuild(build(...datums(12), sketch('s1', front, { entities: line('E', datum('pl1')), constraints: [] } as never)));
    expect(statuses(r).at(-1)).toBe('s1=ok');
    const g = r.sketches.get('s1')!.solved.geometry.get('E');
    expect(g?.type === 'line' && Math.abs(g.a[0]) === 12 && Math.abs(g.b[0]) === 12 && g.construction).toBe(true);
  });

  it('converted reference geometry: a plane or an axis becomes a construction line, a point a point; the same datum twice adds nothing', () => {
    const ids = new IdAllocator({}, []);
    const items = [
      { ref: datum('pl1'), projected: { kind: 'line' as const, a: [10, -25] as [number, number], b: [10, 25] as [number, number] } },
      { ref: datum('pt1'), vertex: [3, 4] as [number, number] },
    ];
    const r = referenceEntities({ entities: [] }, ids, items);
    if ('error' in r) throw new Error(r.error);
    const made = r.edit.add!.entities!;
    expect(made.find((e) => e.type === 'line')).toMatchObject({ construction: true, ref: datum('pl1') });
    expect(made.find((e) => e.type === 'point' && e.ref)).toMatchObject({ x: 3, y: 4, ref: datum('pt1') });
    expect(referenceEntities({ entities: made }, ids, items)).toHaveProperty('error');
  });
});

describe('the commands: only reference geometry before the sketch, of a kind the entity can follow', () => {
  const add = (doc: PartDoc, entities: SketchEntity[]) => applyCommand(doc, { type: 'addSketchItems', featureId: 's1', entities, constraints: [] });
  const base = () => build(...datums(10), sketch('s1', front));

  it('takes an earlier plane, axis or point, a default plane and an axis of the part', () => {
    expect(() => add(base(), [...line('A', datum('pl1')), ...line('B', datum('ax1')), ...line('C', top), ...line('D', datum('axis:y')), { id: 'P', type: 'point', x: 0, y: 0, ref: datum('pt1') }, { id: 'Q', type: 'point', x: 0, y: 0, ref: datum('ax1') }])).not.toThrow();
  });

  it('refuses a datum after the sketch, one that is not there, a line following a point and a point following a plane', () => {
    const later = applyCommand(base(), { type: 'insertFeature', index: 4, feature: { id: 'pl2', type: 'refPlane', name: '基準面2', suppressed: false, def: { mode: 'offset', plane: top, distance: '5' } } as Feature });
    expect(() => add(later, line('A', datum('pl2')))).toThrow(/pl2/);
    expect(() => add(base(), line('A', datum('nope')))).toThrow(/nope/);
    expect(() => add(base(), line('A', datum('pt1')))).toThrow(/pt1/);
    expect(() => add(base(), [{ id: 'P', type: 'point', x: 0, y: 0, ref: datum('pl1') }])).toThrow(/pl1/);
    expect(() => add(base(), [{ id: 'c', type: 'point', x: 0, y: 0 }, { id: 'C', type: 'circle', center: 'c', radius: 1, ref: datum('pl1') }])).toThrow();
  });
});

describe('the parents of a sketch in the history (DAG)', () => {
  it('are its plane and what its entities follow: reference geometry, and the feature that made a model edge it projects', () => {
    const doc = build(
      sketch('s0', front, rectangle('r', 0, 0, 40, 30)),
      extrude('e1', 's0', 'boss', { type: 'blind', depth: '10' }),
      ...datums(10),
      sketch('s1', top, {
        entities: [...line('L', datum('ax1')), { id: 'P', type: 'point', x: 0, y: 0, ref: datum('pt1') }, ...line('M', { kind: 'edge', name: '{e1:side:s0.rl0|e1:cap:end}' }).map((e) => (e.type === 'line' ? { ...e, construction: false } : e))],
        constraints: [],
      } as never),
    );
    const s1 = doc.features.find((f) => f.id === 's1') as SketchFeature;
    const parents = parentsOf(s1, doc);
    expect(parents).toEqual(expect.arrayContaining(['ax1', 'pt1', 'e1']));
  });
});
