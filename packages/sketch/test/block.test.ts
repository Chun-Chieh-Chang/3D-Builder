/**
 * 「固定」 of a whole line, circle or arc (ADR 0182, Schema 74; FreeCAD 「Block」). Truth by hand: a line holds its two ends (4 freedoms), a circle its center
 * and radius (3), an arc its center, its start and the direction of its end (5). One relation too many would be redundant (the solver says so), one too few
 * would leave the sketch under defined; the fuzz below holds that for arcs in every quadrant.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, IdAllocator, resolveSketch, sketchError, type Command, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedSketch } from '../src/index';
import { applicableRelations, blockTargets } from '../src/interact';
import { transformEntities } from '../src/ops';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EMPTY: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 's1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};
const start = (entities: SketchEntity[], constraints: SketchConstraint[] = []): PartDoc =>
  applyCommand(applyCommand(createEmptyPart(), EMPTY), { type: 'addSketchItems', featureId: 's1', entities, constraints });
const sketchOf = (doc: PartDoc) => doc.features.find((f) => f.id === 's1') as SketchFeature;
const solve = (doc: PartDoc, options: Parameters<PlaneGcsSolver['solve']>[1] = {}): SolvedSketch => solver.solve(resolveSketch(sketchOf(doc), doc), { analyze: true, ...options });
const at = (s: SolvedSketch, id: string) => {
  const g = s.geometry.get(id);
  if (g?.type !== 'point') throw new Error(`no point ${id}`);
  return g.p;
};
const near = (p: [number, number], x: number, y: number, tol = 1e-8) => Math.hypot(p[0] - x, p[1] - y) < tol;
const polar = (c: [number, number], r: number, a: number): [number, number] => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
const block = (entity: string): SketchConstraint => ({ id: `b${entity}`, type: 'block', entity });

const lineDoc = (blocked = true, extra: SketchConstraint[] = []) =>
  start(
    [
      { id: 'a', type: 'point', x: 2, y: 3 },
      { id: 'b', type: 'point', x: 8, y: 7 },
      { id: 'L', type: 'line', p1: 'a', p2: 'b' },
    ],
    [...(blocked ? [block('L')] : []), ...extra],
  );
const circleDoc = (blocked = true, extra: SketchConstraint[] = []) =>
  start(
    [
      { id: 'c', type: 'point', x: 5, y: 5 },
      { id: 'K', type: 'circle', center: 'c', radius: 3 },
    ],
    [...(blocked ? [block('K')] : []), ...extra],
  );
function arcDoc(c: [number, number], r: number, a0: number, sweep: number, blocked = true, extra: SketchConstraint[] = []): PartDoc {
  const [s, e] = [polar(c, r, a0), polar(c, r, a0 + sweep)];
  return start(
    [
      { id: 'o', type: 'point', x: c[0], y: c[1] },
      { id: 's', type: 'point', x: s[0], y: s[1] },
      { id: 'e', type: 'point', x: e[0], y: e[1] },
      { id: 'A', type: 'arc', center: 'o', start: 's', end: 'e' },
    ],
    [...(blocked ? [block('A')] : []), ...extra],
  );
}

describe('a line held whole', () => {
  it('is fully defined with nothing redundant, where it was; without the relation it has its four freedoms', () => {
    expect(solve(lineDoc(false)).dof).toBe(4);
    const s = solve(lineDoc());
    expect(s.status).toBe('fully');
    expect(s.dof).toBe(0);
    expect(s.redundant).toEqual([]);
    expect(near(at(s, 'a'), 2, 3)).toBe(true);
    expect(near(at(s, 'b'), 8, 7)).toBe(true);
  });

  it('a length or an angle on it afterwards is one too many: the sketch is over defined and says which', () => {
    const s = solve(lineDoc(true, [{ id: 'd', type: 'distance', a: 'L', value: '99' }]));
    expect(s.status).toBe('over');
    expect([...s.conflicting, ...s.redundant]).toContain('d');
  });

  it('dragging an end of it does not move it', () => {
    const s = solve(lineDoc(), { drag: { points: [{ id: 'b', x: 30, y: -4 }] } });
    expect(near(at(s, 'b'), 8, 7)).toBe(true);
    expect(near(at(s, 'a'), 2, 3)).toBe(true);
  });

  it('a neighbour that shares its end is held by it: the shared point stays, the rest of the sketch follows its own relations', () => {
    const doc = start(
      [
        { id: 'a', type: 'point', x: 2, y: 3 },
        { id: 'b', type: 'point', x: 8, y: 7 },
        { id: 'c', type: 'point', x: 20, y: 7 },
        { id: 'L', type: 'line', p1: 'a', p2: 'b' },
        { id: 'M', type: 'line', p1: 'b', p2: 'c' },
      ],
      [block('L'), { id: 'h', type: 'horizontal', a: 'M' }],
    );
    const s = solve(doc, { drag: { points: [{ id: 'c', x: 40, y: 30 }] } });
    expect(near(at(s, 'b'), 8, 7)).toBe(true);
    expect(Math.abs(at(s, 'c')[1] - 7)).toBeLessThan(1e-8); // horizontal from b, the pointer's 30 does not take it off
  });
});

describe('a circle held whole', () => {
  it('holds its center and radius: 3 freedoms without it, none with it', () => {
    expect(solve(circleDoc(false)).dof).toBe(3);
    const s = solve(circleDoc());
    expect(s.status).toBe('fully');
    expect(s.redundant).toEqual([]);
    expect(near(at(s, 'c'), 5, 5)).toBe(true);
    const k = s.geometry.get('K');
    expect(k?.type === 'circle' && Math.abs(k.r - 3) < 1e-9).toBe(true);
  });

  it('a diameter on it afterwards is one too many; dragging its radius does not change it', () => {
    expect(solve(circleDoc(true, [{ id: 'd', type: 'diameter', circle: 'K', value: '9' }])).status).toBe('over');
    const s = solve(circleDoc(), { drag: { radii: [{ id: 'K', radius: 11 }] } });
    const k = s.geometry.get('K');
    expect(k?.type === 'circle' && Math.abs(k.r - 3) < 1e-9).toBe(true);
  });
});

describe('an arc held whole', () => {
  it('a quarter turn about (1, 2), radius 5: 5 freedoms without the relation, none with it, the ends where they were', () => {
    expect(solve(arcDoc([1, 2], 5, 0, Math.PI / 2, false)).dof).toBe(5);
    const s = solve(arcDoc([1, 2], 5, 0, Math.PI / 2));
    expect(s.status).toBe('fully');
    expect(s.dof).toBe(0);
    expect(s.redundant).toEqual([]);
    expect(near(at(s, 'o'), 1, 2)).toBe(true);
    expect(near(at(s, 's'), 6, 2)).toBe(true);
    expect(near(at(s, 'e'), 1, 7)).toBe(true);
  });

  it('a radius on it afterwards is one too many', () => {
    expect(solve(arcDoc([1, 2], 5, 0, Math.PI / 2, true, [{ id: 'R', type: 'radius', circle: 'A', value: '5' }])).status).toBe('over');
  });

  it('150 arcs of every quadrant, radius and sweep (0.1 to 2π − 0.1): fully defined, nothing redundant, every end where it was', () => {
    let seed = 20261022;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    for (let n = 0; n < 150; n++) {
      const c: [number, number] = [(rnd() - 0.5) * 80, (rnd() - 0.5) * 80];
      const r = 0.5 + rnd() * 40;
      const a0 = (rnd() - 0.5) * 2 * Math.PI * 1.9; // from below −π to above π: the branch cut of the angle is crossed too
      const sweep = 0.1 + rnd() * (2 * Math.PI - 0.2);
      const s = solve(arcDoc(c, r, a0, sweep));
      const [ps, pe] = [polar(c, r, a0), polar(c, r, a0 + sweep)];
      expect(s.status, `n=${n} a0=${a0} sweep=${sweep}`).toBe('fully');
      expect(s.redundant, `n=${n}`).toEqual([]);
      expect(near(at(s, 'o'), c[0], c[1]), `n=${n} center`).toBe(true);
      expect(near(at(s, 's'), ps[0], ps[1]), `n=${n} start`).toBe(true);
      expect(near(at(s, 'e'), pe[0], pe[1]), `n=${n} end`).toBe(true);
    }
  });
});

describe('what is offered and what is refused', () => {
  const doc = start(
    [
      { id: 'a', type: 'point', x: 0, y: 0 },
      { id: 'b', type: 'point', x: 10, y: 0 },
      { id: 'L', type: 'line', p1: 'a', p2: 'b' },
      { id: 'c', type: 'point', x: 5, y: 8 },
      { id: 'K', type: 'circle', center: 'c', radius: 2 },
      { id: 'p', type: 'point', x: 20, y: 20 },
    ],
    [],
  );
  const sketch = () => sketchOf(doc);
  const geometry = () => solve(doc).geometry;
  const types = (sel: string[], s: Parameters<typeof applicableRelations>[2] = sketch()) => applicableRelations(geometry(), sel, s).map((r) => r.type);

  it('「固定」 of a curve for lines, circles and arcs alone, one or several; a point keeps its own 「固定」; a point with a curve gets none', () => {
    expect(types(['L'])).toContain('block');
    expect(types(['K'])).toEqual(['block']);
    expect(types(['L', 'K'])).toContain('block');
    expect(types(['p'])).toEqual(['fix']);
    expect(types(['p', 'L'])).not.toContain('block');
  });

  it('blockTargets: each selected curve that is not held yet; none for a selection with a point in it', () => {
    expect(blockTargets(geometry(), ['L', 'K'], sketch())).toEqual(['L', 'K']);
    const held = { ...sketch(), constraints: [block('L')] };
    expect(blockTargets(geometry(), ['L', 'K'], held)).toEqual(['K']);
    expect(blockTargets(geometry(), ['L', 'p'], sketch())).toEqual([]);
    expect(blockTargets(geometry(), [], sketch())).toEqual([]);
    // every one held: nothing is offered
    expect(types(['L'], { ...sketch(), constraints: [block('L')] })).not.toContain('block');
  });

  it('a point, or something that is not there, is not a curve to hold', () => {
    expect(sketchError({ entities: sketch().entities, constraints: [{ id: 'x', type: 'block', entity: 'p' }] })).not.toBeNull();
    expect(sketchError({ entities: sketch().entities, constraints: [{ id: 'x', type: 'block', entity: 'nowhere' }] })).not.toBeNull();
    expect(sketchError({ entities: sketch().entities, constraints: [block('L'), block('K')] })).toBeNull();
  });

  it('taking the curve away takes its 「固定」 with it', () => {
    const held = applyCommand(lineDoc(), { type: 'removeSketchItems', featureId: 's1', ids: ['L'] });
    expect(sketchOf(held).constraints.some((c) => c.type === 'block')).toBe(false);
  });

  it('moving or turning a held curve (or one of its ends) is refused; copying it leaves the original held and the copy free', () => {
    const d = lineDoc();
    const sk = sketchOf(d);
    const g = solve(d).geometry;
    const ids = new IdAllocator(d.idCounters, [...sk.entities.map((e) => e.id), ...sk.constraints.map((c) => c.id)]);
    const moved = transformEntities(sk, g, ids, ['L'], { kind: 'translate', d: [5, 0] }, { keepRelations: true, copy: false });
    expect('error' in moved).toBe(true);
    const turned = transformEntities(sk, g, ids, ['a'], { kind: 'translate', d: [1, 1] }, { keepRelations: true, copy: false });
    expect('error' in turned).toBe(true);
    const copied = transformEntities(sk, g, ids, ['L'], { kind: 'translate', d: [0, 5] }, { keepRelations: true, copy: true });
    expect('error' in copied).toBe(false);
    if (!('error' in copied)) {
      // no 「固定」 comes with the copy (it would hold the copy where the original is)
      expect((copied.edit.add?.constraints ?? []).some((c) => c.type === 'block')).toBe(false);
    }
  });
});
