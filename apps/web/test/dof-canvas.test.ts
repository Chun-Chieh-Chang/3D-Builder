/**
 * G13 (P4): the solver's own answers on the canvas. The DOF analysis draws one arrow per probed axis beside the point, along the
 * displacement the solver actually made; a hovered fix of an over-defined sketch is previewed before it is applied — the entities
 * that would move, dashed, and a fix that moves nothing says so instead of drawing a ghost of the same shape.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, SKETCH_ORIGIN, DocHistory, resolveSketch, type Command, type Id, type PartDoc, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedGeometry } from '@3db/sketch';
import type { PlaneFrame } from '@3db/render';
import { buildOverlay, arrowPoints, arrowTip, MOTION_ARROW_PX, SKETCH_COLORS } from '../src/sketcher/overlay';
import { SketchController, type SketchHost } from '../src/sketcher/controller';
import type { ControllerView } from '../src/sketcher/controller';
import type { SketchSolvePayload } from '../src/worker/protocol';

const FRONT: PlaneFrame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const PX = 0.05;
const view = (): ControllerView =>
  ({ tool: 'select', selection: [], hover: null, snap: null, inference: null, inferLine: null, quickSnap: null, grid: null, preview: [], picks: [], pickedCrossings: [], cursor: null, hint: '', message: null, options: {} }) as unknown as ControllerView;

describe('motion arrows of the DOF analysis (G13)', () => {
  it('a direction with no length draws nothing; a real one is a shaft of constant screen length with a symmetric head', () => {
    expect(arrowPoints([1, 2], [0, 0], PX)).toEqual([]);
    const strokes = arrowPoints([1, 2], [3, 0], PX);
    expect(strokes.length).toBe(2);
    const [shaft, head] = strokes;
    expect(shaft![0]).toEqual([1, 2]);
    expect(shaft![1]![0]).toBeCloseTo(1 + MOTION_ARROW_PX * PX, 12);
    expect(shaft![1]![1]).toBe(2);
    // the head's middle is the tip, and its two wings stand off it symmetrically (wing(-1) first, so below the shaft for +x)
    expect(head![1]).toEqual(shaft![1]);
    expect(head![0]![1]).toBeCloseTo(2 - 8 * PX * 0.7, 12);
    expect(head![2]![1]).toBeCloseTo(2 + 8 * PX * 0.7, 12);
    expect(head![0]![0]).toBeCloseTo(head![2]![0], 12);
    expect(arrowTip([1, 2], [3, 0], PX)).toEqual(shaft![1]);
  });

  it('the overlay draws one arrow and one labelled hint per probed axis, from the point the analysis named', () => {
    const geometry = new Map<Id, SolvedGeometry>([['p1', { type: 'point', p: [30, 0] }]]);
    const solve = { seq: 0, geometry, status: 'under', dof: 1, conflicting: [], redundant: [], problems: [], ms: 0 } as unknown as SketchSolvePayload;
    const o = buildOverlay(FRONT, { ...(createEmptyPart().features[0] as SketchFeature), entities: [], constraints: [] }, solve, view(), PX, {
      showRelations: false,
      dimensionPreview: null,
      dofMotion: { at: [30, 0], probes: [{ axis: 'x', delta: [0.5, 0] }, { axis: 'y', delta: [0, 0.5] }] },
    });
    const shafts = o.curves.filter((c) => c.color === SKETCH_COLORS.under && c.points.length === 2);
    expect(shafts.length).toBe(2);
    expect(shafts[0]!.points[1]![0]).toBeCloseTo(30 + MOTION_ARROW_PX * PX, 12);
    const labels = o.labels.filter((l) => l.className === 'motion');
    expect(labels.length).toBe(2);
    expect(labels[0]!.key).toBe('motion:x');
    expect(labels[0]!.text).toContain('X');
    expect(labels[1]!.key).toBe('motion:y');
    expect(labels[1]!.text).toContain('Y');
  });

  it('a fix preview: the shapes that move are dashed in the change colour, and a fix that moves nothing draws only its note', () => {
    const sketch = { ...(createEmptyPart().features[0] as SketchFeature), entities: [], constraints: [] };
    const solve = { seq: 0, geometry: new Map(), status: 'over', dof: 0, conflicting: [], redundant: [], problems: [], ms: 0 } as unknown as SketchSolvePayload;
    const line = { type: 'line', a: [0, 0], b: [40, 0], p1: 'p1', p2: 'p2', construction: false } as SolvedGeometry;
    const o = buildOverlay(FRONT, sketch, solve, view(), PX, {
      showRelations: false,
      dimensionPreview: null,
      fixPreview: { shapes: [line], at: [20, 0], moved: true },
    });
    const dashed = o.curves.filter((c) => c.dashed && c.color === SKETCH_COLORS.opChange);
    expect(dashed.length).toBe(1);
    expect(dashed[0]!.points[0]).toEqual([0, 0]);
    const label = o.labels.find((l) => l.key === 'fix-preview')!;
    expect(label.className).toBe('hint');
    expect(label.text.length).toBeGreaterThan(0);
    const o2 = buildOverlay(FRONT, sketch, solve, view(), PX, { showRelations: false, dimensionPreview: null, fixPreview: { shapes: [], at: [0, 0], moved: false } });
    expect(o2.curves.filter((c) => c.dashed && c.color === SKETCH_COLORS.opChange).length).toBe(0);
    expect(o2.labels.find((l) => l.key === 'fix-preview')).toBeTruthy();
  });
});

// ---------------------------------------------------------------- the controller's fix preview, against the real solver

const OVER_SKETCH: Command = {
  type: 'insertFeature',
  index: 0,
  feature: {
    id: 'sketch1',
    type: 'sketch',
    name: '草圖1',
    suppressed: false,
    plane: { kind: 'datum', name: 'plane:front' },
    entities: [
      { id: 'p1', type: 'point', x: 0, y: 0 },
      { id: 'p2', type: 'point', x: 30, y: 0 },
      { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
    ],
    constraints: [
      { id: 'c1', type: 'coincident', a: 'p1', b: SKETCH_ORIGIN },
      { id: 'c2', type: 'horizontal', a: 'l1' },
      { id: 'd1', type: 'distance', a: 'l1', value: '30', driving: true },
      { id: 'd2', type: 'distanceX', a: 'p1', b: 'p2', value: '40', driving: true },
    ],
  },
};

class Host implements SketchHost {
  readonly featureId = 'sketch1';
  readonly history: DocHistory;
  last: SketchSolvePayload | null = null;
  constructor(doc: PartDoc) {
    this.history = new DocHistory(doc);
    this.resolve();
  }
  sketch(): SketchFeature {
    return this.history.doc.features.find((f) => f.id === this.featureId) as SketchFeature;
  }
  resolve(): void {
    const r = solver.solve(resolveSketch(this.sketch(), this.history.doc), {});
    this.last = { seq: 0, ...r, ms: 0, problems: r.status === 'failed' ? [] : [] };
  }
  doc = (): PartDoc => this.history.doc;
  solved = () => this.last;
  execute = (cmd: Command) => {
    try {
      this.history.execute(cmd);
      this.resolve();
      return true;
    } catch {
      return false;
    }
  };
  dragPreview: SketchHost['dragPreview'] = () => {};
  trial = async (s: SketchFeature, doc?: PartDoc) => {
    const r = solver.solve(resolveSketch(s, doc ?? this.history.doc), {});
    return { seq: 0, ...r, ms: 0, problems: r.status === 'failed' ? [] : [] } as SketchSolvePayload;
  };
  notify = () => {};
  editDimension = () => {};
}

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

describe('the fix preview of an over-defined sketch, against the real solver (G13)', () => {
  it('two dimensions that disagree: the fix whose demotion lets the other drive moves the edge to 40; the other moves nothing', async () => {
    const host = new Host(applyCommand(createEmptyPart(), OVER_SKETCH));
    const controller = new SketchController(host);
    const solved = host.last!;
    expect(solved.status).toBe('over');
    const fixes = await controller.diagnose();
    expect(fixes.length).toBeGreaterThan(0);
    const previews = [];
    for (const fix of fixes) previews.push(await controller.fixPreview(fix));
    expect(previews.every((p) => p !== null)).toBe(true);
    const moved = previews.find((p) => p!.moved)!;
    expect(moved.shapes.length).toBeGreaterThan(0);
    const movedLine = moved.shapes.find((g) => g.type === 'line') as Extract<SolvedGeometry, { type: 'line' }>;
    expect(Math.max(movedLine.a[0], movedLine.b[0])).toBeCloseTo(40, 6);
    // the label sits by the entity that moves
    expect(moved.at[0]).toBeGreaterThan(0);
    const statics = previews.filter((p) => !p!.moved);
    expect(statics.length).toBeGreaterThan(0);
    for (const s of statics) expect(s!.shapes.length).toBe(0);
  });
});
