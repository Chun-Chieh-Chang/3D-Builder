import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, parsePart, resolveSketch, serializePart, SKETCH_AXIS_H, type Command, type PartDoc, type SketchConstraint, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver, type SolvedGeometry } from '@3db/sketch';
import { SketchController, type PointerInput, type SketchHost } from '../src/sketcher/controller';
import type { SketchSolvePayload } from '../src/worker/protocol';

/** Values typed while drawing (P1, G01; cases B01–B04, T09 of docs/design/sketch-interaction/plan.md), checked on the real PlaneGCS solution. */

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EMPTY_SKETCH: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 'sketch1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};

/** E04: lengths to 1e-6 mm, angles to 1e-6 rad. */
const MM = 1e-6;
const RAD = 1e-6;

class Host implements SketchHost {
  readonly featureId = 'sketch1';
  readonly history: DocHistory;
  last: SketchSolvePayload | null = null;
  notices: string[] = [];

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
    else this.resolve();
  };
  trial = async (s: SketchFeature, doc?: PartDoc) => this.payload(s, {}, doc);
  notify = (text: string) => void this.notices.push(text);
  editDimension = () => {};
}

const at = (x: number, y: number, mods: Partial<PointerInput> = {}): PointerInput => ({ p: [x, y], px: 0.05, ctrl: false, shift: false, ...mods });
function click(c: SketchController, x: number, y: number): void {
  c.pointerMove(at(x, y), false);
  c.pointerDown(at(x, y));
  c.pointerUp(at(x, y));
}
const move = (c: SketchController, x: number, y: number) => c.pointerMove(at(x, y), false);

const geometry = (h: Host, id: string) => h.last!.geometry.get(id) as SolvedGeometry;
const lineOf = (h: Host, id: string) => geometry(h, id) as Extract<SolvedGeometry, { type: 'line' }>;
const lines = (h: Host) => h.sketch().entities.filter((e) => e.type === 'line' && !e.construction);
const dims = (h: Host) => h.sketch().constraints.filter((c) => ['distance', 'angle', 'radius', 'diameter'].includes(c.type)) as Extract<SketchConstraint, { value: string }>[];
const length = (g: Extract<SolvedGeometry, { type: 'line' }>) => Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
const direction = (g: Extract<SolvedGeometry, { type: 'line' }>) => Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0]);
/** The four corners of the solved rectangle's sides, as its extent. */
function extent(h: Host): { x0: number; x1: number; y0: number; y1: number } {
  const ps = lines(h).flatMap((l) => [lineOf(h, l.id).a, lineOf(h, l.id).b]);
  return { x0: Math.min(...ps.map((p) => p[0])), x1: Math.max(...ps.map((p) => p[0])), y0: Math.min(...ps.map((p) => p[1])), y1: Math.max(...ps.map((p) => p[1])) };
}

