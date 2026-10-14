/**
 * D-I2 (ADR 0138): the edges and vertices of a view by name. The worker projects every edge and vertex of the part with its persistent name; the drawing keeps
 * those that lie on the view's visible lines (the near one where several are one place on the sheet). A dimension can then be put on a vertex or a straight
 * edge — in any view, the isometric too — and its number is the model's: worked out here by hand from the part's own corners, never from the drawing's lines.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rightOf, sheetUp, viewVectors, type Dimension, type Feature, type Ref, type ViewAxes, type ViewEdgeSet } from '@3db/model';
import { Kernel, type ShapeId } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { elementFacts, Regenerator, viewEdges, viewFeatures, type RebuildResult } from '@3db/regen';
import { EDGE_TOLERANCE, evaluateDimension, featureAt, planDimension, visibleElements, type EdgePick, type PlacedView, type ViewLines } from '@3db/drawing';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let built: RebuildResult;
let shape: ShapeId;
const kept: Regenerator[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
  const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  kept.push(regen);
  // a plate 40 × 30 × 20 with a blind hole Ø8 from its top
  built = regen.rebuild(
    build(
      sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      { ...sketch('s2', face('e1:cap:end')), entities: [{ id: 'p1', type: 'point', x: 10, y: 5 }] } as Feature,
      { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'straight', diameter: '8', end: { type: 'blind', depth: '10' } } as Feature,
    ),
  );
  shape = built.body!.shape;
});
afterAll(() => kept.forEach((r) => r.dispose()));

const axesOf = (name: 'front' | 'isometric'): ViewAxes => viewVectors(name);
function view(name: 'front' | 'isometric') {
  const axes = axesOf(name);
  const body = built.body!;
  const lines = kernel.projectView(shape, axes) as ViewLines;
  const set: ViewEdgeSet = viewEdges(kernel, shape, body.topology, body.names, axes);
  const features = viewFeatures(body.topology, body.names, axes);
  return { axes, lines, set, features, seen: visibleElements(lines, set, features) };
}
/** Where a point of the part is in a view (x to the right, y up) and how near the viewer. */
const project = (p: readonly number[], axes: ViewAxes) => {
  const r = rightOf(axes);
  // the sheet's y is square to the direction looked along: in the isometric it is not the model's up (sheetUp)
  const u = sheetUp(axes);
  return { at: [p[0]! * r[0] + p[1]! * r[1] + p[2]! * r[2], p[0]! * u[0] + p[1]! * u[1] + p[2]! * u[2]] as [number, number], depth: -(p[0]! * axes.dir[0] + p[1]! * axes.dir[1] + p[2]! * axes.dir[2]) };
};
const placedAt = (lines: ViewLines): PlacedView => {
  const b = lines.box!;
  return { id: 'v', at: [200, 150], scale: 1, w: b.max[0] - b.min[0], h: b.max[1] - b.min[1], centre: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] };
};
/** The corners of the plate's box (the vertices of its outline), from the topology. */
const corners = () => built.body!.topology.vertices.map((v) => v.point).filter((p) => [0, 40].some((x) => Math.abs(p[0] - x) < 1e-6) && [0, 30].some((y) => Math.abs(p[1] - y) < 1e-6));

