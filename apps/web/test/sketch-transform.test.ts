import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, IdAllocator, idsInUse, resolveSketch, SKETCH_ORIGIN, type Command, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver, type P2, type SolvedGeometry } from '@3db/sketch';
import { applyTransform, patternEntities, patternTransforms, transformEntities, type PatternSpec, type Transform2 } from '@3db/sketch/ops';
import { DEFAULT_SNAPS, type SnapSettings } from '@3db/sketch/snaps';
import { SketchController, type PointerInput, type SketchHost, type ToolId } from '../src/sketcher/controller';
import type { SketchSolvePayload } from '../src/worker/protocol';

/**
 * 移動／複製／旋轉／縮放圖元 and sketch patterns (ADR 0178), through the controller with the real solver: where every point ends up is compared with the
 * transform applied to where it was (the truth comes from the matrix, never written down), with 「保持關係」 on and off, moving and copying.
 */

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EXACT = 1e-9;

const EMPTY_SKETCH: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 'sketch1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};

/** The application side, synchronous: every change is solved at once; a trial is solved with the drag it is given, as the worker does. */
class Host implements SketchHost {
  readonly featureId = 'sketch1';
  readonly history: DocHistory;
  last: SketchSolvePayload | null = null;
  notices: string[] = [];
  snapSettings?: () => SnapSettings = () => ({ ...DEFAULT_SNAPS, enabled: false });

  constructor(doc: PartDoc) {
    this.history = new DocHistory(doc);
    this.resolve();
  }

  sketch(): SketchFeature {
    return this.history.doc.features.find((f) => f.id === this.featureId) as SketchFeature;
  }

  private payload(s: SketchFeature, options = {}, doc: PartDoc = this.history.doc): SketchSolvePayload {
    const r = solver.solve(resolveSketch(s, doc), options);
    return { seq: 0, ...r, problems: r.status === 'failed' ? [] : findProfiles(s, r).problems, ms: 0 };
  }

  resolve(): void {
    this.last = this.payload(this.sketch(), { analyze: true });
  }

  doc = () => this.history.doc;
  solved = () => this.last;
  execute = (cmd: Command) => {
    try {
      this.history.execute(cmd);
      this.resolve();
      return true;
    } catch (e) {
      this.notices.push(String(e));
      return false;
    }
  };
  dragPreview: SketchHost['dragPreview'] = () => {};
  /** The status of each trial solve, in order (a failed drag is tried again without the pull). */
  trials: string[] = [];
  trial: SketchHost['trial'] = async (s, doc, options) => {
    const r = this.payload(s, options ?? {}, doc);
    this.trials.push(r.status);
    return r;
  };
  notify = (text: string) => void this.notices.push(text);
  editDimension = () => {};
}

const pt = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });

/**
 * Two lines that meet at B (a right angle, the first horizontal and 10 long), a circle (radius 3), a quarter arc; outside the selection a line U that
 * shares the end C, and a point Q held on the arc's start F by a coincident relation.
 */
function fixture(extra: SketchConstraint[] = [], extraEntities: SketchEntity[] = []): PartDoc {
  const entities: SketchEntity[] = [
    pt('A', 0, 0),
    pt('B', 10, 0),
    pt('C', 10, 6),
    { id: 'L1', type: 'line', p1: 'A', p2: 'B' },
    { id: 'L2', type: 'line', p1: 'B', p2: 'C' },
    pt('D', 20, 3),
    { id: 'K', type: 'circle', center: 'D', radius: 3 },
    pt('E', 30, 0),
    pt('F', 34, 0),
    pt('G', 30, 4),
    { id: 'R', type: 'arc', center: 'E', start: 'F', end: 'G' },
    pt('H', 16, 12),
    { id: 'U', type: 'line', p1: 'C', p2: 'H' },
    pt('Q', 34, 0),
    ...extraEntities,
  ];
  const constraints: SketchConstraint[] = [
    { id: 'c1', type: 'horizontal', a: 'L1' },
    { id: 'd1', type: 'distance', a: 'L1', value: '10' },
    { id: 'd2', type: 'radius', circle: 'K', value: '3' },
    { id: 'c2', type: 'perpendicular', a: 'L1', b: 'L2' },
    { id: 'c3', type: 'coincident', a: 'F', b: 'Q' },
    ...extra,
  ];
  return applyCommand(applyCommand(createEmptyPart(), EMPTY_SKETCH), { type: 'addSketchItems', featureId: 'sketch1', entities, constraints });
}

const SELECTION = ['L1', 'L2', 'K', 'R'];
const CLOSURE = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function points(h: Host): Map<string, P2> {
  const out = new Map<string, P2>();
  for (const [id, g] of h.last!.geometry) if (g.type === 'point') out.set(id, g.p);
  return out;
}
const radiusOf = (h: Host, id: string) => (h.last!.geometry.get(id) as Extract<SolvedGeometry, { type: 'circle' }>).r;
const near = (a: P2 | undefined, b: P2, tol = EXACT) => {
  expect(a).toBeDefined();
  expect(Math.hypot(a![0] - b[0], a![1] - b[1])).toBeLessThan(tol);
};
/** The new points match the expected places one to one (as multisets). */
function sameSet(actual: P2[], expected: P2[], tol = EXACT): void {
  expect(actual.length).toBe(expected.length);
  const left = [...actual];
  for (const e of expected) {
    const i = left.findIndex((a) => Math.hypot(a[0] - e[0], a[1] - e[1]) < tol);
    expect(i, `no new point at (${e[0]}, ${e[1]})`).toBeGreaterThanOrEqual(0);
    left.splice(i, 1);
  }
}

