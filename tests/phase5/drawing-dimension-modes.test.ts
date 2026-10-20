/**
 * ADR 0175: every kind of dimension made from a drawing view, through the same path the sheet takes ??the element under the pointer (`featureAt`, on the view's real
 * hidden-line projection and the part's named edges), the plan (`planDimension` with the kind asked for) and the number (`evaluateDimension` on the model's own
 * facts of the elements). Every expected value is worked out here from the part's topology (its vertices and its cylinders), never from the drawing's lines and
 * never written in by hand.
 *
 * The part: a plate 10 thick, its outline (0,0) (40,0) (40,20) (30,30) (0,30) ??one slanted side ??with the corner at (0,0) rounded R5 and a ?8 hole at (12,12).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rightOf, sheetUp, viewVectors, type Dimension, type Feature, type Ref, type ViewAxes, type ViewFeature } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { elementFacts, Regenerator, viewEdges, viewFeatures, type RebuildResult } from '@3db/regen';
import { DIMENSION_MODES, dimensionModesFor, evaluateDimension, featureAt, pickKind, planDimension, toSheet, visibleElements, type DimensionMode, type Pickable, type PlacedView, type ViewLines } from '@3db/drawing';
import { t } from '@3db/i18n';
import { build, edge, extrude, face, fillet, front, pin, sketch } from '../phase1/builders';

let kernel: Kernel;
let regen: Regenerator;
let built: RebuildResult;

const OUTLINE: [number, number][] = [[0, 0], [40, 0], [40, 20], [30, 30], [0, 30]];
const THICK = 10;

/** The plate's sketch: the five corners pinned, joined in order. */
const outline = (): Feature =>
  sketch('s1', front, {
    entities: [
      ...OUTLINE.map(([x, y], i) => ({ id: `q${i}`, type: 'point' as const, x, y })),
      ...OUTLINE.map((_, i) => ({ id: `l${i}`, type: 'line' as const, p1: `q${i}`, p2: `q${(i + 1) % OUTLINE.length}` })),
    ],
    constraints: OUTLINE.flatMap(([x, y], i) => pin(`q${i}`, `q${i}`, x, y)),
  });
const hole = (): Feature[] => [
  { ...sketch('s2', face('e1:cap:end')), entities: [{ id: 'p1', type: 'point', x: 12, y: 12 }] } as Feature,
  { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'straight', diameter: '8', end: { type: 'throughAll' } } as Feature,
];

beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  // the edge along z at the corner (0,0), by the name the model gives it: what the fillet rounds
  const plain = regen.rebuild(build(outline(), extrude('e1', 's1', 'boss', { type: 'blind', depth: String(THICK) })));
  const body = plain.body!;
  const corner = body.topology.edges.findIndex((e) => e.curve === 'line' && e.vertices.every((v) => Math.hypot(body.topology.vertices[v]!.point[0], body.topology.vertices[v]!.point[1]) < 1e-6));
  expect(corner).toBeGreaterThanOrEqual(0);
  built = regen.rebuild(build(outline(), extrude('e1', 's1', 'boss', { type: 'blind', depth: String(THICK) }), fillet('f1', [edge(body.names.edges[corner]!)], '5'), ...hole()));
  expect(built.features.every((f) => f.status === 'ok'), JSON.stringify(built.features.map((f) => [f.id, f.status, f.message]))).toBe(true);
});
afterAll(() => regen.dispose());

const axes: ViewAxes = viewVectors('front');
function frontView() {
  const body = built.body!;
  const lines = kernel.projectView(body.shape, axes) as ViewLines;
  const features = viewFeatures(body.topology, body.names, axes);
  const seen = visibleElements(lines, viewEdges(kernel, body.shape, body.topology, body.names, axes), features);
  const b = lines.box!;
  const placed: PlacedView = { id: 'v', at: [200, 150], scale: 1, w: b.max[0] - b.min[0], h: b.max[1] - b.min[1], centre: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] };
  return { lines, features, seen, placed };
}
let V: ReturnType<typeof frontView>;
beforeAll(() => {
  V = frontView();
});

