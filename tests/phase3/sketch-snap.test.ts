/**
 * D5.3b: what a sketch can snap to on the model. The model's edges that lie in the sketch plane are projected and handed to the sketch with the
 * edge each one is; an entity made from one follows the model like the ones 「轉換實體引用」 makes (ADR 0026).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type Ref, type SketchEntity } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { modelSnapItems, planarEdgeItems, Regenerator, type SnapItem } from '@3db/regen';

type P2 = [number, number];
import { build, circle, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

/** A plate 40 × 30 (width dimension `rw`), 10 thick, with a hole of radius 5 at (20, 15) cut through it, and an empty sketch s3 on the front plane. */
const plate = (plane: Ref = front): PartDoc =>
  build(
    sketch('s1', front, rectangle('r', 0, 0, 40, 30)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
    sketch('s2', front, circle('h', 20, 15, 5)),
    extrude('e2', 's2', 'cut', { type: 'midPlane', depth: '30' }), // both ways: which side of the front plane the plate grew on does not matter
    sketch('s3', plane),
  );
const regen = () => new Regenerator(kernel, solver, new Map());
/** The model as the sketch s3 sees it (everything before it), and the edges it can snap to. */
function seenFrom(doc: PartDoc) {
  const r = regen().rebuild(doc, { until: doc.features.findIndex((f) => f.id === 's3') });
  if (!r.body) throw new Error('no body: ' + statuses(r).join(' '));
  const body = r.body;
  const items = planarEdgeItems({ names: body.names, topology: body.topology, frame: r.frames.get('s3')! }, (i) => edgeFingerprint(body.topology, i));
  return { r, items };
}
const failures = (r: ReturnType<typeof seenFrom>['r']) => statuses(r).filter((s) => !s.endsWith('=ok'));

describe('the model edges in the sketch plane (D5.3b)', () => {
  let items: ReturnType<typeof seenFrom>['items'];
  beforeAll(() => {
    items = seenFrom(plate()).items;
  });

  it('are the four edges of the plate and the hole in the face on the plane: nothing above it, nothing crossing it', () => {
    expect(items).toHaveLength(5); // the far face's four edges are 10 above the plane, the four upright ones cross it
    expect(items.filter((i) => 'projected' in i && i.projected.kind === 'line')).toHaveLength(4);
    const hole = items.find((i) => 'projected' in i && i.projected.kind === 'circle')!;
    expect('projected' in hole && hole.projected.kind === 'circle' && hole.projected.r).toBeCloseTo(5, 9);
  });

  it('are in sketch coordinates: the corners of the plate and the center of the hole', () => {
    const points = items.flatMap((i) => ('projected' in i ? (i.projected.kind === 'line' ? [i.projected.a, i.projected.b] : i.projected.kind === 'circle' ? [i.projected.c] : []) : []));
    const has = (x: number, y: number) => points.some((p) => Math.hypot(p[0] - x, p[1] - y) < 1e-6);
    // the front plane's y axis may point either way in the plane, but the plate is where it was drawn
    for (const [x, y] of [[0, 0], [40, 0], [40, 30], [0, 30], [20, 15]] as const) expect(has(x, y), `a point at (${x}, ${y})`).toBe(true);
  });

  it('carry the persistent name of the edge, so an entity made from one finds it again', () => {
    for (const i of items) expect(i.ref).toMatchObject({ kind: 'edge', name: expect.stringMatching(/\S/) });
    expect(new Set(items.map((i) => i.ref.name)).size).toBe(items.length);
  });

  it('are the edges of the face on that plane when the sketch is on another plane through the plate, and not those of the faces across', () => {
    for (const name of ['plane:top', 'plane:right'] as const) {
      const { items: here } = seenFrom(plate({ kind: 'datum', name }));
      expect(here.map((i) => ('projected' in i ? i.projected.kind : ''))).toEqual(['line', 'line', 'line', 'line']);
    }
  });
});

/**
 * C1 (decisions 2026-10-14): besides the edges in the plane, the others projected onto it along its normal, and the points where edges pass
 * through it. Every number below is worked out by hand from the part as drawn.
 */
describe('the model edges outside the sketch plane, projected, and where edges pass through it (C1)', () => {
  const offsetPlane = (id: string, from: Ref, distance: string): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: from, distance } });
  /** Everything before the sketch s3, its frame, and what it can snap to. */
  function snapsOf(doc: PartDoc) {
    const r = regen().rebuild(doc, { until: doc.features.findIndex((f) => f.id === 's3') });
    if (!r.body) throw new Error('no body: ' + statuses(r).join(' '));
    const body = r.body;
    const frame = r.frames.get('s3')!;
    const items = modelSnapItems({ names: body.names, topology: body.topology, frame }, (i) => edgeFingerprint(body.topology, i));
    const z = kernel.bounds(body.shape);
    return { r, frame, items, bounds: z };
  }
  const near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-6;
  /** A line item between the two points, either way round. */
  const lineAt = (items: SnapItem[], a: P2, b: P2) =>
    items.filter((i): i is Extract<SnapItem, { projected: unknown }> => 'projected' in i && i.projected.kind === 'line' && ((near(i.projected.a, a) && near(i.projected.b, b)) || (near(i.projected.a, b) && near(i.projected.b, a))));

  it('a plate seen from a plane 25 off the front plane: its outline and its hole, once each (the two faces project onto each other), as far off as the nearer face', () => {
    const { items, bounds, frame } = snapsOf(build(...plate().features.slice(0, 4), offsetPlane('pl', front, '25'), sketch('s3', { kind: 'datum', name: 'pl' })));
    expect(frame.origin[2]).toBeCloseTo(25, 9);
    // the plate is 10 thick on one side of the front plane (the box only says which: OCCT pads it by its tolerance): its nearer face is 15 or 25 away
    const nearer = bounds.min[2] + bounds.max[2] > 0 ? 15 : 25;
    expect(items).toHaveLength(5);
    expect(items.every((i) => 'projected' in i)).toBe(true); // no edge reaches the plane: no pierce point
    for (const [a, b] of [[[0, 0], [40, 0]], [[40, 0], [40, 30]], [[40, 30], [0, 30]], [[0, 30], [0, 0]]] as [P2, P2][]) expect(lineAt(items, a, b), `${a} – ${b}`).toHaveLength(1);
    const hole = items.find((i) => 'projected' in i && i.projected.kind === 'circle')!;
    expect('projected' in hole && hole.projected.kind === 'circle' && [hole.projected.c, hole.projected.r]).toEqual([[expect.closeTo(20, 9), expect.closeTo(15, 9)], expect.closeTo(5, 9)]);
    for (const i of items) expect('projected' in i ? i.off : NaN, i.ref.name).toBeCloseTo(nearer, 9);
  });

  it('on the plane the plate stands on: only the edges in it, nothing from the far face (it projects onto them) and no pierce point (the upright edges only touch it)', () => {
    const doc = plate();
    const { items } = snapsOf(doc);
    expect(items.map((i) => ('projected' in i ? i.projected.kind : 'pierce')).sort()).toEqual(['circle', 'line', 'line', 'line', 'line']);
    expect(items.every((i) => 'projected' in i && i.off === undefined)).toBe(true); // in the plane: no distance from it
    expect(items.map((i) => i.ref.name).sort()).toEqual(seenFrom(doc).items.map((i) => i.ref.name).sort()); // the same edges as planarEdgeItems
  });

  /** A right triangle 40 wide and `h` tall (corner at the origin) on the front plane, extruded 10: the hypotenuse runs from (40, 0) to (0, h). */
  const wedge = (h: number, plane: Feature): PartDoc =>
    build(
      {
        id: 's1',
        type: 'sketch',
        name: 's1',
        suppressed: false,
        plane: front,
        entities: [
          { id: 'p0', type: 'point', x: 0, y: 0 },
          { id: 'p1', type: 'point', x: 40, y: 0 },
          { id: 'p2', type: 'point', x: 0, y: h },
          { id: 'l0', type: 'line', p1: 'p0', p2: 'p1' },
          { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
          { id: 'l2', type: 'line', p1: 'p2', p2: 'p0' },
        ],
        constraints: [
          { id: 'o', type: 'coincident', a: 'p0', b: '@origin' },
          { id: 'h0', type: 'horizontal', a: 'l0' },
          { id: 'v2', type: 'vertical', a: 'l2' },
          { id: 'w', type: 'distance', a: 'l0', value: '40' },
          { id: 'th', type: 'distance', a: 'l2', value: String(h) },
        ],
      },
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      plane,
      sketch('s3', { kind: 'datum', name: 'pl' }),
    );
  const level15 = offsetPlane('pl', { kind: 'datum', name: 'plane:top' }, '15');

  it('a wedge cut by a plane level with the top plane, 15 up: the hypotenuse passes through it at x = 20, the triangle\'s outline below projects to a 40 × 10 rectangle', () => {
    const { items, bounds, frame } = snapsOf(wedge(30, level15));
    expect(frame.origin[1]).toBeCloseTo(15, 9);
    expect(frame.yDir).toEqual([0, 0, -1].map((x) => expect.closeTo(x, 12))); // the top plane's axes: sketch (x, y) is world (x, −z)
    const t = bounds.min[2] + bounds.max[2] > 0 ? 10 : -10; // the wedge is 10 thick on one side of the front plane (the box, padded by OCCT, only says which)
    const pierces = items.filter((i): i is Extract<SnapItem, { pierce: P2 }> => 'pierce' in i);
    // the two hypotenuse edges (z = 0 and z = t) pass through y = 15 halfway along x; the upright edges at x = 0 pass through where projected corners already are
    expect(pierces.map((i) => i.pierce).sort((a, b) => a[1] - b[1])).toEqual(
      [[20, -Math.max(0, t)], [20, -Math.min(0, t)]].map(([x, y]) => [expect.closeTo(x!, 9), expect.closeTo(y!, 9)]),
    );
    // along x: the hypotenuse edges pass through the plane (0 off) and project onto the bottom edges (15 off): the hypotenuse is kept
    for (const y of [0, -t]) {
      const along = lineAt(items, [0, y], [40, y]);
      expect(along, `y = ${y}`).toHaveLength(1);
      expect(along[0]!.off).toBe(0);
    }
    // along z, 15 below or above: the three edges at (0, 0), (40, 0) and (0, 30) project to two lines
    expect(lineAt(items, [0, 0], [0, -t])).toHaveLength(1);
    expect(lineAt(items, [40, 0], [40, -t])).toHaveLength(1);
    for (const l of [...lineAt(items, [0, 0], [0, -t]), ...lineAt(items, [40, 0], [40, -t])]) expect(l.off ?? NaN).toBeCloseTo(15, 9);
    expect(items).toHaveLength(6);
  });

  it('a point made on where the hypotenuse passes through follows it: the triangle 40 tall instead of 30 moves it from x = 20 to x = 25', () => {
    const doc = wedge(30, level15);
    const { items } = snapsOf(doc);
    const pierce = items.find((i): i is Extract<SnapItem, { pierce: P2 }> => 'pierce' in i && Math.abs(i.pierce[1]) < 1e-9)!;
    expect(pierce.pierce[0]).toBeCloseTo(20, 9);
    const withPoint = applyCommand(doc, { type: 'addSketchItems', featureId: 's3', entities: [{ id: 'q', type: 'point', x: 20, y: 0, pierce: pierce.ref }], constraints: [] });
    const taller = applyCommand(withPoint, { type: 'setDimension', featureId: 's1', constraintId: 'th', value: '40' });
    const r = regen().rebuild(taller);
    expect(failures(r)).toEqual([]);
    const q = r.sketches.get('s3')!.solved.geometry.get('q')!;
    expect(q.type === 'point' && q.p).toEqual([expect.closeTo(25, 6), expect.closeTo(0, 6)]); // 40 · (1 − 15/40)
  });
});

describe('entities made from them follow the model (D5.3b)', () => {
  it('a line on the bottom edge of the plate gets longer when the plate is widened, and the sketch stays fully solved', () => {
    const doc0 = plate();
    const { items } = seenFrom(doc0);
    const bottom = items.find((i) => 'projected' in i && i.projected.kind === 'line' && Math.abs(i.projected.a[1] - i.projected.b[1]) < 1e-9 && Math.abs(i.projected.a[1]) < 1e-9)!;
    const entities: SketchEntity[] = [
      { id: 'a', type: 'point', x: 0, y: 0 },
      { id: 'b', type: 'point', x: 1, y: 0 },
      { id: 'n', type: 'line', p1: 'a', p2: 'b', ref: bottom.ref },
    ];
    const withLine = applyCommand(doc0, { type: 'addSketchItems', featureId: 's3', entities, constraints: [] });
    const wide = applyCommand(withLine, { type: 'setDimension', featureId: 's1', constraintId: 'rw', value: '55' });
    const r = regen().rebuild(wide);
    expect(failures(r)).toEqual([]);
    const g = r.sketches.get('s3')!.solved.geometry.get('n')!;
    expect(g.type === 'line' && Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1])).toBeCloseTo(55, 6);
  });
});