async function use(h: Host, tool: ToolId, set: (c: SketchController) => void, selection = SELECTION): Promise<SketchController> {
  const c = new SketchController(h);
  c.select(selection);
  c.setTool(tool);
  set(c);
  c.applyToolValues();
  await c.settled();
  return c;
}

const at = (x: number, y: number): PointerInput => ({ p: [x, y], px: 0.05, ctrl: false, shift: false });
function click(c: SketchController, x: number, y: number): void {
  c.pointerMove(at(x, y), false);
  c.pointerDown(at(x, y));
  c.pointerUp(at(x, y));
}

/** The transforms of the matrix tests, and how the controller is told each one (its values; a center is clicked). */
const CASES: { name: string; m: Transform2; tool: ToolId; set: (c: SketchController, copy: boolean) => void }[] = [
  { name: 'move by (13, −7)', m: { kind: 'translate', d: [13, -7] }, tool: 'moveEntities', set: (c) => (c.setOption('moveX', 13), c.setOption('moveY', -7)) },
  { name: 'rotate 37° about (2, 3)', m: { kind: 'rotate', c: [2, 3], angle: 37 }, tool: 'rotateEntities', set: (c, copy) => (click(c, 2, 3), c.setOption('rotateAngle', 37), c.setOption('transformCopy', copy)) },
  { name: 'rotate 90° about (−4, 1)', m: { kind: 'rotate', c: [-4, 1], angle: 90 }, tool: 'rotateEntities', set: (c, copy) => (click(c, -4, 1), c.setOption('rotateAngle', 90), c.setOption('transformCopy', copy)) },
  { name: 'rotate 180° about (5, 5)', m: { kind: 'rotate', c: [5, 5], angle: 180 }, tool: 'rotateEntities', set: (c, copy) => (click(c, 5, 5), c.setOption('rotateAngle', 180), c.setOption('transformCopy', copy)) },
  { name: 'scale 1.7 about (1, 1)', m: { kind: 'scale', c: [1, 1], k: 1.7 }, tool: 'scaleEntities', set: (c, copy) => (click(c, 1, 1), c.setOption('scaleFactor', 1.7), c.setOption('transformCopy', copy)) },
  { name: 'scale 0.35 about (30, 0)', m: { kind: 'scale', c: [30, 0], k: 0.35 }, tool: 'scaleEntities', set: (c, copy) => (click(c, 30, 0), c.setOption('scaleFactor', 0.35), c.setOption('transformCopy', copy)) },
];
const kOf = (m: Transform2) => (m.kind === 'scale' ? m.k : 1);
/** What a horizontal relation becomes under the transform: kept, made vertical, or gone. */
const horizontalBecomes = (m: Transform2): 'horizontal' | 'vertical' | null => (m.kind !== 'rotate' ? 'horizontal' : m.angle % 180 === 0 ? 'horizontal' : m.angle % 90 === 0 ? 'vertical' : null);

