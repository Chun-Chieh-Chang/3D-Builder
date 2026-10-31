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

  it('hover on a short stub previews it extended to its first crossing, and the click lands there', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, -10, 0);
    click(c, 9, 0);
    c.escape();
    click(c, 10, -5);
    click(c, 10, 5);
    c.escape();
    const counts = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };

    c.setTool('extend');
    move(c, 8.5, 0);
    const seen = overview(c);
    expect(seen).toEqual([{ kind: 'line', role: 'change', s: expect.objectContaining({ kind: 'line', role: 'change', a: [-10, 0], b: [10, 0] }) }]);
    expect(h.sketch().entities).toHaveLength(counts.entities);

    click(c, 8.5, 0); // the confirming click submits the same plan
    await c.settled();
    const l1 = h.last!.geometry.get('l1')! as Extract<SolvedGeometry, { type: 'line' }>;
    expect(l1.b[0]).toBeCloseTo(10, 6);
    expect(l1.b[1]).toBeCloseTo(0, 6);
    expect(c.getView().preview).toEqual([]); // the plan went with the document revision it was built from

    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(counts.entities);
    expect(h.sketch().constraints).toHaveLength(counts.constraints);
    c.setTool('select');
  });

  it('hover on a corner point previews the fillet that the click then makes', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 0);
    click(c, 10, 10);
    c.escape();
    const counts = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };

    c.setTool('sketchFillet');
    move(c, 10.001, 0.001); // the corner both lines meet at
    const seen = overview(c);
    expect(seen.some((x) => x.kind === 'arc' && x.role === 'add')).toBe(true);
    expect(seen.filter((x) => x.kind === 'line' && x.role === 'change').length).toBe(2); // both legs shorten by the radius
    const plan = seen.find((x) => x.kind === 'arc' && x.role === 'add')! as { s: Extract<PreviewShape, { kind: 'arc' }> };
    expect(plan.s.r).toBeCloseTo(5, 9); // the option's fillet radius
    expect(h.sketch().entities).toHaveLength(counts.entities);

    click(c, 10.001, 0.001); // the click previews nothing by itself: same plan, same result
    await c.settled();
    const arcs = h.sketch().entities.filter((e) => e.type === 'arc');
    expect(arcs).toHaveLength(1);
    const g = h.last!.geometry.get(arcs[0]!.id)! as Extract<SolvedGeometry, { type: 'arc' }>;
    expect(g.r).toBeCloseTo(5, 6);
    expect(c.getView().preview).toEqual([]);

    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(counts.entities);
    c.setTool('select');
  });

  it('hover on the same corner previews the chamfer bevel the click then makes', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 0);
    click(c, 10, 10);
    c.escape();

    c.setTool('sketchChamfer');
    move(c, 10.001, 0.001);
    const seen = overview(c);
    expect(seen.some((x) => x.kind === 'line' && x.role === 'add')).toBe(true); // the bevel is a straight piece
    c.setTool('select');
  });

  it('hover beside a selected line previews the offset copy the click then makes', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 20, 0);
    c.escape();
    const counts = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };

    c.select(['l1']);
    c.setTool('offset');
    move(c, 10, 5); // above the line: that is the side the copy goes to
    const seen = overview(c);
    expect(seen).toEqual([{ kind: 'line', role: 'add', s: expect.objectContaining({ kind: 'line', role: 'add', a: [0, 5], b: [20, 5] }) }]);
    expect(h.sketch().entities).toHaveLength(counts.entities);

    click(c, 10, 5); // the confirming click submits the same plan
    await c.settled();
    const lines = h.sketch().entities.filter((e) => e.type === 'line' && !e.construction);
    expect(lines).toHaveLength(2);
    const g = h.last!.geometry.get('l1')! as Extract<SolvedGeometry, { type: 'line' }>;
    expect(g.a[1]).toBeCloseTo(0, 6); // the original stays where it was
    expect(c.getView().preview).toEqual([]);

    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(counts.entities);
    c.setTool('select');
  });

  it('hover on another line previews the mirrored copy the click then makes', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 0);
    c.escape();
    click(c, 0, 0);
    click(c, 0, 10);
    c.escape();
    const counts = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };

    c.select(['l1']); // what gets mirrored
    c.setTool('mirror');
    move(c, 0, 1); // the vertical line is the mirror: the hover must be on it
    const seen = overview(c);
    expect(seen).toEqual([{ kind: 'line', role: 'add', s: expect.objectContaining({ kind: 'line', role: 'add', a: [0, 0], b: [-10, 0] }) }]);
    expect(h.sketch().entities).toHaveLength(counts.entities);

    click(c, 0, 1); // the confirming click submits the same plan
    await c.settled();
    const lines = h.sketch().entities.filter((e) => e.type === 'line' && !e.construction);
    expect(lines).toHaveLength(3);
    expect(c.getView().preview).toEqual([]);

    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(counts.entities);
    c.setTool('select');
  });
});
