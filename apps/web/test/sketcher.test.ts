import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type Command, type PartDoc, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver, type SolvedGeometry } from '@3db/sketch';
import type { ModelItem } from '@3db/sketch/ops';
import { DEFAULT_SNAPS, type SnapSettings } from '@3db/sketch/snaps';
import { SketchController, type PointerInput, type SketchHost } from '../src/sketcher/controller';
import { gridCurves } from '../src/sketcher/overlay';
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
  modelItems?: () => readonly ModelItem[];
  snapSettings?: () => SnapSettings;

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

  it('stores a moved dimension label without changing its driving value', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 20, 0);
    c.escape();
    c.setTool('dimension');
    click(c, 10, 0);
    click(c, 10, -3);
    await flush();
    const dimension = h.sketch().constraints.find((x) => x.type === 'distance')!;
    c.moveDimensionLabel(dimension.id, [30, 15]);
    expect(h.sketch().constraints.find((x) => x.id === dimension.id)).toMatchObject({ value: '20', labelPosition: [30, 15] });
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
    // the first line's own horizontal, and the start of it lined up with the origin (its y is 0)
    expect(h.sketch().constraints.filter((x) => x.type === 'horizontal')).toHaveLength(2);
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

  it('交錯 brings a far point to the crossing of two free lines and leaves the lines where they are (C6.2)', async () => {
    const twoLines = (crossing: boolean) =>
      applyCommand(applyCommand(createEmptyPart(), EMPTY_SKETCH), {
        type: 'addSketchItems',
        featureId: 'sketch1',
        entities: [
          { id: 'pa', type: 'point', x: -10, y: -5 }, { id: 'pb', type: 'point', x: 10, y: 5 }, { id: 'pc', type: 'point', x: crossing ? -10 : 5, y: 6 }, { id: 'pd', type: 'point', x: crossing ? 10 : 25, y: crossing ? -4 : 16 }, { id: 'px', type: 'point', x: 20, y: 20 },
          { id: 'la', type: 'line', p1: 'pa', p2: 'pb' }, { id: 'lb', type: 'line', p1: 'pc', p2: 'pd' },
        ],
        constraints: [],
      });
    const h = new Host(twoLines(true));
    const c = new SketchController(h);
    expect(h.last!.status).toBe('under'); // nothing holds the sketch: the case the manual check found
    expect(await c.addRelation({ type: 'intersection', point: 'px', a: 'la', b: 'lb' })).toBe(true);
    // the lines L: y = x/2 and M: y = 1 - x/2 cross at (1, 0.5); the point comes to it, the sketch stays
    expect(point(h, 'px')).toEqual([expect.closeTo(1, 6), expect.closeTo(0.5, 6)]);
    for (const [id, [x, y]] of [
      ['pa', [-10, -5]],
      ['pb', [10, 5]],
      ['pc', [-10, 6]],
      ['pd', [10, -4]],
    ] as const) {
      expect(point(h, id)).toEqual([expect.closeTo(x, 6), expect.closeTo(y, 6)]);
    }

    // parallel lines have no crossing: the relation is refused and says so, instead of the solver's over-defined answer
    const apart = new Host(twoLines(false));
    const apartController = new SketchController(apart);
    expect(await apartController.addRelation({ type: 'intersection', point: 'px', a: 'la', b: 'lb' })).toBe(false);
    expect(apart.notices.join()).toContain('沒有交點');
    expect(apart.sketch().constraints).toEqual([]);
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

  it.each([
    ['vertical side', [[20, 10], [60, 10], [60, 30], [20, 30], [20, 14]]],
    ['horizontal side', [[10, 20], [10, 60], [30, 60], [30, 20], [14, 20]]],
  ] as const)('repairs the gap of a rectangle drawn with the line tool (%s): the relation between the ends and the line\'s own are one', async (_name, clicks) => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    for (const [x, y] of clicks) click(c, x, y);
    c.setTool('select');
    const before = h.sketch().constraints.length;
    c.setOption('gapTolerance', 5);
    expect(c.issues().map((i) => i.kind)).toEqual(['gap']);
    c.repair();
    await c.settled();
    expect(h.notices.join()).toContain('已修復 1 處；0 處沒有修');
    expect(h.notices.join()).not.toContain('過多定義');
    expect(c.issues()).toEqual([]);
    expect(h.last!.status).toBe('under');
    expect(h.last!.dof).toBe(4); // four corners, four relations: position, width and height
    expect(h.sketch().constraints.filter((x) => x.type === 'horizontal' || x.type === 'vertical')).toHaveLength(4);
    h.history.undo();
    h.resolve();
    expect(h.sketch().constraints).toHaveLength(before);
    expect(c.issues().map((i) => i.kind)).toEqual(['gap']);
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

describe('lining up with other sketch points (D5.3a)', () => {
  it('pulls the first point of a line into line with an end point, with a dotted guide and a horizontal relation', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 5);
    c.escape();
    c.pointerMove(at(30, 5.1), false); // 0.1 mm off the height of the end point (5 px = 0.25 mm)
    expect(c.getView().snap).toMatchObject({ kind: 'free', p: [30, 5], align: { h: { p: [10, 5] } } });
    expect(c.getView().inference).toBe('水平點');
    click(c, 30, 5.1);
    click(c, 30.1, 20); // nearly vertical from there: vertical
    const s = h.sketch();
    const [first, second] = s.entities.filter((e) => e.type === 'line') as Extract<SketchFeature['entities'][number], { type: 'line' }>[];
    expect(second).toBeDefined();
    expect(s.constraints).toContainEqual(expect.objectContaining({ type: 'horizontal', a: second!.p1, b: first!.p2 }));
    expect(point(h, second!.p1)).toEqual([30, 5]);
    expect(h.last!.status).not.toBe('over');
    expect(h.last!.conflicting).toEqual([]);
    expect(h.last!.redundant).toEqual([]);
  });

  it('undoes in one step, the relation and the point together', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('point');
    click(c, 10, 5);
    const before = h.sketch().constraints.length;
    click(c, 30, 5.1);
    expect(h.sketch().constraints.length).toBe(before + 1);
    h.history.undo();
    expect(h.sketch().constraints.length).toBe(before);
    expect(h.sketch().entities).toHaveLength(1);
  });

  it('lines up with the other axis when a horizontal line is inferred, and does not over-define', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('point');
    click(c, 20, 15);
    c.setTool('line');
    click(c, 1, 3);
    c.pointerMove(at(20.1, 3.2), false); // nearly horizontal from (1, 3), and 0.1 mm from x = 20
    const v = c.getView();
    expect(v.snap).toMatchObject({ kind: 'free', p: [20, 3], align: { v: { p: [20, 15] } } });
    expect(v.snap && v.snap.kind === 'free' && v.snap.align?.h).toBeUndefined();
    expect(v.inference).toBe('水平'); // the line's own relation is what is named
    click(c, 20.1, 3.2);
    expect(types(h)).toEqual(expect.arrayContaining(['horizontal', 'vertical']));
    expect(h.last!.conflicting).toEqual([]);
    expect(h.last!.redundant).toEqual([]);
    expect(h.last!.status).not.toBe('over');
  });

  it('does not take over from a point the cursor is on: that merges', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('point');
    click(c, 10, 5);
    c.setTool('line');
    c.pointerMove(at(10.1, 5.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'point' });
    expect(c.getView().inference).toBe('重合');
  });

  it('lines up the corner of a rectangle and keeps it solvable', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('point');
    click(c, 40, 12);
    c.setTool('rect');
    click(c, 0, 0);
    click(c, 25, 12.1); // the opposite corner is level with the point
    const s = h.sketch();
    expect(s.entities.filter((e) => e.type === 'line')).toHaveLength(4);
    expect(types(h).filter((t) => t === 'horizontal')).toHaveLength(3); // two sides and the alignment
    expect(h.last!.conflicting).toEqual([]);
    expect(h.last!.redundant).toEqual([]);
    const corner = s.entities.find((e) => e.type === 'point' && Math.abs(point(h, e.id)[0] - 25) < 1e-9 && Math.abs(point(h, e.id)[1] - 12) < 1e-9);
    expect(corner).toBeDefined();
  });

  it('does not line up the radius click of a circle, nor the cursor when the tool is a selection', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('point');
    click(c, 30, 5);
    c.setTool('circle');
    click(c, 0, 0);
    c.pointerMove(at(10, 5.1), false); // a radius: it must not be bent toward the point at y = 5
    expect(c.getView().snap).toMatchObject({ kind: 'free', p: [10, 5.1] });
    c.escape();
    c.setTool('select');
    c.pointerMove(at(40, 5.1), false);
    expect(c.getView().snap).toBeNull();
  });

  it('the guide is gone once the cursor moves away', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('point');
    click(c, 10, 5);
    c.pointerMove(at(30, 5.1), false);
    expect(c.getView().snap).toMatchObject({ align: expect.anything() });
    c.pointerMove(at(30, 9), false);
    expect(c.getView().snap).toMatchObject({ kind: 'free', p: [30, 9] });
    expect(c.getView().inference).toBeNull();
  });
});

