/**
 * B1 (2026-10-16): local (partial) section cut by the kernel — the outline extrusion, depth from the visible surface,
 * and the hatch of the depth plane. Every number is worked out by hand from the block that is built here; nothing is
 * backfilled from the kernel (AGENTS.md §2.4). A section measuring from the model origin plane instead (the first,
 * discarded implementation) cuts thin air and returns an empty `cut`, so all of the area assertions below fail on it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId, type Vec3 } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator } from '@3db/regen';
import { buildScene, hatch, type ViewLines } from '@3db/drawing';
import {
  applyDrawingCommand,
  createEmptyDrawing,
  type DrawingDoc,
  type DrawingPage,
  type DrawingView,
} from '@3db/model';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';

const kept: Regenerator[] = [];
let kernel: Kernel;
let solver: PlaneGcsSolver;
/**
 * A stepped block, built by hand: x in [0, 20] rises to 12, x in [20, 40] only to 6, y in [0, 30].
 * The local-section outline (a 10-by-10 square, x in [15, 25], y in [10, 20]) straddles the step.
 */
let saw: ShapeId;

const shapeOf = (doc: ReturnType<typeof build>): ShapeId => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  const r = regen.rebuild(doc);
  expect(r.features.filter((f) => f.status !== 'ok').map((f) => f.message)).toEqual([]);
  return r.body!.shape;
};

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  saw = shapeOf(
    build(
      sketch('s1', front, rectangle('r1', 0, 0, 20, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '12' }),
      sketch('s2', front, rectangle('r2', 20, 0, 20, 30)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '6' })
    )
  );
}, 60_000);

/** A 10-by-10 closed rectangle on the block's top (z = 12), as the model layer hands it over (first point repeated). */
const rect10 = (z: number): Vec3[] => [
  [15, 10, z],
  [25, 10, z],
  [25, 20, z],
  [15, 20, z],
  [15, 10, z],
];

/** The area the cut polygons would hatch: polygon length times the spacing, as in drawing-derived.test.ts. */
const hatchArea = (cut: number[][], spacing: number): number =>
  hatch(cut, spacing).reduce((a, l) => a + Math.hypot(l[2]! - l[0]!, l[3]! - l[1]!), 0) * spacing;

const inOutline = ([x, y]: readonly [number, number]): boolean =>
  x >= 15 - 1e-6 && x <= 25 + 1e-6 && y >= 10 - 1e-6 && y <= 20 + 1e-6;

describe('a local section cut to a depth from the visible surface', () => {
  it('depth 5 from the top (z = 12): the pocket bottom at z = 7 is 5 by 10 = 50', () => {
    const live = kernel.liveShapes;
    // at z = 7 only the tall half (x in [15, 20]) still has material inside the outline
    const v = kernel.sectionViewLocal(saw, rect10(12), 5, { origin: [15, 10, 12], normal: [0, 0, 1] }, [0, 1, 0]);
    expect(kernel.liveShapes).toBe(live);
    // the whole stepped block is still seen: x in [0, 40], y in [0, 30]
    expect(v.box).toEqual({ min: [expect.closeTo(0, 6), expect.closeTo(0, 6)], max: [expect.closeTo(40, 6), expect.closeTo(30, 6)] });
    expect(v.cut!.length).toBeGreaterThan(0);
    const points = v.cut!.flatMap((l) => Array.from({ length: l.length / 2 }, (_, i) => [l[2 * i]!, l[2 * i + 1]!] as const));
    expect(points.every(([x, y]) => inOutline([x, y]))).toBe(true);
    // reverse control: this fails if the tool were measured from the model origin plane (it would cut z in [-5, 0],
    // missing the part entirely, and `cut` would be empty)
    const area = hatchArea(v.cut!, 0.5);
    expect(area).toBeGreaterThan(50 * 0.99);
    expect(area).toBeLessThan(50 * 1.01);
  }, 60_000);

  it('depth 8: the plane at z = 4 crosses both halves, 10 by 10 = 100', () => {
    const v = kernel.sectionViewLocal(saw, rect10(12), 8, { origin: [15, 10, 12], normal: [0, 0, 1] }, [0, 1, 0]);
    const area = hatchArea(v.cut!, 0.5);
    expect(area).toBeGreaterThan(100 * 0.99);
    expect(area).toBeLessThan(100 * 1.01);
  }, 60_000);

  it('where the outline plane sits along the gaze does not matter: on the bottom (z = 0) the same pocket', () => {
    // the first implementation extruded from this plane and cut thin air; with the visible-surface semantics
    // the outline is lifted to the top first, so the answer is the same as with z = 12
    const v = kernel.sectionViewLocal(saw, rect10(0), 5, { origin: [15, 10, 0], normal: [0, 0, 1] }, [0, 1, 0]);
    const area = hatchArea(v.cut!, 0.5);
    expect(area).toBeGreaterThan(50 * 0.99);
    expect(area).toBeLessThan(50 * 1.01);
  }, 60_000);

  it('depth past the material is refused, never shortened: 13 > 12 - 0', () => {
    expect(() => kernel.sectionViewLocal(saw, rect10(12), 13, { origin: [15, 10, 12], normal: [0, 0, 1] }, [0, 1, 0])).toThrow(/深度/);
  });

  it('a zero or negative depth, or a degenerate outline, is refused without touching OCCT', () => {
    const plane = { origin: [15, 10, 12] as Vec3, normal: [0, 0, 1] as Vec3 };
    expect(() => kernel.sectionViewLocal(saw, rect10(12), 0, plane, [0, 1, 0])).toThrow(/深度/);
    expect(() => kernel.sectionViewLocal(saw, rect10(12), -2, plane, [0, 1, 0])).toThrow(/深度/);
    expect(() => kernel.sectionViewLocal(saw, [[15, 10, 12], [25, 10, 12]], 5, plane, [0, 1, 0])).toThrow(/輪廓/);
  });

  it('an outline missing the part cuts nothing: the whole part is seen, `cut` is empty', () => {
    const full = kernel.projectView(saw, { dir: [0, 0, -1], up: [0, 1, 0] });
    const far = rect10(12).map(([x, y, z]) => [x + 100, y, z] as Vec3);
    const v = kernel.sectionViewLocal(saw, far, 5, { origin: [115, 10, 12], normal: [0, 0, 1] }, [0, 1, 0]);
    expect(v.cut).toEqual([]);
    expect(v.box).toEqual(full.box);
  }, 60_000);
});

