/**
 * B2.2 (2026-10-17): Hiding individual edges in drawing views (ADR / handoff).
 * An edge of a view can be hidden by its persistent name (and component id for an assembly).
 * The view spans the same bounding box, but the hidden edge's lines are not drawn.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  createEmptyDrawing,
  parseDrawing,
  serializeDrawing,
  viewVectors,
  page,
  type DrawingDoc,
  type DrawingRef,
  type DrawingView,
  type ViewAxes,
  type ViewEdgeSet,
} from '@3db/model';
import { Kernel, type ShapeId } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, viewEdges, type RebuildResult } from '@3db/regen';
import { visibleElements, withoutHiddenEdges, type ViewLines } from '@3db/drawing';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let built: RebuildResult;
let shape: ShapeId;
const kept: Regenerator[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
  const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  kept.push(regen);
  // a box 40 × 30 × 20
  built = regen.rebuild(
    build(
      sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
    ),
  );
  shape = built.body!.shape;
});

afterAll(() => kept.forEach((r) => r.dispose()));

const baseDoc = (): DrawingDoc =>
  applyDrawingCommand(createEmptyDrawing(), {
    type: 'insertViews',
    views: [{ id: 'v1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' }],
  });

describe('B2.2: hide individual edges — model validation and mutations', () => {
  it('adds hidden edges to a view via setView', () => {
    const doc = baseDoc();
    const edgeRef: DrawingRef = { kind: 'edge', name: 'e1:side:s1.a1' };
    const next = applyDrawingCommand(doc, {
      type: 'setView',
      viewId: 'v1',
      patch: { hiddenEdges: [edgeRef] },
    });
    const v = page(next).views.find((x) => x.id === 'v1')!;
    expect(v.hiddenEdges).toHaveLength(1);
    expect(v.hiddenEdges![0]).toEqual(edgeRef);
  });

  it('preserves assembly leaf "in" attribute in hiddenEdges', () => {
    const doc = baseDoc();
    const edgeRef: DrawingRef = { kind: 'edge', name: 'e1:side:s1.a1', in: 'pin_1' };
    const next = applyDrawingCommand(doc, {
      type: 'setView',
      viewId: 'v1',
      patch: { hiddenEdges: [edgeRef] },
    });
    const v = page(next).views.find((x) => x.id === 'v1')!;
    expect(v.hiddenEdges![0]).toEqual({ kind: 'edge', name: 'e1:side:s1.a1', in: 'pin_1' });
  });

  it('unhiding all edges (hiddenEdges: null or []) removes the property', () => {
    const doc = baseDoc();
    const withHidden = applyDrawingCommand(doc, {
      type: 'setView',
      viewId: 'v1',
      patch: { hiddenEdges: [{ kind: 'edge', name: 'edge1' }] },
    });
    expect(page(withHidden).views[0]!.hiddenEdges).toBeDefined();

    const clearedNull = applyDrawingCommand(withHidden, {
      type: 'setView',
      viewId: 'v1',
      patch: { hiddenEdges: null },
    });
    expect(page(clearedNull).views[0]!.hiddenEdges).toBeUndefined();

    const clearedEmpty = applyDrawingCommand(withHidden, {
      type: 'setView',
      viewId: 'v1',
      patch: { hiddenEdges: [] },
    });
    expect(page(clearedEmpty).views[0]!.hiddenEdges).toBeUndefined();
  });

  it('rejects invalid hidden edge references (red team input corruption)', () => {
    const doc = baseDoc();
    // non-edge kind
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setView',
        viewId: 'v1',
        patch: { hiddenEdges: [{ kind: 'face' as any, name: 'f1' }] },
      }),
    ).toThrow();

    // empty or blank name
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setView',
        viewId: 'v1',
        patch: { hiddenEdges: [{ kind: 'edge', name: '   ' }] },
      }),
    ).toThrow();

    // invalid in field
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setView',
        viewId: 'v1',
        patch: { hiddenEdges: [{ kind: 'edge', name: 'e1', in: '   ' }] },
      }),
    ).toThrow();

    // not an array
    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setView',
        viewId: 'v1',
        patch: { hiddenEdges: 'not an array' as any },
      }),
    ).toThrow();
  });

  it('round-trips hiddenEdges through serializeDrawing and parseDrawing', () => {
    const doc = baseDoc();
    const withHidden = applyDrawingCommand(doc, {
      type: 'setView',
      viewId: 'v1',
      patch: { hiddenEdges: [{ kind: 'edge', name: 'edge_abc', in: 'part_xyz' }] },
    });
    const serialized = serializeDrawing(withHidden);
    const parsed = parseDrawing(serialized);
    expect(page(parsed).views[0]!.hiddenEdges).toEqual([{ kind: 'edge', name: 'edge_abc', in: 'part_xyz' }]);
  });
});

describe('B2.2: withoutHiddenEdges — geometry and line filtering', () => {
  it('removes the lines of the specified edge from visible lines', () => {
    const axes: ViewAxes = viewVectors('front');
    const body = built.body!;
    const lines = kernel.projectView(shape, axes) as ViewLines;
    const edgeSet: ViewEdgeSet = viewEdges(kernel, shape, body.topology, body.names, axes);

    expect(lines.visible.length).toBeGreaterThan(0);
    expect(edgeSet.edges.length).toBeGreaterThan(0);

    const seen = visibleElements(lines, edgeSet, []);
    expect(seen.edges.length).toBeGreaterThan(0);
    const targetEdge = seen.edges[0]!;
    const originalVisibleCount = lines.visible.length;

    const filtered = withoutHiddenEdges(lines, edgeSet, [targetEdge.ref]);

    // Visibly fewer polylines
    expect(filtered.visible.length).toBeLessThan(originalVisibleCount);
    // Bounding box spans the same as before (box is not shrunken)
    expect(filtered.box).toEqual(lines.box);
  });

  it('returns exact same lines when hidden edges list is empty', () => {
    const axes: ViewAxes = viewVectors('front');
    const lines = kernel.projectView(shape, axes) as ViewLines;
    const edgeSet: ViewEdgeSet = viewEdges(kernel, shape, built.body!.topology, built.body!.names, axes);

    const filtered = withoutHiddenEdges(lines, edgeSet, []);
    expect(filtered).toBe(lines);
  });

  it('filters based on component id "in" for assembly views', () => {
    const axes: ViewAxes = viewVectors('front');
    const lines = kernel.projectView(shape, axes) as ViewLines;
    const edgeSet: ViewEdgeSet = {
      edges: [
        {
          kind: 'line',
          ref: { kind: 'edge', name: 'top_edge', in: 'comp_1' },
          points: [0, 30, 40, 30],
          ends: [null, null],
          depth: [0, 0],
        },
      ],
      vertices: [],
    };
    const mockLines: ViewLines = {
      visible: [[0, 30, 40, 30], [0, 0, 40, 0]],
      hidden: [],
      box: { min: [0, 0], max: [40, 30] },
    };

    // Edge in comp_2 should NOT hide edge in comp_1
    const noMatch = withoutHiddenEdges(mockLines, edgeSet, [{ kind: 'edge', name: 'top_edge', in: 'comp_2' }]);
    expect(noMatch.visible).toHaveLength(2);

    // Edge in comp_1 matches and hides
    const match = withoutHiddenEdges(mockLines, edgeSet, [{ kind: 'edge', name: 'top_edge', in: 'comp_1' }]);
    expect(match.visible).toHaveLength(1);
    expect(match.visible[0]).toEqual([0, 0, 40, 0]);
    // Box preserved
    expect(match.box).toEqual(mockLines.box);
  });
});

describe('B2.2: DrawingStore hideEdge and unhideEdge store methods', async () => {
  const { DrawingStore } = await import('../../apps/web/src/state/drawing');

  it('hides an edge, ignores duplicate hides, and unhides cleanly', () => {
    const notices: string[] = [];
    const host = {
      api: {} as any,
      changed: () => {},
      notify: (text: string) => void notices.push(text),
      projectFolder: async () => null,
    };
    const store = new DrawingStore(host as any, {
      doc: baseDoc(),
      handle: null,
      fileName: null,
      folder: '',
      untitled: '圖',
      project: null,
    });

    const edgeRef: DrawingRef = { kind: 'edge', name: 'edge_top' };

    // 1. First hide succeeds
    const hide1 = store.hideEdge('v1', edgeRef);
    expect(hide1).toBe(true);
    expect(page(store.getState().doc).views[0]!.hiddenEdges).toEqual([edgeRef]);
    expect(notices).toHaveLength(1);

    // 2. Duplicate hide is rejected as no-op
    const hide2 = store.hideEdge('v1', edgeRef);
    expect(hide2).toBe(false);
    expect(page(store.getState().doc).views[0]!.hiddenEdges).toHaveLength(1);

    // 3. Unhide removes it and clears property when empty
    const unhide1 = store.unhideEdge('v1', 'edge_top');
    expect(unhide1).toBe(true);
    expect(page(store.getState().doc).views[0]!.hiddenEdges).toBeUndefined();
    expect(notices).toHaveLength(2);

    // 4. Duplicate unhide returns false
    const unhide2 = store.unhideEdge('v1', 'edge_top');
    expect(unhide2).toBe(false);

    // 5. Non-existent view returns false
    expect(store.hideEdge('non_existent', edgeRef)).toBe(false);
    expect(store.unhideEdge('non_existent', 'edge_top')).toBe(false);
  });
});