describe('collinear, parallel and perpendicular inference while drawing (D5.3a)', () => {
  const twoLines = () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0.5, 0.3); // off the origin: this is about the other line
    click(c, 10.5, 5.3);
    c.escape();
    return { h, c };
  };
  const lastLine = (h: Host) => h.sketch().entities.filter((e) => e.type === 'line').at(-1)!;

  it('makes a line leaving the end of another along its direction collinear', () => {
    const { h, c } = twoLines();
    c.setTool('line');
    click(c, 10.5, 5.3); // snaps onto the end of the first line
    c.pointerMove(at(30.5, 15.6), false);
    expect(c.getView().inference).toBe('共線');
    expect(c.getView().inferLine).toMatchObject({ kind: 'collinear', line: 'l1' });
    expect(c.getView().hover).toBe('l1'); // the line it follows is lit
    click(c, 30.5, 15.6);
    expect(h.sketch().constraints).toContainEqual(expect.objectContaining({ type: 'collinear', a: lastLine(h).id, b: 'l1' }));
    expect(h.last!.conflicting).toEqual([]);
    expect(h.last!.redundant).toEqual([]);
  });

  it('makes a line drawn beside another parallel to it', () => {
    const { h, c } = twoLines();
    c.setTool('line');
    click(c, 0, 20);
    c.pointerMove(at(20, 30.3), false);
    expect(c.getView().inference).toBe('平行');
    click(c, 20, 30.3);
    expect(h.sketch().constraints).toContainEqual(expect.objectContaining({ type: 'parallel', a: lastLine(h).id, b: 'l1' }));
    expect(h.last!.conflicting).toEqual([]);
    expect(h.last!.redundant).toEqual([]);
  });

  it('makes a line drawn across another perpendicular to it', () => {
    const { h, c } = twoLines();
    c.setTool('line');
    click(c, 30, 0);
    c.pointerMove(at(28, 4.1), false);
    expect(c.getView().inference).toBe('互相垂直');
    click(c, 28, 4.1);
    expect(h.sketch().constraints).toContainEqual(expect.objectContaining({ type: 'perpendicular', a: lastLine(h).id, b: 'l1' }));
    expect(h.last!.conflicting).toEqual([]);
    expect(h.last!.redundant).toEqual([]);
  });

  it('leaves horizontal and vertical to their own inference', () => {
    const { h, c } = twoLines();
    c.setTool('line');
    click(c, 0, 20);
    c.pointerMove(at(20, 20.2), false);
    expect(c.getView().inference).toBe('水平');
    expect(c.getView().inferLine).toBeNull();
    click(c, 20, 20.2);
    expect(types(h)).toContain('horizontal');
    expect(types(h)).not.toContain('parallel');
  });

  it('infers nothing for a line that is too short to have a direction, or beyond a few degrees', () => {
    const { c } = twoLines();
    c.setTool('line');
    click(c, 0, 20);
    c.pointerMove(at(0.2, 20.1), false);
    expect(c.getView().inferLine).toBeNull();
    c.pointerMove(at(20, 33), false);
    expect(c.getView().inferLine).toBeNull();
    expect(c.getView().inference).toBeNull();
  });

  it('does not line up with a point when the line already follows another line', () => {
    const { c } = twoLines();
    c.setTool('point');
    click(c, 30.4, 40);
    c.setTool('line');
    click(c, 0, 20);
    c.pointerMove(at(30.2, 35.3), false); // slope 0.51 from (0, 20): parallel; also 0.2 mm from x = 30.4
    expect(c.getView().inferLine).toMatchObject({ kind: 'parallel' });
    const snap = c.getView().snap;
    expect(snap && snap.kind === 'free' && snap.align).toBeFalsy();
  });

  it('undoes a line with its inferred relation in one step', () => {
    const { h, c } = twoLines();
    const before = h.sketch().constraints.length;
    c.setTool('line');
    click(c, 1.5, 20); // not level or in line with a point: only the parallel relation
    click(c, 21.5, 30.3);
    expect(h.sketch().constraints.length).toBe(before + 1);
    h.history.undo();
    expect(h.sketch().constraints.length).toBe(before);
  });
});