/** A point of the part in the front view (x right, y up). */
const inView = (p: readonly number[]): [number, number] => {
  const r = rightOf(axes);
  const u = sheetUp(axes);
  return [p[0]! * r[0] + p[1]! * r[1] + p[2]! * r[2], p[0]! * u[0] + p[1]! * u[1] + p[2]! * u[2]];
};
/** The part's vertices as the front view sees them (the near and far ones fall on the same points). */
const corners = () => built.body!.topology.vertices.map((v) => inView(v.point));
const cornerAt = (x: number, y: number): [number, number] => {
  const c = corners().find((q) => Math.hypot(q[0] - x, q[1] - y) < 1e-6);
  expect(c, `a vertex of the part at (${x}, ${y})`).toBeDefined();
  return c!;
};
/** The radius of the part's cylinder whose axis is at (x, y) in the view: the hole's, the fillet's. */
const cylinderAt = (x: number, y: number): number => {
  const g = built.body!.topology.faces.map((f) => f.geometry).find((s) => s?.type === 'cylinder' && Math.hypot(inView(s.origin)[0] - x, inView(s.origin)[1] - y) < 1e-6);
  expect(g, `a cylinder of the part about (${x}, ${y})`).toBeDefined();
  return (g as { radius: number }).radius;
};

const pickAt = (x: number, y: number): Pickable => {
  const f = featureAt(V.lines, V.features, inView([x, y, 0]), 0.4, V.seen);
  expect(f, `something under (${x}, ${y})`).not.toBeNull();
  return f!;
};
/** Where on the sheet a pointer is, from a point of the view. */
const sheetAt = (x: number, y: number) => toSheet(V.placed, ...inView([x, y, 0]));
/** The dimension planned and its number, from the model's facts of its elements. */
function make(picks: Pickable[], at: [number, number], mode?: DimensionMode) {
  const plan = planDimension(picks, at, V.placed, axes, mode);
  if (!('draft' in plan)) return plan;
  const d = { ...plan.draft, id: 'd', view: 'v' } as Dimension;
  const refs: Ref[] = d.kind === 'linear' || d.kind === 'angle' ? [d.a, d.b] : d.kind === 'ordinate' ? [] : [d.ref];
  const elements = refs.map((r) => elementFacts(built.body!.topology, built.body!.names, r));
  expect(elements.every((e) => !('error' in e)), JSON.stringify(elements)).toBe(true);
  const out = evaluateDimension(d, { elements: elements as never }, axes, V.placed);
  if ('error' in out) return { error: out.error };
  return { kind: d.kind, orientation: d.kind === 'linear' ? d.orientation : undefined, value: out.value };
}
const deg = (r: number) => (r * 180) / Math.PI;