describe('typing values while drawing (P1, G01)', () => {
  it('B01: a line from the origin typed 30 long at 30°, Tab between the boxes, Enter: driving dimensions the solver holds while the end is dragged; one undo', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    expect(c.getView().entry).toBeNull(); // nothing to type before the start
    click(c, 0.1, 0.1); // onto the origin
    move(c, 20, 9);
    const before = c.getView().entry!;
    expect(before.fields.map((f) => f.key)).toEqual(['length', 'angle']);
    expect(before.fields.every((f) => !f.locked && f.live !== '')).toBe(true);
    expect(c.beginEntry('3')).toBe(true);
    c.setEntry('length', '30');
    expect(c.nextEntry()).toBe(true);
    expect(c.getView().entry!.active).toBe(1);
    c.setEntry('angle', '30');
    expect(h.history.canUndo).toBe(false);
    expect(c.commitEntry()).toBe(true);

    const [line] = lines(h);
    expect(line).toBeDefined();
    expect(dims(h)).toEqual([
      expect.objectContaining({ type: 'distance', a: line!.id, value: '30' }),
      expect.objectContaining({ type: 'angle', a: SKETCH_AXIS_H, b: line!.id, value: '30' }),
    ]);
    expect(dims(h).every((d) => d.driving !== false)).toBe(true);
    const g = lineOf(h, line!.id);
    expect(Math.abs(length(g) - 30)).toBeLessThanOrEqual(MM);
    expect(Math.abs(direction(g) - Math.PI / 6)).toBeLessThanOrEqual(RAD);
    expect(h.last!.status).toBe('fully');
    expect(c.getView().entry!.fields.every((f) => f.text === '')).toBe(true); // the next segment starts with nothing typed

    // dragging the free end cannot change what was typed
    const end = (h.sketch().entities.find((e) => e.id === line!.id) as Extract<SketchFeature['entities'][number], { type: 'line' }>).p2;
    h.dragPreview({ drag: { points: [{ id: end, x: 50, y: -10 }] }, initial: { points: [], radii: [] } });
    const dragged = lineOf(h, line!.id);
    expect(Math.abs(length(dragged) - 30)).toBeLessThanOrEqual(MM);
    expect(Math.abs(direction(dragged) - Math.PI / 6)).toBeLessThanOrEqual(RAD);
    h.dragPreview(null);

    // the line, its points and both dimensions are one step
    h.history.undo();
    expect(h.sketch().entities).toHaveLength(0);
    expect(h.sketch().constraints).toHaveLength(0);
    expect(h.history.canUndo).toBe(false);
    h.history.redo();
    expect(lines(h)).toHaveLength(1);
    expect(dims(h)).toHaveLength(2);
  });

  it('B01: the angle is measured clockwise to a line drawn below its start, and a click with the mouse uses the typed values too', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 5, 5);
    move(c, 20, -4); // below the start
    c.setEntry('angle', '40');
    click(c, 20, -4);
    const [line] = lines(h);
    expect(dims(h)).toEqual([expect.objectContaining({ type: 'angle', a: line!.id, b: SKETCH_AXIS_H, value: '40' })]);
    h.resolve();
    expect(Math.abs(direction(lineOf(h, line!.id)) + (40 * Math.PI) / 180)).toBeLessThanOrEqual(RAD);
  });

  it('B01: a typed angle replaces the direction relations the cursor would add (no horizontal next to an angle)', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 5, 5);
    move(c, 25, 5.2); // nearly horizontal: the cursor alone would make it horizontal
    expect(c.getView().inference).not.toBeNull();
    c.setEntry('angle', '10');
    expect(c.getView().inference).toBeNull();
    expect(c.commitEntry()).toBe(true);
    expect(h.sketch().constraints.map((x) => x.type)).toEqual(['angle']);
    expect(h.last!.status).not.toBe('over');
  });

  it.each([
    ['upper right', 30, 20],
    ['upper left', -30, 20],
    ['lower left', -30, -20],
    ['lower right', 30, -20],
  ])('B02: a center rectangle typed 40 × 25 with the cursor to the %s', (_, x, y) => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('centerRect');
    click(c, 0.1, 0.1); // its center on the origin
    move(c, x, y);
    c.setEntry('width', '40');
    c.setEntry('height', '25');
    expect(c.commitEntry()).toBe(true);
    const e = extent(h);
    for (const [got, want] of [[e.x0, -20], [e.x1, 20], [e.y0, -12.5], [e.y1, 12.5]] as const) expect(Math.abs(got - want)).toBeLessThanOrEqual(MM);
    expect(dims(h).map((d) => [d.type, d.value])).toEqual([['distance', '40'], ['distance', '25']]);
    expect(h.last!.status).toBe('fully');
  });

  it.each([
    ['upper right', 1, 1],
    ['upper left', -1, 1],
    ['lower left', -1, -1],
    ['lower right', 1, -1],
  ])('B02: a corner rectangle from (5, 5) typed 40 × 25 goes toward the cursor at the %s', (_, sx, sy) => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('rect');
    click(c, 5, 5);
    move(c, 5 + sx * 7, 5 + sy * 3);
    c.setEntry('width', '40');
    c.setEntry('height', '25');
    expect(c.commitEntry()).toBe(true);
    const e = extent(h);
    const [x0, x1] = sx > 0 ? [5, 45] : [-35, 5];
    const [y0, y1] = sy > 0 ? [5, 30] : [-20, 5];
    for (const [got, want] of [[e.x0, x0], [e.x1, x1], [e.y0, y0], [e.y1, y1]] as const) expect(Math.abs(got - want)).toBeLessThanOrEqual(MM);
  });

  it('B02: with only the width typed the cursor still sets the height; a snap never changes a typed value, and the hint says what was not snapped to', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('point');
    click(c, 15, 10);
    const target = h.sketch().entities.at(-1)!.id;
    c.setTool('centerRect');
    click(c, 0.1, 0.1);
    c.setEntry('width', '40');
    move(c, 10, 7);
    expect(c.getView().snap!.p).toEqual([20, 7]);
    move(c, 3, 9);
    expect(c.getView().snap!.p).toEqual([20, 9]);
    expect(c.getView().entry!.fields.find((f) => f.key === 'height')!.live).toBe('18'); // the cursor's height, doubled about the center
    c.setEntry('height', '25');
    move(c, 15, 10); // right on the point
    expect(c.getView().snap).toEqual({ kind: 'free', p: [20, 12.5] });
    expect(c.getView().hint).toContain(target);
    click(c, 15, 10);
    expect(h.sketch().constraints.filter((x) => JSON.stringify(x).includes(`"${target}"`))).toEqual([]);
    const e = extent(h);
    expect(Math.abs(e.x1 - 20)).toBeLessThanOrEqual(MM);
    expect(Math.abs(e.y1 - 12.5)).toBeLessThanOrEqual(MM);
  });

  it('B03: Ø8 switched to R gives R4 and one dimension; an inch value and a variable are kept as typed and drive the circle', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('circle');
    click(c, 10, 10);
    move(c, 13, 10);
    expect(c.getView().entry!.fields.map((f) => f.key)).toEqual(['diameter']);
    c.setEntry('diameter', '8');
    c.setCircleEntry('radius');
    expect(c.getView().entry!.fields).toEqual([expect.objectContaining({ key: 'radius', text: '4', locked: true })]);
    expect(c.commitEntry()).toBe(true);
    expect(dims(h)).toEqual([expect.objectContaining({ type: 'radius', value: '4' })]);
    const circle = h.sketch().entities.find((e) => e.type === 'circle')!.id;
    expect(Math.abs((geometry(h, circle) as Extract<SolvedGeometry, { type: 'circle' }>).r - 4)).toBeLessThanOrEqual(MM);

    // the radius box is kept for the next circle; switching back carries an expression over wrapped, not evaluated
    click(c, 40, 10);
    move(c, 45, 10);
    c.setEntry('radius', '0.5in');
    c.setCircleEntry('diameter');
    expect(c.getView().entry!.fields[0]).toMatchObject({ key: 'diameter', text: '(0.5in)*2', locked: true });
    expect(c.commitEntry()).toBe(true);
    const inch = h.sketch().entities.filter((e) => e.type === 'circle')[1]!.id;
    expect(Math.abs((geometry(h, inch) as Extract<SolvedGeometry, { type: 'circle' }>).r - 12.7)).toBeLessThanOrEqual(MM);
  });

  it('B03: a value naming a variable follows the variable, and survives saving and opening the part again', () => {
    const h = new Host(applyCommand(applyCommand(createEmptyPart(), EMPTY_SKETCH), { type: 'addVariable', variable: { id: 'v1', name: 'hole', expr: '8' } }));
    const c = new SketchController(h);
    c.setTool('circle');
    click(c, 0, 20);
    move(c, 3, 20);
    c.setEntry('diameter', 'hole');
    expect(c.commitEntry()).toBe(true);
    const circle = h.sketch().entities.find((e) => e.type === 'circle')!.id;
    const radius = () => (geometry(h, circle) as Extract<SolvedGeometry, { type: 'circle' }>).r;
    expect(Math.abs(radius() - 4)).toBeLessThanOrEqual(MM);
    expect(h.execute({ type: 'setVariable', id: 'v1', expr: '10' })).toBe(true);
    expect(Math.abs(radius() - 5)).toBeLessThanOrEqual(MM);

    const reopened = new Host(parsePart(serializePart(h.history.doc)));
    expect(reopened.sketch().constraints).toEqual(h.sketch().constraints);
    expect(reopened.sketch().constraints.find((x) => x.type === 'diameter')).toMatchObject({ value: 'hole' });
    expect(Math.abs((geometry(reopened, circle) as Extract<SolvedGeometry, { type: 'circle' }>).r - 5)).toBeLessThanOrEqual(MM);
  });

  it.each(['0', '-5', '0mm', 'NaN', 'Infinity', '1/0', '1+', 'abc', '2000000', '30deg'])('T09: a length typed as %s is refused where it is typed and makes nothing, by Enter or by a click', (text) => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 5, 5);
    move(c, 20, 9);
    c.setEntry('length', text);
    const field = c.getView().entry!.fields[0]!;
    expect(field.locked).toBe(false);
    expect(field.error).toBeTruthy();
    const doc = h.history.doc;
    expect(c.commitEntry()).toBe(false);
    click(c, 20, 9);
    expect(h.history.doc).toBe(doc); // nothing changed, nothing to undo
    expect(h.notices.at(-1)).toBe(field.error);
  });

  it.each(['0', '180', '-30', '200', '90mm'])('T09: an angle typed as %s is refused', (text) => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 5, 5);
    move(c, 20, 9);
    c.setEntry('angle', text);
    expect(c.getView().entry!.fields[1]).toMatchObject({ locked: false });
    expect(c.getView().entry!.fields[1]!.error).toBeTruthy();
    const doc = h.history.doc;
    expect(c.commitEntry()).toBe(false);
    expect(h.history.doc).toBe(doc);
  });

  it('Esc drops what was typed first, then the step, then the tool; what was drawn stays', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('line');
    click(c, 5, 5);
    click(c, 15, 9); // one segment drawn; the chain goes on
    move(c, 25, 2);
    c.beginEntry('1');
    c.setEntry('length', '12');
    expect(c.getView().entry!.fields[0]!.locked).toBe(true);
    c.escape();
    expect(c.getView().tool).toBe('line');
    expect(c.getView().entry!.fields.every((f) => f.text === '')).toBe(true); // the chain is still going
    c.escape();
    expect(c.getView().tool).toBe('line');
    expect(c.getView().entry).toBeNull();
    c.escape();
    expect(c.getView().tool).toBe('select');
    expect(lines(h)).toHaveLength(1);
    expect(dims(h)).toHaveLength(0);
  });

  it('a new tool and a new segment start with nothing typed; typing does nothing for a tool that takes no values', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('ellipse');
    click(c, 5, 5);
    expect(c.beginEntry('4')).toBe(false);
    c.setTool('circle');
    click(c, 5, 5);
    c.setEntry('diameter', '8');
    c.setTool('rect');
    click(c, 5, 5);
    expect(c.getView().entry!.fields.every((f) => f.text === '')).toBe(true);
  });

  it('B05: slot typed with length, angle and width produces driving dimensions; one undo step', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('slot');
    click(c, 0, 0); // first center
    move(c, 30, 10);
    expect(c.getView().entry!.fields.map((f) => f.key)).toEqual(['length', 'angle']);
    c.setEntry('length', '40');
    c.setEntry('angle', '30');
    expect(c.commitEntry()).toBe(true); // places second center

    move(c, 20, 15);
    expect(c.getView().entry!.fields.map((f) => f.key)).toEqual(['width']);
    c.setEntry('width', '12');
    expect(c.commitEntry()).toBe(true); // completes slot

    await c.settled();
    expect(dims(h)).toEqual([
      expect.objectContaining({ type: 'distance', value: '40' }),
      expect.objectContaining({ type: 'angle', value: '30' }),
      expect.objectContaining({ type: 'diameter', value: '12' }),
    ]);

    const arcs = h.sketch().entities.filter((e) => e.type === 'arc');
    expect(arcs).toHaveLength(2);
    const arcGeo = geometry(h, arcs[0]!.id) as Extract<SolvedGeometry, { type: 'arc' }>;
    expect(Math.abs(arcGeo.r - 6)).toBeLessThanOrEqual(MM);

    // 1-step undo
    h.history.undo();
    expect(h.sketch().entities).toHaveLength(0);
    expect(h.sketch().constraints).toHaveLength(0);
    h.history.redo();
    expect(h.sketch().entities.filter((e) => e.type === 'arc')).toHaveLength(2);
    expect(dims(h)).toHaveLength(3);
  });

  it('B06: polygon typed with radius and angle sets driving radius and construction ray angle (G16)', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('polygon');
    c.setOption('polygonSides', 6);
    click(c, 0, 0);
    move(c, 20, 10);
    expect(c.getView().entry!.fields.map((f) => f.key)).toEqual(['radius', 'angle']);
    c.setEntry('radius', '30');
    c.setEntry('angle', '30');
    expect(c.commitEntry()).toBe(true);

    await c.settled();
    expect(dims(h)).toEqual([
      expect.objectContaining({ type: 'radius', value: '30' }),
      expect.objectContaining({ type: 'angle', value: '30' }),
    ]);

    const circle = h.sketch().entities.find((e) => e.type === 'circle')!;
    const circGeo = geometry(h, circle.id) as Extract<SolvedGeometry, { type: 'circle' }>;
    expect(Math.abs(circGeo.r - 30)).toBeLessThanOrEqual(MM);

    // 1-step undo
    h.history.undo();
    expect(h.sketch().entities).toHaveLength(0);
    expect(h.sketch().constraints).toHaveLength(0);
    h.history.redo();
    expect(dims(h)).toHaveLength(2);
  });

  it('B06: polygon switched to edge length mode drives side length directly', async () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('polygon');
    c.setOption('polygonSides', 6);
    click(c, 0, 0);
    move(c, 20, 0);
    c.setPolygonEntry('edge');
    expect(c.getView().entry!.fields[0]!.key).toBe('edge');
    c.setEntry('edge', '15');
    expect(c.commitEntry()).toBe(true);

    await c.settled();
    expect(dims(h)).toEqual([expect.objectContaining({ type: 'distance', value: '15' })]);
    const linesMade = lines(h);
    expect(linesMade).toHaveLength(6);
    const sideGeo = lineOf(h, linesMade[0]!.id);
    expect(Math.abs(length(sideGeo) - 15)).toBeLessThanOrEqual(MM);
  });

  it('B06: hexagon oriented with angle 0 locks vertex along the X axis, and circumscribed side angle 0 locks first side parallel to X', async () => {
    // 1. Vertex to X axis: angle 0 on circumscribed=false
    const h1 = new Host();
    const c1 = new SketchController(h1);
    c1.setTool('polygon');
    c1.setOption('polygonSides', 6);
    c1.setOption('circumscribed', false);
    click(c1, 0, 0);
    move(c1, 20, 0);
    c1.setEntry('radius', '20');
    c1.setEntry('angle', '0');
    expect(c1.commitEntry()).toBe(true);
    await c1.settled();
    expect(dims(h1)).toEqual([
      expect.objectContaining({ type: 'radius', value: '20' }),
      expect.objectContaining({ type: 'angle', value: '0' }),
    ]);

    // 2. Side parallel to X: circumscribed=true with side angle 0
    const h2 = new Host();
    const c2 = new SketchController(h2);
    c2.setTool('polygon');
    c2.setOption('polygonSides', 6);
    c2.setOption('circumscribed', true);
    click(c2, 0, 0);
    move(c2, 0, 20);
    c2.setEntry('radius', '25');
    c2.setEntry('angle', '0');
    expect(c2.commitEntry()).toBe(true);
    await c2.settled();
    expect(dims(h2)).toEqual([
      expect.objectContaining({ type: 'radius', value: '25' }),
      expect.objectContaining({ type: 'angle', value: '0' }),
    ]);
  });

  it('Esc layering for slot and polygon: clears input text, backs out to previous step, and cancels tool', () => {
    const h = new Host();
    const c = new SketchController(h);
    c.setTool('slot');
    click(c, 0, 0);
    move(c, 20, 0);
    c.setEntry('length', '30');
    expect(c.getView().entry!.fields[0]!.locked).toBe(true);
    c.escape(); // drops typed length
    expect(c.getView().entry!.fields[0]!.text).toBe('');
    expect(c.getView().tool).toBe('slot');

    c.setEntry('length', '30');
    expect(c.commitEntry()).toBe(true); // places second center, now in width phase
    move(c, 20, 10);
    c.setEntry('width', '10');
    c.escape(); // drops typed width
    expect(c.getView().entry!.fields[0]!.text).toBe('');
    c.escape(); // cancels second center, backs up to first center
    expect(c.getView().entry!.fields.map((f) => f.key)).toEqual(['length', 'angle']);
    expect(c.getView().entry!.fields[0]!.text).toBe('30');
    c.escape(); // drops restored typed length
    expect(c.getView().entry!.fields[0]!.text).toBe('');
    c.escape(); // cancels first center
    expect(c.getView().entry).toBeNull();
    c.escape(); // returns to select tool
    expect(c.getView().tool).toBe('select');
    expect(h.sketch().entities).toHaveLength(0);
  });

  it('fuzz: 180 random lines, rectangles, circles, slots and polygons typed in, in every quadrant, solve to the typed values', async () => {
    let seed = 20261030;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const round = (v: number) => Number(v.toFixed(3));
    for (let i = 0; i < 180; i++) {
      // each case in a sketch of its own, so a case is checked on its own and the solve stays small
      const h = new Host();
      const c = new SketchController(h);
      const kind = (['line', 'rect', 'centerRect', 'circle', 'slot', 'polygon'] as const)[i % 6]!;
      const ox = round((rnd() - 0.5) * 400);
      const oy = round((rnd() - 0.5) * 400);
      const sx = rnd() < 0.5 ? -1 : 1;
      const sy = rnd() < 0.5 ? -1 : 1;
      const a = round(0.1 + rnd() * 500);
      const b = round(0.1 + rnd() * 500);
      c.setTool(kind);
      // far from everything drawn so far: Ctrl keeps the start from snapping
      c.pointerMove(at(ox, oy, { ctrl: true }), false);
      c.pointerDown(at(ox, oy, { ctrl: true }));
      c.pointerUp(at(ox, oy, { ctrl: true }));
      c.pointerMove(at(ox + sx * 3, oy + sy * 2, { ctrl: true }), false);
      const before = h.sketch().entities.length;
      const label = `case ${i}: ${kind} at (${ox}, ${oy}) toward (${sx}, ${sy}), ${a} × ${b}`;
      if (kind === 'line') {
        const angle = round(0.5 + rnd() * 179);
        c.setEntry('length', String(a));
        c.setEntry('angle', String(angle));
        expect(c.commitEntry()).toBe(true);
        const g = lineOf(h, h.sketch().entities.slice(before).find((e) => e.type === 'line')!.id);
        expect(Math.abs(length(g) - a)).toBeLessThanOrEqual(MM);
        expect(Math.abs(direction(g) - (sy * angle * Math.PI) / 180)).toBeLessThanOrEqual(RAD);
      } else if (kind === 'circle') {
        c.setEntry('diameter', String(a));
        expect(c.commitEntry()).toBe(true);
        const g = geometry(h, h.sketch().entities.slice(before).find((e) => e.type === 'circle')!.id) as Extract<SolvedGeometry, { type: 'circle' }>;
        expect(Math.abs(2 * g.r - a)).toBeLessThanOrEqual(MM);
      } else if (kind === 'slot') {
        const angle = round(0.5 + rnd() * 179);
        const width = round(Math.max(0.5, b / 4));
        c.setEntry('length', String(a));
        c.setEntry('angle', String(angle));
        expect(c.commitEntry()).toBe(true);
        c.pointerMove(at(ox + sx * 10, oy + sy * 10, { ctrl: true }), false);
        c.setEntry('width', String(width));
        expect(c.commitEntry()).toBe(true);
        await c.settled();
        const arcs = h.sketch().entities.slice(before).filter((e) => e.type === 'arc');
        expect(arcs).toHaveLength(2);
        const arcG = geometry(h, arcs[0]!.id) as Extract<SolvedGeometry, { type: 'arc' }>;
        expect(Math.abs(arcG.r - width / 2)).toBeLessThanOrEqual(MM);
      } else if (kind === 'polygon') {
        const sides = 3 + (i % 6);
        const angle = round(0.5 + rnd() * 179);
        c.setOption('polygonSides', sides);
        c.setEntry('radius', String(a));
        c.setEntry('angle', String(angle));
        expect(c.commitEntry()).toBe(true);
        await c.settled();
        const circ = h.sketch().entities.slice(before).find((e) => e.type === 'circle')!;
        const circG = geometry(h, circ.id) as Extract<SolvedGeometry, { type: 'circle' }>;
        expect(Math.abs(circG.r - a)).toBeLessThanOrEqual(MM);
      } else {
        c.setEntry('width', String(a));
        c.setEntry('height', String(b));
        expect(c.commitEntry(), label).toBe(true);
        expect(h.last!.status, `${label}: ${JSON.stringify(h.notices)}`).not.toBe('failed');
        const made = h.sketch().entities.slice(before).filter((e) => e.type === 'line' && !e.construction).map((e) => lineOf(h, e.id));
        const xs = made.flatMap((g) => [g.a[0], g.b[0]]);
        const ys = made.flatMap((g) => [g.a[1], g.b[1]]);
        expect(Math.abs(Math.max(...xs) - Math.min(...xs) - a)).toBeLessThanOrEqual(MM);
        expect(Math.abs(Math.max(...ys) - Math.min(...ys) - b)).toBeLessThanOrEqual(MM);
        // toward the cursor: a corner rectangle on the cursor's side of its first corner, a center rectangle about its center
        const mid = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
        if (kind === 'rect') expect([Math.sign(mid[0]! - ox), Math.sign(mid[1]! - oy)]).toEqual([sx, sy]);
        else expect(Math.hypot(mid[0]! - ox, mid[1]! - oy)).toBeLessThanOrEqual(MM);
      }
      expect(h.last!.status, label).not.toBe('failed');
      expect(h.last!.status, label).not.toBe('over');
    }
  });
});