describe('moving in place (ADR 0178)', () => {
  for (const { name, m, tool, set } of CASES) {
    for (const keep of [false, true]) {
      it(`${name}, keep relations ${keep ? 'on' : 'off'}: every point where the matrix takes it`, async () => {
        const h = new Host(fixture());
        const before = points(h);
        const rK = radiusOf(h, 'K');
        const constraintsBefore = h.sketch().constraints.length;
        await use(h, tool, (c) => (c.setOption('keepRelations', keep), set(c, false)));
        expect(h.notices.filter((n) => !n.includes('已刪除'))).toEqual([]);
        expect(h.last!.status).not.toBe('failed');
        expect(h.last!.status).not.toBe('over');
        const after = points(h);
        for (const p of CLOSURE.filter((p) => keep || p !== 'C')) near(after.get(p), applyTransform(m, before.get(p)!));
        expect(radiusOf(h, 'K')).toBeCloseTo(rK * kOf(m), 9);
        const s = h.sketch();
        const L2 = s.entities.find((e) => e.id === 'L2') as Extract<SketchEntity, { type: 'line' }>;
        const U = s.entities.find((e) => e.id === 'U') as Extract<SketchEntity, { type: 'line' }>;
        near(after.get('H'), before.get('H')!);
        if (keep) {
          // the rest follows what it is joined to: U's end is C, which moved; Q is held on F
          expect(L2.p2).toBe('C');
          near(after.get('Q'), applyTransform(m, before.get('F')!));
        } else {
          // C is split: the selection takes a new point where the matrix puts C, U keeps C where it was; Q stays, its relation to F is gone
          expect(L2.p2).not.toBe('C');
          expect(U.p1).toBe('C');
          near(after.get(L2.p2), applyTransform(m, before.get('C')!));
          near(after.get('C'), before.get('C')!);
          near(after.get('Q'), before.get('Q')!);
          expect(s.constraints.some((k) => k.id === 'c3')).toBe(false);
        }
        // the relations among the selection, by the rule: horizontal kept, turned into vertical, or gone; lengths scaled
        const h1 = horizontalBecomes(m);
        const onL1 = s.constraints.filter((k) => (k.type === 'horizontal' || k.type === 'vertical') && k.a === 'L1');
        expect(onL1.map((k) => k.type)).toEqual(h1 ? [h1] : []);
        const d1 = s.constraints.find((k) => k.id === 'd1') as Extract<SketchConstraint, { type: 'distance' }>;
        const d2 = s.constraints.find((k) => k.id === 'd2') as Extract<SketchConstraint, { type: 'radius' }>;
        expect(Number(d1.value)).toBe(10 * kOf(m));
        expect(Number(d2.value)).toBe(3 * kOf(m));
        expect(s.constraints.some((k) => k.id === 'c2')).toBe(true);
        const removed = (h1 ? 0 : 1) + (keep ? 0 : 1);
        expect(s.constraints.length).toBe(constraintsBefore - removed);
        // one undo step brings it all back
        h.history.undo();
        h.resolve();
        for (const [id, p] of before) near(points(h).get(id), p);
      });
    }
  }

  it('keep relations on: a dimension to the rest of the sketch holds the selection back; off, it is deleted and the selection moves', async () => {
    const dim: SketchConstraint = { id: 'd9', type: 'distance', a: 'B', b: SKETCH_ORIGIN, value: '10' };
    const kept = new Host(fixture([dim]));
    const target = applyTransform({ kind: 'translate', d: [5, 2] }, points(kept).get('B')!);
    await use(kept, 'moveEntities', (c) => (c.setOption('keepRelations', true), c.setOption('moveX', 5), c.setOption('moveY', 2)));
    const held = points(kept).get('B')!;
    expect(Math.hypot(...held)).toBeCloseTo(10, 9); // the dimension holds …
    expect(Math.hypot(held[0] - target[0], held[1] - target[1])).toBeGreaterThan(0.1); // … so B is not where the move alone would put it
    expect(kept.sketch().constraints.some((k) => k.id === 'd9')).toBe(true);
    const freed = new Host(fixture([dim]));
    const before = points(freed);
    await use(freed, 'moveEntities', (c) => (c.setOption('keepRelations', false), c.setOption('moveX', 5), c.setOption('moveY', 2)));
    near(points(freed).get('B'), applyTransform({ kind: 'translate', d: [5, 2] }, before.get('B')!));
    expect(freed.sketch().constraints.some((k) => k.id === 'd9')).toBe(false);
  });

  it('keep relations on: when the rest cannot follow (a line kept vertical between two turned lines), its relation wins and the sketch still solves', async () => {
    const entities: SketchEntity[] = [pt('A', 0, 0), pt('B', 10, 0), pt('C', 10, 10), pt('D', 20, 10), { id: 'L1', type: 'line', p1: 'A', p2: 'B' }, { id: 'V', type: 'line', p1: 'B', p2: 'C' }, { id: 'L2', type: 'line', p1: 'C', p2: 'D' }];
    const doc = applyCommand(applyCommand(createEmptyPart(), EMPTY_SKETCH), { type: 'addSketchItems', featureId: 'sketch1', entities, constraints: [{ id: 'c1', type: 'vertical', a: 'V' }] });
    const h = new Host(doc);
    await use(h, 'rotateEntities', (c) => (click(c, -5, 3), c.setOption('rotateAngle', 120), c.setOption('keepRelations', true)), ['L1', 'L2']);
    expect(h.notices).toEqual([]);
    expect(h.trials[0]).toBe('failed'); // the drag found no way (this is the case the second solve is for) …
    expect(h.trials).toHaveLength(2); // … and the solve without the pull did
    expect(['under', 'fully']).toContain(h.last!.status);
    const p = points(h);
    expect(Math.abs(p.get('B')![0] - p.get('C')![0])).toBeLessThan(EXACT); // V is still vertical
    expect(h.sketch().constraints.map((k) => k.id)).toEqual(['c1']);
  });

  it('a selected point is the selection’s own: the line that ends there goes with it', async () => {
    const h = new Host(fixture());
    const before = points(h);
    await use(h, 'moveEntities', (c) => (c.setOption('keepRelations', false), c.setOption('moveX', 0), c.setOption('moveY', 4)), ['H']);
    near(points(h).get('H'), [before.get('H')![0], before.get('H')![1] + 4]);
    expect((h.sketch().entities.find((e) => e.id === 'U') as Extract<SketchEntity, { type: 'line' }>).p2).toBe('H');
  });

  it('distanceX and distanceY swap on a quarter turn, are kept on a half turn, and go otherwise', async () => {
    const extra: SketchConstraint[] = [{ id: 'd5', type: 'distanceX', a: 'D', b: 'E', value: '10' }];
    for (const [angle, expected] of [[90, 'distanceY'], [180, 'distanceX'], [30, null]] as const) {
      const h = new Host(fixture(extra));
      const before = points(h);
      await use(h, 'rotateEntities', (c) => (click(c, 0, 0), c.setOption('rotateAngle', angle)));
      const between = h.sketch().constraints.filter((k) => (k.type === 'distanceX' || k.type === 'distanceY') && k.a === 'D' && k.b === 'E');
      expect(between.map((k) => k.type)).toEqual(expected ? [expected] : []);
      near(points(h).get('E'), applyTransform({ kind: 'rotate', c: [0, 0], angle }, before.get('E')!));
    }
  });
});