describe('a line pointed at alone is its length (the reason only circles could be dimensioned with one click)', () => {
  it('the line under the pointer is a plane seen edge-on, and carries the model edge drawn there', () => {
    const f = pickAt(20, 0);
    expect(f.type).toBe('plane');
    expect('along' in f && f.along?.type).toBe('edge');
  });

  it('the bottom: horizontal, from the end of the fillet to the corner', () => {
    const [a, b] = [cornerAt(5, 0), cornerAt(40, 0)];
    const got = make([pickAt(20, 0)], sheetAt(20, -15));
    expect(got).toMatchObject({ kind: 'linear', orientation: 'horizontal' });
    expect((got as { value: number }).value).toBeCloseTo(Math.abs(b[0] - a[0]), 9);
  });

  it('the right side: vertical', () => {
    const [a, b] = [cornerAt(40, 0), cornerAt(40, 20)];
    const got = make([pickAt(40, 10)], sheetAt(55, 10));
    expect(got).toMatchObject({ kind: 'linear', orientation: 'vertical' });
    expect((got as { value: number }).value).toBeCloseTo(Math.abs(b[1] - a[1]), 9);
  });

  it('the slanted side: along itself, and its width and height when asked for', () => {
    const [a, b] = [cornerAt(40, 20), cornerAt(30, 30)];
    const p = pickAt(35, 25);
    expect(p.type).toBe('slant');
    expect(make([p], sheetAt(45, 35))).toMatchObject({ kind: 'linear', orientation: 'aligned', value: expect.closeTo(Math.hypot(b[0] - a[0], b[1] - a[1]), 9) });
    expect(make([p], sheetAt(35, 45), 'horizontal')).toMatchObject({ orientation: 'horizontal', value: expect.closeTo(Math.abs(b[0] - a[0]), 9) });
    expect(make([p], sheetAt(50, 25), 'vertical')).toMatchObject({ orientation: 'vertical', value: expect.closeTo(Math.abs(b[1] - a[1]), 9) });
    expect(make([p], sheetAt(45, 35), 'aligned')).toMatchObject({ orientation: 'aligned', value: expect.closeTo(Math.hypot(b[0] - a[0], b[1] - a[1]), 9) });
  });

  it('a line with no length the asked way is refused, not given another kind', () => {
    expect(make([pickAt(20, 0)], sheetAt(55, 0), 'vertical')).toEqual({ error: t('drawing.dimZero') });
  });
});

describe('two elements', () => {
  it('two vertices: horizontal, vertical and the true distance', () => {
    const [a, b] = [cornerAt(40, 0), cornerAt(0, 30)];
    const va = pickAt(40, 0);
    const vb = pickAt(0, 30);
    expect([va.type, vb.type]).toEqual(['vertex', 'vertex']);
    expect(make([va, vb], sheetAt(20, 45), 'horizontal')).toMatchObject({ orientation: 'horizontal', value: expect.closeTo(Math.abs(a[0] - b[0]), 9) });
    expect(make([va, vb], sheetAt(55, 15), 'vertical')).toMatchObject({ orientation: 'vertical', value: expect.closeTo(Math.abs(a[1] - b[1]), 9) });
    expect(make([va, vb], sheetAt(25, 20), 'aligned')).toMatchObject({ orientation: 'aligned', value: expect.closeTo(Math.hypot(a[0] - b[0], a[1] - b[1]), 9) });
  });

  it('two parallel lines: the distance across them, horizontal or aligned (the same distance)', () => {
    const right = pickAt(40, 10);
    const left = pickAt(0, 20);
    const across = Math.abs(cornerAt(40, 0)[0] - cornerAt(0, 30)[0]);
    expect(make([left, right], sheetAt(20, 45))).toMatchObject({ orientation: 'horizontal', value: expect.closeTo(across, 9) });
    expect(make([left, right], sheetAt(20, 45), 'aligned')).toMatchObject({ value: expect.closeTo(across, 9) });
    expect(make([left, right], sheetAt(20, 45), 'vertical')).toEqual({ error: t('drawing.dimModeDirection', { mode: t('drawingUi.dimMode.vertical') }) });
  });

  it('a vertex and the slanted line: square to it', () => {
    const [a, b] = [cornerAt(40, 20), cornerAt(30, 30)];
    const q = cornerAt(0, 30);
    const u = [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])];
    const off = Math.abs((q[0] - a[0]) * u[1] - (q[1] - a[1]) * u[0]);
    expect(make([pickAt(0, 30), pickAt(35, 25)], sheetAt(20, 40))).toMatchObject({ orientation: 'aligned', value: expect.closeTo(off, 9) });
  });

  it('the hole to the left side, horizontal', () => {
    const h = pickAt(12 + cylinderAt(12, 12), 12);
    expect(h.type).toBe('circle');
    expect(make([pickAt(0, 20), h], sheetAt(6, 45), 'horizontal')).toMatchObject({ value: expect.closeTo(12 - cornerAt(0, 30)[0], 9) });
  });

  it('an angle between the slanted side and the right side', () => {
    const [a, b] = [cornerAt(40, 20), cornerAt(30, 30)];
    const between = deg(Math.acos(Math.abs((b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]))));
    const got = make([pickAt(35, 25), pickAt(40, 10)], sheetAt(44, 26), 'angle') as { kind: string; value: number };
    expect(got.kind).toBe('angle');
    expect(Math.min(got.value, 180 - got.value)).toBeCloseTo(between, 6);
    // asked for as smart, two lines that meet are an angle as well
    expect(make([pickAt(35, 25), pickAt(40, 10)], sheetAt(44, 26))).toMatchObject({ kind: 'angle' });
  });

  it('an angle between parallel lines is refused with the reason', () => {
    expect(make([pickAt(0, 20), pickAt(40, 10)], sheetAt(20, 45), 'angle')).toEqual({ error: t('drawing.dimNeedsAngle') });
  });
});

