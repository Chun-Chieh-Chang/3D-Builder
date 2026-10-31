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

  it('an offset drawn to both sides previews two copies, and the click lands them (G09, P2-3)', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 20, 0);
    c.escape();
    const counts = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };

    c.select(['l1']);
    c.setTool('offset');
    c.setOption('offsetBoth', true);
    move(c, 10, 5);
    const seen = overview(c).filter((x) => x.kind === 'line' && x.role === 'add');
    expect(seen).toHaveLength(2); // one copy on each side
    const ys = seen.map((x) => (x.s as Extract<PreviewShape, { kind: 'line' }>).a[1]).map((v) => Math.round(v * 1e6) / 1e6).sort((a, b) => a - b);
    expect(ys).toEqual([-5, 5]);
    expect(h.sketch().entities).toHaveLength(counts.entities);

    click(c, 10, 5); // the confirming click submits the same plan
    await c.settled();
    expect(h.sketch().entities.filter((e) => e.type === 'line' && !e.construction)).toHaveLength(3);
    expect(c.getView().preview).toEqual([]);

    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(counts.entities);
    expect(h.sketch().constraints).toHaveLength(counts.constraints);
    c.setTool('select');
  });

  it('封口 previews the closing lines of an open chain, and the click makes them (G09, P2-3)', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 20, 0);
    c.escape(); // one open chain: a single line has two free ends
    const counts = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };

    c.select(['l1']);
    c.setTool('offset');
    c.setOption('offsetCaps', true);
    move(c, 10, 5);
    const seen = overview(c).filter((x) => x.kind === 'line' && x.role === 'add');
    expect(seen).toHaveLength(3); // the copy and its two caps
    expect(h.sketch().entities).toHaveLength(counts.entities);

    click(c, 10, 5); // the confirming click submits the same plan
    await c.settled();
    expect(h.sketch().entities.filter((e) => e.type === 'line' && !e.construction)).toHaveLength(4);
    expect(c.getView().preview).toEqual([]);

    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(counts.entities);
    expect(h.sketch().constraints).toHaveLength(counts.constraints);
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

describe('drag-sweep trim (G07, P2-4)', () => {
  /** Three verticals each crossed by two horizontals, so a stroke along y=0 cuts out each vertical's middle. */
  function scene(c: SketchController): void {
    for (const x of [-8, -4, 4]) {
      c.setTool('line');
      click(c, x, -5);
      click(c, x, 5);
      c.escape();
    }
    for (const y of [-2, 2]) {
      c.setTool('line');
      click(c, -12, y);
      click(c, 12, y);
      c.escape();
    }
  }
  const verticals = (h: Host, x: number): Extract<SolvedGeometry, { type: 'line' }>[] =>
    [...h.last!.geometry.values()].filter(
      (g): g is Extract<SolvedGeometry, { type: 'line' }> => g.type === 'line' && Math.abs(g.a[0] - x) < 1e-6 && Math.abs(g.b[0] - x) < 1e-6,
    );
  const lineCount = (h: Host) => h.sketch().entities.filter((e) => e.type === 'line' && !e.construction).length;

  it('one stroke across three segments trims each once, as a single undo', async () => {
    const h = new Host();
    const c = new SketchController(h);
    scene(c);
    const before = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };
    const rev = h.history.doc;

    c.setTool('trim');
    c.pointerMove(at(-11, 0), false);
    c.pointerDown(at(-11, 0));
    c.pointerMove(at(-8, 0), true);
    c.pointerMove(at(-4, 0), true);
    const seen = overview(c);
    expect(seen.filter((s) => s.role === 'change')).toHaveLength(2); // the two verticals crossed so far
    expect(seen.filter((s) => s.role === 'add')).toHaveLength(2);
    c.pointerMove(at(4, 0), true);
    expect(overview(c).filter((s) => s.role === 'change')).toHaveLength(3);
    expect(h.sketch().entities).toHaveLength(before.entities); // the stroke commits nothing yet

    c.pointerUp(at(11, 0));
    await c.settled();
    expect(h.history.doc).not.toBe(rev); // one command
    expect(lineCount(h)).toBe(8); // each of the three verticals split in two, plus the two horizontals
    expect(c.getView().preview).toEqual([]);
    for (const x of [-8, -4, 4]) {
      const spans = verticals(h, x)
        .map((g) => [Math.min(g.a[1], g.b[1]), Math.max(g.a[1], g.b[1])] as [number, number])
        .sort((p, q) => p[0] - q[0]);
      expect(verticals(h, x)).toHaveLength(2);
      expect(spans[0]![1]).toBeCloseTo(-2, 6);
      expect(spans[1]![0]).toBeCloseTo(2, 6);
    }

    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(before.entities); // the one command is the whole stroke
    expect(h.sketch().constraints).toHaveLength(before.constraints);
    c.setTool('select');
  });

  it('crossing the same segment again within one stroke trims it only once', async () => {
    const h = new Host();
    const c = new SketchController(h);
    scene(c);

    c.setTool('trim');
    c.pointerMove(at(-11, 0), false);
    c.pointerDown(at(-11, 0));
    for (const x of [-8, -4, 4]) c.pointerMove(at(x, 0), true);
    for (const x of [4, -4, -8]) c.pointerMove(at(x, 0), true); // back over the same three
    c.pointerUp(at(-11, 0));
    await c.settled();
    expect(lineCount(h)).toBe(8); // not twelve: each segment was trimmed once
    c.setTool('select');
  });

  it('a stroke that crosses nothing changes nothing and adds no undo step', () => {
    const h = new Host();
    const c = new SketchController(h);
    scene(c);
    const before = h.sketch().entities.length;
    const rev = h.history.doc;

    c.setTool('trim');
    c.pointerMove(at(-11, 8), false);
    c.pointerDown(at(-11, 8));
    c.pointerMove(at(11, 12), true); // empty space, clear of everything
    c.pointerUp(at(11, 12));
    expect(h.sketch().entities).toHaveLength(before);
    expect(h.history.doc).toBe(rev);
    expect(c.getView().preview).toEqual([]);
  });

  it('Esc during a stroke stops previewing and the release changes nothing', () => {
    const h = new Host();
    const c = new SketchController(h);
    scene(c);
    const before = h.sketch().entities.length;
    const rev = h.history.doc;

    c.setTool('trim');
    c.pointerMove(at(-11, 0), false);
    c.pointerDown(at(-11, 0));
    c.pointerMove(at(-8, 0), true);
    expect(overview(c).length).toBeGreaterThan(0);
    c.escape();
    expect(c.getView().preview).toEqual([]);
    c.pointerUp(at(4, 0));
    expect(h.sketch().entities).toHaveLength(before);
    expect(h.history.doc).toBe(rev);
    c.setTool('select');
  });
});