const lines = (w: number, h: number, x = 0, y = 0): ViewLines => ({
  visible: [[x, y, x + w, y + h]],
  hidden: [],
  box: { min: [x, y], max: [x + w, y + h] },
});

describe('the local section on the sheet', () => {
  const doc = (views: DrawingView[], sheet: Partial<DrawingPage['sheet']> = {}): DrawingDoc =>
    applyDrawingCommand(applyDrawingCommand(createEmptyDrawing(), { type: 'setSheet', sheet }), { type: 'insertViews', views });
  const front: DrawingView = { id: 'f', name: 'f', source: 'a.3dbx', direction: 'front' };

  it('hatches what the kernel cut, draws the outline box on the parent with the letter, titles the section A-A', () => {
    const section: DrawingView = {
      id: 's',
      name: 'A-A',
      kind: 'sectionLocal',
      parent: 'f',
      outline: { kind: 'rectangle', p0: [0, 0], p1: [40, 30] },
      depth: 5,
      label: 'A',
    };
    const cut = [[10, 10, 20, 10, 20, 20, 10, 20, 10, 10]];
    const d = doc([front, section]);
    const { scene, placed } = buildScene(
      d,
      new Map([
        ['f', lines(100, 60)],
        ['s', { visible: [[0, 0, 40, 0, 40, 30]], hidden: [], box: { min: [0, 0], max: [40, 30] }, cut }],
      ])
    );
    const styles = scene.items.flatMap((i) => (i.kind === 'polyline' ? [i.style] : []));
    expect(styles.filter((s) => s === 'center')).toHaveLength(1); // the outline box on the parent
    expect(styles.filter((s) => s === 'thin').length).toBeGreaterThan(10);
    const texts = scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    expect(texts.filter((x) => x === 'A')).toHaveLength(1); // one letter beside the outline
    expect(texts).toContain('A-A'); // the section's own title
    // the outline box sits where the rectangle is in the parent's view, at the parent's place on the sheet
    const f = placed.get('f')!;
    const chain = scene.items.find((i) => i.kind === 'polyline' && i.style === 'center')!;
    if (chain.kind === 'polyline') expect(chain.points[0]).toBeCloseTo(f.at[0] + (0 - f.centre[0]) * f.scale, 9);
    // and the local section itself does not get a second name under it
    expect(texts.filter((x) => x === 'A-A')).toHaveLength(1);
  });

  it('goes beside its parent like a detail (right side)', () => {
    const section: DrawingView = {
      id: 's',
      name: 'A-A',
      kind: 'sectionLocal',
      parent: 'f',
      outline: { kind: 'rectangle', p0: [0, 0], p1: [40, 30] },
      depth: 5,
      label: 'A',
    };
    const d = doc([front, section]);
    const { placed } = buildScene(d, new Map([['f', lines(100, 60)], ['s', lines(40, 30)]]));
    expect(placed.get('s')!.at[0]).toBeGreaterThan(placed.get('f')!.at[0]);
  });
});