describe('snapping to the model while drawing (D5.3b)', () => {
  /** The model seen from the sketch plane: a plate 40 × 30 and a hole of radius 5 at (20, 15). */
  const plate: ModelItem[] = [
    { ref: { kind: 'edge', name: 'bottom' }, projected: { kind: 'line', a: [0, 0], b: [40, 0] } },
    { ref: { kind: 'edge', name: 'right' }, projected: { kind: 'line', a: [40, 0], b: [40, 30] } },
    { ref: { kind: 'edge', name: 'hole' }, projected: { kind: 'circle', c: [20, 15], r: 5 } },
  ];
  const withPlate = () => {
    const h = new Host();
    h.modelItems = () => plate;
    return { h, c: new SketchController(h) };
  };
  const lines = (h: Host) => h.sketch().entities.filter((e) => e.type === 'line') as Extract<SketchFeature['entities'][number], { type: 'line' }>[];

  it('offers the corner of the plate, the middle of an edge and the center of the hole, each named', () => {
    const { c } = withPlate();
    c.setTool('line');
    c.pointerMove(at(39.9, 0.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'model', p: [40, 0] });
    expect(c.getView().inference).toBe('模型端點');
    c.pointerMove(at(20.1, 0.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'model', part: 'mid', p: [20, 0] });
    expect(c.getView().inference).toBe('模型中點');
    c.pointerMove(at(20.1, 15.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'model', part: 'center', p: [20, 15] });
    expect(c.getView().inference).toBe('模型圓心');
    c.pointerMove(at(10, 0.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'model', part: 'curve' });
    expect(c.getView().inference).toBe('在模型邊上');
  });

  it('draws a circle from the center of the hole: the hole becomes an entity that follows the model and the circle shares its center, in one step', () => {
    const { h, c } = withPlate();
    c.setTool('circle');
    click(c, 20.1, 15.1);
    click(c, 28, 15);
    const s = h.sketch();
    const hole = s.entities.find((e) => e.type === 'circle' && e.ref)!;
    const mine = s.entities.find((e) => e.type === 'circle' && !e.ref)!;
    expect(hole).toMatchObject({ ref: { kind: 'edge', name: 'hole' } });
    expect((mine as Extract<typeof mine, { type: 'circle' }>).center).toBe((hole as Extract<typeof hole, { type: 'circle' }>).center);
    expect(s.entities.filter((e) => e.type === 'point')).toHaveLength(1);
    h.history.undo();
    expect(h.sketch().entities).toEqual([]); // the model entity went with the circle
  });

  it('draws a line between two corners: both edges followed, their shared corner one point', () => {
    const { h, c } = withPlate();
    c.setTool('line');
    click(c, 40.1, 0.1); // the corner where the bottom edge ends and the right one starts
    click(c, 40.1, 30.1); // the far end of the right edge
    const s = h.sketch();
    expect(lines(h).flatMap((l) => (l.ref ? [l.ref.name] : [])).sort()).toEqual(['bottom', 'right']);
    expect(s.entities.filter((e) => e.type === 'line')).toHaveLength(3); // the two edges and the line drawn between the corners
    const [bottom, right, mine] = [lines(h).find((l) => l.ref?.name === 'bottom')!, lines(h).find((l) => l.ref?.name === 'right')!, lines(h).find((l) => !l.ref)!];
    expect(bottom.p2).toBe(right.p1); // (40, 0) is one point
    expect(mine.p1).toBe(bottom.p2); // and the line starts there
    expect(mine.p2).toBe(right.p2);
  });

  it('uses the edge it has already followed for a second click on it', () => {
    const { h, c } = withPlate();
    c.setTool('line');
    click(c, 0.1, 0.1);
    click(c, 39.9, 0.1); // the other end of the same edge
    c.escape();
    expect(h.sketch().entities.filter((e) => e.type === 'line' && e.ref)).toHaveLength(1);
    c.setTool('line');
    click(c, 20.1, 0.1); // the middle of it
    expect(h.sketch().entities.filter((e) => e.type === 'line' && e.ref)).toHaveLength(1);
    expect(types(h)).not.toContain('midpoint'); // a start alone makes no point yet
    click(c, 20.1, 12);
    expect(types(h)).toContain('midpoint');
  });

  it('lets a sketch point win over the model, and the model win over a free place', () => {
    const { c } = withPlate();
    c.setTool('point');
    click(c, 20, 15); // on the hole's center: a model point, which makes the hole an entity (and its center the point)
    c.setTool('line');
    c.pointerMove(at(20.1, 15.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'point' }); // now a point of the sketch
    c.pointerMove(at(5, 8), false);
    expect(c.getView().snap).toMatchObject({ kind: 'free' });
  });

  it('snaps to and selects the model with the select tool (Plan B)', () => {
    const { h, c } = withPlate();
    c.setTool('select');
    c.pointerMove(at(40, 0.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'model' });

    // Clicking the model edge in select mode anchors it as a construction line and selects it
    c.pointerDown(at(20, 0.1));
    c.pointerUp(at(20, 0.1));
    const refLine = h.sketch().entities.find((e) => e.type === 'line' && e.ref?.name === 'bottom');
    expect(refLine).toBeDefined();
    expect((refLine as any).construction).toBe(true);
    expect(c.getView().selection).toContain(refLine!.id);
  });

  it('does not snap to the model for the radius click of a circle', () => {
    const { c } = withPlate();
    c.setTool('circle');
    click(c, 10, 10);
    c.pointerMove(at(40, 0.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'free' });
  });

  it('allows multi-selecting a sketch line and model edge to add a collinear relation (Plan B)', async () => {
    const { h, c } = withPlate();
    // 1. Draw a sketch line slightly above the bottom model edge
    c.setTool('line');
    click(c, 5, 2);
    click(c, 35, 2);
    c.escape();
    const sketchLine = h.sketch().entities.find((e) => e.type === 'line' && !e.ref)!;
    expect(sketchLine).toBeDefined();

    // 2. Select the sketch line
    c.setTool('select');
    c.pointerDown(at(20, 2));
    c.pointerUp(at(20, 2));
    expect(c.getView().selection).toEqual([sketchLine.id]);

    // 3. Ctrl-click the bottom model edge to select it too
    c.pointerDown({ ...at(20, 0.1), ctrl: true });
    c.pointerUp({ ...at(20, 0.1), ctrl: true });
    const refLine = h.sketch().entities.find((e) => e.type === 'line' && e.ref?.name === 'bottom')!;
    expect(refLine).toBeDefined();
    expect(c.getView().selection).toContain(sketchLine.id);
    expect(c.getView().selection).toContain(refLine.id);

    // 4. Add collinear relation
    const ok = await c.addRelation({ type: 'collinear', a: sketchLine.id, b: refLine.id });
    expect(ok).toBe(true);
    const collinear = h.sketch().constraints.find((x) => x.type === 'collinear');
    expect(collinear).toBeDefined();
  });

  it('draws nothing from the model when the host has none', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    c.pointerMove(at(40, 0.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'free' });
  });
});