describe('copying (ADR 0178)', () => {
  const copyCases = [
    { name: 'copy by (13, −7)', m: { kind: 'translate', d: [13, -7] } as Transform2, tool: 'copyEntities' as ToolId, set: (c: SketchController) => (c.setOption('moveX', 13), c.setOption('moveY', -7)) },
    ...CASES.filter((x) => x.tool !== 'moveEntities').map((x) => ({ ...x, name: `${x.name}, copied`, set: (c: SketchController) => x.set(c, true) })),
  ];
  for (const { name, m, tool, set } of copyCases) {
    for (const keep of [false, true]) {
      it(`${name}, keep relations ${keep ? 'on' : 'off'}: the copy is where the matrix takes the selection, the original stays`, async () => {
        const h = new Host(fixture());
        const before = points(h);
        const rK = radiusOf(h, 'K');
        const entitiesBefore = new Set(h.sketch().entities.map((e) => e.id));
        const constraintsBefore = h.sketch().constraints.map((k) => k.id);
        await use(h, tool, (c) => (c.setOption('keepRelations', keep), set(c)));
        expect(h.notices).toEqual([]);
        expect(['under', 'fully']).toContain(h.last!.status);
        const after = points(h);
        for (const [id, p] of before) near(after.get(id), p);
        const added = h.sketch().entities.filter((e) => !entitiesBefore.has(e.id));
        sameSet(
          added.filter((e) => e.type === 'point').map((e) => after.get(e.id)!),
          CLOSURE.map((p) => applyTransform(m, before.get(p)!)),
        );
        expect(added.filter((e) => e.type === 'line')).toHaveLength(2);
        expect(added.filter((e) => e.type === 'arc')).toHaveLength(1);
        const circle = added.find((e) => e.type === 'circle')!;
        expect(radiusOf(h, circle.id)).toBeCloseTo(rK * kOf(m), 9);
        const center = (circle as Extract<SketchEntity, { type: 'circle' }>).center;
        near(after.get(center), applyTransform(m, before.get('D')!));
        // the original's relations are all still there; the copy has the relations among the selection (with keep relations) and never the one to Q
        const now = h.sketch().constraints;
        expect(constraintsBefore.every((id) => now.some((k) => k.id === id))).toBe(true);
        const copied = now.filter((k) => !constraintsBefore.includes(k.id));
        const h1 = horizontalBecomes(m);
        const expected = keep ? ['distance', 'perpendicular', 'radius', ...(h1 ? [h1] : [])].sort() : [];
        expect(copied.map((k) => k.type).sort()).toEqual(expected);
        for (const k of copied) {
          if (k.type === 'distance') expect(Number(k.value)).toBe(10 * kOf(m));
          if (k.type === 'radius') expect(Number(k.value)).toBe(3 * kOf(m));
        }
        h.history.undo();
        expect(h.sketch().entities.length).toBe(entitiesBefore.size);
      });
    }
  }
});

describe('sketch patterns (ADR 0178)', () => {
  const patterns: { name: string; spec: PatternSpec; tool: ToolId; set: (c: SketchController) => void }[] = [
    { name: 'linear, 4 copies 12 by 5 apart', spec: { kind: 'linear', step: [12, 5], count: 4 }, tool: 'linearPattern', set: (c) => (c.setOption('patternX', 12), c.setOption('patternY', 5), c.setOption('patternCount', 4)) },
    { name: 'circular, 5 copies all round (60° apart)', spec: { kind: 'circular', c: [-10, -10], angle: 360, count: 5 }, tool: 'circularPattern', set: (c) => (c.setOption('patternCount', 5), c.setOption('patternAngle', 360), click(c, -10, -10)) },
    { name: 'circular, 3 copies over −90° (−30° apart)', spec: { kind: 'circular', c: [0, 20], angle: -90, count: 3 }, tool: 'circularPattern', set: (c) => (c.setOption('patternCount', 3), c.setOption('patternAngle', -90), click(c, 0, 20)) },
  ];
  for (const { name, spec, tool, set } of patterns) {
    for (const keep of [false, true]) {
      it(`${name}, keep relations ${keep ? 'on' : 'off'}: copy i is the i-th transform of the original`, async () => {
        const h = new Host(fixture());
        const before = points(h);
        const entitiesBefore = new Set(h.sketch().entities.map((e) => e.id));
        const constraintsBefore = h.sketch().constraints.length;
        const c = new SketchController(h);
        c.setOption('linkCopies', false); // ADR 0178: independent copies and copied internal relations.
        c.select(SELECTION);
        c.setTool(tool);
        c.setOption('keepRelations', keep);
        set(c);
        if (tool === 'linearPattern') c.applyToolValues();
        await c.settled();
        expect(h.notices).toEqual([]);
        const after = points(h);
        const added = h.sketch().entities.filter((e) => !entitiesBefore.has(e.id));
        const transforms = patternTransforms(spec);
        expect(transforms).toHaveLength(spec.count);
        // the truth from the spec's own definition: step × i, or the angle split evenly (one more share all round)
        transforms.forEach((m, j) => {
          if (spec.kind === 'linear') expect(m).toEqual({ kind: 'translate', d: [spec.step[0] * (j + 1), spec.step[1] * (j + 1)] });
          else expect(m).toEqual({ kind: 'rotate', c: spec.c, angle: ((Math.abs(spec.angle) === 360 ? spec.angle / (spec.count + 1) : spec.angle / spec.count) * (j + 1)) });
        });
        sameSet(
          added.filter((e) => e.type === 'point').map((e) => after.get(e.id)!),
          transforms.flatMap((m) => CLOSURE.map((p) => applyTransform(m, before.get(p)!))),
        );
        expect(added.filter((e) => e.type === 'line')).toHaveLength(2 * spec.count);
        expect(added.filter((e) => e.type === 'circle')).toHaveLength(spec.count);
        expect(h.sketch().constraints.length - constraintsBefore).toBe(keep ? 4 * spec.count - (spec.kind === 'circular' ? transforms.filter((m) => horizontalBecomes(m) === null).length : 0) : 0);
        for (const [id, p] of before) near(after.get(id), p);
      });
    }
  }
});