describe('extend to a chosen boundary (G08, P2-5)', () => {
  /** A stub reaching x=9, a wall at x=10 and a farther wall at x=16. */
  function scene(c: SketchController): void {
    c.setTool('line');
    click(c, -10, 0);
    click(c, 9, 0);
    c.escape();
    for (const x of [10, 16]) {
      click(c, x, -5);
      click(c, x, 5);
      c.escape();
    }
  }
  const verticalAt = (h: Host, x: number): string => [...h.last!.geometry].find(([, g]) => g.type === 'line' && g.a[0] === x && g.b[0] === x)![0];

  it('a preselected curve is the boundary: preview and click cross the nearer curve to reach it', async () => {
    const h = new Host();
    const c = new SketchController(h);
    scene(c);
    const counts = { entities: h.sketch().entities.length, constraints: h.sketch().constraints.length };
    const farId = verticalAt(h, 16);
    const nearId = verticalAt(h, 10);

    c.select([farId]); // the chosen boundary (G08): a curve the user picks first
    c.setTool('extend');
    move(c, 8.5, 0);
    expect(overview(c)).toEqual([
      { kind: 'line', role: 'change', s: expect.objectContaining({ kind: 'line', role: 'change', a: [-10, 0], b: [16, 0] }) },
    ]);
    expect(h.sketch().entities).toHaveLength(counts.entities); // hover commits nothing

    click(c, 8.5, 0); // the confirming click submits the same plan
    await c.settled();
    const l1 = h.last!.geometry.get('l1')! as Extract<SolvedGeometry, { type: 'line' }>;
    expect(l1.b[0]).toBeCloseTo(16, 6);
    expect(l1.b[1]).toBeCloseTo(0, 6);
    const near = h.last!.geometry.get(nearId)! as Extract<SolvedGeometry, { type: 'line' }>;
    expect(near.a[0]).toBeCloseTo(10, 6); // the curve it crossed is untouched
    expect(c.getView().preview).toEqual([]);

    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(counts.entities);
    expect(h.sketch().constraints).toHaveLength(counts.constraints);
    c.setTool('select');
  });

  it('with nothing preselected the extend keeps its default: the nearest curve in the way', () => {
    const h = new Host();
    const c = new SketchController(h);
    scene(c);
    c.setTool('extend');
    move(c, 8.5, 0);
    expect(overview(c)).toEqual([
      { kind: 'line', role: 'change', s: expect.objectContaining({ kind: 'line', role: 'change', a: [-10, 0], b: [10, 0] }) },
    ]);
    c.setTool('select');
  });
});
