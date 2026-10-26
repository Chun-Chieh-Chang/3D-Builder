/**
 * ADR 0177: every kind of dimension made from a drawing view, through the same path the sheet takes ??the element under the pointer (`featureAt`, on the view's real
 * hidden-line projection and the part's named edges), the plan (`planDimension` with the kind asked for) and the number (`evaluateDimension` on the model's own
 * facts of the elements). Every expected value is worked out here from the part's topology (its vertices and its cylinders), never from the drawing's lines and
 * never written in by hand.
 *
 * The part: a plate 10 thick, its outline (0,0) (40,0) (40,20) (30,30) (0,30) ??one slanted side ??with the corner at (0,0) rounded R5 and a ?8 hole at (12,12).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, page, parseDrawing, serializeDrawing, placementRows, placeElementFacts, sameDrawingRef, rightOf, sheetUp, viewVectors, type Dimension, type Feature, type DrawingRef, type Ref, type ViewAxes, type ViewFeature } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { elementFacts, placedViewFeatures, Regenerator, viewEdges, viewFeatures, type RebuildResult } from '@3db/regen';
import { DIMENSION_MODES, chamferReferenceAt, autoDimensions, dimensionReferenceAt, dimensionModesFor, evaluateDimension, outlinesOf, featureAt, pickKind, planDimension, toSheet, visibleElements, type DimensionMode, type Pickable, type PlacedView, type ViewLines } from '@3db/drawing';
import { t } from '@3db/i18n';
import { build, circle as circleProfile, edge, extrude, face, fillet, front, pin, sketch } from '../phase1/builders';

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
    const u: [number, number] = [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])];
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

describe('what the right-click menu of an element offers (ADR 0177)', () => {
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


describe('dimension reference acquisition and automatic radius conversion on native geometry', () => {
  it('acquires the exact circular centre and keeps its persistent reference; visible vertices take priority', () => {
    const f = V.features.find(f => f.type === 'circle' && f.full)!;
    expect(f?.type).toBe('circle');
    if (f.type !== 'circle') throw new Error('native circular feature required');
    const hit = dimensionReferenceAt(V.lines, V.features, [f.centre[0] + 0.1, f.centre[1] - 0.1], 0.4, V.seen);
    expect(hit?.ref).toEqual(f.ref);
    const vertex = V.seen.vertices[0]!;
    expect(vertex).toBeDefined();
    expect(dimensionReferenceAt(V.lines, V.features, vertex.at, 0.4, V.seen)?.ref).toEqual(vertex.ref);
    expect(dimensionReferenceAt({ ...V.lines, visible: [] }, V.features, f.centre, 0.4)?.type).not.toBe('circle');
  });

  it('an automatically generated R becomes a true doubled Ø using the same native circular geometry', () => {
    const draft = autoDimensions(V.features, { overall: false, holes: true, positions: false }).find(d => d.kind === 'radius');
    expect(draft?.kind).toBe('radius');
    if (!draft || draft.kind !== 'radius') throw new Error('native automatic radius required');
    const fact = elementFacts(built.body!.topology, built.body!.names, draft.ref)!;
    const rad = evaluateDimension({ ...draft, id: 'dim1', view: 'v' }, { elements: [fact] as never }, axes, V.placed);
    const dia = evaluateDimension({ ...draft, kind: 'diameter', id: 'dim1', view: 'v' }, { elements: [fact] as never }, axes, V.placed);
    expect('error' in rad).toBe(false);
    expect('error' in dia).toBe(false);
    if ('error' in rad || 'error' in dia) throw new Error('valid native round dimensions required');
    expect(dia.value).toBeCloseTo(2 * rad.value, 9);
    expect(dia.text).toContain('Ø');
    expect(rad.text).toContain('R');
  });
});


describe('persistent reference-point snaps on native geometry', () => {
  const evalPointDistance = (a: DrawingRef, b: DrawingRef, facts: Parameters<typeof evaluateDimension>[1], viewAxes = axes) => evaluateDimension({ id: 'pointDim', view: 'v', kind: 'linear', a, b, orientation: 'aligned', offset: 12 }, facts, viewAxes, V.placed);
  it('100 pointer offsets acquire line midpoints without losing the one-edge length workflow', () => {
    const e = V.seen.edges.find(e => Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) > 12)!;
    expect(e).toBeDefined();
    const mid: [number, number] = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    for (let i = 0; i < 100; i++) {
      const f = dimensionReferenceAt(V.lines, V.features, [mid[0] + (i % 7 - 3) * 0.02, mid[1] + (i % 11 - 5) * 0.02], 0.4, V.seen);
      expect(f?.type).toBe('vertex');
      expect((f?.ref as DrawingRef).point).toBe('midpoint');
      const plan = planDimension([f!], sheetAt(50, -20), V.placed, axes, 'aligned');
      expect(plan).toHaveProperty('draft');
      const end = e.ends[0]!;
      const fact = elementFacts(built.body!.topology, built.body!.names, f!.ref);
      const endFact = elementFacts(built.body!.topology, built.body!.names, end);
      expect('error' in fact || 'error' in endFact).toBe(false);
      const out = evalPointDistance(f!.ref, end, { elements: [fact, endFact] as never });
      expect(out).toHaveProperty('value');
      if (!('error' in out)) expect(out.value).toBeCloseTo(Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) / 2, 7);
    }
  });
  it('native circular quadrants are distinct persistent points and become a model-linked diameter', () => {
    const c = V.features.find(f => f.type === 'circle' && f.full)!;
    if (c.type !== 'circle') throw new Error('native circle required');
    const a = dimensionReferenceAt(V.lines, V.features, [c.centre[0] + c.radius, c.centre[1]], 0.2, V.seen)!;
    const b = dimensionReferenceAt(V.lines, V.features, [c.centre[0] - c.radius, c.centre[1]], 0.2, V.seen)!;
    expect((a.ref as DrawingRef).point).toBe('quadrant0'); expect((b.ref as DrawingRef).point).toBe('quadrant2');
    expect(sameDrawingRef(a.ref, b.ref)).toBe(false);
    const fact = elementFacts(built.body!.topology, built.body!.names, c.ref);
    const out = evalPointDistance(a.ref, b.ref, { elements: [fact, fact] as never });
    if ('error' in out) throw new Error(out.error);
    expect(out.value).toBeCloseTo(2 * c.radius, 8);
    let doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'v', name: 'front', source: 'part.3dbx', direction: 'front' }] });
    doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [{ id: 'pointDim', view: 'v', kind: 'linear', a: a.ref, b: b.ref, orientation: 'horizontal', offset: 12 }] });
    expect(page(parseDrawing(serializeDrawing(doc))).dimensions[0]).toMatchObject({ a: { point: 'quadrant0' }, b: { point: 'quadrant2' } });
  });
  it('saved quadrant and silhouette references follow a real native radius rebuild', async () => {
    const isolated = new Regenerator(kernel, await PlaneGcsSolver.create());
    const shape = (r: number) => isolated.rebuild(build(sketch('s', front, circleProfile('ci', 0, 0, r)), extrude('e', 's', 'boss', { type: 'blind', depth: '8' })));
    try {
      const first = shape(4);
      const c = viewFeatures(first.body!.topology, first.body!.names, axes).find(f => f.type === 'circle' && f.full)!;
      const a: DrawingRef = { ...c.ref, point: 'quadrant0' }, b: DrawingRef = { ...c.ref, point: 'quadrant2' };
      let doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'v', name: 'front', source: 'round.3dbx', direction: 'front' }] });
      doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [{ id: 'd', view: 'v', kind: 'linear', a, b, orientation: 'horizontal', offset: 12 }] });
      const saved = parseDrawing(serializeDrawing(doc));
      const second = shape(6);
      expect(second.features.every(f => f.status === 'ok')).toBe(true);
      const d = page(saved).dimensions[0]!;
      if (d.kind !== 'linear') throw new Error('persistent linear dimension required');
      const facts = [d.a, d.b].map(ref => elementFacts(second.body!.topology, second.body!.names, ref));
      const value = evaluateDimension(d, { elements: facts as never }, axes, V.placed);
      if ('error' in value) throw new Error(value.error);
      expect(value.value).toBeCloseTo(12, 8);
      const sideAxes = viewVectors('right');
      const features = viewFeatures(second.body!.topology, second.body!.names, sideAxes);
      const side = features.find(f => f.type === 'axis')!;
      const outlines = outlinesOf([side]);
      const lineData = kernel.projectView(second.body!.shape, sideAxes) as ViewLines;
      const withoutFaces = visibleElements(lineData, viewEdges(kernel, second.body!.shape, second.body!.topology, second.body!.names, sideAxes));
      const mid = [(outlines[0]!.from[0] + outlines[0]!.to[0]) / 2, (outlines[0]!.from[1] + outlines[0]!.to[1]) / 2] as [number, number];
      expect(featureAt(lineData, [], mid, 0.2, withoutFaces)).toBeNull();
      const points = outlines.map(o => dimensionReferenceAt(lineData, features, o.from, 0.2));
      expect(points.every(p => p?.type === 'vertex' && 'snap' in p)).toBe(true);
      const sideFacts = points.map(p => elementFacts(second.body!.topology, second.body!.names, p!.ref));
      const sideValue = evalPointDistance(points[0]!.ref, points[1]!.ref, { elements: sideFacts as never }, sideAxes);
      if ('error' in sideValue) throw new Error(sideValue.error);
      expect(sideValue.value).toBeCloseTo(12, 8);
    } finally { isolated.dispose(); }
  });
  it('placed assembly features retain local references and distinguish identical component names', () => {
    const body = built.body!;
    const rows = placementRows({ position: [55, 18, 7], rotation: [0, 0, 0, 1] }, true);
    const live = kernel.liveShapes;
    const heap = (kernel as any).oc.wasmMemory.buffer.byteLength; expect(heap).toBeGreaterThan(0);
    const placedFeatures = placedViewFeatures(kernel, body.shape, body.topology, body.names, axes, { rows, in: 'componentB' });
    expect(kernel.liveShapes).toBe(live);
    const native = V.features.find(f => f.type === 'circle' && f.full)!;
    const moved = placedFeatures.find(f => f.ref.name === native.ref.name)!;
    expect((moved.ref as DrawingRef).in).toBe('componentB');
    const fact = elementFacts(body.topology, body.names, native.ref);
    if ('error' in fact || moved.type !== 'circle' || native.type !== 'circle') throw new Error('native placed cylinder required');
    const world = placeElementFacts(fact, rows);
    expect(moved.centre[0]).toBeCloseTo(inView(world.point)[0], 8);
    expect(moved.centre[1]).toBeCloseTo(inView(world.point)[1], 8);
    for (let j = 0; j < 100; j++) {
      const angle = (j * 71 % 360) * Math.PI / 180;
      const rows = placementRows({ position: [j * 0.73 - 20, j * -0.41 + 9, j * 0.13], rotation: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)] }, j % 2 === 1);
      const features = placedViewFeatures(kernel, body.shape, body.topology, body.names, axes, { rows, in: `part${j}` });
      const circles = features.filter(f => f.type === 'circle');
      expect(circles.length).toBeGreaterThan(0);
      for (const f of circles) {
        const local = elementFacts(body.topology, body.names, f.ref);
        if ('error' in local) throw new Error(local.error);
        const expected = inView(placeElementFacts(local, rows).point);
        expect(f.centre[0]).toBeCloseTo(expected[0], 7); expect(f.centre[1]).toBeCloseTo(expected[1], 7);
        expect((f.ref as DrawingRef).in).toBe(`part${j}`);
      }
      expect(kernel.liveShapes).toBe(live);
    }
    console.log('placed-feature native heap bytes', heap, (kernel as any).oc.wasmMemory.buffer.byteLength);
    const a = { ...native.ref, in: 'componentA' }, b = { ...native.ref, in: 'componentB' };
    expect(sameDrawingRef(a, b)).toBe(false);
    expect(() => applyDrawingCommand(applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'v', name: 'front', source: 'a.3dba', direction: 'front' }] }), { type: 'insertDimensions', dimensions: [{ id: 'd', view: 'v', kind: 'linear', a, b, orientation: 'horizontal', offset: 12 }] })).not.toThrow();
  });
  it('invalid selectors and geometry changes are refused rather than frozen as paper points', () => {
    const doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'v', name: 'front', source: 'part.3dbx', direction: 'front' }] });
    const edge = V.seen.edges[0]!;
    for (const point of ['noSuchPoint', NaN, { x: 4 }, 'outlineMidPositive']) {
      const a = { ...edge.ref, point } as DrawingRef;
      expect(() => applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [{ id: 'd', view: 'v', kind: 'linear', a, b: edge.ends[0]!, orientation: 'horizontal', offset: 12 }] })).toThrow();
    }
    const circle = V.features.find(f => f.type === 'circle' && f.full)!;
    const wrong = evalPointDistance({ ...circle.ref, point: 'midpoint' } as DrawingRef, edge.ends[0]!, { elements: [elementFacts(built.body!.topology, built.body!.names, circle.ref), elementFacts(built.body!.topology, built.body!.names, edge.ends[0]!)] as never });
    expect(wrong).toHaveProperty('error');
  });
});


describe('chamfer mode line acquisition', () => {
  it('selects the real slanted edge inside overlapping endpoint hit areas instead of a vertex', () => {
    const { lines, features, seen } = frontView();
    const at: [number, number] = [35, 25];
    // A short displayed chamfer has the same overlap at a smaller drawing scale.
    expect(featureAt(lines, features, at, 8, seen)?.type).toBe('vertex');
    const picked = chamferReferenceAt(lines, features, at, 8, seen)!;
    expect(['slant', 'edge']).toContain(picked.type);
    expect(make([picked], sheetAt(45, 35), 'chamfer')).toMatchObject({ kind: 'chamfer', value: 10 });
    for (let i = 0; i < 100; i++) {
      const k = 0.4 + 0.2 * ((i * 37 % 101) / 100);
      const q: [number, number] = [40 - 10 * k, 20 + 10 * k];
      const f = chamferReferenceAt(lines, features, q, 8, seen)!;
      expect(['slant', 'edge']).toContain(f.type);
      expect(make([f], sheetAt(45, 35), 'chamfer')).toMatchObject({ kind: 'chamfer', value: 10 });
    }
    expect(make([chamferReferenceAt(lines, features, [20, 0], 0.1, seen)!], sheetAt(45, 35), 'chamfer')).toEqual({ error: t('drawing.dimNeedsChamfer') });
  });
});