describe('the tools by pointer clicks (ADR 0178)', () => {
  it('move: base point, then target point', async () => {
    const h = new Host(fixture());
    const before = points(h);
    const c = new SketchController(h);
    c.select(SELECTION);
    c.setTool('moveEntities');
    click(c, 1, 1);
    expect(c.getView().preview.length).toBe(0 + 1); // the line from the base point to the cursor
    c.pointerMove(at(4, 9), false);
    expect(c.getView().preview.filter((s) => s.kind === 'circle')).toHaveLength(1);
    click(c, 4, 9);
    await c.settled();
    near(points(h).get('A'), applyTransform({ kind: 'translate', d: [3, 8] }, before.get('A')!));
    expect(c.getView().tool).toBe('select');
    expect(c.getView().selection.sort()).toEqual([...SELECTION].sort());
  });

  it('rotate: center, a point on the start direction, a point on the end direction', async () => {
    const h = new Host(fixture());
    const before = points(h);
    const c = new SketchController(h);
    c.select(SELECTION);
    c.setTool('rotateEntities');
    click(c, 5, 5);
    click(c, 15, 5);
    click(c, 5, 15);
    await c.settled();
    near(points(h).get('G'), applyTransform({ kind: 'rotate', c: [5, 5], angle: 90 }, before.get('G')!));
  });

  it('scale: base, reference, where the reference goes (factor = ratio of the distances)', async () => {
    const h = new Host(fixture());
    const before = points(h);
    const c = new SketchController(h);
    c.select(SELECTION);
    c.setTool('scaleEntities');
    click(c, 0, 0);
    click(c, 4, 0);
    click(c, 0, 10);
    await c.settled();
    near(points(h).get('F'), applyTransform({ kind: 'scale', c: [0, 0], k: 2.5 }, before.get('F')!));
  });

  it('the tools need a selection, and say so', () => {
    const h = new Host(fixture());
    const c = new SketchController(h);
    c.setTool('moveEntities');
    expect(c.getView().tool).toBe('select');
    expect(h.notices.at(-1)).toContain('請先選取');
  });
});

