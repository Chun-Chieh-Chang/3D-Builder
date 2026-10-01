import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type Command, type PartDoc, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver, type SolvedGeometry } from '@3db/sketch';
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

/** The application side of the controller, synchronous: every change is solved immediately. */
class Host implements SketchHost {
  readonly featureId = 'sketch1';
  readonly history: DocHistory;
  last: SketchSolvePayload | null = null;
  notices: string[] = [];
  edited: string | null = null;

  constructor(doc: PartDoc = applyCommand(createEmptyPart(), EMPTY_SKETCH)) {
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
  dragPreview: SketchHost['dragPreview'] = (o) => {
    if (o) this.last = this.payload(this.sketch(), { drag: o.drag, initial: o.initial });
  };
  trial = async (s: SketchFeature, doc?: PartDoc) => this.payload(s, {}, doc);
  notify = (text: string) => void this.notices.push(text);
  editDimension = (id: string) => void (this.edited = id);
}

const at = (x: number, y: number, mods: Partial<PointerInput> = {}): PointerInput => ({ p: [x, y], px: 0.05, ctrl: false, shift: false, ...mods });

function click(c: SketchController, x: number, y: number, mods: Partial<PointerInput> = {}): void {
  c.pointerMove(at(x, y, mods), false);
  c.pointerDown(at(x, y, mods));
  c.pointerUp(at(x, y, mods));
}

const point = (h: Host, id: string) => (h.last!.geometry.get(id) as Extract<SolvedGeometry, { type: 'point' }>).p;
const types = (h: Host) => h.sketch().constraints.map((c) => c.type);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('sketch tools', () => {
  it('draws a closed chain of lines with inferred relations and merged corners', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0.1, 0.1); // snaps onto the origin
    click(c, 10, 0.3); // nearly horizontal → horizontal
    click(c, 10.2, 8); // nearly vertical → vertical
    click(c, 0.05, 0.05); // back on the first point: closes and ends the chain
    const s = h.sketch();
    expect(s.entities.filter((e) => e.type === 'line')).toHaveLength(3);
    expect(s.entities.filter((e) => e.type === 'point')).toHaveLength(3); // corners are shared, not duplicated
    expect(types(h).sort()).toEqual(['coincident', 'horizontal', 'vertical']);
    expect(h.last!.problems).toEqual([]); // a closed profile
    expect(c.getView().hint).toContain('起點'); // chain ended
  });

