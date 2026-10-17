/**
 * D-I2 (ADR 0138): dimensions on a view of an assembly. Each part of it is put where the assembly has it; its edges and vertices are offered by name with the
 * leaf they are in (`in`), and what the model says of them is put where the part is (`placeElementFacts`). Checked with the same plate placed twice, turned and
 * mirrored: the numbers come from the parts' own corners moved by hand, never from the drawing's lines.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, CommandError, createEmptyDrawing, placeElementFacts, placementRows, rightOf, sheetUp, viewVectors, type Dimension, type DrawingRef, type ElementFacts, type Feature, type Pose, type ViewAxes, page } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { elementFacts, Regenerator, viewEdges, type RebuildResult } from '@3db/regen';
import { evaluateDimension, type PlacedView } from '@3db/drawing';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let built: RebuildResult;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  kept.push(regen);
  built = regen.rebuild(
    build(
      sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      { ...sketch('s2', face('e1:cap:end')), entities: [{ id: 'p1', type: 'point', x: 10, y: 5 }] } as Feature,
      { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'straight', diameter: '8', end: { type: 'blind', depth: '10' } } as Feature,
    ),
  );
});
afterAll(() => kept.forEach((r) => r.dispose()));

const axes: ViewAxes = viewVectors('front');
const at = (p: readonly number[]): [number, number] => {
  const r = rightOf(axes);
  const u = sheetUp(axes);
  return [p[0]! * r[0] + p[1]! * r[1] + p[2]! * r[2], p[0]! * u[0] + p[1]! * u[1] + p[2]! * u[2]];
};
const quarter = Math.SQRT1_2;
const placements: { leaf: string; pose: Pose; mirrored: boolean }[] = [
  { leaf: 'comp1', pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, mirrored: false },
  { leaf: 'comp2', pose: { position: [100, 0, 0], rotation: [0, 0, 0, 1] }, mirrored: false },
  // a quarter turn about z, moved: x → y, y → −x
  { leaf: 'comp3', pose: { position: [0, 100, 0], rotation: [0, 0, quarter, quarter] }, mirrored: false },
  // the mirror of the part (its x → −x), moved
  { leaf: 'comp4', pose: { position: [-50, 0, 0], rotation: [0, 0, 0, 1] }, mirrored: true },
];
const edgesOf = (p: (typeof placements)[number]) => {
  const body = built.body!;
  return viewEdges(kernel, body.shape, body.topology, body.names, axes, undefined, undefined, { rows: placementRows(p.pose, p.mirrored), in: p.leaf });
};
const factsOf = (ref: DrawingRef): ElementFacts => {
  const p = placements.find((x) => x.leaf === ref.in)!;
  const body = built.body!;
  const f = elementFacts(body.topology, body.names, { kind: ref.kind, name: ref.name });
  if ('error' in f) throw new Error(f.error);
  return placeElementFacts(f, placementRows(p.pose, p.mirrored));
};

describe('the parts of a view of an assembly, by name', () => {
  it('every vertex carries its leaf, and what the model says of it, put where the part is, is where it is drawn (moved, turned, mirrored)', () => {
    for (const p of placements) {
      const set = edgesOf(p);
      expect(set.vertices.length).toBeGreaterThan(7);
      for (const v of set.vertices) {
        expect((v.ref as DrawingRef).in).toBe(p.leaf);
        const q = at(factsOf(v.ref as DrawingRef).point);
        expect(Math.hypot(q[0] - v.at[0], q[1] - v.at[1]), `${p.leaf} ${v.ref.name}`).toBeLessThan(1e-6);
      }
      for (const e of set.edges) expect((e.ref as DrawingRef).in).toBe(p.leaf);
    }
  });

  it('the corner (40, 0) of the first plate to the corner (0, 0) of the one moved 100 along x: 60 by hand', () => {
    const corner = (p: (typeof placements)[number], x: number, y: number) => edgesOf(p).vertices.find((v) => Math.hypot(v.at[0] - x, v.at[1] - y) < 1e-6 && v.depth > 19.9)!;
    const a = corner(placements[0]!, 40, 0);
    const b = corner(placements[1]!, 100, 0);
    expect(a && b).toBeTruthy();
    const placed: PlacedView = { id: 'v', at: [200, 150], scale: 1, w: 140, h: 30, centre: [70, 15] };
    const d = { id: 'd', view: 'v', kind: 'linear', a: a.ref, b: b.ref, orientation: 'horizontal', offset: -10 } as Dimension;
    const out = evaluateDimension(d, { elements: [factsOf(a.ref as DrawingRef), factsOf(b.ref as DrawingRef)] }, axes, placed) as { value: number };
    expect(out.value).toBeCloseTo(60, 9);
  });

  it('the turned plate: its 40 long side runs up the sheet, from y = 100 to 140; the mirrored one lies from x = −90 to −50', () => {
    const turned = edgesOf(placements[2]!).vertices.map((v) => v.at);
    expect(Math.min(...turned.map((p) => p[1]))).toBeCloseTo(100, 6);
    expect(Math.max(...turned.map((p) => p[1]))).toBeCloseTo(140, 6);
    const mirrored = edgesOf(placements[3]!).vertices.map((v) => v.at);
    expect(Math.min(...mirrored.map((p) => p[0]))).toBeCloseTo(-90, 6);
    expect(Math.max(...mirrored.map((p) => p[0]))).toBeCloseTo(-50, 6);
  });

  it('the commands keep the leaf, and refuse an empty one; a placement that is not 12 finite numbers is refused', () => {
    let doc = createEmptyDrawing();
    doc = applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: 'view1', name: 'Front', source: 'jig.3dba', direction: 'front' }] });
    const v = (name: string, leaf?: string): DrawingRef => ({ kind: 'vertex', name, ...(leaf !== undefined ? { in: leaf } : {}) });
    const dim = (a: DrawingRef, b: DrawingRef) => ({ id: 'dim1', view: 'view1', kind: 'linear', a, b, orientation: 'horizontal', offset: 10 }) as Dimension;
    const ok = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [dim(v('a', 'comp1'), v('b', 'comp2/pa'))] });
    expect((page(ok).dimensions[0] as { a: DrawingRef }).a.in).toBe('comp1');
    expect(() => applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [dim(v('a', ''), v('b', 'comp2'))] })).toThrow(CommandError);
    expect(() => placeElementFacts({ kind: 'vertex', type: 'point', point: [0, 0, 0] }, [1, 0, 0])).toThrow();
    expect(() => placeElementFacts({ kind: 'vertex', type: 'point', point: [0, 0, 0] }, [1, 0, 0, Number.NaN, 0, 1, 0, 0, 0, 0, 1, 0])).toThrow();
  });
});