describe('what cannot be done is refused and said, nothing changes (AGENTS.md §2.1)', () => {
  const refusals: { name: string; tool: ToolId; set: (c: SketchController) => void; says: string }[] = [
    { name: 'scale 0', tool: 'scaleEntities', set: (c) => (click(c, 0, 0), c.setOption('scaleFactor', 0)), says: '比例必須是大於 0' },
    { name: 'scale −2', tool: 'scaleEntities', set: (c) => (click(c, 0, 0), c.setOption('scaleFactor', -2)), says: '比例必須是大於 0' },
    { name: 'scale NaN', tool: 'scaleEntities', set: (c) => (click(c, 0, 0), c.setOption('scaleFactor', Number.NaN)), says: '比例必須是大於 0' },
    { name: 'scale ∞', tool: 'scaleEntities', set: (c) => (click(c, 0, 0), c.setOption('scaleFactor', Number.POSITIVE_INFINITY)), says: '比例必須是大於 0' },
    { name: 'scale 1', tool: 'scaleEntities', set: (c) => (click(c, 0, 0), c.setOption('scaleFactor', 1)), says: '比例為 1' },
    { name: 'angle NaN', tool: 'rotateEntities', set: (c) => (click(c, 0, 0), c.setOption('rotateAngle', Number.NaN)), says: '旋轉角度必須是有限的數字' },
    { name: 'angle ∞', tool: 'rotateEntities', set: (c) => (click(c, 0, 0), c.setOption('rotateAngle', Number.NEGATIVE_INFINITY)), says: '旋轉角度必須是有限的數字' },
    { name: 'angle 720', tool: 'rotateEntities', set: (c) => (click(c, 0, 0), c.setOption('rotateAngle', 720)), says: '360° 的整數倍' },
    { name: 'rotate without a center', tool: 'rotateEntities', set: (c) => c.setOption('rotateAngle', 45), says: '請先在圖面上按一下中心' },
    { name: 'move by NaN', tool: 'moveEntities', set: (c) => c.setOption('moveX', Number.NaN), says: '移動距離必須是有限的數字' },
    { name: 'move by 0', tool: 'moveEntities', set: (c) => (c.setOption('moveX', 0), c.setOption('moveY', 0)), says: '移動距離為 0' },
    { name: 'pattern of 2.5 copies', tool: 'linearPattern', set: (c) => c.setOption('patternCount', 2.5), says: '副本數必須是 1 到 200 的整數' },
    { name: 'pattern of 0 copies', tool: 'linearPattern', set: (c) => c.setOption('patternCount', 0), says: '副本數必須是 1 到 200 的整數' },
    { name: 'pattern of −1 copies', tool: 'linearPattern', set: (c) => c.setOption('patternCount', -1), says: '副本數必須是 1 到 200 的整數' },
    { name: 'pattern of NaN copies', tool: 'linearPattern', set: (c) => c.setOption('patternCount', Number.NaN), says: '副本數必須是 1 到 200 的整數' },
    { name: 'pattern of 201 copies', tool: 'linearPattern', set: (c) => c.setOption('patternCount', 201), says: '副本數必須是 1 到 200 的整數' },
    { name: 'pattern step 0', tool: 'linearPattern', set: (c) => (c.setOption('patternX', 0), c.setOption('patternY', 0)), says: '間距為 0' },
    { name: 'pattern step NaN', tool: 'linearPattern', set: (c) => c.setOption('patternY', Number.NaN), says: '移動距離必須是有限的數字' },
  ];
  for (const { name, tool, set, says } of refusals) {
    it(name, async () => {
      const h = new Host(fixture());
      const doc = h.history.doc;
      await use(h, tool, set);
      expect(h.notices).toHaveLength(1);
      expect(h.notices[0]).toContain(says);
      expect(h.history.doc).toBe(doc);
    });
  }

  it.each([
    ['angle NaN', Number.NaN],
    ['angle 0', 0],
    ['angle 400', 400],
    ['angle −361', -361],
  ])('circular pattern, %s', async (_name, angle) => {
    const h = new Host(fixture());
    const doc = h.history.doc;
    const c = new SketchController(h);
    c.select(SELECTION);
    c.setTool('circularPattern');
    c.setOption('patternAngle', angle);
    click(c, 0, 0);
    await c.settled();
    expect(h.notices).toEqual([expect.stringContaining('總角度必須是不為 0')]);
    expect(h.history.doc).toBe(doc);
  });

  it('a fixed point, geometry that follows the model, the origin: not moved (a copy of the model geometry is free)', () => {
    const doc = fixture([{ id: 'c8', type: 'fix', point: 'A' }]);
    const s = doc.features[0] as SketchFeature;
    const ids = () => new IdAllocator(doc.idCounters, idsInUse(doc));
    const g = new Map();
    const move: Transform2 = { kind: 'translate', d: [1, 0] };
    for (const keepRelations of [false, true]) {
      expect(transformEntities(s, g, ids(), ['L1'], move, { keepRelations, copy: false })).toEqual({ error: expect.stringContaining('固定') });
      expect('edit' in transformEntities(s, g, ids(), ['L1'], move, { keepRelations, copy: true })).toBe(true);
    }
    const followed = { ...s, entities: s.entities.map((e) => (e.id === 'L2' ? { ...e, ref: { kind: 'edge', feature: 'x', name: 'e' } } : e)) } as SketchFeature;
    expect(transformEntities(followed, g, ids(), ['L2'], move, { keepRelations: true, copy: false })).toEqual({ error: expect.stringContaining('跟隨模型') });
    const copied = transformEntities(followed, g, ids(), ['L2'], move, { keepRelations: true, copy: true });
    expect('edit' in copied && copied.edit.add!.entities.every((e) => !('ref' in e))).toBe(true);
    expect(transformEntities(s, g, ids(), [SKETCH_ORIGIN, 'L1'], move, { keepRelations: false, copy: true })).toEqual({ error: expect.stringContaining('原點') });
    expect(transformEntities(s, g, ids(), ['c1'], move, { keepRelations: false, copy: true })).toEqual({ error: expect.stringContaining('請先選取圖元') });
  });

  it('a length given as an expression cannot be scaled', () => {
    const doc = fixture();
    const s = doc.features[0] as SketchFeature;
    const withExpr = { ...s, constraints: s.constraints.map((k) => (k.id === 'd1' ? { ...k, value: '5 * 2', label: 'D1' } : k)) } as SketchFeature;
    const r = transformEntities(withExpr, new Map(), new IdAllocator(doc.idCounters, idsInUse(doc)), SELECTION, { kind: 'scale', c: [0, 0], k: 2 }, { keepRelations: false, copy: false });
    expect(r).toEqual({ error: expect.stringContaining('「D1」是運算式') });
    // a move does not touch it
    expect('edit' in transformEntities(withExpr, new Map(), new IdAllocator(doc.idCounters, idsInUse(doc)), SELECTION, { kind: 'translate', d: [1, 1] }, { keepRelations: false, copy: false })).toBe(true);
  });

  it('patternEntities refuses the same counts as the tool', () => {
    const doc = fixture();
    const s = doc.features[0] as SketchFeature;
    for (const count of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 201]) {
      expect(patternEntities(s, new Map(), new IdAllocator(doc.idCounters, idsInUse(doc)), SELECTION, { kind: 'linear', step: [1, 0], count }, true)).toEqual({ error: expect.stringContaining('副本數') });
    }
  });
});

