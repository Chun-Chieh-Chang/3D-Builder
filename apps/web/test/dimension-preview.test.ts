/**
 * The dimension preview next to the cursor (G14, ADR 0223): it says what is being measured — the entities, 「圓心」 where a circle is measured from its
 * centre rather than from the edge, and which sector of an angle — because those are the choices that were not visible before clicking (D06).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type Command, type PartDoc, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver } from '@3db/sketch';
import { SketchController, type PointerInput, type SketchHost } from '../src/sketcher/controller';
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
  private payload(s: SketchFeature, doc: PartDoc = this.history.doc): SketchSolvePayload {
    const r = solver.solve(resolveSketch(s, doc), {});
    return { seq: 0, ...r, problems: r.status === 'failed' ? [] : findProfiles(s, r).problems, ms: 0 };
  }
  resolve(): void {
    this.last = this.payload(this.sketch());
  }
  doc = () => this.history.doc;
  solved = () => this.last;
  execute = (cmd: Command) => {
    this.history.execute(cmd);
    this.resolve();
    return true;
  };
  dragPreview: SketchHost['dragPreview'] = () => this.resolve();
  trial = async (s: SketchFeature, doc?: PartDoc) => this.payload(s, doc);
  notify = () => undefined;
  editDimension = () => undefined;
}

/** ox along +x from the origin, oy 60° above it, and a circle of r = 3 at (10, 5) (its centre is 5 mm from ox, its edge 2 mm). */
function scene(): PartDoc {
  const doc = applyCommand(createEmptyPart(), EMPTY_SKETCH);
  return applyCommand(doc, {
    type: 'addSketchItems',
    featureId: 'sketch1',
    entities: [
      { id: 'o', type: 'point', x: 0, y: 0 },
      { id: 'x', type: 'point', x: 20, y: 0 },
      { id: 'y', type: 'point', x: 5, y: 5 * Math.sqrt(3) },
      { id: 'kc', type: 'point', x: 10, y: 5 },
      { id: 'ox', type: 'line', p1: 'o', p2: 'x' },
      { id: 'oy', type: 'line', p1: 'o', p2: 'y' },
      { id: 'k1', type: 'circle', center: 'kc', radius: 3 },
    ],
    constraints: [],
  });
}

const at = (p: [number, number], mods: Partial<PointerInput> = {}): PointerInput => ({ p, px: 0.05, ctrl: false, shift: false, ...mods });

/** Move, press and release, as a click on the viewport does. */
function click(c: SketchController, x: number, y: number): void {
  c.pointerMove(at([x, y]), false);
  c.pointerDown(at([x, y]));
  c.pointerUp(at([x, y]));
}

const text = (c: SketchController) => c.dimensionPreview()?.text ?? null;

/** Placing a dimension asks the solver whether it would over-define the sketch, so it lands on a later turn. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the dimension preview says what it measures (G14)', () => {
  it('names a line it would measure the length of', () => {
    const c = new SketchController(new Host(scene()));
    c.setTool('dimension');
    click(c, 10, 0); // the line ox
    c.pointerMove(at([10, -6]), false); // placed below it, away from the geometry
    expect(text(c)).toBe('20 · ox');
  });

  it('names the circle a diameter is measured of', () => {
    const c = new SketchController(new Host(scene()));
    c.setTool('dimension');
    click(c, 13, 5); // on the circle
    c.pointerMove(at([22, 10]), false);
    expect(text(c)).toBe('Ø6 · k1');
  });

  it('says a circle is measured from its centre, not from its edge', () => {
    const c = new SketchController(new Host(scene()));
    c.setTool('dimension');
    click(c, 13, 5); // the circle
    click(c, 10, 0); // then the line
    c.pointerMove(at([10, -6]), false);
    // 5 mm from the centre to the line; from the near edge it would be 2 mm
    expect(text(c)).toBe('5 · k1（圓心）–ox');
  });

  it('says which sector of an angle it is in, which the cursor alone cannot show (two sectors have the same value)', () => {
    const c = new SketchController(new Host(scene()));
    c.setTool('dimension');
    click(c, 10, 0); // ox
    click(c, 2.5, 4.33); // oy
    c.pointerMove(at([6, 2]), false); // inside the 60° opening
    expect(text(c)).toBe('60° · ox–oy（第 1 象限）');
    c.pointerMove(at([-3, 3]), false); // beside it, across oy
    expect(text(c)).toBe('120° · oy–ox（第 2 象限）');
    c.pointerMove(at([-6, -2]), false); // opposite the first: the same 60°, but the vertical angle
    expect(text(c)).toBe('60° · ox–oy（第 3 象限）');
    c.pointerMove(at([6, -2]), false);
    expect(text(c)).toBe('120° · oy–ox（第 4 象限）');
  });

  it('shows what the click will make: the same value, the same entities, the same sector', async () => {
    for (const [place, expected] of [
      [[6, 2], { type: 'angle', a: 'ox', b: 'oy', value: '60' }],
      // the vertical angle shows the same 60°, and what the click makes is a different constraint
      [[-6, -2], { type: 'angle', a: 'ox', b: 'oy', value: '60', flip: 'both' }],
    ] as [[number, number], Record<string, unknown>][]) {
      const h = new Host(scene());
      const c = new SketchController(h);
      c.setTool('dimension');
      click(c, 10, 0); // ox
      click(c, 2.5, 4.33); // oy
      c.pointerMove(at(place), false);
      const shown = text(c)!;
      click(c, place[0], place[1]);
      await flush();
      expect(h.sketch().constraints.at(-1)).toMatchObject(expected);
      expect(shown).toContain(`${expected.value as string}°`);
      expect(shown).toContain(`${expected.a as string}–${expected.b as string}`);
    }
  });
});
