/**
 * B2.3 (2026-10-19): the tangent edges of a view. The lines where two faces meet smoothly (a fillet meeting a face, the seam of a cylinder) are no
 * longer mixed into a view's visible lines: the kernel gives them on their own (`ProjectedView.tangent`), the drawing carries them (`ViewLines.tangent`)
 * and draws them thin — as before unless the view leaves them out (`showTangentEdges: false`), which is how a drawing made before the field looks. Verified against the shape itself: a
 * filleted plate has them and a plain one has none, so the field is never made up.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, parseDrawing, serializeDrawing, type DrawingDoc, type DrawingView, type ModelDrawingView, page } from '@3db/model';
import { Kernel, type ShapeId } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator } from '@3db/regen';
import { resolveLines, viewItems, type PlacedView, type ViewLines } from '@3db/drawing';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let regen: Regenerator;
const made: ShapeId[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});
afterAll(() => {
  for (const id of made) kernel.release(id);
  regen.dispose();
});

/** A plate 40 × 30 × 20, extruded from a rectangle: a box, which has no smooth edge at all. */
const box = (): ShapeId =>
  regen.rebuild(
    build(
      sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
    ),
  ).body!.shape;

describe('the tangent edges of a shape (B2.3)', () => {
  it('a filleted plate has them, apart from the visible lines; a plain one has none', () => {
    const dirs: { dir: [number, number, number]; up: [number, number, number] }[] = [
      { dir: [0, 0, -1], up: [0, 1, 0] },
      { dir: [0, 1, 0], up: [0, 0, 1] },
      { dir: [-1, 0, 0], up: [0, 0, 1] },
      { dir: [-1, -1, -1], up: [0, 0, 1] },
    ];
    const plain = box();
    // a box has no smooth edge: nothing is made up, in any view
    for (const d of dirs) expect(kernel.projectView(plain, d).tangent ?? [], `${d.dir}`).toHaveLength(0);

    const topo = kernel.topology(plain);
    const edge = topo.edges.findIndex((e) => e.curve === 'line');
    expect(edge).toBeGreaterThanOrEqual(0);
    const filleted = kernel.fillet(plain, [edge], 3).shape;
    made.push(filleted);
    const views = dirs.map((d) => kernel.projectView(filleted, d));
    // the smooth edge of the fillet shows in at least one view, and always apart from the visible lines
    const withTangent = views.filter((v) => (v.tangent ?? []).length > 0);
    expect(withTangent.length).toBeGreaterThan(0);
    for (const v of withTangent) {
      const visible = new Set(v.visible.map((l) => l.join(',')));
      for (const t of v.tangent!) {
        expect(t.length).toBeGreaterThanOrEqual(4);
        expect(visible.has(t.join(','))).toBe(false);
      }
    }
  });

  it('asking for a view leaks no shapes, tangent lines or not', () => {
    const plain = box();
    const topo = kernel.topology(plain);
    const edge = topo.edges.findIndex((e) => e.curve === 'line');
    const filleted = kernel.fillet(plain, [edge], 3).shape;
    made.push(filleted);
    const live = kernel.liveShapes;
    for (let i = 0; i < 3; i++) kernel.projectView(filleted, { dir: [0, 0, -1], up: [0, 1, 0] });
    expect(kernel.liveShapes).toBe(live);
  });
});

describe('a view asks for its tangent edges (B2.3)', () => {
  const oneView = (): DrawingDoc =>
    applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [{ id: 'front', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' }],
    });
  const viewOf = (doc: DrawingDoc) => page(doc).views[0] as ModelDrawingView;

  it('drawn by default; left out and taken back through setView', () => {
    const doc = oneView();
    expect(viewOf(doc).showTangentEdges).toBeUndefined(); // absent: drawn, as a drawing made before the field looks
    const off = applyDrawingCommand(doc, { type: 'setView', viewId: 'front', patch: { showTangentEdges: false } });
    expect(viewOf(off).showTangentEdges).toBe(false);
    expect(viewOf(applyDrawingCommand(off, { type: 'setView', viewId: 'front', patch: { showTangentEdges: true } })).showTangentEdges).toBeUndefined();
    expect(viewOf(applyDrawingCommand(off, { type: 'setView', viewId: 'front', patch: { showTangentEdges: null } })).showTangentEdges).toBeUndefined();
  });

  it('goes with the file: written and read back', () => {
    const doc = applyDrawingCommand(oneView(), { type: 'setView', viewId: 'front', patch: { showTangentEdges: false } });
    expect((page(parseDrawing(serializeDrawing(doc))).views[0] as ModelDrawingView).showTangentEdges).toBe(false);
  });
});

describe('the drawing draws the tangent edges unless the view leaves them out (B2.3)', () => {
  const lines: ViewLines = { visible: [[0, 0, 10, 0]], hidden: [], box: { min: [0, 0], max: [10, 10] }, tangent: [[2, 5, 8, 5]] };
  const placed: PlacedView = { id: 'v', at: [0, 0], scale: 1, w: 10, h: 10, centre: [5, 5] };
  const view = (show?: boolean): DrawingView => ({ id: 'v', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front', ...(show === undefined ? {} : { showTangentEdges: show }) });
  const thin = (v: DrawingView) => viewItems(v, lines, placed).filter((i) => i.style === 'thin');

  it('one thin polyline by default, none when the view leaves them out', () => {
    expect(thin(view())).toHaveLength(1);
    expect(thin(view(true))).toHaveLength(1);
    expect(thin(view(false))).toHaveLength(0);
  });

  it('not on a shaded view, which draws no edges at all', () => {
    expect(thin({ ...view(true), display: 'shaded' })).toHaveLength(0);
  });

  it("a detail view keeps its parent's tangent edges, clipped to its circle", () => {
    const doc = applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [
        { id: 'front', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' },
        { id: 'd1', kind: 'detail', name: 'Detail A', parent: 'front', centre: [5, 5], radius: 3, label: 'A' },
      ],
    });
    const resolved = resolveLines(doc, new Map([['front', lines]]));
    const tangent = resolved.get('d1')!.tangent;
    expect(tangent).toBeDefined();
    expect(tangent!.length).toBeGreaterThan(0);
    for (const l of tangent!) for (let i = 0; i < l.length; i += 2) expect(Math.hypot(l[i]! - 5, l[i + 1]! - 5)).toBeLessThanOrEqual(3 + 1e-9);
  });
});