// ---------------------------------------------------------------- fuzz (AGENTS.md §3.4)

/** A small, repeatable random source (the fuzz must fail the same way twice). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A random sketch: chains of lines, circles and arcs, with some relations and dimensions, and links to entities that are not selected. */
function randomSketch(r: () => number): { doc: PartDoc; selection: string[] } {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const selection: string[] = [];
  let n = 0;
  const id = (p: string) => `${p}${n++}`;
  const u = (a: number, b: number) => a + (b - a) * r();
  const shapes = 2 + Math.floor(r() * 5);
  for (let i = 0; i < shapes; i++) {
    const kind = r();
    const picked = r() < 0.6;
    if (kind < 0.45) {
      // a chain of 1–3 lines
      let from = id('p');
      entities.push(pt(from, u(-50, 50), u(-50, 50)));
      const segments = 1 + Math.floor(r() * 3);
      for (let j = 0; j < segments; j++) {
        const to = id('p');
        entities.push(pt(to, u(-50, 50), u(-50, 50)));
        const line = id('l');
        entities.push({ id: line, type: 'line', p1: from, p2: to });
        if (r() < 0.25) constraints.push({ id: id('c'), type: r() < 0.5 ? 'horizontal' : 'vertical', a: line });
        else if (r() < 0.3) constraints.push({ id: id('d'), type: 'distance', a: line, value: String(Math.round(u(5, 40))) });
        if (picked || r() < 0.3) selection.push(line);
        from = to;
      }
    } else if (kind < 0.75) {
      const c = id('p');
      entities.push(pt(c, u(-50, 50), u(-50, 50)));
      const circle = id('ci');
      entities.push({ id: circle, type: 'circle', center: c, radius: u(1, 15) });
      if (r() < 0.4) constraints.push({ id: id('d'), type: 'radius', circle, value: String(Math.round(u(2, 12))) });
      if (picked) selection.push(circle);
    } else {
      const [cx, cy, rr, a0] = [u(-50, 50), u(-50, 50), u(2, 15), u(0, 2 * Math.PI)];
      const a1 = a0 + u(0.3, 5);
      const [c, s, e] = [id('p'), id('p'), id('p')];
      entities.push(pt(c, cx, cy), pt(s, cx + rr * Math.cos(a0), cy + rr * Math.sin(a0)), pt(e, cx + rr * Math.cos(a1), cy + rr * Math.sin(a1)));
      const arc = id('a');
      entities.push({ id: arc, type: 'arc', center: c, start: s, end: e });
      if (picked) selection.push(arc);
    }
  }
  // links between shapes: a coincident between two points of different shapes now and then
  // (never two points of one shape: that would collapse a line or an arc, a degenerate sketch rather than a test of the transform)
  const pts = entities.filter((e) => e.type === 'point').map((e) => e.id);
  const shapeOf = (p: string) => entities.findIndex((e) => e.type !== 'point' && (e.type === 'line' ? [e.p1, e.p2] : e.type === 'circle' ? [e.center] : e.type === 'arc' ? [e.center, e.start, e.end] : []).includes(p));
  const together = (a: string, b: string) => {
    // the points of one chain of lines are one shape too
    const chain = (p: string) => entities.filter((e) => e.type === 'line' && (e.p1 === p || e.p2 === p)).flatMap((e) => (e.type === 'line' ? [e.p1, e.p2] : []));
    return shapeOf(a) === shapeOf(b) || chain(a).some((q) => chain(b).includes(q)) || chain(a).includes(b);
  };
  if (pts.length > 3 && r() < 0.5) {
    const [a, b] = [pts[Math.floor(r() * pts.length)]!, pts[Math.floor(r() * pts.length)]!];
    if (a !== b && !together(a, b)) constraints.push({ id: id('c'), type: 'coincident', a, b });
  }
  if (selection.length === 0) selection.push(entities.find((e) => e.type !== 'point')!.id);
  const doc = applyCommand(applyCommand(createEmptyPart(), EMPTY_SKETCH), { type: 'addSketchItems', featureId: 'sketch1', entities, constraints });
  return { doc, selection: [...new Set(selection)] };
}

