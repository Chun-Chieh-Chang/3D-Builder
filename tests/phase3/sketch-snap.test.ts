/**
 * D5.3b: what a sketch can snap to on the model. The model's edges that lie in the sketch plane are projected and handed to the sketch with the
 * edge each one is; an entity made from one follows the model like the ones 「轉換實體引用」 makes (ADR 0026).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type PartDoc, type Ref, type SketchEntity } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { planarEdgeItems, Regenerator } from '@3db/regen';
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
