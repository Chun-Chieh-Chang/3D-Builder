import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, IdAllocator, idsInUse, resolveSketch, SKETCH_ORIGIN, type Command, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver, type SolvedSketch } from '../src/index';
import { chamfer, extend, fillet, mirror, offset, polygon, referenceEntities, slot, trim, type OpResult } from '../src/ops';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EMPTY: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 's1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};

const start = (entities: SketchEntity[] = [], constraints: SketchConstraint[] = []): PartDoc => {
  const doc = applyCommand(createEmptyPart(), EMPTY);
  return entities.length + constraints.length === 0 ? doc : applyCommand(doc, { type: 'addSketchItems', featureId: 's1', entities, constraints });
};
const sketchOf = (doc: PartDoc) => doc.features.find((f) => f.id === 's1') as SketchFeature;
const ids = (doc: PartDoc) => new IdAllocator(doc.idCounters, idsInUse(doc));
const solve = (doc: PartDoc, options = { analyze: true }): SolvedSketch => solver.solve(resolveSketch(sketchOf(doc), doc), options);
const run = (doc: PartDoc, r: OpResult): PartDoc => {
  if ('error' in r) throw new Error(r.error);
  return applyCommand(doc, { type: 'editSketch', featureId: 's1', ...r.edit });
};
const at = (s: SolvedSketch, id: string) => {
  const g = s.geometry.get(id);
  if (g?.type !== 'point') throw new Error(`no point ${id}`);
  return g.p.map((v) => Math.round(v * 1e6) / 1e6);
};
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const add = (doc: PartDoc, ...c: SketchConstraint[]) => applyCommand(doc, { type: 'addSketchItems', featureId: 's1', entities: [], constraints: c });

describe('slot (C1.8)', () => {
  it('draws a slot with the five freedoms of one: both centers and the width', () => {
    const doc = run(start(), slot(ids(start()), [0, 0], [30, 0], 5));
    const s = solve(doc);
    expect(s.status).toBe('under');
    expect(s.dof).toBe(5);
    expect(s.redundant).toEqual([]);
    expect(s.conflicting).toEqual([]);
    expect(findProfiles(sketchOf(doc), s).problems).toEqual([]);
    expect(findProfiles(sketchOf(doc), s).regions).toHaveLength(1);
  });

  it('is fully defined by the two centers and the radius, and has the outline of a slot', () => {
    let doc = run(start(), slot(ids(start()), [0, 0], [30, 0], 5));
    const [c1, c2] = sketchOf(doc).entities.filter((e) => e.type === 'point').slice(0, 2).map((e) => e.id);
    const arc = sketchOf(doc).entities.find((e) => e.type === 'arc')!.id;
    doc = add(doc,
      { id: 'k1', type: 'coincident', a: c1!, b: SKETCH_ORIGIN },
      { id: 'k2', type: 'horizontal', a: c1!, b: c2! },
      { id: 'k3', type: 'distance', a: c1!, b: c2!, value: '30' },
      { id: 'k4', type: 'radius', circle: arc, value: '5' },
    );
    const s = solve(doc);
    expect(s.status).toBe('fully');
    const region = findProfiles(sketchOf(doc), s).regions[0]!;
    expect(region.outer).toHaveLength(4);
    expect(region.outer.map((seg) => seg.kind).sort()).toEqual(['arc', 'arc', 'line', 'line']);
    const extent = region.outer.flatMap((seg) => (seg.kind === 'line' ? [seg.a, seg.b] : seg.kind === 'arc' ? [seg.from, seg.to] : []));
    expect(Math.max(...extent.map((p) => p[1]))).toBeCloseTo(5, 6);
    expect(Math.min(...extent.map((p) => p[1]))).toBeCloseTo(-5, 6);
  });

  it('works in any direction, and refuses what is not a slot', () => {
    const doc = run(start(), slot(ids(start()), [0, 0], [3, 4], 1));
    expect(solve(doc).status).toBe('under');
    expect(slot(ids(start()), [1, 1], [1, 1], 1)).toMatchObject({ error: expect.stringContaining('同一點') });
    expect(slot(ids(start()), [0, 0], [5, 0], 0)).toMatchObject({ error: expect.stringContaining('寬度') });
  });
});

