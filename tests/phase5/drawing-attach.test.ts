/**
 * D-I2 (ADR 0138): annotations fastened to the model. A datum's triangle, a note's or a frame's leader, a centre mark's middle may be fastened to a vertex, a
 * straight edge (at a place along it) or a circle; drawn, the point is where the model has the element now. Checked by changing the part: a plate 40 wide made
 * 60 wide moves what is fastened to its bottom edge's middle from x = 20 to 30, and to its corner from 40 to 60; the hole taken away leaves its centre mark
 * where it was, said to be lost.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, CommandError, createEmptyDrawing, viewVectors, type Annotation, type Feature, type ViewAxes } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, viewEdges, viewFeatures, type RebuildResult } from '@3db/regen';
import { attachedAnnotations, visibleElements, type ViewLines } from '@3db/drawing';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});
afterAll(() => regen.dispose());

const plate = (width: number, hole: boolean): RebuildResult =>
  regen.rebuild(
    build(
      sketch('s1', front, rectangle('a', 0, 0, width, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      ...(hole
        ? [
            { ...sketch('s2', face('e1:cap:end')), entities: [{ id: 'p1', type: 'point', x: 10, y: 5 }] } as Feature,
            { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'straight', diameter: '8', end: { type: 'blind', depth: '10' } } as Feature,
          ]
        : []),
    ),
  );
const axes: ViewAxes = viewVectors('front');
function seenOf(r: RebuildResult) {
  const body = r.body!;
  const lines = kernel.projectView(body.shape, axes) as ViewLines;
  const features = viewFeatures(body.topology, body.names, axes);
  return { seen: visibleElements(lines, viewEdges(kernel, body.shape, body.topology, body.names, axes), features), features };
}

describe('annotations fastened to the model', () => {
  it('follow the part when it changes: the bottom edge middle from x = 20 to 30, the corner from (40, 30) to (60, 30)', () => {
    const narrow = seenOf(plate(40, true));
    const bottom = narrow.seen.edges.find((e) => Math.abs(e.a[1]) < 1e-6 && Math.abs(e.b[1]) < 1e-6)!;
    const corner = narrow.seen.vertices.find((v) => Math.hypot(v.at[0] - 40, v.at[1] - 30) < 1e-6)!;
    expect(bottom && corner).toBeTruthy();
    // the place along the edge from its first end: the middle is 0.5 whichever way the edge runs
    const annotations: Annotation[] = [
      { id: 'ann1', kind: 'datum', view: 'view1', at: [20, 0], label: 'A', attach: { ref: bottom.ref, u: 0.5 } },
      { id: 'ann2', kind: 'note', view: 'view1', at: [60, 40], text: 'x', leader: [40, 30], attach: { ref: corner.ref, u: 0 } },
    ];
    const views = (s: ReturnType<typeof seenOf>) => new Map([['view1', s]]);
    const before = attachedAnnotations(annotations, views(narrow));
    expect(before.lost.size).toBe(0);
    expect((before.annotations[0] as { at: number[] }).at[0]).toBeCloseTo(20, 6);
    expect((before.annotations[1] as { leader: number[] }).leader).toEqual([expect.closeTo(40, 6), expect.closeTo(30, 6)]);
    const wide = seenOf(plate(60, true));
    const after = attachedAnnotations(annotations, views(wide));
    expect(after.lost.size).toBe(0);
    expect((after.annotations[0] as { at: number[] }).at[0]).toBeCloseTo(30, 6);
    expect((after.annotations[1] as { leader: number[] }).leader).toEqual([expect.closeTo(60, 6), expect.closeTo(30, 6)]);
    // the note's text stays where it was put: only the point on the feature is the model's
    expect((after.annotations[1] as { at: number[] }).at).toEqual([60, 40]);
  });

  it('the hole taken away: its centre mark stays where it was, and is said to be lost', () => {
    const withHole = seenOf(plate(40, true));
    const ring = withHole.features.find((f): f is Extract<typeof f, { type: 'circle' }> => f.type === 'circle' && f.full)!;
    const mark: Annotation = { id: 'ann3', kind: 'centreMark', view: 'view1', at: [ring.centre[0], ring.centre[1]], radius: 4, attach: { ref: ring.ref, u: 0 } };
    expect(attachedAnnotations([mark], new Map([['view1', withHole]])).lost.size).toBe(0);
    const without = attachedAnnotations([mark], new Map([['view1', seenOf(plate(40, false))]]));
    expect([...without.lost]).toEqual(['ann3']);
    expect((without.annotations[0] as { at: number[] }).at).toEqual([ring.centre[0], ring.centre[1]]);
  });

  it('the commands refuse a place along an edge outside 0 to 1, an empty reference, and a note fastened without a leader', () => {
    let doc = createEmptyDrawing();
    doc = applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: 'view1', name: 'Front', source: 'p.3dbx', direction: 'front' }] });
    const edge = { kind: 'edge' as const, name: 'e' };
    const insert = (a: Annotation) => applyDrawingCommand(doc, { type: 'insertAnnotations', annotations: [a] });
    expect(() => insert({ id: 'ann1', kind: 'datum', view: 'view1', at: [0, 0], label: 'A', attach: { ref: edge, u: 0.3 } })).not.toThrow();
    for (const u of [-0.1, 1.1, Number.NaN]) expect(() => insert({ id: 'ann1', kind: 'datum', view: 'view1', at: [0, 0], label: 'A', attach: { ref: edge, u } }), String(u)).toThrow(CommandError);
    expect(() => insert({ id: 'ann1', kind: 'datum', view: 'view1', at: [0, 0], label: 'A', attach: { ref: { kind: 'edge', name: '' }, u: 0 } })).toThrow(CommandError);
    expect(() => insert({ id: 'ann1', kind: 'note', view: 'view1', at: [0, 0], text: 'x', attach: { ref: edge, u: 0 } })).toThrow(CommandError);
    // taking the leader away takes the fastening with it, in one change
    let withNote = insert({ id: 'ann1', kind: 'note', view: 'view1', at: [0, 0], text: 'x', leader: [5, 5], attach: { ref: edge, u: 0 } });
    expect(() => applyDrawingCommand(withNote, { type: 'setAnnotation', annotationId: 'ann1', patch: { leader: null } })).toThrow(CommandError);
    withNote = applyDrawingCommand(withNote, { type: 'setAnnotation', annotationId: 'ann1', patch: { leader: null, attach: null } });
    expect('attach' in withNote.annotations[0]!).toBe(false);
  });
});