  it('draws a corner rectangle, dimensions it and becomes fully defined', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('rect');
    click(c, 0, 0);
    click(c, 20, 10);
    expect(types(h).filter((t) => t === 'horizontal' || t === 'vertical')).toHaveLength(4);
    expect(h.last!.status).toBe('under');
    expect(h.last!.dof).toBe(2); // width and height

    c.setTool('dimension');
    const bottom = h.sketch().entities.find((e) => e.type === 'line' && e.id === 'l1')!;
    click(c, 10, 0); // pick the bottom line
    click(c, 10, -3); // place below it
    await flush();
    expect(h.sketch().constraints.at(-1)).toMatchObject({ type: 'distance', a: bottom.id, value: '20' });
    expect(h.edited).toBe(h.sketch().constraints.at(-1)!.id); // Modify box opens

    click(c, 20, 5); // right line
    click(c, 23, 5);
    await flush();
    expect(h.last!.status).toBe('fully');
    expect([...h.last!.entityStatus!.values()].every((s) => s === 'fully')).toBe(true);
  });

  it('refuses a dimension that would over-define the sketch', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('rect');
    click(c, 0, 0);
    click(c, 20, 10);
    c.setTool('dimension');
    for (const [pick, place] of [[[10, 0], [10, -3]], [[20, 5], [23, 5]], [[10, 10], [10, 13]]] as const) {
      click(c, pick[0], pick[1]);
      click(c, place[0], place[1]);
      await flush();
    }
    // the top width would have over-defined the sketch: it is a reference (driven) dimension, which shows what is measured
    const distances = h.sketch().constraints.filter((x) => x.type === 'distance') as { driving?: boolean }[];
    expect(distances).toHaveLength(3);
    expect(distances.filter((x) => x.driving !== false)).toHaveLength(2);
    expect(h.notices.join()).toContain('從動');
    expect(h.last!.status).toBe('fully'); // the reference adds nothing to solve
  });

  it('continues a line with a tangent arc', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 0);
    c.escape();
    c.setTool('tangentArc');
    click(c, 10, 0); // the line's end point
    click(c, 14, 4);
    const s = h.sketch();
    const arc = s.entities.find((e) => e.type === 'arc')!;
    expect(s.constraints.at(-1)).toMatchObject({ type: 'tangent', b: arc.id });
    const g = h.last!.geometry.get(arc.id) as Extract<SolvedGeometry, { type: 'arc' }>;
    expect(g.c[0]).toBeCloseTo(10, 6); // turning left: the center is straight above the tangent point
    expect(g.r).toBeCloseTo(4, 6);
    expect(h.last!.status).toBe('under'); // tangency at a shared end must not read as over-defined
    expect(h.last!.redundant).toEqual([]);
  });

  it('infers tangency for a line leaving the end of an arc, so a drawn slot closes without conflicts', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, -10, 0);
    click(c, 10, 0.2); // horizontal
    c.escape();
    c.setTool('tangentArc');
    click(c, 10, 0);
    click(c, 10, 10);
    c.setTool('line');
    click(c, 10, 10); // start at the arc's end …
    click(c, -10, 10.4); // … leaving along its tangent: tangent wins over horizontal
    c.escape();
    c.setTool('tangentArc');
    click(c, -10, 10);
    click(c, -10, 0); // back onto the first line's start
    const tangents = h.sketch().constraints.filter((x) => x.type === 'tangent');
    expect(tangents).toHaveLength(3);
    expect(h.sketch().constraints.filter((x) => x.type === 'horizontal')).toHaveLength(1);
    expect(h.last!.status).toBe('under');
    expect(h.last!.problems).toEqual([]);
  });

  it('drags an under-defined corner and stores where it was dropped', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('rect');
    click(c, 0, 0);
    click(c, 20, 10);
    c.setTool('select');
    c.pointerDown(at(20, 10));
    c.pointerMove(at(24, 13), true);
    c.pointerMove(at(26, 15), true);
    c.pointerUp(at(26, 15));
    // p3 is the dragged corner: its stored position is now where it was dropped
    expect(h.sketch().entities.find((e) => e.id === 'p3')).toMatchObject({ x: expect.closeTo(26, 6), y: expect.closeTo(15, 6) });
    expect(point(h, 'p2')).toEqual([expect.closeTo(26, 6), expect.closeTo(0, 6)]); // the rectangle followed
  });

  it('selects, deletes and undoes inside the sketch', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 5);
    c.escape();
    c.setTool('select');
    click(c, 5, 2.5);
    expect(c.getView().selection).toEqual(['l1']);
    c.deleteSelection();
    expect(h.sketch().entities).toEqual([]);
    h.history.undo();
    expect(h.sketch().entities.some((e) => e.id === 'l1')).toBe(true);
  });

  it('offers and adds relations for the selection', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 5);
    c.escape();
    c.setTool('select');
    click(c, 5, 2.5);
    expect(await c.addRelation({ type: 'horizontal', a: 'l1' })).toBe(true);
    expect(point(h, 'p2')[1]).toBeCloseTo(0, 6);
  });
});