describe('circles and arcs', () => {
  it('the hole: its diameter alone, its radius when asked for', () => {
    const r = cylinderAt(12, 12);
    const h = pickAt(12 + r, 12);
    expect(pickKind(h)).toBe('circle');
    expect(make([h], sheetAt(30, -10))).toMatchObject({ kind: 'diameter', value: expect.closeTo(2 * r, 9) });
    expect(make([h], sheetAt(30, -10), 'diameter')).toMatchObject({ kind: 'diameter', value: expect.closeTo(2 * r, 9) });
    expect(make([h], sheetAt(30, -10), 'radius')).toMatchObject({ kind: 'radius', value: expect.closeTo(r, 9) });
  });

  it('the rounded corner: its radius alone, its diameter when asked for', () => {
    const r = cylinderAt(5, 5);
    const at = 5 - r * Math.SQRT1_2;
    const arc = pickAt(at, at);
    expect(pickKind(arc)).toBe('arc');
    expect(make([arc], sheetAt(-10, -10))).toMatchObject({ kind: 'radius', value: expect.closeTo(r, 9) });
    expect(make([arc], sheetAt(-10, -10), 'diameter')).toMatchObject({ kind: 'diameter', value: expect.closeTo(2 * r, 9) });
  });

  it('a diameter or a radius of what is not round is refused; a circle asked for as a distance along a way is told it is round', () => {
    expect(make([pickAt(20, 0)], sheetAt(20, -15), 'radius')).toEqual({ error: t('drawing.dimModeNotRound') });
    expect(make([pickAt(40, 0)], sheetAt(20, -15), 'diameter')).toEqual({ error: t('drawing.dimModeNotRound') });
    const h = pickAt(12 + cylinderAt(12, 12), 12);
    expect(make([h], sheetAt(30, -10), 'horizontal')).toEqual({ error: t('drawing.dimModeRound') });
    expect(make([h, pickAt(0, 20)], sheetAt(30, -10), 'radius')).toEqual({ error: t('drawing.dimModeNotRound') });
  });
});

describe('what is refused before anything is planned', () => {
  it('a kind that is not one, a pointer that is not a number', () => {
    expect(planDimension([pickAt(20, 0)], sheetAt(20, -15), V.placed, axes, 'diagonal' as DimensionMode)).toEqual({ error: t('drawing.dimBadMode', { mode: 'diagonal' }) });
    for (const bad of [NaN, Infinity, -Infinity]) expect(planDimension([pickAt(20, 0)], [bad, 100], V.placed, axes, 'smart')).toEqual({ error: t('drawing.badPosition') });
  });
});