describe('the snaps beyond points and curves, and the settings (D5.3c)', () => {
  const withSnaps = (patch: Partial<SnapSettings> = {}) => {
    const h = new Host();
    h.snapSettings = () => ({ ...DEFAULT_SNAPS, ...patch });
    return { h, c: new SketchController(h) };
  };
  const lineAt = (h: Host, id: string) => h.last!.geometry.get(id) as Extract<SolvedGeometry, { type: 'line' }>;

  it('snaps to the crossing of two lines, and the new point is made an intersection of both', () => {
    const { h, c } = withSnaps();
    c.setTool('line');
    click(c, 0, 0);
    click(c, 20, 10); // slope 0.5
    c.escape();
    click(c, 0, 16);
    click(c, 20, 0); // crosses the first at (12.31, 6.15), away from the middle of either
    c.escape();
    c.setTool('point');
    c.pointerMove(at(12.4, 6.2), false);
    expect(c.getView().snap).toMatchObject({ kind: 'intersection' });
    expect(c.getView().inference).toBe('交點');
    click(c, 12.4, 6.2);
    const k = h.sketch().constraints.find((x) => x.type === 'intersection');
    expect(k).toBeDefined();
    expect(h.last!.conflicting).toEqual([]);
    expect(h.last!.redundant).toEqual([]);
  });

  it('snaps to a quarter point of a circle: on the circle and level or plumb with its center', () => {
    const { h, c } = withSnaps();
    c.setTool('circle');
    click(c, 10, 10);
    click(c, 16, 10); // r = 6
    c.escape();
    c.setTool('point');
    c.pointerMove(at(10.1, 16.1), false); // the top: (10, 16)
    expect(c.getView().snap).toMatchObject({ kind: 'quadrant', axis: 'vertical', p: [10, 16] });
    expect(c.getView().inference).toBe('四分之一點');
    click(c, 10.1, 16.1);
    const types_ = types(h);
    expect(types_).toContain('pointOnCurve');
    expect(types_).toContain('vertical');
    expect(h.last!.conflicting).toEqual([]);
    const p = h.sketch().entities.filter((e) => e.type === 'point').at(-1)!;
    expect(point(h, p.id)[0]).toBeCloseTo(10, 6);
    expect(point(h, p.id)[1]).toBeCloseTo(16, 6);
  });

  it('snaps to where a line from its start touches a circle, and makes the line tangent to it', () => {
    const { h, c } = withSnaps();
    c.setTool('circle');
    click(c, 30, 0.5);
    click(c, 35, 0.5); // r = 5, center (30, 0.5)
    c.escape();
    c.setTool('line');
    click(c, 0, 20);
    const dx = 30;
    const dy = 0.5 - 20;
    const d = Math.hypot(dx, dy);
    const phi = Math.acos(5 / d);
    const base = Math.atan2(-dy, -dx); // from the center back to the start
    const t1 = [30 + 5 * Math.cos(base + phi), 0.5 + 5 * Math.sin(base + phi)] as const;
    c.pointerMove(at(t1[0] + 0.1, t1[1] - 0.1), false);
    expect(c.getView().inference).toBe('相切');
    expect(c.getView().inferLine).toMatchObject({ kind: 'tangent' });
    click(c, t1[0] + 0.1, t1[1] - 0.1);
    const line = h.sketch().entities.filter((e) => e.type === 'line').at(-1)!;
    expect(h.sketch().constraints).toContainEqual(expect.objectContaining({ type: 'tangent', a: line.id }));
    expect(h.last!.conflicting).toEqual([]);
    expect(h.last!.redundant).toEqual([]);
    // the line touches: its distance from the center is the radius
    const g = lineAt(h, line.id);
    const u = [g.b[0] - g.a[0], g.b[1] - g.a[1]];
    const dist = Math.abs(u[0]! * (0.5 - g.a[1]) - u[1]! * (30 - g.a[0])) / Math.hypot(u[0]!, u[1]!);
    expect(dist).toBeCloseTo(5, 4);
  });

  it('snaps to the foot of the perpendicular onto a line, and makes the new line perpendicular to it with its end on it', () => {
    const { h, c } = withSnaps();
    c.setTool('line');
    click(c, 0, 0);
    click(c, 20, 0.3);
    c.escape();
    click(c, 5, 8);
    c.pointerMove(at(4.95, 0.15), false); // about the foot (4.9, 0.07)
    expect(c.getView().inference).toBe('互相垂直');
    expect(c.getView().inferLine).toMatchObject({ kind: 'perpendicular' });
    click(c, 4.95, 0.15);
    const lines = h.sketch().entities.filter((e) => e.type === 'line');
    expect(h.sketch().constraints).toContainEqual(expect.objectContaining({ type: 'perpendicular', a: lines.at(-1)!.id }));
    expect(h.sketch().constraints).toContainEqual(expect.objectContaining({ type: 'pointOnCurve' }));
    expect(h.last!.conflicting).toEqual([]);
    expect(h.last!.redundant).toEqual([]);
  });

  it('does nothing by itself when snapping is off: no snap, no merge, no relation', () => {
    const { h, c } = withSnaps({ enabled: false });
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 0.2); // nearly horizontal
    c.escape();
    c.setTool('point');
    c.pointerMove(at(10.05, 0.25), false);
    expect(c.getView().snap).toMatchObject({ kind: 'free', p: [10.05, 0.25] });
    expect(c.getView().inference).toBeNull();
    click(c, 10.05, 0.25);
    expect(h.sketch().constraints).toEqual([]);
    expect(h.sketch().entities.filter((e) => e.type === 'point')).toHaveLength(3); // the two ends and the new one
  });

  it('leaves out the one that is switched off and keeps the rest', () => {
    const horizontal = withSnaps({ horizontalVertical: false });
    horizontal.c.setTool('line');
    click(horizontal.c, 0, 0);
    click(horizontal.c, 10, 0.2);
    expect(types(horizontal.h)).not.toContain('horizontal');
    const points = withSnaps({ point: false });
    points.c.setTool('point');
    click(points.c, 5, 5);
    points.c.pointerMove(at(5.1, 5.1), false);
    expect(points.c.getView().snap).toMatchObject({ kind: 'free' }); // the point is there, and not snapped to
    const model = withSnaps({ lineRelations: false });
    model.c.setTool('line');
    click(model.c, 0, 0.5);
    click(model.c, 10, 5.5);
    model.c.escape();
    click(model.c, 0, 20);
    model.c.pointerMove(at(10, 25.1), false);
    expect(model.c.getView().inferLine).toBeNull();
  });

  it('goes to the grid when the grid is on, and to nothing when it is off', () => {
    const on = withSnaps({ grid: true, gridSpacing: 5 });
    on.c.setTool('point');
    click(on.c, 12.4, 7.6);
    expect(point(on.h, on.h.sketch().entities.at(-1)!.id)).toEqual([10, 10]);
    expect(on.h.sketch().constraints).toEqual([]);
    const off = withSnaps();
    off.c.setTool('point');
    click(off.c, 12.4, 7.6);
    expect(point(off.h, off.h.sketch().entities.at(-1)!.id)).toEqual([12.4, 7.6]);
  });

  it('shows the grid while its snap is on, and zoomed out snaps to the stepped-up grid it draws (lines on the screen at least 8 px apart)', () => {
    const on = withSnaps({ grid: true, gridSpacing: 5 });
    expect(on.c.getView().grid).toBe(5);
    on.c.setTool('point');
    // zoomed out: one pixel is 1 mm, so 5 mm is 5 px; the grid drawn is every 10 mm, and that is where the point goes
    click(on.c, 12.4, 7.6, { px: 1 });
    expect(point(on.h, on.h.sketch().entities.at(-1)!.id)).toEqual([10, 10]);
    click(on.c, 26.4, 23.6, { px: 1 }); // more than 5 px (5 mm here) from lining up with (10, 10) or the origin
    expect(point(on.h, on.h.sketch().entities.at(-1)!.id)).toEqual([30, 20]); // not (25, 25): 25 is not on the drawn grid
    const curves = gridCurves({ min: [-30, -30], max: [30, 30] }, on.c.getView().grid!, 1);
    const xs = curves.filter((k) => k.points[0]![0] === k.points[1]![0]).map((k) => k.points[0]![0]);
    expect(xs).toEqual([-30, -20, -10, 0, 10, 20, 30]); // the 30 and the 20 the point went to are among them
    // off, or a quick snap: no grid
    expect(withSnaps().c.getView().grid).toBeNull();
    on.c.setQuickSnap('point');
    expect(on.c.getView().grid).toBeNull();
    expect(withSnaps({ grid: true, enabled: false }).c.getView().grid).toBeNull();
  });

  it('turns a line onto a multiple of the angle step, and makes its length a multiple of the spacing with Shift', () => {
    const angle = withSnaps({ angle: true, angleStep: 15 });
    angle.c.setTool('line');
    click(angle.c, 0, 0.3);
    click(angle.c, 10, 3.0); // 15.1° from the start (0, 0.3)
    const l = angle.h.sketch().entities.find((e) => e.type === 'line') as Extract<SketchFeature['entities'][number], { type: 'line' }>;
    const g = lineAt(angle.h, l.id);
    expect(Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0])).toBeCloseTo((15 * Math.PI) / 180, 9);
    const length = withSnaps({ gridSpacing: 5 });
    length.c.setTool('line');
    click(length.c, 0, 0.3);
    click(length.c, 12, 6.3, { shift: true }); // from (0, 0.3): 13.4 long, in the direction of (12, 6)
    const m = length.h.sketch().entities.find((e) => e.type === 'line') as Extract<SketchFeature['entities'][number], { type: 'line' }>;
    const gm = lineAt(length.h, m.id);
    expect(Math.hypot(gm.b[0] - gm.a[0], gm.b[1] - gm.a[1])).toBeCloseTo(15, 9);
  });

  it('can be limited to one snap (a quick snap), which ends with the tool or when it is cleared', () => {
    const { h, c } = withSnaps();
    c.setTool('circle');
    click(c, 10, 10);
    click(c, 16, 10);
    c.escape();
    c.setTool('point');
    click(c, 10, 16.05); // a point at the top, near the quarter point
    c.pointerMove(at(10.05, 16.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'point' }); // the point just made comes first
    c.setQuickSnap('quadrant');
    expect(c.getView().quickSnap).toBe('quadrant');
    c.pointerMove(at(10.05, 16.1), false);
    expect(c.getView().snap).toMatchObject({ kind: 'quadrant' }); // only that one is on
    c.pointerMove(at(14, 14), false);
    expect(c.getView().snap).toMatchObject({ kind: 'free' }); // not even a place on the circle
    c.setQuickSnap(null);
    expect(c.getView().quickSnap).toBeNull();
    c.setQuickSnap('curve');
    c.setTool('line');
    expect(c.getView().quickSnap).toBeNull(); // another tool, another choice
    expect(h.sketch().entities.length).toBeGreaterThan(0);
  });

  it('keeps the priority of the others: a point before a crossing, a crossing before a place on a curve', () => {
    const { c } = withSnaps();
    c.setTool('line');
    click(c, 0, 0);
    click(c, 20, 10);
    c.escape();
    click(c, 0, 16);
    click(c, 20, 0);
    c.escape();
    c.setTool('point');
    c.pointerMove(at(12.4, 6.2), false);
    expect(c.getView().snap).toMatchObject({ kind: 'intersection' });
    c.pointerMove(at(19.9, 9.95), false);
    expect(c.getView().snap).toMatchObject({ kind: 'point' }); // the end of the first line
    c.pointerMove(at(5, 2.52), false);
    expect(c.getView().snap).toMatchObject({ kind: 'curve' });
  });
});