describe('fuzz: 200 random sketches, transforms and options (AGENTS.md §3.4)', () => {
  it('0 exceptions, 0 failed or over-defined solves; copies and unlinked moves exactly where the matrix puts them', async () => {
    const r = rng(20261020);
    let checked = 0;
    let exact = 0;
    let done = 0;
    let overDefined = 0;
    for (let i = 0; i < 200; i++) {
      const { doc, selection } = randomSketch(r);
      const h = new Host(doc);
      if (h.last!.status === 'failed' || h.last!.status === 'over') continue; // the random sketch itself (a coincident between ends of one line …)
      const before = points(h);
      const keep = r() < 0.5;
      const choice = Math.floor(r() * 6);
      const values = [r() * 40 - 20, r() * 40 - 20, r() * 340 + 10, 0.2 + r() * 3, 1 + Math.floor(r() * 6)] as const;
      const tools: ToolId[] = ['moveEntities', 'copyEntities', 'rotateEntities', 'scaleEntities', 'linearPattern', 'circularPattern'];
      const tool = tools[choice]!;
      const copy = r() < 0.5;
      const center: P2 = [r() * 20 - 10, r() * 20 - 10];
      const entitiesBefore = new Set(h.sketch().entities.map((e) => e.id));
      const c = new SketchController(h);
      c.setOption('linkCopies',false);
      c.select(selection);
      c.setTool(tool);
      c.setOption('keepRelations', keep);
      c.setOption('transformCopy', copy);
      c.setOption('moveX', values[0]);
      c.setOption('moveY', values[1]);
      c.setOption('patternX', values[0]);
      c.setOption('patternY', values[1]);
      c.setOption('rotateAngle', values[2]);
      c.setOption('scaleFactor', values[3]);
      c.setOption('patternCount', values[4]);
      c.setOption('patternAngle', 360);
      if (tool === 'rotateEntities' || tool === 'scaleEntities' || tool === 'circularPattern') click(c, center[0], center[1]);
      if (tool !== 'circularPattern') c.applyToolValues();
      await c.settled();
      checked++;
      // a sketch that cannot take the scaled lengths (a scale with keep relations, a link to the rest) is refused by the solver check, and says so
      const refused = h.notices.filter((n) => !n.includes('已刪除'));
      expect(refused.every((n) => n.includes('過多定義') || n.includes('無法跟著這個變換'))).toBe(true);
      if (refused.length > 0) {
        if (process.env.FUZZ_DEBUG) console.info(JSON.stringify({ tool, keep, copy, values, center, selection, notices: h.notices }));
        overDefined++;
        continue;
      }
      expect(['under', 'fully']).toContain(h.last!.status);
      // something was done: the document changed
      expect(h.history.doc).not.toBe(doc);
      done++;
      const m: Transform2 =
        tool === 'moveEntities' || tool === 'copyEntities'
          ? { kind: 'translate', d: [values[0], values[1]] }
          : tool === 'rotateEntities'
            ? { kind: 'rotate', c: center, angle: values[2] }
            : tool === 'scaleEntities'
              ? { kind: 'scale', c: center, k: values[3] }
              : patternTransforms(tool === 'linearPattern' ? { kind: 'linear', step: [values[0], values[1]], count: values[4] } : { kind: 'circular', c: center, angle: 360, count: values[4] })[0]!;
      const copying = tool === 'copyEntities' || tool === 'linearPattern' || tool === 'circularPattern' || ((tool === 'rotateEntities' || tool === 'scaleEntities') && copy);
      if (copying && tool !== 'linearPattern' && tool !== 'circularPattern') {
        // the copies have no relation to anything else: exactly where the matrix puts the selection's points
        const s0 = doc.features[0] as SketchFeature;
        const closure = new Set(s0.entities.filter((e) => selection.includes(e.id)).flatMap((e) => (e.type === 'line' ? [e.p1, e.p2] : e.type === 'circle' ? [e.center] : e.type === 'arc' ? [e.center, e.start, e.end] : [])));
        const after = points(h);
        sameSet(
          h.sketch().entities.filter((e) => e.type === 'point' && !entitiesBefore.has(e.id)).map((e) => after.get(e.id)!),
          [...closure].map((p) => applyTransform(m, before.get(p)!)),
        );
        exact++;
      }
    }
    console.info(`fuzz: ${checked} run, ${done} applied, ${overDefined} refused as over-defined, ${exact} checked against the matrix`);
    expect(checked).toBeGreaterThanOrEqual(190);
    expect(overDefined).toBe(0);
    expect(done).toBe(checked);
    expect(exact).toBeGreaterThan(20);
  });
});

it('linked circular copies preserve real arc validity without redundant radius rules or native OOM',async()=>{
 const h=new Host(fixture()),before=points(h),c=new SketchController(h);c.select(SELECTION);c.setTool('circularPattern');c.setOption('linkCopies',true);c.setOption('patternCount',5);c.setOption('patternAngle',360);click(c,-10,-10);await c.settled();
 expect(h.notices).toEqual([]);expect(h.sketch().constraints.filter(k=>k.type==='patternPoint')).toHaveLength(35);
 const transforms=patternTransforms({kind:'circular',c:[-10,-10],angle:360,count:5}),after=points(h);
 const originals=new Set(['A','B','C','D','E','F','G','H','Q']);
 sameSet([...after].filter(([id])=>!originals.has(id)).map(([,p])=>p),transforms.flatMap(m=>CLOSURE.map(id=>applyTransform(m,before.get(id)!))));
 for(const [id,p] of before)near(after.get(id),p);
 for(const g of h.last!.geometry.values())if(g.type==='arc') {expect(Math.hypot(g.r)).toBeGreaterThan(0);const start=after.get(g.start)!,end=after.get(g.end)!;expect(Math.hypot(start[0]-g.c[0],start[1]-g.c[1])).toBeCloseTo(g.r,7);expect(Math.hypot(end[0]-g.c[0],end[1]-g.c[1])).toBeCloseTo(g.r,7);}
});
