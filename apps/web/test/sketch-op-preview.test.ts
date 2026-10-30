import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type Command, type PartDoc, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type P2, type SolvedGeometry } from '@3db/sketch';
import { SketchController, type PointerInput, type PreviewShape, type SketchHost } from '../src/sketcher/controller';
import type { SketchSolvePayload } from '../src/worker/protocol';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EMPTY_SKETCH: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 'sketch1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};

/** The application side of the controller, synchronous: every change is solved immediately. */
class Host implements SketchHost {
  readonly featureId = 'sketch1';
  readonly history: DocHistory;
  last: SketchSolvePayload | null = null;

  constructor(doc: PartDoc = applyCommand(createEmptyPart(), EMPTY_SKETCH)) {
    this.history = new DocHistory(doc);
    this.resolve();
  }

  sketch(): SketchFeature {
    return this.history.doc.features.find((f) => f.id === this.featureId) as SketchFeature;
  }

  resolve(): void {
    const r = solver.solve(resolveSketch(this.sketch(), this.history.doc), { analyze: true });
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

type P = PointerInput;
const at = (x: number, y: number): P => ({ p: [x, y] as P2, px: 0.05, ctrl: false, shift: false });
const move = (c: SketchController, x: number, y: number) => c.pointerMove(at(x, y), false);
const click = (c: SketchController, x: number, y: number) => {
  move(c, x, y);
  c.pointerDown(at(x, y));
  c.pointerUp(at(x, y));
};

/** The preview shapes a role marks, as the overlay sees them. */
const role = (s: PreviewShape): string => (s as { role?: string }).role ?? '';
const overview = (c: SketchController) => c.getView().preview.map((s) => ({ kind: s.kind, role: role(s), s }));
/** Sets up the two crossing lines of the trim tests: a horizontal one and a vertical one. */
function lines(h: Host, c: SketchController): void {
  c.setTool('line');
  click(c, -10, 0);
  click(c, 10, 0);
  c.escape();
  click(c, 0, -5);
  click(c, 0, 5);
  c.escape();
}

describe('operation preview of the shared plan (G06, P2-1: trim)', () => {
  it('hover on a trimmable segment previews where the kept part will end, and moves nothing', () => {
    const h = new Host();
    const c = new SketchController(h);
    lines(h, c);
    const before = h.sketch().entities.length;
    c.setTool('trim');
    move(c, 5, 0);
    const seen = overview(c);
    expect(seen).toEqual([
      { kind: 'line', role: 'change', s: expect.objectContaining({ kind: 'line', role: 'change', a: [-10, 0], b: [0, 0] }) },
    ]);
    expect(h.sketch().entities).toHaveLength(before); // hover commits nothing
    expect(h.history.doc).toBe(h.doc()); // a new document revision would have dropped the plan
  });

  it('moving off the curves stops previewing and leaves the sketch alone', () => {
    const h = new Host();
    const c = new SketchController(h);
    lines(h, c);
    const counts = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };
    c.setTool('trim');
    move(c, 5, 0);
    move(c, 15, 15);
    expect(c.getView().preview).toEqual([]);
    expect(h.sketch().entities).toHaveLength(counts.entities);
    expect(h.sketch().constraints).toHaveLength(counts.constraints);
  });

  it('a circle trim previews the circle it deletes and the arc it makes, and the click lands exactly there, then one undo restores it', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('circle');
    click(c, 0, 0);
    click(c, 10, 0); // Ø20 circle
    c.setTool('line');
    click(c, -15, 0);
    click(c, 15, 0);
    c.escape();
    const counts = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };

    c.setTool('trim');
    move(c, 0, 10); // hover on the upper half: it is the part that goes
    const seen = overview(c);
    expect(seen.some((x) => x.kind === 'circle' && x.role === 'remove' && (x.s as { r: number }).r === 10)).toBe(true);
    expect(seen.some((x) => x.kind === 'arc' && x.role === 'add')).toBe(true);
    const planArc = seen.find((x) => x.kind === 'arc' && x.role === 'add')!.s as Extract<PreviewShape, { kind: 'arc' }>;
    expect(planArc.c[0]).toBeCloseTo(0, 9);
    expect(planArc.c[1]).toBeCloseTo(0, 9);
    expect(planArc.r).toBeCloseTo(10, 9);
    expect(planArc.a0).toBeCloseTo(Math.PI, 9); // from the crossing at (-10, 0)
    expect(planArc.a1).toBeCloseTo(0, 9); // to the one at (10, 0), through the bottom

    expect(h.sketch().entities).toHaveLength(counts.entities);

    click(c, 0, 10); // the confirming click submits the same plan
    await c.settled();
    const arcs = h.sketch().entities.filter((e) => e.type === 'arc');
    expect(arcs).toHaveLength(1);
    const g = h.last!.geometry.get(arcs[0]!.id)! as Extract<SolvedGeometry, { type: 'arc' }>;
    expect(g.r).toBeCloseTo(planArc.r, 6);
    expect(g.a0).toBeCloseTo(planArc.a0, 6);
    expect(g.a1).toBeCloseTo(planArc.a1, 6);
    expect(g.c[0]).toBeCloseTo(0, 6);
    expect(g.c[1]).toBeCloseTo(0, 6);
    expect(h.sketch().entities.some((e) => e.id === 'ci1')).toBe(false); // the circle is gone

    // the plan is gone with the document it was built from: nothing stale is drawn before the next move
    expect(c.getView().preview).toEqual([]);

    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(counts.entities);
    expect(h.sketch().constraints).toHaveLength(counts.constraints);
  });
});
