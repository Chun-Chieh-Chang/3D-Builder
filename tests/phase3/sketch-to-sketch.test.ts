/**
 * A sketch that follows entities of an earlier sketch (G6, ADR 0175). Truth by hand: s1 on the front plane (z = 0, its coordinates the part's x and y);
 * a parallel plane 20 in front of it sees s1 as it is; the right plane (x = 0) sees s1's y as its own vertical and s1's x not at all, so a line along x
 * is refused there and passes through it where x = 0.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, IdAllocator, type Feature, type PartDoc, type Ref, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { referenceEntities } from '@3db/sketch/ops';
import { Kernel } from '@3db/kernel';
import { modelSnapItems, parentsOf, Regenerator, sketchEntityRefs, sketchItem, sketchPierces, NO_NAMES, NO_TOPOLOGY, type RebuildResult, type ReferenceScope } from '@3db/regen';
import { build, circle, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
const regen = () => new Regenerator(kernel, solver, new Map());
const right: Ref = { kind: 'datum', name: 'plane:right' };
const ahead = (d: number): Feature => ({ id: 'pl', type: 'refPlane', name: '基準面1', suppressed: false, def: { mode: 'offset', plane: front, distance: String(d) } }) as Feature;
const ref = (name: string): Ref => ({ kind: 'sketch', name });
/** s1: a 40 × 20 rectangle from the origin (corners ap0 … ap3, sides al0 bottom … al3), a circle R10 at (60, 0), an arc of R5 about (0, 40) from (5, 40) to (0, 45). */
const s1 = (w = 40): Feature =>
  sketch('s1', front, rectangle('a', 0, 0, w, 20), circle('c', 60, 0, 10), {
    entities: [
      { id: 'o', type: 'point', x: 0, y: 40 },
      { id: 's', type: 'point', x: 5, y: 40 },
      { id: 'e', type: 'point', x: 0, y: 45 },
      { id: 'A', type: 'arc', center: 'o', start: 's', end: 'e' },
    ],
    constraints: [
      { id: 'fo', type: 'fix', point: 'o' },
      { id: 'fs', type: 'fix', point: 's' },
      // the end on the circle (the arc says so) and plumb above the center: (0, 45). Fixing it too would over-define the arc
      { id: 've', type: 'vertical', a: 'o', b: 'e' },
    ],
  } as never);

/** What sketch `s` sees of the sketches before it (no model at all: only sketches and a plane). */
function scopeOf(r: RebuildResult, s: string): ReferenceScope {
  return { names: NO_NAMES, topology: NO_TOPOLOGY, frame: r.frames.get(s)!, sketches: (id) => { const x = r.sketches.get(id); return x && { frame: x.frame, geometry: x.solved.geometry }; } };
}
const near = (p: [number, number], x: number, y: number) => Math.hypot(p[0] - x, p[1] - y) < 1e-9;