describe('polygon (C1.9)', () => {
  it.each([3, 4, 5, 6, 8])('draws a regular %i-gon with four freedoms: center, size, turn', (n) => {
    const doc = run(start(), polygon(ids(start()), { p: [0, 0] }, [10, 0], n));
    const s = solve(doc);
    expect(s.redundant).toEqual([]);
    expect(s.conflicting).toEqual([]);
    expect(s.dof).toBe(4);
    const sides = sketchOf(doc).entities.filter((e) => e.type === 'line');
    expect(sides).toHaveLength(n);
    const lengths = sides.map((e) => {
      const g = s.geometry.get(e.id)!;
      return g.type === 'line' ? Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) : 0;
    });
    for (const l of lengths) expect(l).toBeCloseTo(2 * 10 * Math.sin(Math.PI / n), 5);
    expect(findProfiles(sketchOf(doc), s).regions).toHaveLength(1); // the construction circle is not part of the outline
  });

  it('takes the size from the middle of a side when asked: the corners lie on the circle through them', () => {
    const doc = run(start(), polygon(ids(start()), { p: [0, 0] }, [10, 0], 6, true));
    const s = solve(doc);
    const ring = s.geometry.get(sketchOf(doc).entities.find((e) => e.type === 'circle')!.id)!;
    expect(ring.type === 'circle' && ring.r).toBeCloseTo(10 / Math.cos(Math.PI / 6), 5);
    // the side's middle is where it was clicked
    const lines = sketchOf(doc).entities.filter((e) => e.type === 'line').map((e) => s.geometry.get(e.id)!);
    expect(lines.some((g) => g.type === 'line' && Math.hypot((g.a[0] + g.b[0]) / 2 - 10, (g.a[1] + g.b[1]) / 2) < 1e-6)).toBe(true);
  });

  it('is fully defined by its center, its size and one side being horizontal; and refuses a polygon that is not one', () => {
    let doc = run(start(), polygon(ids(start()), { p: [0, 0] }, [10, 0], 6));
    const ring = sketchOf(doc).entities.find((e) => e.type === 'circle')!;
    const centre = (ring as Extract<SketchEntity, { type: 'circle' }>).center;
    const side = sketchOf(doc).entities.find((e) => e.type === 'line')!;
    doc = add(doc, { id: 'k1', type: 'coincident', a: centre, b: SKETCH_ORIGIN }, { id: 'k2', type: 'diameter', circle: ring.id, value: '20' }, { id: 'k3', type: 'horizontal', a: side.id });
    expect(solve(doc).status).toBe('fully');
    expect(polygon(ids(start()), { p: [0, 0] }, [1, 0], 2)).toMatchObject({ error: expect.stringContaining('邊數') });
    expect(polygon(ids(start()), { p: [0, 0] }, [0, 0], 5)).toMatchObject({ error: expect.stringContaining('大小') });
  });
});

describe('mirror (C1.19)', () => {
  /** A vertical center line at x = 0 and a triangle with a corner on it, and a circle, to its left. */
  const base = () =>
    start(
      [
        point('a0', 0, -10), point('a1', 0, 10), { id: 'axis', type: 'line', p1: 'a0', p2: 'a1', construction: true },
        point('t0', -5, -4), point('t1', -15, -4), point('t2', -5, 8),
        { id: 'tl0', type: 'line', p1: 't0', p2: 't1' }, { id: 'tl1', type: 'line', p1: 't1', p2: 't2' }, { id: 'tl2', type: 'line', p1: 't2', p2: 't0' },
        point('cc', -10, 2), { id: 'cir', type: 'circle', center: 'cc', radius: 2 },
        point('ac', -8, -8), point('as', -4, -8), point('ae', -8, -4), { id: 'arc', type: 'arc', center: 'ac', start: 'as', end: 'ae' },
      ],
      [{ id: 'v', type: 'vertical', a: 'axis' }, { id: 'f0', type: 'coincident', a: 'a0', b: SKETCH_ORIGIN }],
    );

  it('copies lines, a circle and an arc to the other side, each held by symmetry, an arc running the other way round', () => {
    const doc0 = base();
    const geometry = solve(doc0).geometry;
    const doc = run(doc0, mirror(sketchOf(doc0), geometry, ids(doc0), ['tl0', 'tl1', 'tl2', 'cir', 'arc'], 'axis'));
    const s = solve(doc);
    expect(s.conflicting).toEqual([]);
    expect(s.redundant).toEqual([]);
    const sk = sketchOf(doc);
    expect(sk.entities.filter((e) => e.type === 'line')).toHaveLength(7); // the axis, 3 + 3
    const twin = (id: string) => sk.constraints.find((c) => c.type === 'symmetric' && c.a === id) as Extract<SketchConstraint, { type: 'symmetric' }>;
    for (const p of ['t0', 't1', 't2', 'cc', 'ac', 'as', 'ae']) {
      const m = at(s, twin(p).b);
      const o = at(s, p);
      expect(m[0]).toBeCloseTo(-o[0]!, 5);
      expect(m[1]).toBeCloseTo(o[1]!, 5);
    }
    const arcs = sk.entities.filter((e) => e.type === 'arc');
    expect(arcs).toHaveLength(2);
    const [orig, copy] = arcs.map((e) => s.geometry.get(e.id)!) as Extract<ReturnType<typeof s.geometry.get>, { type: 'arc' }>[];
    expect(copy!.r).toBeCloseTo(orig!.r, 5);
    // the mirror of the arc's middle is the middle of the mirrored arc
    const midAngle = (a: { a0: number; a1: number }) => a.a0 + ((a.a1 - a.a0 + 2 * Math.PI) % (2 * Math.PI)) / 2;
    const m0 = [orig!.c[0] + orig!.r * Math.cos(midAngle(orig!)), orig!.c[1] + orig!.r * Math.sin(midAngle(orig!))];
    const m1 = [copy!.c[0] + copy!.r * Math.cos(midAngle(copy!)), copy!.c[1] + copy!.r * Math.sin(midAngle(copy!))];
    expect(m1[0]).toBeCloseTo(-m0[0]!, 5);
    expect(m1[1]).toBeCloseTo(m0[1]!, 5);
    expect(findProfiles(sk, s).problems.length).toBeGreaterThanOrEqual(0);
  });

  it('follows the originals: a corner dragged, its twin moves the opposite way', () => {
    const doc0 = base();
    const doc = run(doc0, mirror(sketchOf(doc0), solve(doc0).geometry, ids(doc0), ['tl0', 'tl1', 'tl2'], 'axis'));
    const sk = sketchOf(doc);
    const twin = (sk.constraints.find((c) => c.type === 'symmetric' && c.a === 't2') as Extract<SketchConstraint, { type: 'symmetric' }>).b;
    const s = solver.solve(sk, { drag: { points: [{ id: 't2', x: -7, y: 12 }] } });
    expect(at(s, twin)[0]).toBeCloseTo(-at(s, 't2')[0]!, 5);
    expect(at(s, twin)[1]).toBeCloseTo(at(s, 't2')[1]!, 5);
  });

  it('keeps a point on the axis as its own twin, and does not copy a line that lies on it', () => {
    const doc0 = start(
      [point('a0', 0, -10), point('a1', 0, 10), { id: 'axis', type: 'line', p1: 'a0', p2: 'a1' }, point('p', 0, 3), point('q', -6, 3), { id: 'l', type: 'line', p1: 'p', p2: 'q' }],
      [{ id: 'v', type: 'vertical', a: 'axis' }, { id: 'f', type: 'coincident', a: 'a0', b: SKETCH_ORIGIN }],
    );
    const doc = run(doc0, mirror(sketchOf(doc0), solve(doc0).geometry, ids(doc0), ['l'], 'axis'));
    const sk = sketchOf(doc);
    const copy = sk.entities.filter((e) => e.type === 'line' && e.id !== 'l' && e.id !== 'axis')[0] as Extract<SketchEntity, { type: 'line' }>;
    expect(copy.p1).toBe('p'); // the end on the axis is shared, not copied
    expect(sk.constraints.filter((c) => c.type === 'symmetric')).toHaveLength(1);
    expect(mirror(sketchOf(doc0), solve(doc0).geometry, ids(doc0), ['axis'], 'axis')).toMatchObject({ error: expect.any(String) });
    expect(mirror(sketchOf(doc0), solve(doc0).geometry, ids(doc0), [], 'axis')).toMatchObject({ error: expect.stringContaining('選取') });
    expect(mirror(sketchOf(doc0), solve(doc0).geometry, ids(doc0), ['l'], 'p')).toMatchObject({ error: expect.stringContaining('直線') });
  });
});