describe('what the right-click menu of an element offers (ADR 0175)', () => {
  /** A second element each kind can be made with, for the kinds that need one. */
  const partner = (mode: DimensionMode, first: Pickable): Pickable | null => {
    if (mode === 'angle') return pickAt(35, 25) === first || pickAt(35, 25).type === first.type ? pickAt(40, 10) : pickAt(35, 25);
    if (mode === 'horizontal' || mode === 'vertical' || mode === 'aligned' || mode === 'smart') return pickAt(0, 30);
    return null;
  };
  it('every kind offered for a line, a vertex, a circle and an arc can be made from it: alone, or with a second element', () => {
    const elements = [pickAt(35, 25), pickAt(40, 0), pickAt(12 + cylinderAt(12, 12), 12), pickAt(5 - 5 * Math.SQRT1_2, 5 - 5 * Math.SQRT1_2)];
    expect(elements.map(pickKind)).toEqual(['line', 'vertex', 'circle', 'arc']);
    for (const f of elements) {
      for (const mode of dimensionModesFor(f)) {
        expect(DIMENSION_MODES).toContain(mode);
        const alone = make([f], sheetAt(20, 50), mode);
        if ('kind' in alone) continue;
        const second = partner(mode, f);
        expect(second, `${pickKind(f)} ${mode}: ${JSON.stringify(alone)}`).not.toBeNull();
        // the place: far enough from the view whichever way the dimension runs
        const tries = [sheetAt(20, 50), sheetAt(60, 15), sheetAt(46, 32)].map((p) => make([f, second!], p, mode));
        expect(tries.some((x) => 'kind' in x), `${pickKind(f)} ${mode}: ${JSON.stringify(tries)}`).toBe(true);
      }
    }
  });

  it('a fillet seen across offers only its radius', () => {
    expect(dimensionModesFor({ type: 'torus', ref: { kind: 'face', name: 'x' }, centre: [0, 0], axis: [1, 0], radius: 2, major: 5, at: [0, 5] } as Extract<ViewFeature, { type: 'torus' }>)).toEqual(['radius']);
  });
});

describe("an edge's ends are named in the order its points run (found by the fuzz below: the left side measured 0)", () => {
  it('every straight edge of the view: its first end is the vertex at its first point, its second the one at its last', () => {
    const body = built.body!;
    const set = viewEdges(kernel, body.shape, body.topology, body.names, axes);
    const lines = set.edges.filter((e) => e.kind === 'line' && e.ends[0] && e.ends[1]);
    expect(lines.length).toBeGreaterThan(10);
    for (const e of lines) {
      const at = (r: Ref) => inView((elementFacts(body.topology, body.names, r) as { point: number[] }).point);
      const [a, b] = [at(e.ends[0]!), at(e.ends[1]!)];
      const n = e.points.length;
      expect(Math.hypot(a[0] - e.points[0]!, a[1] - e.points[1]!), e.ref.name).toBeLessThan(1e-6);
      expect(Math.hypot(b[0] - e.points[n - 2]!, b[1] - e.points[n - 1]!), e.ref.name).toBeLessThan(1e-6);
    }
  });
});

describe('fuzz: 200 random picks, kinds and places (0 throws, each answer is a dimension with a finite positive number or a reason)', () => {
  it('holds', () => {
    let seed = 175;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pool: Pickable[] = [...V.seen.vertices, ...V.seen.edges, ...V.features.filter((f): f is Exclude<ViewFeature, { type: 'axis' }> => f.type !== 'axis')];
    expect(pool.length).toBeGreaterThan(10);
    let made = 0;
    for (let k = 0; k < 200; k++) {
      const n = 1 + Math.floor(rnd() * 2);
      const picks = Array.from({ length: n }, () => pool[Math.floor(rnd() * pool.length)]!);
      const mode = DIMENSION_MODES[Math.floor(rnd() * DIMENSION_MODES.length)]!;
      const at: [number, number] = [100 + rnd() * 200, 60 + rnd() * 180];
      const got = make(picks, at, mode) as { kind?: string; value?: number; error?: string; need?: string };
      if (got.kind) {
        expect(Number.isFinite(got.value) && got.value! > 0, JSON.stringify({ picks: picks.map((p) => (p.type === 'edge' ? { a: p.a, b: p.b, ends: p.ends.map((e) => e?.name), inPlane: p.inPlane } : p.type)), mode, got })).toBe(true);
        made++;
      } else expect(typeof got.error === 'string' || got.need === 'second').toBe(true);
    }
    // the fuzz makes real dimensions too, not only refusals
    expect(made).toBeGreaterThan(20);
  });
});