describe('an earlier sketch seen from a parallel plane (20 in front)', () => {
  const r = () => regen().rebuild(build(s1(), ahead(20), sketch('s2', { kind: 'datum', name: 'pl' })));

  it('points, lines and circles are where s1 has them; an arc keeps its sweep', () => {
    const res = r();
    expect(statuses(res).every((x) => x.endsWith('=ok'))).toBe(true);
    const sc = scopeOf(res, 's2');
    expect(sketchItem(sc, ref('s1:ap2'))).toEqual({ point: [expect.closeTo(40, 9), expect.closeTo(20, 9)] });
    const bottom = sketchItem(sc, ref('s1:al0'));
    expect('projected' in bottom && bottom.projected.kind === 'line' && near(bottom.projected.a, 0, 0) && near(bottom.projected.b, 40, 0)).toBe(true);
    const c = sketchItem(sc, ref('s1:c'));
    expect('projected' in c && c.projected.kind === 'circle' && near(c.projected.c, 60, 0) && Math.abs(c.projected.r - 10) < 1e-9).toBe(true);
    const a = sketchItem(sc, ref('s1:A'));
    expect('projected' in a && a.projected.kind === 'arc' && near(a.projected.start, 5, 40) && near(a.projected.end, 0, 45)).toBe(true);
  });

  it('seen from the other side (a plane through the y axis turned 180°, facing −z) an arc runs the other way: its ends swap, the same quarter circle', () => {
    // an offset plane's 「反轉方向」 only moves it the other way; this one faces the other way
    const yAxis: Feature = { id: 'ax', type: 'refAxis', name: '基準軸1', suppressed: false, def: { mode: 'planes', plane: front, plane2: right } } as Feature;
    const back: Feature = { id: 'pl', type: 'refPlane', name: '基準面1', suppressed: false, def: { mode: 'angle', plane: front, axis: { kind: 'datum', name: 'ax' }, angle: '180' } } as Feature;
    const res = regen().rebuild(build(s1(), yAxis, back, sketch('s2', { kind: 'datum', name: 'pl' })));
    expect(res.frames.get('pl')!.normal[2]).toBeCloseTo(-1, 9);
    const sc = scopeOf(res, 's2');
    const f = sc.frame;
    const a = sketchItem(sc, ref('s1:A'));
    if (!('projected' in a) || a.projected.kind !== 'arc') throw new Error('arc expected');
    // back in the part's coordinates the start is (0, 45) and the end (5, 40): the same arc, counter-clockwise on this plane
    const world = (p: [number, number]) => [f.origin[0] + f.xDir[0] * p[0] + f.yDir[0] * p[1], f.origin[1] + f.xDir[1] * p[0] + f.yDir[1] * p[1]];
    expect(world(a.projected.start).map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, 45]);
    expect(world(a.projected.end).map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([5, 40]);
  });

  it('a sketch that follows s1 needs no solid, and goes with it when s1 is made wider (40 → 55)', () => {
    const follow = (w: number) => {
      const entities: SketchEntity[] = [
        { id: 'q', type: 'point', x: 0, y: 0, ref: ref('s1:ap2') },
        { id: 'l1', type: 'point', x: 0, y: 0 },
        { id: 'l2', type: 'point', x: 1, y: 0 },
        { id: 'L', type: 'line', p1: 'l1', p2: 'l2', construction: true, ref: ref('s1:al1') },
      ];
      const res = regen().rebuild(build(s1(w), ahead(20), sketch('s2', { kind: 'datum', name: 'pl' }, { entities, constraints: [] } as never)));
      expect(statuses(res)).toEqual(['s1=ok', 'pl=ok', 's2=ok']);
      const g = res.sketches.get('s2')!.solved.geometry;
      const q = g.get('q');
      const L = g.get('L');
      return { q: q?.type === 'point' ? q.p : null, L: L?.type === 'line' ? [L.a, L.b] : null };
    };
    expect(near(follow(40).q!, 40, 20)).toBe(true);
    const wide = follow(55);
    expect(near(wide.q!, 55, 20)).toBe(true);
    expect(wide.L!.every((p) => Math.abs(p[0] - 55) < 1e-9)).toBe(true); // the right side al1 at x = 55
  });
});

describe('an earlier sketch seen from a plane square to it (the right plane, x = 0)', () => {
  const r = () => regen().rebuild(build(s1(), sketch('s2', right)));

  it('a line along x looks like a point there and is refused; a line along y is a line; a circle is refused (tilted)', () => {
    const sc = scopeOf(r(), 's2');
    expect(() => sketchItem(sc, ref('s1:al0'))).toThrow();
    const left = sketchItem(sc, ref('s1:al3'));
    expect('projected' in left && left.projected.kind === 'line').toBe(true);
    expect(() => sketchItem(sc, ref('s1:c'))).toThrow();
  });

  it('pierce: the bottom (y = 0, along x) passes through the plane at the origin; the top (y = 20) at height 20; the circle about (60, 0) does not reach x = 0', () => {
    const sc = scopeOf(r(), 's2');
    const f = sc.frame;
    const world = (p: [number, number]) => [0, 1, 2].map((k) => f.origin[k]! + f.xDir[k]! * p[0] + f.yDir[k]! * p[1]);
    const bottom = sketchPierces(sc, ref('s1:al0'));
    expect(bottom).toHaveLength(1);
    expect(world(bottom[0]!).map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, 0, 0]);
    expect(world(sketchPierces(sc, ref('s1:al2'))[0]!).map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, 20, 0]);
    expect(() => sketchPierces(sc, ref('s1:c'))).toThrow();
    expect(() => sketchPierces(sc, ref('s1:al1'))).toThrow(); // parallel to the plane
  });

  it('pierce of a circle through the plane: a circle R10 at the origin crosses x = 0 at y = ±10', () => {
    const res = regen().rebuild(build(sketch('s1', front, circle('k', 0, 0, 10)), sketch('s2', right)));
    const sc = scopeOf(res, 's2');
    const f = sc.frame;
    const ys = sketchPierces(sc, ref('s1:k')).map((p) => Math.round((f.origin[1] + f.xDir[1] * p[0] + f.yDir[1] * p[1]) * 1e9) / 1e9).sort((a, b) => a - b);
    expect(ys).toEqual([-10, 10]);
  });
});