describe('fillet and chamfer (C1.15)', () => {
  /** An L: from the origin 20 along x and 20 along y, fully defined, the corner at the origin. */
  const corner = () =>
    start(
      [point('p', 0, 0), point('qa', 20, 0), point('qb', 0, 20), { id: 'A', type: 'line', p1: 'p', p2: 'qa' }, { id: 'B', type: 'line', p1: 'p', p2: 'qb' }],
      [
        { id: 'c0', type: 'coincident', a: 'p', b: SKETCH_ORIGIN },
        { id: 'c1', type: 'horizontal', a: 'A' },
        { id: 'c2', type: 'vertical', a: 'B' },
        { id: 'd1', type: 'distance', a: 'A', value: '20' },
        { id: 'd2', type: 'distance', a: 'B', value: '20' },
      ],
    );

  it('rounds the corner: the lines end where the arc touches them, the corner stays, the sketch stays fully defined', () => {
    const doc0 = corner();
    expect(solve(doc0).status).toBe('fully');
    const doc = run(doc0, fillet(sketchOf(doc0), solve(doc0).geometry, ids(doc0), 'A', 'B', 5));
    const s = solve(doc);
    expect(s.status).toBe('fully');
    expect(s.redundant).toEqual([]);
    const sk = sketchOf(doc);
    const arc = sk.entities.find((e) => e.type === 'arc') as Extract<SketchEntity, { type: 'arc' }>;
    const g = s.geometry.get(arc.id)!;
    expect(g.type === 'arc' && g.c.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([5, 5]);
    expect(g.type === 'arc' && g.r).toBeCloseTo(5, 6);
    expect([at(s, arc.start), at(s, arc.end)].sort()).toEqual([[0, 5], [5, 0]]);
    expect(at(s, 'p')).toEqual([0, 0]); // the virtual sharp
    // the two lines now end at the arc: A from the far end to (5, 0), B to (0, 5)
    const A = sk.entities.find((e) => e.id === 'A') as Extract<SketchEntity, { type: 'line' }>;
    expect(at(s, A.p1)).toEqual([5, 0]);
    // length dimensions go on measuring to the corner
    expect(sk.constraints.find((c) => c.id === 'd1')).toMatchObject({ type: 'distance', a: 'qa', b: 'p' });
    expect(findProfiles(sk, s).problems).toHaveLength(2); // an open L (two free ends): the round did not close anything
  });

  it('closes into a profile when the lines were part of one: a rectangle with one corner rounded', () => {
    const rect = start(
      [point('p0', 0, 0), point('p1', 30, 0), point('p2', 30, 20), point('p3', 0, 20),
        { id: 'l0', type: 'line', p1: 'p0', p2: 'p1' }, { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'l3', type: 'line', p1: 'p3', p2: 'p0' }],
      [{ id: 'h0', type: 'horizontal', a: 'l0' }, { id: 'v1', type: 'vertical', a: 'l1' }, { id: 'h2', type: 'horizontal', a: 'l2' }, { id: 'v3', type: 'vertical', a: 'l3' },
        { id: 'c', type: 'coincident', a: 'p0', b: SKETCH_ORIGIN }, { id: 'w', type: 'distance', a: 'l0', value: '30' }, { id: 'h', type: 'distance', a: 'l1', value: '20' }],
    );
    expect(solve(rect).status).toBe('fully');
    const doc = run(rect, fillet(sketchOf(rect), solve(rect).geometry, ids(rect), 'l0', 'l1', 6));
    const s = solve(doc);
    expect(s.status).toBe('fully');
    const profile = findProfiles(sketchOf(doc), s);
    expect(profile.problems).toEqual([]);
    expect(profile.regions).toHaveLength(1);
    expect(profile.regions[0]!.outer).toHaveLength(5);
  });

  it('chamfers the corner with two distances from it', () => {
    const doc0 = corner();
    const doc = run(doc0, chamfer(sketchOf(doc0), solve(doc0).geometry, ids(doc0), 'A', 'B', 4, 6));
    const s = solve(doc);
    expect(s.status).toBe('fully');
    expect(s.redundant).toEqual([]);
    const sk = sketchOf(doc);
    const cut = sk.entities.filter((e) => e.type === 'line').find((e) => e.id !== 'A' && e.id !== 'B') as Extract<SketchEntity, { type: 'line' }>;
    expect([at(s, cut.p1), at(s, cut.p2)].sort()).toEqual([[0, 6], [4, 0]]);
  });

  it('refuses a round or chamfer that does not fit, lines that do not meet and lines on one line', () => {
    const doc = corner();
    const geometry = solve(doc).geometry;
    expect(fillet(sketchOf(doc), geometry, ids(doc), 'A', 'B', 30)).toMatchObject({ error: expect.stringContaining('太大') });
    expect(chamfer(sketchOf(doc), geometry, ids(doc), 'A', 'B', 25, 5)).toMatchObject({ error: expect.stringContaining('太大') });
    expect(fillet(sketchOf(doc), geometry, ids(doc), 'A', 'A', 5)).toMatchObject({ error: expect.stringContaining('兩條不同') });
    expect(fillet(sketchOf(doc), geometry, ids(doc), 'A', 'B', 0)).toMatchObject({ error: expect.stringContaining('大於 0') });
    const apart = start([point('a', 0, 0), point('b', 10, 0), point('c', 20, 5), point('d', 30, 5), { id: 'L', type: 'line', p1: 'a', p2: 'b' }, { id: 'M', type: 'line', p1: 'c', p2: 'd' }]);
    expect(fillet(sketchOf(apart), solve(apart).geometry, ids(apart), 'L', 'M', 1)).toMatchObject({ error: expect.stringContaining('共用') });
    const straight = start([point('a', 0, 0), point('b', 10, 0), point('c', 20, 0), { id: 'L', type: 'line', p1: 'a', p2: 'b' }, { id: 'M', type: 'line', p1: 'b', p2: 'c' }]);
    expect(fillet(sketchOf(straight), solve(straight).geometry, ids(straight), 'L', 'M', 1)).toMatchObject({ error: expect.stringContaining('同一條線') });
  });
});

const line = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
const lineOf = (s: SolvedSketch, id: string) => {
  const g = s.geometry.get(id);
  if (g?.type !== 'line') throw new Error(`no line ${id}`);
  return g;
};
const everyRefExists = (doc: PartDoc) => {
  const sk = sketchOf(doc);
  const known = new Set<string>([SKETCH_ORIGIN, ...sk.entities.map((e) => e.id)]);
  for (const k of sk.constraints) {
    for (const [field, v] of Object.entries(k)) if (['a', 'b', 'point', 'line', 'curve', 'axis', 'circle'].includes(field) && v !== undefined) expect(known.has(v as string), `${k.id}.${field} -> ${String(v)}`).toBe(true);
  }
};

describe('trim (C1.16)', () => {
  /** A horizontal line from -10 to 10 on the x axis, crossed by verticals at the given x. */
  const crossed = (...xs: number[]) =>
    start(
      [
        point('h0', -10, 0), point('h1', 10, 0), line('H', 'h0', 'h1'),
        ...xs.flatMap((x, i) => [point(`a${i}`, x, -5), point(`b${i}`, x, 5), line(`V${i}`, `a${i}`, `b${i}`)]),
      ],
      [{ id: 'hz', type: 'horizontal', a: 'H' }, { id: 'len', type: 'distance', a: 'H', value: '20' }, ...xs.map((_, i): SketchConstraint => ({ id: `vv${i}`, type: 'vertical', a: `V${i}` }))],
    );

  it('cuts back to the crossing: the end under the click goes, the new end lies on the cutting line, the length dimension goes with it', () => {
    const doc0 = crossed(0);
    const doc = run(doc0, trim(sketchOf(doc0), solve(doc0).geometry, ids(doc0), 'H', [5, 0]));
    const sk = sketchOf(doc);
    expect(sk.entities.some((e) => e.id === 'h1')).toBe(false); // the old end
    expect(sk.constraints.some((k) => k.id === 'len')).toBe(false);
    everyRefExists(doc);
    const s = solve(doc);
    const h = lineOf(s, 'H');
    expect(h.a.map(Math.round)).toEqual([-10, 0]);
    expect(Math.abs(h.b[0])).toBeLessThan(1e-6);
    expect(s.conflicting).toEqual([]);
  });

  it('cuts out a middle stretch: two lines, the second one horizontal too, and one undo step brings it all back', () => {
    const doc0 = crossed(-3, 4);
    const doc = run(doc0, trim(sketchOf(doc0), solve(doc0).geometry, ids(doc0), 'H', [0, 0]));
    const sk = sketchOf(doc);
    const [first, second] = [sk.entities.find((e) => e.id === 'H')!, sk.entities.find((e) => e.type === 'line' && !['H', 'V0', 'V1'].includes(e.id))!] as Extract<SketchEntity, { type: 'line' }>[];
    expect(second!.p2).toBe('h1');
    expect(sk.constraints.filter((k) => k.type === 'horizontal').map((k) => (k as { a: string }).a).sort()).toEqual([second!.id, 'H'].sort());
    everyRefExists(doc);
    const s = solve(doc);
    expect(lineOf(s, 'H').b[0]).toBeCloseTo(-3, 6);
    expect(lineOf(s, second!.id).a[0]).toBeCloseTo(4, 6);
    expect(lineOf(s, second!.id).b[0]).toBeCloseTo(10, 6);
    expect(first!.p1).toBe('h0');
    expect(s.conflicting).toEqual([]);
    expect(s.redundant).toEqual([]);
  });

  it('deletes a curve that crosses nothing, with the ends nothing else uses', () => {
    const doc0 = start([point('a', 0, 0), point('b', 5, 0), line('L', 'a', 'b')]);
    const doc = run(doc0, trim(sketchOf(doc0), solve(doc0).geometry, ids(doc0), 'L', [2, 0]));
    expect(sketchOf(doc).entities).toEqual([]);
  });

  it('turns a circle cut by a line into the arc that is left, keeping its dimension', () => {
    const doc0 = start(
      [point('c', 0, 0), { id: 'C', type: 'circle', center: 'c', radius: 5 }, point('a', -10, 0), point('b', 10, 0), line('L', 'a', 'b')],
      [{ id: 'r', type: 'radius', circle: 'C', value: '5' }, { id: 'f', type: 'coincident', a: 'c', b: SKETCH_ORIGIN }],
    );
    const doc = run(doc0, trim(sketchOf(doc0), solve(doc0).geometry, ids(doc0), 'C', [0, 5]));
    const sk = sketchOf(doc);
    expect(sk.entities.some((e) => e.id === 'C')).toBe(false);
    const arc = sk.entities.find((e) => e.type === 'arc')!;
    expect(sk.constraints.find((k) => k.id === 'r')).toMatchObject({ circle: arc.id });
    everyRefExists(doc);
    const s = solve(doc);
    const g = s.geometry.get(arc.id)!;
    expect(g.type).toBe('arc');
    if (g.type === 'arc') {
      expect(g.r).toBeCloseTo(5, 6);
      const m = g.a0 + ((g.a1 - g.a0 + 2 * Math.PI) % (2 * Math.PI)) / 2;
      expect(Math.sin(m)).toBeCloseTo(-1, 6); // what is left is the bottom half
    }
    expect(s.conflicting).toEqual([]);
  });

  it('shortens an arc at its crossing', () => {
    const doc0 = start(
      [point('c', 0, 0), point('s', 5, 0), point('e', -5, 0), { id: 'A', type: 'arc', center: 'c', start: 's', end: 'e' }, point('a', 0, -9), point('b', 0, 9), line('V', 'a', 'b')],
      [{ id: 'f', type: 'coincident', a: 'c', b: SKETCH_ORIGIN }],
    );
    const doc = run(doc0, trim(sketchOf(doc0), solve(doc0).geometry, ids(doc0), 'A', [4, 3]));
    const g = solve(doc).geometry.get('A')!;
    expect(g.type === 'arc' && Math.round(((g.a0 * 180) / Math.PI) * 1e4) / 1e4).toBe(90);
    everyRefExists(doc);
  });

  it('refuses what is not a line, an arc or a circle', () => {
    const doc = start([point('p', 1, 1)]);
    expect(trim(sketchOf(doc), solve(doc).geometry, ids(doc), 'p', [1, 1])).toMatchObject({ error: expect.stringContaining('修剪') });
  });
});

describe('extend (C1.16)', () => {
  const wall = () => [point('w0', 10, -5), point('w1', 10, 5), line('W', 'w0', 'w1')];

  it('lengthens the end nearest the click to the first curve in the way', () => {
    const doc0 = start([point('a', 0, 0), point('b', 5, 0), line('L', 'a', 'b'), ...wall()], [{ id: 'h', type: 'horizontal', a: 'L' }, { id: 'len', type: 'distance', a: 'L', value: '5' }]);
    const doc = run(doc0, extend(sketchOf(doc0), solve(doc0).geometry, ids(doc0), 'L', [4.5, 0]));
    everyRefExists(doc);
    expect(sketchOf(doc).constraints.some((k) => k.id === 'len')).toBe(false);
    const s = solve(doc);
    expect(lineOf(s, 'L').b.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 0]);
    expect(lineOf(s, 'L').a).toEqual([0, 0]);
    expect(s.conflicting).toEqual([]);
  });

  it('lengthens the start the other way, and an arc along its circle', () => {
    const doc0 = start([point('a', 0, 0), point('b', 5, 0), line('L', 'a', 'b'), point('w0', -4, -5), point('w1', -4, 5), line('W', 'w0', 'w1')]);
    const doc = run(doc0, extend(sketchOf(doc0), solve(doc0).geometry, ids(doc0), 'L', [0.2, 0]));
    expect(lineOf(solve(doc), 'L').a[0]).toBeCloseTo(-4, 6);

    const arcs = start(
      [point('c', 0, 0), point('s', 5, 0), point('e', 0, 5), { id: 'A', type: 'arc', center: 'c', start: 's', end: 'e' }, point('w0', -3, -9), point('w1', -3, 9), line('W', 'w0', 'w1')],
      [{ id: 'f', type: 'coincident', a: 'c', b: SKETCH_ORIGIN }],
    );
    const out = run(arcs, extend(sketchOf(arcs), solve(arcs).geometry, ids(arcs), 'A', [0, 5.2]));
    const g = solve(out).geometry.get('A')!;
    expect(g.type === 'arc' && Math.round(((g.a1 - 0) * 180) / Math.PI * 1e3) / 1e3).toBeCloseTo((Math.atan2(4, -3) * 180) / Math.PI, 3);
    everyRefExists(out);
  });

  it('says so when nothing is in the way, and continues from a shared end without moving its neighbor', () => {
    const lone = start([point('a', 0, 0), point('b', 5, 0), line('L', 'a', 'b')]);
    expect(extend(sketchOf(lone), solve(lone).geometry, ids(lone), 'L', [5, 0])).toMatchObject({ error: expect.stringContaining('沒有可以延伸') });
    const joined = start([point('a', 0, 0), point('b', 5, 0), point('c', 5, 5), line('L', 'a', 'b'), line('M', 'b', 'c'), ...wall()]);
    const continued = run(joined, extend(sketchOf(joined), solve(joined).geometry, ids(joined), 'L', [5, 0]));
    everyRefExists(continued);
    expect(lineOf(solve(continued), 'L').b).toEqual([5, 0]);
    expect(lineOf(solve(continued), 'M').a).toEqual([5, 0]);
    const extra = sketchOf(continued).entities.find(e => e.type === 'line' && !sketchOf(joined).entities.some(old => old.id === e.id))!;
    expect(lineOf(solve(continued), extra.id).b).toEqual([10, 0]);
  });
});

