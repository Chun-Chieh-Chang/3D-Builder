import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, type Command, type PartDoc, type SketchFeature } from '@3db/model';
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

  private payload(s: SketchFeature, options = {}): SketchSolvePayload {
    const r = solver.solve(s, options);
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
  trial = async (s: SketchFeature) => this.payload(s);
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
    expect(h.sketch().constraints.filter((x) => x.type === 'distance')).toHaveLength(2); // the top width was refused
    expect(h.notices.join()).toContain('過多定義');
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