describe('which edges and vertices a view shows', () => {
  it('the front view: the four corners of the near face, each the nearer of the two that are one point on the sheet', () => {
    const { axes, seen } = view('front');
    const box = corners().map((p) => project(p, axes));
    const atCorner = seen.vertices.filter((v) => box.some((c) => Math.hypot(c.at[0] - v.at[0], c.at[1] - v.at[1]) < 1e-6));
    expect(atCorner.length).toBe(4);
    for (const v of atCorner) {
      const here = box.filter((c) => Math.hypot(c.at[0] - v.at[0], c.at[1] - v.at[1]) < 1e-6);
      expect(here.length).toBe(2);
      expect(v.depth).toBeCloseTo(Math.max(...here.map((c) => c.depth)), 6);
    }
  });

  it('the isometric view: seven of the eight corners, the far one hidden', () => {
    const { axes, seen } = view('isometric');
    const box = corners().map((p) => project(p, axes));
    expect(box.length).toBe(8);
    const shown = box.filter((c) => seen.vertices.some((v) => Math.hypot(c.at[0] - v.at[0], c.at[1] - v.at[1]) < 1e-6));
    expect(shown.length).toBe(7);
    const far = box.reduce((a, b) => (b.depth < a.depth ? b : a));
    expect(shown.includes(far)).toBe(false);
  });

  it("every vertex shown is the part's by name: its facts are where it is drawn", () => {
    const { axes, seen } = view('isometric');
    const body = built.body!;
    // the seven corners seen, and nothing on the hole's outline (the point its circle starts at is not offered)
    expect(seen.vertices.length).toBeGreaterThanOrEqual(7);
    for (const v of seen.vertices) {
      const f = elementFacts(body.topology, body.names, v.ref);
      expect('error' in f, v.ref.name).toBe(false);
      const p = project((f as { point: number[] }).point, axes);
      expect(Math.hypot(p.at[0] - v.at[0], p.at[1] - v.at[1])).toBeLessThan(1e-6);
    }
  });

  it('the grid gives what looking at every segment gives (the oracle): the same edges and vertices, in both views', () => {
    for (const name of ['front', 'isometric'] as const) {
      const { lines, set, seen } = view(name);
      const dist = (x: number, y: number) => {
        let best = Infinity;
        for (const l of lines.visible)
          for (let k = 0; k + 3 < l.length; k += 2) {
            const dx = l[k + 2]! - l[k]!;
            const dy = l[k + 3]! - l[k + 1]!;
            const l2 = dx * dx + dy * dy;
            const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - l[k]!) * dx + (y - l[k + 1]!) * dy) / l2));
            best = Math.min(best, Math.hypot(x - l[k]! - t * dx, y - l[k + 1]! - t * dy));
          }
        return best;
      };
      const onBrute = set.vertices.filter((v) => dist(v.at[0], v.at[1]) <= EDGE_TOLERANCE);
      // every vertex the brute force finds on a line is at a place the drawing shows a vertex, and the other way round
      for (const v of onBrute) expect(seen.vertices.some((s) => Math.hypot(s.at[0] - v.at[0], s.at[1] - v.at[1]) <= EDGE_TOLERANCE), `${name} ${v.ref.name}`).toBe(true);
      for (const s of seen.vertices) expect(dist(s.at[0], s.at[1]) <= EDGE_TOLERANCE, `${name} ${s.ref.name}`).toBe(true);
    }
  });

  it('a point near a vertex shown picks that vertex (200 random points within reach, 0 misses)', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const { lines, features, seen } = view('isometric');
    const tol = 0.6;
    // only vertices further apart than twice the reach can be told apart by a point within it
    const apart = seen.vertices.filter((v) => seen.vertices.every((w) => w === v || Math.hypot(w.at[0] - v.at[0], w.at[1] - v.at[1]) > 2 * tol));
    expect(apart.length).toBeGreaterThan(5);
    for (let k = 0; k < 200; k++) {
      const v = apart[Math.floor(rnd() * apart.length)]!;
      const a = rnd() * 2 * Math.PI;
      const r = rnd() * tol * 0.95;
      const got = featureAt(lines, features, [v.at[0] + r * Math.cos(a), v.at[1] + r * Math.sin(a)], tol, seen);
      expect(got?.type).toBe('vertex');
      expect((got as { ref: { name: string } }).ref.name).toBe(v.ref.name);
    }
  });
});

describe('what is not offered', () => {
  it('the point a whole circle starts at is not a vertex to pick: pointing at the hole outline there picks the hole (the circle), as SolidWorks does', () => {
    // the hole is drilled along z: the front view sees it as a circle
    const axes: ViewAxes = viewVectors('front');
    const body = built.body!;
    const lines = kernel.projectView(shape, axes) as ViewLines;
    const set = viewEdges(kernel, shape, body.topology, body.names, axes);
    const features = viewFeatures(body.topology, body.names, axes);
    const seen = visibleElements(lines, set, features);
    const hole = features.find((f) => f.type === 'circle' && f.full) as Extract<(typeof features)[number], { type: 'circle' }>;
    expect(hole).toBeDefined();
    // no vertex anywhere on the hole's outline
    expect(seen.vertices.some((v) => Math.abs(Math.hypot(v.at[0] - hole.centre[0], v.at[1] - hole.centre[1]) - hole.radius) < 1e-3)).toBe(false);
    // and every quarter of the outline picks the hole
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const got = featureAt(lines, features, [hole.centre[0] + hole.radius * Math.cos(a), hole.centre[1] + hole.radius * Math.sin(a)], 0.6, seen);
      expect(got?.type, `at ${a}`).toBe('circle');
    }
  });
});