describe('offset (C1.17)', () => {
  const rectangle = () =>
    start(
      [point('p0', 0, 0), point('p1', 30, 0), point('p2', 30, 20), point('p3', 0, 20), line('l0', 'p0', 'p1'), line('l1', 'p1', 'p2'), line('l2', 'p2', 'p3'), line('l3', 'p3', 'p0')],
      [{ id: 'h0', type: 'horizontal', a: 'l0' }, { id: 'v1', type: 'vertical', a: 'l1' }, { id: 'h2', type: 'horizontal', a: 'l2' }, { id: 'v3', type: 'vertical', a: 'l3' },
        { id: 'c', type: 'coincident', a: 'p0', b: SKETCH_ORIGIN }, { id: 'w', type: 'distance', a: 'l0', value: '30' }, { id: 'h', type: 'distance', a: 'l1', value: '20' }],
    );
  const copies = (doc: PartDoc, before: string[]) => sketchOf(doc).entities.filter((e) => e.type === 'line' && !before.includes(e.id)).map((e) => e.id);
  const original = ['l0', 'l1', 'l2', 'l3'];

  it('offsets a closed outline inward as one chain: a smaller rectangle, fully defined, one dimension drives all four sides', () => {
    const doc0 = rectangle();
    const doc = run(doc0, offset(sketchOf(doc0), solve(doc0).geometry, ids(doc0), original, 2, [15, 10]));
    everyRefExists(doc);
    const s = solve(doc);
    expect(s.status).toBe('fully');
    expect(s.redundant).toEqual([]);
    const inner = copies(doc, original);
    expect(inner).toHaveLength(4);
    const xs = inner.flatMap((id) => [lineOf(s, id).a[0], lineOf(s, id).b[0]]);
    const ys = inner.flatMap((id) => [lineOf(s, id).a[1], lineOf(s, id).b[1]]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([2, 28, 2, 18]);
    // the first dimension is the only number: the others name it
    const dims = sketchOf(doc).constraints.filter((k) => k.type === 'distance' && k.b !== undefined) as Extract<SketchConstraint, { type: 'distance' }>[];
    expect(dims).toHaveLength(4);
    expect(dims.filter((k) => /^[\d.]+$/.test(k.value))).toHaveLength(1);
    const widened = { ...sketchOf(doc), constraints: sketchOf(doc).constraints.map((k) => (k.type === 'distance' && k.b !== undefined && /^[\d.]+$/.test(k.value) ? { ...k, value: '3' } : k)) } as SketchFeature;
    const after = solve({ ...doc, features: doc.features.map((f) => (f.id === 's1' ? widened : f)) });
    const wx = inner.flatMap((id) => [lineOf(after, id).a[0], lineOf(after, id).b[0]]);
    expect([Math.min(...wx), Math.max(...wx)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([3, 27]);
    expect(findProfiles(sketchOf(doc), s).regions).toHaveLength(1);
  });

  it('offsets outward when the click is outside', () => {
    const doc0 = rectangle();
    const doc = run(doc0, offset(sketchOf(doc0), solve(doc0).geometry, ids(doc0), original, 2, [15, 40]));
    const s = solve(doc);
    const xs = copies(doc, original).flatMap((id) => [lineOf(s, id).a[0], lineOf(s, id).b[0]]);
    expect([Math.min(...xs), Math.max(...xs)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-2, 32]);
    expect(s.status).toBe('fully');
  });

  it('offsets a slot: lines and arcs together, the arcs concentric with a bigger radius', () => {
    const doc0 = (() => {
      const d = run(start(), slot(ids(start()), [0, 0], [30, 0], 5));
      const pts = sketchOf(d).entities.filter((e) => e.type === 'point');
      const arc = sketchOf(d).entities.find((e) => e.type === 'arc')!.id;
      return add(d, { id: 'k1', type: 'coincident', a: pts[0]!.id, b: SKETCH_ORIGIN }, { id: 'k2', type: 'horizontal', a: pts[0]!.id, b: pts[1]!.id }, { id: 'k3', type: 'distance', a: pts[0]!.id, b: pts[1]!.id, value: '30' }, { id: 'k4', type: 'radius', circle: arc, value: '5' });
    })();
    expect(solve(doc0).status).toBe('fully');
    const outline = sketchOf(doc0).entities.filter((e) => e.type === 'line' || e.type === 'arc').map((e) => e.id);
    const doc = run(doc0, offset(sketchOf(doc0), solve(doc0).geometry, ids(doc0), outline, 2, [15, 30]));
    everyRefExists(doc);
    const s = solve(doc);
    expect(s.status).toBe('fully');
    expect(s.redundant).toEqual([]);
    const newArcs = sketchOf(doc).entities.filter((e) => e.type === 'arc' && !outline.includes(e.id));
    expect(newArcs).toHaveLength(2);
    for (const a of newArcs) {
      const g = s.geometry.get(a.id)!;
      expect(g.type === 'arc' && g.r).toBeCloseTo(7, 6);
    }
    const newLines = sketchOf(doc).entities.filter((e) => e.type === 'line' && !outline.includes(e.id));
    expect(newLines.map((e) => Math.abs(lineOf(s, e.id).a[1])).sort()).toEqual([7, 7]);
    expect(Math.min(...newLines.flatMap((e) => [lineOf(s, e.id).a[0], lineOf(s, e.id).b[0]]))).toBeCloseTo(0, 6); // the lines still run between the arcs' centers
  });

  it('offsets an open chain at a corner, and a circle, and refuses what cannot be done', () => {
    const corner = start([point('p', 0, 0), point('qa', 20, 0), point('qb', 0, 20), line('A', 'p', 'qa'), line('B', 'p', 'qb')]);
    const doc = run(corner, offset(sketchOf(corner), solve(corner).geometry, ids(corner), ['A', 'B'], 3, [10, 10]));
    const s = solve(doc);
    const [na, nb] = copies(doc, ['A', 'B']);
    // the corner of the offset chain is where the offset lines cross, three from each original line
    const common = [lineOf(s, na!).a, lineOf(s, na!).b].map((p) => p.map((v) => Math.round(v * 1e6) / 1e6));
    expect(common.some((p) => p[0] === 3 && p[1] === 3)).toBe(true);
    expect(s.conflicting).toEqual([]);
    expect(s.redundant).toEqual([]);
    expect(nb).toBeDefined();

    const ring = start([point('c', 0, 0), { id: 'C', type: 'circle', center: 'c', radius: 5 }], [{ id: 'f', type: 'coincident', a: 'c', b: SKETCH_ORIGIN }, { id: 'r', type: 'radius', circle: 'C', value: '5' }]);
    const bigger = run(ring, offset(sketchOf(ring), solve(ring).geometry, ids(ring), ['C'], 2, [20, 0]));
    expect(solve(bigger).status).toBe('fully');
    const smaller = run(ring, offset(sketchOf(ring), solve(ring).geometry, ids(ring), ['C'], 2, [1, 0]));
    const rings = sketchOf(smaller).entities.filter((e) => e.type === 'circle' && e.id !== 'C');
    expect(solve(smaller).geometry.get(rings[0]!.id)).toMatchObject({ r: 3 });
    expect(offset(sketchOf(ring), solve(ring).geometry, ids(ring), ['C'], 6, [1, 0])).toMatchObject({ error: expect.stringContaining('太大') });
    expect(offset(sketchOf(ring), solve(ring).geometry, ids(ring), [], 1, [1, 0])).toMatchObject({ error: expect.stringContaining('選取') });
    expect(offset(sketchOf(ring), solve(ring).geometry, ids(ring), ['C'], 0, [1, 0])).toMatchObject({ error: expect.stringContaining('大於 0') });
    const tee = start([point('p', 0, 0), point('a', 5, 0), point('b', 0, 5), point('c', -5, 0), line('A', 'p', 'a'), line('B', 'p', 'b'), line('C', 'p', 'c')]);
    expect(offset(sketchOf(tee), solve(tee).geometry, ids(tee), ['A', 'B', 'C'], 1, [1, 1])).toMatchObject({ error: expect.stringContaining('分岔') });
  });
});

describe('entities that follow the model (C1.18, C1.26)', () => {
  const ref = (name: string) => ({ kind: 'edge' as const, name });

  it('adds projected edges as entities carrying the edge, sharing the corners of a face outline', () => {
    const square = [[0, 0], [10, 0], [10, 5], [0, 5]] as const;
    const items = square.map((p, i) => ({ ref: ref(`edge${i}`), projected: { kind: 'line' as const, a: [...p] as [number, number], b: [...square[(i + 1) % 4]!] as [number, number] } }));
    const doc = run(start(), referenceEntities(sketchOf(start()), ids(start()), items));
    const sk = sketchOf(doc);
    expect(sk.entities.filter((e) => e.type === 'point')).toHaveLength(4);
    expect(sk.entities.filter((e) => e.type === 'line').map((e) => (e as { ref?: { name: string } }).ref?.name)).toEqual(['edge0', 'edge1', 'edge2', 'edge3']);
    const profile = findProfiles(sk, solve(doc));
    expect(profile.problems).toEqual([]);
    expect(profile.regions).toHaveLength(1);
  });

  it('adds circles, arcs and pierce points, and leaves out an edge the sketch already follows', () => {
    const items = [
      { ref: ref('c'), projected: { kind: 'circle' as const, c: [3, 4] as [number, number], r: 2 } },
      { ref: ref('a'), projected: { kind: 'arc' as const, c: [0, 0] as [number, number], r: 5, start: [5, 0] as [number, number], end: [0, 5] as [number, number] } },
      { ref: ref('p'), pierce: [7, 8] as [number, number] },
    ];
    let doc = run(start(), referenceEntities(sketchOf(start()), ids(start()), items));
    const sk = sketchOf(doc);
    expect(sk.entities.find((e) => e.type === 'circle')).toMatchObject({ radius: 2, ref: { name: 'c' } });
    expect(sk.entities.find((e) => e.type === 'arc')).toMatchObject({ ref: { name: 'a' } });
    expect(sk.entities.find((e) => e.type === 'point' && e.pierce)).toMatchObject({ x: 7, y: 8, pierce: { name: 'p' } });
    // again: nothing new; with one new edge: only that one
    expect(referenceEntities(sk, ids(doc), items)).toMatchObject({ error: expect.stringContaining('已經在草圖裡') });
    doc = run(doc, referenceEntities(sk, ids(doc), [...items, { ref: ref('q'), projected: { kind: 'line' as const, a: [0, 0] as [number, number], b: [1, 0] as [number, number] } }]));
    expect(sketchOf(doc).entities.filter((e) => e.type === 'line')).toHaveLength(1);
    expect(sketchOf(doc).entities.filter((e) => e.type === 'circle')).toHaveLength(1);
  });

  it('refuses a reference that is not an edge', () => {
    const bad = { kind: 'face' as const, name: 'f' };
    expect(() => run(start(), { edit: { add: { entities: [{ id: 'l1', type: 'line', p1: 'a', p2: 'b', ref: bad }, point('a', 0, 0), point('b', 1, 0)], constraints: [] } } })).toThrow('必須是模型的邊線');
  });
});

describe('editSketch (the command under the operations)', () => {
  it('changes references, deletes and adds in one step, and refuses what would make the sketch invalid', () => {
    const doc = corner2();
    const edited = applyCommand(doc, { type: 'editSketch', featureId: 's1', entities: [{ id: 'A', set: { p2: 'qb' } }], remove: ['qa'] });
    expect(sketchOf(edited).entities.find((e) => e.id === 'A')).toMatchObject({ p2: 'qb' });
    expect(sketchOf(edited).entities.some((e) => e.id === 'qa')).toBe(false);
    expect(() => applyCommand(doc, { type: 'editSketch', featureId: 's1', entities: [{ id: 'A', set: { p2: 'nowhere' } }] })).toThrow('不存在的點');
    expect(() => applyCommand(doc, { type: 'editSketch', featureId: 's1', entities: [{ id: 'qa', set: { p1: 'p' } }] })).toThrow('沒有');
    expect(() => applyCommand(doc, { type: 'editSketch', featureId: 's1', remove: ['ghost'] })).toThrow('找不到');
    expect(() => applyCommand(doc, { type: 'editSketch', featureId: 's1', add: { entities: [point('p', 1, 1)], constraints: [] } })).toThrow('已被使用');
  });

  function corner2(): PartDoc {
    return start([point('p', 0, 0), point('qa', 20, 0), point('qb', 0, 20), { id: 'A', type: 'line', p1: 'p', p2: 'qa' }]);
  }
});