describe('the extension of a line (FreeCAD line extension; SolidWorks inference line)', () => {
  // a slanted line, so being on its extension is not also being level or plumb with its ends
  const slanted = (patch: Partial<SnapSettings> = {}) => {
    const h = new Host();
    h.snapSettings = () => ({ ...DEFAULT_SNAPS, ...patch });
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 1, 1);
    click(c, 11, 6); // direction (2, 1)
    c.escape();
    const line = h.sketch().entities.find((e) => e.type === 'line')!;
    return { h, c, line };
  };

  it('a point past the end, close to where the line would go on, snaps onto it with a dotted guide from that end, and is put on the line', () => {
    const { h, c, line } = slanted();
    c.setTool('point');
    c.pointerMove(at(21.05, 10.95), false); // (21, 11) is on the extension; the cursor is 0.07 mm off it (5 px = 0.25 mm)
    const v = c.getView();
    expect(v.snap).toMatchObject({ kind: 'extension', line: line.id, from: [11, 6] });
    const s = v.snap as Extract<NonNullable<typeof v.snap>, { kind: 'extension' }>;
    expect(s.p[0]).toBeCloseTo(21.02, 9); // the foot of (21.05, 10.95) on the line
    expect(s.p[1]).toBeCloseTo(11.01, 9);
    expect(v.inference).toBe('在延長線上');
    click(c, 21.05, 10.95);
    const p = h.sketch().entities.filter((e) => e.type === 'point').at(-1)!;
    expect(h.sketch().constraints.at(-1)).toMatchObject({ type: 'pointOnCurve', point: p.id, curve: line.id });
    expect(h.last!.status).not.toBe('over');
    const q = point(h, p.id);
    expect(Math.abs((q[0] - 1) * 1 - (q[1] - 1) * 2) / Math.sqrt(5)).toBeLessThan(1e-9); // on the line through (1, 1) along (2, 1)
  });

  it('works past either end, and not on the line itself or at an end: those are the curve and the point', () => {
    const { c } = slanted();
    c.setTool('point');
    c.pointerMove(at(-8.95, -4.05), false); // before the start: (-9, -4)
    expect(c.getView().snap).toMatchObject({ kind: 'extension', from: [1, 1] });
    c.pointerMove(at(3.05, 1.95), false); // on the drawn line at (3, 2), away from its middle
    expect(c.getView().snap).toMatchObject({ kind: 'curve' });
    c.pointerMove(at(11.1, 6.05), false); // at its end
    expect(c.getView().snap).toMatchObject({ kind: 'point' });
  });

  it('a line ending on the extension of another gets its end put on that line, and the sketch is not over-defined', () => {
    const { h, c, line } = slanted();
    c.setTool('line');
    click(c, 31, 1); // from there toward (21, 11): 135°, not horizontal, vertical or along the first line
    click(c, 21.05, 10.95);
    c.escape();
    const second = h.sketch().entities.filter((e) => e.type === 'line').at(-1) as Extract<SketchFeature['entities'][number], { type: 'line' }>;
    expect(h.sketch().constraints).toContainEqual(expect.objectContaining({ type: 'pointOnCurve', point: second.p2, curve: line.id }));
    expect(h.last!.status).not.toBe('over');
    expect(h.last!.redundant).toEqual([]);
  });

  it('a line\'s own horizontal or vertical comes first, and the setting turns it off', () => {
    const { c } = slanted();
    c.setTool('line');
    click(c, -9, 30);
    c.pointerMove(at(-9.05, -4.05), false); // plumb under the start (vertical wins), and also near the extension at (-9, -4)
    expect(c.getView().snap).toMatchObject({ kind: 'free' });
    expect(c.getView().inference).toBe('垂直');
    c.escape();
    const off = slanted({ extension: false });
    off.c.setTool('point');
    off.c.pointerMove(at(21.05, 10.95), false);
    expect(off.c.getView().snap).toMatchObject({ kind: 'free' });
  });
});