describe('sketch operations (C1.8, C1.9, C1.15, C1.16, C1.17, C1.19)', () => {
  const kinds = (h: Host, type: string) => h.sketch().entities.filter((e) => e.type === type);
  const geo = (h: Host, id: string) => h.last!.geometry.get(id)!;
  const rectangle = () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('rect');
    click(c, 0, 0);
    click(c, 20, 10);
    return { h, c };
  };

  it('draws a slot from two centers and a width, in one undo step', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('slot');
    click(c, 0, 0);
    click(c, 30, 0);
    expect(c.getView().hint).toContain('寬度');
    click(c, 15, 4);
    await c.settled();
    expect(kinds(h, 'line')).toHaveLength(2);
    expect(kinds(h, 'arc')).toHaveLength(2);
    const arc = geo(h, kinds(h, 'arc')[0]!.id);
    expect(arc.type === 'arc' && arc.r).toBeCloseTo(4, 6);
    expect(h.last!.problems).toEqual([]);
    h.history.undo();
    expect(h.sketch().entities).toEqual([]);
  });

  it('draws a regular polygon with the number of sides set in the options', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('polygon');
    c.setOption('polygonSides', 5);
    click(c, 0, 0);
    click(c, 10, 0);
    await c.settled();
    expect(kinds(h, 'line')).toHaveLength(5);
    expect(h.last!.dof).toBe(4);
    expect(h.last!.problems).toEqual([]);
  });

  it('rounds a corner clicked in the sketch, and chamfers one by picking its two lines', async () => {
    const { h, c } = rectangle();
    c.setTool('sketchFillet');
    c.setOption('filletRadius', 3);
    click(c, 20, 0); // the corner point
    await c.settled();
    const arc = geo(h, kinds(h, 'arc')[0]!.id);
    expect(arc.type === 'arc' && arc.r).toBeCloseTo(3, 6);
    expect(h.last!.problems).toEqual([]);

    c.setTool('sketchChamfer');
    c.setOption('chamferDistance1', 2);
    c.setOption('chamferDistance2', 2);
    click(c, 10, 10); // top line
    expect(c.getView().hint).toContain('第二條');
    click(c, 0, 5); // left line
    await c.settled();
    expect(kinds(h, 'line')).toHaveLength(5);
    expect(h.last!.problems).toEqual([]);
  });

  it('trims and extends lines, each in one undo step', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, -10, 0);
    click(c, 10, 0);
    c.escape();
    click(c, 0, -5);
    click(c, 0, 5);
    c.escape();
    const entities = h.sketch().entities.length;
    c.setTool('trim');
    click(c, 5, 0);
    await c.settled();
    const first = geo(h, 'l1');
    expect(first.type === 'line' && first.b[0]).toBeCloseTo(0, 6);
    h.history.undo();
    h.resolve();
    expect(h.sketch().entities).toHaveLength(entities);

    // a stub short of the other line is lengthened up to it
    c.setTool('extend');
    click(c, 9, 0);
    await c.settled();
    expect(h.notices.join()).toContain('沒有可以延伸'); // nothing beyond the right end
    click(c, -9, 0);
    await c.settled();
    expect(h.notices.join()).toContain('沒有可以延伸');
  });

  it('lengthens a stub up to the line in its way', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 5, 0);
    c.escape();
    click(c, 10, -5);
    click(c, 10, 5);
    c.escape();
    c.setTool('extend');
    click(c, 4.5, 0);
    await c.settled();
    const stub = geo(h, 'l1');
    expect(stub.type === 'line' && stub.b[0]).toBeCloseTo(10, 6);
    expect(h.last!.conflicting).toEqual([]);
  });

  it('offsets the selected outline to the side that was clicked, and mirrors a selection about a line', async () => {
    const { h, c } = rectangle();
    c.setTool('select');
    c.select(['l1', 'l2', 'l3', 'l4']);
    c.setTool('offset');
    c.setOption('offsetDistance', 2);
    click(c, 10, 5);
    await c.settled();
    expect(c.getView().tool).toBe('select');
    expect(kinds(h, 'line')).toHaveLength(8);
    const xs = kinds(h, 'line').slice(4).flatMap((e) => {
      const g = geo(h, e.id);
      return g.type === 'line' ? [g.a[0], g.b[0]] : [];
    });
    expect([Math.min(...xs), Math.max(...xs)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([2, 18]);

    const m = new Host();
    const mc = new SketchController(m);
    mc.setTool('centerline');
    click(mc, -5, -10);
    click(mc, -5, 10);
    mc.escape();
    mc.setTool('line');
    click(mc, 3, 1);
    click(mc, 8, 4);
    mc.escape();
    mc.setTool('select');
    mc.select(['l2']);
    mc.setTool('mirror');
    click(mc, -5, 8); // the center line
    await mc.settled();
    expect(kinds(m, 'line')).toHaveLength(3);
    expect(m.sketch().constraints.filter((k) => k.type === 'symmetric')).toHaveLength(2);
    expect(m.last!.conflicting).toEqual([]);
  });

  it('merges two selected points into one, in one undo step', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 0);
    c.escape();
    click(c, 12, 3);
    click(c, 12, 9);
    c.escape();
    c.setTool('select');
    const [a, b] = ['p2', 'p3'];
    c.select([a!, b!]);
    c.mergeSelection();
    await c.settled();
    expect(kinds(h, 'point').map((e) => e.id)).toEqual(['p1', 'p2', 'p4']);
    expect(h.sketch().entities.find((e) => e.id === 'l2')).toMatchObject({ p1: 'p2' });
    h.history.undo();
    expect(kinds(h, 'point')).toHaveLength(4);
    // one point is not enough
    c.select(['p1']);
    c.mergeSelection();
    expect(h.notices.join()).toContain('兩個不同');
  });

  it('dimensions the length of an arc, and a dimension that would over-define is added as a reference that follows the geometry', async () => {
    const doc = applyCommand(applyCommand(createEmptyPart(), EMPTY_SKETCH), {
      type: 'addSketchItems',
      featureId: 'sketch1',
      entities: [
        { id: 'c', type: 'point', x: 0, y: 0 }, { id: 's', type: 'point', x: 10, y: 0 }, { id: 'e', type: 'point', x: 0, y: 10 }, { id: 'A', type: 'arc', center: 'c', start: 's', end: 'e' },
      ],
      constraints: [
        { id: 'f', type: 'coincident', a: 'c', b: '@origin' }, { id: 'h', type: 'horizontal', a: 'c', b: 's' }, { id: 'r', type: 'radius', circle: 'A', value: '10' }, { id: 'v', type: 'vertical', a: 'c', b: 'e' },
      ],
    });
    const h = new Host(doc);
    const c = new SketchController(h);
    expect(h.last!.status).toBe('fully');
    c.dimensionArcLength('A'); // already defined by its radius and its two ends: a reference
    await flush();
    const length = h.sketch().constraints.find((k) => k.type === 'arcLength') as { value: string; driving?: boolean };
    expect(length).toMatchObject({ driving: false, value: String(Number(((10 * Math.PI) / 2).toFixed(4))) });
    expect(h.notices.join()).toContain('從動');
    expect(h.last!.status).toBe('fully');
    // a reference becomes driving again with the value measured now, unless that over-defines the sketch
    c.setDriven(h.sketch().constraints.find((k) => k.type === 'arcLength')!.id, false);
    await c.settled();
    expect(h.notices.join()).toContain('過多定義');
    expect(h.sketch().constraints.find((k) => k.type === 'arcLength')).toMatchObject({ driving: false });
    // making a driving dimension a reference is one command, and frees what it held
    c.setDriven('r', true);
    expect(h.sketch().constraints.find((k) => k.id === 'r')).toMatchObject({ driving: false });
    expect(h.last!.status).toBe('under');
  });

  it('diagnoses an over-defined sketch: each fix offered is confirmed by the solver, and one click applies it', async () => {
    const doc = applyCommand(applyCommand(createEmptyPart(), EMPTY_SKETCH), {
      type: 'addSketchItems',
      featureId: 'sketch1',
      entities: [
        { id: 'p1', type: 'point', x: 0, y: 0 }, { id: 'p2', type: 'point', x: 30, y: 0 }, { id: 'p3', type: 'point', x: 30, y: 20 }, { id: 'p4', type: 'point', x: 0, y: 20 },
        { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'l3', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'l4', type: 'line', p1: 'p4', p2: 'p1' },
      ],
      constraints: [
        { id: 'h1', type: 'horizontal', a: 'l1' }, { id: 'v2', type: 'vertical', a: 'l2' }, { id: 'h3', type: 'horizontal', a: 'l3' }, { id: 'v4', type: 'vertical', a: 'l4' },
        { id: 'o', type: 'coincident', a: 'p1', b: '@origin' }, { id: 'w', type: 'distance', a: 'l1', value: '30' }, { id: 'h', type: 'distance', a: 'l2', value: '20' },
        { id: 'top', type: 'distance', a: 'l3', value: '25' },
      ],
    });
    const h = new Host(doc);
    const c = new SketchController(h);
    expect(h.last!.status).toBe('over');
    const fixes = await c.diagnose();
    // the two widths disagree: either dimension cures it, and so does letting a side lean (a relation is deleted)
    expect(fixes.map((x) => x.id)).toEqual(expect.arrayContaining(['top', 'w']));
    expect(fixes.find((x) => x.id === 'top')).toMatchObject({ kind: 'driven' });
    expect(fixes.find((x) => x.id === 'v2')).toMatchObject({ kind: 'delete' });
    expect(fixes.some((x) => ['h', 'o', 'h1'].includes(x.id))).toBe(false); // the height is not the problem
    c.applyFix(fixes.find((x) => x.id === 'top')!);
    expect(h.last!.status).toBe('fully');
    expect(await c.diagnose()).toEqual([]);
    // a relation is deleted instead
    h.history.undo();
    h.resolve();
    h.execute({ type: 'removeSketchItems', featureId: 'sketch1', ids: ['top'] });
    h.execute({ type: 'addSketchItems', featureId: 'sketch1', entities: [], constraints: [{ id: 'hx', type: 'horizontal', a: 'p2', b: 'p4' }] });
    expect(h.last!.status).toBe('over');
    const second = await c.diagnose();
    expect(second.some((x) => x.id === 'hx' && x.kind === 'delete')).toBe(true);
  });

  it('checks the sketch and repairs a gap and a duplicate in one undo step', async () => {
    const doc = applyCommand(applyCommand(createEmptyPart(), EMPTY_SKETCH), {
      type: 'addSketchItems',
      featureId: 'sketch1',
      entities: [
        { id: 'a', type: 'point', x: 0, y: 0 }, { id: 'b', type: 'point', x: 10, y: 0 }, { id: 'c', type: 'point', x: 10, y: 10 }, { id: 'd', type: 'point', x: 0, y: 10 }, { id: 'e', type: 'point', x: 0, y: 0.05 },
        { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' }, { id: 'l3', type: 'line', p1: 'c', p2: 'd' }, { id: 'l4', type: 'line', p1: 'e', p2: 'd' }, { id: 'l5', type: 'line', p1: 'd', p2: 'c' },
      ],
      constraints: [],
    });
    const h = new Host(doc);
    const c = new SketchController(h);
    expect(c.issues().map((i) => i.kind).sort()).toEqual(['branch', 'branch', 'duplicate', 'gap']); // the copy makes both its ends branch points
    c.repair();
    await c.settled();
    expect(c.issues()).toEqual([]);
    expect(h.last!.problems).toEqual([]);
    expect(h.notices.join()).toContain('已修復 2 處');
    h.history.undo();
    h.resolve();
    expect(c.issues()).toHaveLength(4);
  });

  it('asks for a selection first, and refuses an operation the solver finds over-defining', async () => {
    const { h, c } = rectangle();
    c.setTool('select');
    c.setTool('mirror');
    expect(c.getView().tool).toBe('select');
    expect(h.notices.join()).toContain('先選取');
    c.setTool('offset');
    expect(c.getView().tool).toBe('select');

    const refused = new Host();
    const rc = new SketchController(refused);
    refused.trial = async (s) => ({ ...(await new Host(applyCommand(createEmptyPart(), EMPTY_SKETCH)).trial(s)), status: 'over' as const });
    rc.setTool('slot');
    click(rc, 0, 0);
    click(rc, 30, 0);
    click(rc, 15, 4);
    await rc.settled();
    expect(refused.sketch().entities).toEqual([]);
    expect(refused.notices.join()).toContain('過多定義');
  });
});