describe('what refers to what', () => {
  const base = () => build(s1(), sketch('s2', front));

  it('the commands take an entity of an earlier sketch of the right kind, and refuse a later sketch, a missing entity and the wrong kind', () => {
    const add = (doc: PartDoc, id: string, entities: SketchEntity[]) => applyCommand(doc, { type: 'addSketchItems', featureId: id, entities, constraints: [] });
    const line = (name: string): SketchEntity[] => [{ id: 'x1', type: 'point', x: 0, y: 0 }, { id: 'x2', type: 'point', x: 1, y: 0 }, { id: 'X', type: 'line', p1: 'x1', p2: 'x2', construction: true, ref: ref(name) }];
    expect(() => add(base(), 's2', [...line('s1:al0'), { id: 'P', type: 'point', x: 0, y: 0, ref: ref('s1:ap1') }, { id: 'Q', type: 'point', x: 0, y: 0, pierce: ref('s1:c') }])).not.toThrow();
    expect(() => add(base(), 's1', line('s2:x'))).toThrow(); // s2 is later than s1
    expect(() => add(base(), 's2', line('s1:nothing'))).toThrow();
    expect(() => add(base(), 's2', line('s1:ap1'))).toThrow(); // a line cannot follow a point
    expect(() => add(base(), 's2', [{ id: 'P', type: 'point', x: 0, y: 0, ref: ref('s1:al0') }])).toThrow(); // a point a line: only as a pierce
  });

  it('the sketch is a child of the sketch it follows', () => {
    const doc = applyCommand(base(), { type: 'addSketchItems', featureId: 's2', entities: [{ id: 'P', type: 'point', x: 0, y: 0, ref: ref('s1:ap1') }], constraints: [] });
    expect(parentsOf(doc.features.find((f) => f.id === 's2')!, doc)).toContain('s1');
  });

  it('a whole sketch converted takes its curves and its free points, not the points its curves are built on', () => {
    const doc = build(s1(), sketch('s2', front));
    const s = doc.features.find((f) => f.id === 's1') as SketchFeature;
    const names = sketchEntityRefs(s).map((r) => r.name.split(':')[1]).sort();
    expect(names).toEqual(['A', 'al0', 'al1', 'al2', 'al3', 'c'].sort());
  });

  it('what it makes in the sketch is construction, and the same entity twice adds nothing', () => {
    const ids = new IdAllocator({}, []);
    const items = [{ ref: ref('s1:al0'), projected: { kind: 'line' as const, a: [0, 0] as [number, number], b: [40, 0] as [number, number] } }];
    const r = referenceEntities({ entities: [] }, ids, items);
    if ('error' in r) throw new Error(r.error);
    expect(r.edit.add!.entities!.find((e) => e.type === 'line')).toMatchObject({ construction: true, ref: ref('s1:al0') });
    expect(referenceEntities({ entities: r.edit.add!.entities! }, ids, items)).toHaveProperty('error');
  });

  it('snapping offers the entities of a sketch on show: its corners, its sides, and where its curves pass through the plane', () => {
    const res = regen().rebuild(build(s1(), sketch('s2', right)));
    const sc = scopeOf(res, 's2');
    const items = modelSnapItems(sc, () => undefined, [res.sketches.get('s1')!.sketch]);
    const names = items.map((i) => i.ref.name);
    expect(names).toContain('s1:al3'); // the left side, along y, seen as a line
    expect(items.some((i) => 'pierce' in i && i.ref.name === 's1:al0')).toBe(true); // the bottom passes through
    expect(names).not.toContain('s1:c'); // the circle is tilted to this plane and does not reach it
  });
});