describe('Ctrl while sketching (SolidWorks: hold Ctrl to keep relations from being added)', () => {
  it('a point clicked with Ctrl on an end, a middle and in line with a point goes where the cursor is, with no relation', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 20, 0);
    c.escape();
    const before = h.sketch().constraints.length;
    c.setTool('point');
    for (const [x, y] of [[20.1, 0.1], [10.05, 0.05], [30, 0.1]] as const) {
      c.pointerMove(at(x, y, { ctrl: true }), false);
      expect(c.getView().snap, `${x}, ${y}`).toMatchObject({ kind: 'free', p: [x, y] });
      const s = c.getView().snap;
      expect(s && s.kind === 'free' ? s.align : undefined, `${x}, ${y}`).toBeUndefined();
      expect(c.getView().inference, `${x}, ${y}`).toBeNull();
      click(c, x, y, { ctrl: true });
    }
    expect(h.sketch().constraints.length).toBe(before);
    expect(h.sketch().entities.filter((e) => e.type === 'point')).toHaveLength(5); // 2 ends + 3 new, none merged
  });

  it('a line drawn with Ctrl nearly horizontal stays as drawn; without Ctrl the same line is made horizontal', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 0, 0, { ctrl: true });
    click(c, 20, 0.3, { ctrl: true });
    c.escape();
    expect(types(h)).not.toContain('horizontal');
    const line = h.sketch().entities.find((e) => e.type === 'line') as Extract<SketchFeature['entities'][number], { type: 'line' }>;
    expect(point(h, line.p2)[1]).toBeCloseTo(0.3, 9);
    expect(types(h)).not.toContain('coincident'); // the first click was on the origin: not merged with it either
    click(c, 0, 10);
    click(c, 20, 10.3);
    expect(types(h)).toContain('horizontal');
  });

  it('only while it is held: the next move without Ctrl snaps again', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('point');
    click(c, 10, 5);
    c.pointerMove(at(10.05, 5.05, { ctrl: true }), false);
    expect(c.getView().snap).toMatchObject({ kind: 'free' });
    c.pointerMove(at(10.05, 5.05), false);
    expect(c.getView().snap).toMatchObject({ kind: 'point' });
  });
});