describe('dimensions on vertices and edges', () => {
  const facts = (refs: Ref[]) => ({ elements: refs.map((r) => elementFacts(built.body!.topology, built.body!.names, r) as never) });

  it('the front view: a horizontal edge alone is its length, 40, as the model has it', () => {
    const { axes, lines, seen } = view('front');
    const placed = placedAt(lines);
    const bottom = seen.edges.find((e) => Math.abs(e.a[1] - e.b[1]) < 1e-6 && Math.abs(Math.abs(e.a[0] - e.b[0]) - 40) < 1e-6 && e.ends[0] && e.ends[1]) as EdgePick;
    expect(bottom).toBeDefined();
    const plan = planDimension([bottom], [200, 150 - placed.h / 2 - 15], placed, axes);
    expect('draft' in plan).toBe(true);
    const draft = (plan as unknown as { draft: Dimension }).draft as Extract<Dimension, { kind: 'linear' }>;
    expect(draft.orientation).toBe('horizontal');
    const out = evaluateDimension({ ...draft, id: 'd', view: 'v' } as Dimension, facts([draft.a, draft.b]), axes, placed);
    expect('error' in out).toBe(false);
    expect((out as { value: number }).value).toBeCloseTo(40, 9);
  });

  it("the isometric view: an edge's length is what it is seen as (its projection), worked out by hand from its two corners", () => {
    const { axes, lines, seen } = view('isometric');
    const placed = placedAt(lines);
    const body = built.body!;
    const edges = seen.edges.filter((e) => e.ends[0] && e.ends[1]);
    expect(edges.length).toBeGreaterThan(5);
    for (const e of edges) {
      const plan = planDimension([e], [placed.at[0] + placed.w, placed.at[1] + placed.h], placed, axes);
      expect('draft' in plan, e.ref.name).toBe(true);
      const draft = (plan as unknown as { draft: Dimension }).draft as Extract<Dimension, { kind: 'linear' }>;
      const [pa, pb] = [draft.a, draft.b].map((r) => project((elementFacts(body.topology, body.names, r) as { point: number[] }).point, axes).at);
      const byHand = draft.orientation === 'horizontal' ? Math.abs(pb![0] - pa![0]) : draft.orientation === 'vertical' ? Math.abs(pb![1] - pa![1]) : Math.hypot(pb![0] - pa![0], pb![1] - pa![1]);
      const out = evaluateDimension({ ...draft, id: 'd', view: 'v' } as Dimension, facts([draft.a, draft.b]), axes, placed);
      expect('error' in out, e.ref.name).toBe(false);
      expect((out as { value: number }).value).toBeCloseTo(byHand, 6);
      expect(byHand).toBeGreaterThan(1);
    }
  });

  it('two vertices: the true distance between them where the pointer is off a corner, along x or y beside or above', () => {
    const { axes, lines, seen } = view('front');
    const placed = placedAt(lines);
    const box = corners().map((p) => project(p, axes));
    const pick = (x: number, y: number) => seen.vertices.find((v) => Math.hypot(v.at[0] - x, v.at[1] - y) < 1e-6)!;
    const lo = box.reduce((a, b) => (b.at[0] + b.at[1] < a.at[0] + a.at[1] ? b : a)).at;
    const hi = box.reduce((a, b) => (b.at[0] + b.at[1] > a.at[0] + a.at[1] ? b : a)).at;
    const [a, b] = [pick(lo[0], lo[1]), pick(hi[0], hi[1])];
    const corner = planDimension([a, b], [placed.at[0] + placed.w, placed.at[1] + placed.h], placed, axes) as unknown as { draft: Extract<Dimension, { kind: 'linear' }> };
    expect(corner.draft.orientation).toBe('aligned');
    const out = evaluateDimension({ ...corner.draft, id: 'd', view: 'v' } as Dimension, facts([corner.draft.a, corner.draft.b]), axes, placed) as { value: number };
    expect(out.value).toBeCloseTo(Math.hypot(40, 30), 9);
    const above = planDimension([a, b], [placed.at[0], placed.at[1] + placed.h], placed, axes) as unknown as { draft: Extract<Dimension, { kind: 'linear' }> };
    expect(above.draft.orientation).toBe('horizontal');
    expect((evaluateDimension({ ...above.draft, id: 'd', view: 'v' } as Dimension, facts([above.draft.a, above.draft.b]), axes, placed) as { value: number }).value).toBeCloseTo(40, 9);
  });

  it('aligned from a corner to a plane seen edge-on is the distance square to the plane, from the model: 40 from x = 0 to the side at x = 40', () => {
    const { axes, lines, features, seen } = view('front');
    const placed = placedAt(lines);
    const side = features.find((f) => f.type === 'plane' && f.axis === 'x' && Math.abs(f.coord - 40) < 1e-6)!;
    const origin = seen.vertices.find((v) => Math.hypot(v.at[0], v.at[1]) < 1e-6)!;
    expect(side && origin).toBeTruthy();
    const d = { id: 'd', view: 'v', kind: 'linear', a: origin.ref, b: side.ref, orientation: 'aligned', offset: 10 } as Dimension;
    const out = evaluateDimension(d, facts([origin.ref, side.ref]), axes, placed) as { value: number };
    expect(out.value).toBeCloseTo(40, 9);
  });

  it('an angle between edges that do not lie in the sheet (the isometric) is refused: the view does not show it truly', () => {
    const { axes, lines, seen } = view('isometric');
    const placed = placedAt(lines);
    const slanted = seen.edges.filter((e) => !e.inPlane && Math.abs(e.a[0] - e.b[0]) > 1e-3 && Math.abs(e.a[1] - e.b[1]) > 1e-3);
    expect(slanted.length).toBeGreaterThan(1);
    const [e1, e2] = [slanted[0]!, slanted.find((e) => Math.abs((e.b[1] - e.a[1]) / (e.b[0] - e.a[0]) - (slanted[0]!.b[1] - slanted[0]!.a[1]) / (slanted[0]!.b[0] - slanted[0]!.a[0])) > 1e-3)!];
    expect(e2).toBeDefined();
    const plan = planDimension([e1, e2], [placed.at[0], placed.at[1]], placed, axes);
    expect('error' in plan).toBe(true);
  });
});
