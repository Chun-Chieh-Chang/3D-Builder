/**
 * 「匯入 DXF」 (F2.6): DXF files written here by hand from the DXF reference, each with the geometry it must give worked out by hand, and the DXF this program
 * writes read back. A sketch's entities are checked as what they are (points, radii, Bézier poles sampled against the true curve), never as counts alone.
 */
import { describe, expect, it } from 'vitest';
import { IdAllocator, sketchError, type SketchEntity } from '@3db/model';
import { DXF_APPROXIMATION, DXF_MAX_CURVES, DXF_MAX_WORK, DxfImportError, dxfText, flatPatternDxf, importDxf, surveyDxf, toDxf } from '@3db/drawing';
import { bezierPoint } from '@3db/sketch/interact';
import { plateScene } from '../support/outputScene';

type P = [number, number];
type Rec = (string | number)[];

/** An entity: its type, then group code and value pairs. */
const ent = (type: string, ...pairs: Rec): string => ['0', type, ...pairs.map(String)].join('\n');
/** A DXF of these entities (and blocks), with `$INSUNITS` when given. */
function dxf(entities: string[], opts: { units?: number; blocks?: string[] } = {}): string {
  const header = opts.units === undefined ? [] : ['9', '$INSUNITS', '70', String(opts.units)];
  return ['0', 'SECTION', '2', 'HEADER', ...header, '0', 'ENDSEC', '0', 'SECTION', '2', 'BLOCKS', ...(opts.blocks ?? []), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}
const block = (name: string, base: P, ...entities: string[]) => [ent('BLOCK', 8, '0', 2, name, 70, 0, 10, base[0], 20, base[1], 30, 0), ...entities, ent('ENDBLK', 8, '0')].join('\n');

const run = (text: string, options = {}) => importDxf(text, new IdAllocator({}, []), options);

/** The places of the points, and the curves by kind. */
function geometry(entities: SketchEntity[]) {
  const at = new Map<string, P>();
  for (const e of entities) if (e.type === 'point') at.set(e.id, [e.x, e.y]);
  const of = <K extends SketchEntity['type']>(k: K) => entities.filter((e): e is Extract<SketchEntity, { type: K }> => e.type === k);
  return { at, of, p: (id: string) => at.get(id)! };
}
const close = (a: P, b: P, tol = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
const lineSet = (entities: SketchEntity[]) => {
  const g = geometry(entities);
  return g.of('line').map((l) => [g.p(l.p1), g.p(l.p2)] as [P, P]);
};
const hasLine = (lines: [P, P][], a: P, b: P, tol = 1e-9) => lines.some(([x, y]) => (close(x, a, tol) && close(y, b, tol)) || (close(x, b, tol) && close(y, a, tol)));

/** Cox–de Boor: a B-spline's point at u, written here apart from the importer's knot insertion. */
function deBoor(degree: number, knots: number[], poles: P[], u: number, weights?: number[]): P {
  const n = poles.length;
  const basis = (i: number, p: number): number => {
    if (p === 0) {
      const last = u === knots[knots.length - 1] && knots[i + 1] === u && knots[i]! < u;
      return (knots[i]! <= u && u < knots[i + 1]!) || last ? 1 : 0;
    }
    const a = knots[i + p]! - knots[i]! === 0 ? 0 : ((u - knots[i]!) / (knots[i + p]! - knots[i]!)) * basis(i, p - 1);
    const b = knots[i + p + 1]! - knots[i + 1]! === 0 ? 0 : ((knots[i + p + 1]! - u) / (knots[i + p + 1]! - knots[i + 1]!)) * basis(i + 1, p - 1);
    return a + b;
  };
  let x = 0, y = 0, w = 0;
  for (let i = 0; i < n; i++) {
    const b = basis(i, degree) * (weights?.[i] ?? 1);
    x += b * poles[i]![0];
    y += b * poles[i]![1];
    w += b;
  }
  return [x / w, y / w];
}

/** Points along every Bézier spline made. */
function splineSamples(entities: SketchEntity[], per = 40): P[] {
  const g = geometry(entities);
  return g.of('spline').flatMap((s) => Array.from({ length: per + 1 }, (_, k) => bezierPoint(s.points.map(g.p), k / per) as P));
}
const nearest = (q: P, curve: P[]) => Math.min(...curve.map((c) => Math.hypot(c[0] - q[0], c[1] - q[1])));

describe('lines, circles and arcs, in millimetres', () => {
  it('a LINE, a CIRCLE and an ARC as they are; the unit of $INSUNITS turned into millimetres (in, cm, m), none read as millimetres', () => {
    const body = [ent('LINE', 8, 'A', 10, 0, 20, 0, 11, 10, 21, 0), ent('CIRCLE', 8, 'A', 10, 5, 20, 5, 40, 2), ent('ARC', 8, 'B', 10, 0, 20, 0, 40, 3, 50, 0, 51, 90)];
    for (const [units, k] of [[undefined, 1], [4, 1], [1, 25.4], [5, 10], [6, 1000]] as const) {
      const r = run(dxf(body, units === undefined ? {} : { units }));
      expect(r.problems).toEqual([]);
      const g = geometry(r.entities);
      expect(hasLine(lineSet(r.entities), [0, 0], [10 * k, 0], 1e-9 * k)).toBe(true);
      const c = g.of('circle')[0]!;
      expect(close(g.p(c.center), [5 * k, 5 * k], 1e-9 * k)).toBe(true);
      expect(c.radius).toBeCloseTo(2 * k, 9);
      const a = g.of('arc')[0]!;
      expect(close(g.p(a.start), [3 * k, 0], 1e-9 * k)).toBe(true);
      expect(close(g.p(a.end), [0, 3 * k], 1e-9 * k)).toBe(true);
      expect(sketchError({ entities: r.entities, constraints: [] })).toBeNull();
    }
    expect(surveyDxf(dxf(body)).unit).toBeNull();
    expect(surveyDxf(dxf(body, { units: 1 })).scale).toBe(25.4);
    expect(surveyDxf(dxf(body)).layers).toEqual([{ name: 'A', count: 2 }, { name: 'B', count: 1 }]);
  });

  it('ends that meet become one point; ends farther apart than the tolerance stay two', () => {
    const square = [ent('LINE', 8, 'A', 10, 0, 20, 0, 11, 10, 21, 0), ent('LINE', 8, 'A', 10, 10, 20, 1e-9, 11, 10, 21, 10), ent('LINE', 8, 'A', 10, 10, 20, 10, 11, 0, 21, 10), ent('LINE', 8, 'A', 10, 0, 20, 10, 11, 0, 21, 0)];
    const r = run(dxf(square));
    expect(r.entities.filter((e) => e.type === 'point')).toHaveLength(4);
    expect(r.entities.filter((e) => e.type === 'line')).toHaveLength(4);
    // a millionth of the extent (about 1.4e-5 mm): 1e-9 is merged, 1e-3 is not
    expect(r.mergeTolerance).toBeCloseTo(Math.hypot(10, 10) * 1e-6, 15);
    const apart = run(dxf([ent('LINE', 8, 'A', 10, 0, 20, 0, 11, 10, 21, 0), ent('LINE', 8, 'A', 10, 10, 20, 1e-3, 11, 10, 21, 10)]));
    expect(apart.entities.filter((e) => e.type === 'point')).toHaveLength(4);
    expect(() => run(dxf(square), { mergeTolerance: 0 })).toThrow(DxfImportError);
    expect(() => run(dxf(square), { mergeTolerance: Number.NaN })).toThrow(DxfImportError);
  });

  it('a bulge is an arc: +1 the half circle under a→b (counter-clockwise from a), -1 the one over it', () => {
    for (const [bulge, mid] of [[1, [5, -5]], [-1, [5, 5]], [Math.tan(Math.PI / 8), [5, 5 - Math.SQRT2 * 5 + 5 - 5]]] as const) {
      const r = run(dxf([ent('LWPOLYLINE', 8, 'A', 90, 2, 70, 0, 10, 0, 20, 0, 42, bulge, 10, 10, 20, 0)]));
      const g = geometry(r.entities);
      const a = g.of('arc')[0]!;
      const c = g.p(a.center), s = g.p(a.start), e = g.p(a.end);
      const r0 = Math.hypot(s[0] - c[0], s[1] - c[1]);
      expect(Math.hypot(e[0] - c[0], e[1] - c[1])).toBeCloseTo(r0, 9);
      // the middle of the sweep, counter-clockwise from start to end
      const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
      let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
      while (a1 <= a0) a1 += 2 * Math.PI;
      const m: P = [c[0] + r0 * Math.cos((a0 + a1) / 2), c[1] + r0 * Math.sin((a0 + a1) / 2)];
      if (Math.abs(bulge) === 1) expect(close(m, mid as P, 1e-9)).toBe(true);
      else {
        // a quarter circle's bulge (tan 22.5°): the sweep is 90°, the arc to the right of a→b
        expect(a1 - a0).toBeCloseTo(Math.PI / 2, 9);
        expect(m[1]).toBeLessThan(0);
      }
    }
  });

  it('an arc whose extrusion is -Z is mirrored in x (its object coordinates), and runs the other way', () => {
    const r = run(dxf([ent('ARC', 8, 'A', 10, 10, 20, 0, 40, 5, 50, 0, 51, 90, 210, 0, 220, 0, 230, -1)]));
    const g = geometry(r.entities);
    const a = g.of('arc')[0]!;
    expect(close(g.p(a.center), [-10, 0])).toBe(true);
    // (15, 0) → (-15, 0) and (10, 5) → (-10, 5); counter-clockwise in the world from (-10, 5) to (-15, 0)
    expect(close(g.p(a.start), [-10, 5])).toBe(true);
    expect(close(g.p(a.end), [-15, 0])).toBe(true);
    const tilted = run(dxf([ent('CIRCLE', 8, 'A', 10, 0, 20, 0, 40, 5, 210, 0, 220, 1, 230, 0)]));
    expect(tilted.entities).toEqual([]);
    expect(tilted.problems).toHaveLength(1);
  });
});

describe('ellipses and splines', () => {
  /** Distance to an axis-aligned ellipse at the origin: the nearest of a dense sampling, then refined by golden section on the parameter (written apart from the importer). */
  const onEllipse = (q: P, a: number, b: number) => {
    const d = (tt: number) => Math.hypot(a * Math.cos(tt) - q[0], b * Math.sin(tt) - q[1]);
    let best = 0;
    for (let k = 1; k < 4000; k++) if (d((2 * Math.PI * k) / 4000) < d(best)) best = (2 * Math.PI * k) / 4000;
    let lo = best - (2 * Math.PI) / 4000, hi = best + (2 * Math.PI) / 4000;
    for (let k = 0; k < 100; k++) {
      const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
      if (d(m1) < d(m2)) hi = m2;
      else lo = m1;
    }
    return d((lo + hi) / 2);
  };

  it('a whole ELLIPSE is an ellipse: centre, the end of the major axis, the minor radius', () => {
    const r = run(dxf([ent('ELLIPSE', 8, 'A', 10, 1, 20, 2, 11, 0, 21, 20, 40, 0.5, 41, 0, 42, 2 * Math.PI)]));
    const g = geometry(r.entities);
    const e = g.of('ellipse')[0]!;
    expect(close(g.p(e.center), [1, 2])).toBe(true);
    expect(close(g.p(e.major), [1, 22])).toBe(true);
    expect(e.minorRadius).toBeCloseTo(10, 12);
    expect(r.approximated.count).toBe(0);
  });

  it('a part of an ellipse: Bézier pieces within the approximation tolerance of the true ellipse, joined end to end, from the start to the end parameter', () => {
    const r = run(dxf([ent('ELLIPSE', 8, 'A', 10, 0, 20, 0, 11, 20, 21, 0, 40, 0.5, 41, 0.3, 42, 2.9)]));
    expect(r.approximated.count).toBe(1);
    expect(r.approximated.deviation).toBeGreaterThan(0);
    expect(r.approximated.deviation).toBeLessThanOrEqual(DXF_APPROXIMATION);
    const samples = splineSamples(r.entities);
    expect(samples.length).toBeGreaterThan(0);
    const worst = Math.max(...samples.map((q) => onEllipse(q, 20, 10)));
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(DXF_APPROXIMATION);
    const g = geometry(r.entities);
    const ends = g.of('spline').flatMap((s) => [s.points[0]!, s.points[s.points.length - 1]!]);
    // the pieces share their ends: n pieces, n + 1 distinct ends
    expect(new Set(ends).size).toBe(g.of('spline').length + 1);
    const tips = [...new Set(ends)].map(g.p);
    expect(tips.some((q) => close(q, [20 * Math.cos(0.3), 10 * Math.sin(0.3)], 1e-9))).toBe(true);
    expect(tips.some((q) => close(q, [20 * Math.cos(2.9), 10 * Math.sin(2.9)], 1e-9))).toBe(true);
    expect(sketchError({ entities: r.entities, constraints: [] })).toBeNull();
  });

  it('a non-rational SPLINE is its Bézier pieces exactly (knots inserted): each point of them on the B-spline of the file', () => {
    const poles: P[] = [[0, 0], [10, 20], [20, -10], [35, 15], [50, 0], [60, 10]];
    const knots = [0, 0, 0, 0, 1, 2, 3, 3, 3, 3];
    const r = run(dxf([ent('SPLINE', 8, 'A', 70, 8, 71, 3, 72, knots.length, 73, poles.length, ...knots.flatMap((k) => [40, k]), ...poles.flatMap((q) => [10, q[0], 20, q[1], 30, 0]))]));
    expect(r.problems).toEqual([]);
    expect(r.approximated.count).toBe(0);
    const g = geometry(r.entities);
    expect(g.of('spline')).toHaveLength(3); // three knot spans
    expect(g.of('spline').every((s) => s.bezier && s.points.length === 4)).toBe(true);
    const truth = Array.from({ length: 6001 }, (_, k) => deBoor(3, knots, poles, (3 * k) / 6000));
    for (const q of splineSamples(r.entities)) expect(nearest(q, truth)).toBeLessThan(0.01); // the reference's own spacing; exactness is checked at the knots:
    for (const u of [0, 1, 2, 3]) expect(g.of('spline').some((s) => [s.points[0]!, s.points[3]!].some((id) => close(g.p(id), deBoor(3, knots, poles, u), 1e-9)))).toBe(true);
    // and at the middle of each span, where Bézier and B-spline must agree exactly
    g.of('spline').forEach((s, j) => expect(close(bezierPoint(s.points.map(g.p), 0.5) as P, deBoor(3, knots, poles, j + 0.5), 1e-9)).toBe(true));
  });

  it('a rational SPLINE (a quarter circle, weights 1, √2/2, 1) is approximated within the tolerance: every sampled point that far from radius 10', () => {
    const r = run(dxf([ent('SPLINE', 8, 'A', 70, 8, 71, 2, 72, 6, 73, 3, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 41, 1, 41, Math.SQRT1_2, 41, 1, 10, 10, 20, 0, 30, 0, 10, 10, 20, 10, 30, 0, 10, 0, 20, 10, 30, 0)]));
    expect(r.approximated.count).toBe(1);
    const samples = splineSamples(r.entities, 200);
    const worst = Math.max(...samples.map((q) => Math.abs(Math.hypot(...q) - 10)));
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(DXF_APPROXIMATION);
    // the reference itself: the rational spline is the circle
    expect(Math.abs(Math.hypot(...deBoor(2, [0, 0, 0, 1, 1, 1], [[10, 0], [10, 10], [0, 10]], 0.37, [1, Math.SQRT1_2, 1])) - 10)).toBeLessThan(1e-12);
  });

  it('a spline given only by fit points, or whose knots do not agree, is said and left out', () => {
    const fit = run(dxf([ent('SPLINE', 8, 'A', 70, 8, 71, 3, 74, 3, 11, 0, 21, 0, 31, 0, 11, 5, 21, 5, 31, 0, 11, 10, 21, 0, 31, 0)]));
    expect(fit.entities).toEqual([]);
    expect(fit.problems.map((p) => p.what)).toEqual(['SPLINE']);
    const bad = run(dxf([ent('SPLINE', 8, 'A', 71, 3, 40, 0, 40, 1, 10, 0, 20, 0, 10, 1, 20, 1)]));
    expect(bad.entities).toEqual([]);
    expect(bad.problems).toHaveLength(1);
  });
});

describe('blocks', () => {
  const blocks = [block('B', [5, 5], ent('LINE', 8, '0', 10, 5, 20, 5, 11, 15, 21, 5), ent('CIRCLE', 8, 'KEEP', 10, 5, 20, 5, 40, 2))];

  it('an INSERT: the base to the origin, scaled, turned, moved, and again for each cell of its array; layer 0 takes the INSERT\'s layer', () => {
    const r = run(dxf([ent('INSERT', 8, 'PARTS', 2, 'B', 10, 100, 20, 0, 41, 2, 42, 2, 50, 90, 70, 2, 44, 50)], { blocks }));
    expect(r.problems).toEqual([]);
    const lines = lineSet(r.entities);
    expect(lines).toHaveLength(2);
    expect(hasLine(lines, [100, 0], [100, 20])).toBe(true);
    // the second column 50 along the turned x axis
    expect(hasLine(lines, [100, 50], [100, 70])).toBe(true);
    const g = geometry(r.entities);
    expect(g.of('circle').map((c) => [g.p(c.center), c.radius])).toEqual([[[100, 0], 4], [expect.anything(), 4]]);
    expect(close(g.p(g.of('circle')[1]!.center), [100, 50])).toBe(true);
    const survey = surveyDxf(dxf([ent('INSERT', 8, 'PARTS', 2, 'B', 10, 100, 20, 0)], { blocks }));
    expect(survey.layers).toEqual([{ name: 'KEEP', count: 1 }, { name: 'PARTS', count: 1 }]);
  });

  it('a mirrored INSERT (x scale -1) mirrors an arc and keeps it counter-clockwise from its start', () => {
    const b = [block('A', [0, 0], ent('ARC', 8, '0', 10, 0, 20, 0, 40, 5, 50, 0, 51, 90))];
    const r = run(dxf([ent('INSERT', 8, 'M', 2, 'A', 10, 0, 20, 0, 41, -1, 42, 1)], { blocks: b }));
    const g = geometry(r.entities);
    const a = g.of('arc')[0]!;
    // (5, 0) → (-5, 0), (0, 5) stays: counter-clockwise from (0, 5) to (-5, 0)
    expect(close(g.p(a.start), [0, 5])).toBe(true);
    expect(close(g.p(a.end), [-5, 0])).toBe(true);
  });

  it('an unevenly scaled circle is an ellipse, an arc a Bézier approximation', () => {
    const b = [block('C', [0, 0], ent('CIRCLE', 8, '0', 10, 0, 20, 0, 40, 5), ent('ARC', 8, '0', 10, 0, 20, 0, 40, 5, 50, 0, 51, 90))];
    const r = run(dxf([ent('INSERT', 8, 'M', 2, 'C', 10, 0, 20, 0, 41, 2, 42, 1)], { blocks: b }));
    const g = geometry(r.entities);
    const e = g.of('ellipse')[0]!;
    expect(close(g.p(e.major), [10, 0]) || close(g.p(e.major), [-10, 0])).toBe(true);
    expect(e.minorRadius).toBeCloseTo(5, 9);
    expect(r.approximated.count).toBe(1);
  });

  it('a block that inserts itself, a block that is not there: said, and the rest imported', () => {
    const loop = [block('L', [0, 0], ent('LINE', 8, '0', 10, 0, 20, 0, 11, 1, 21, 0), ent('INSERT', 8, '0', 2, 'L', 10, 5, 20, 0))];
    const r = run(dxf([ent('INSERT', 8, 'X', 2, 'L', 10, 0, 20, 0), ent('INSERT', 8, 'X', 2, 'NOPE', 10, 0, 20, 0)], { blocks: loop }));
    expect(lineSet(r.entities)).toHaveLength(1);
    expect(r.problems).toHaveLength(2);
  });

  it('an array placing a block more often than the limit refuses the whole file, in words', () => {
    const huge = () => run(dxf([ent('INSERT', 8, 'X', 2, 'B', 10, 0, 20, 0, 70, 1000, 71, 1000, 44, 1, 45, 1)], { blocks }));
    expect(huge).toThrow(DxfImportError);
    expect(huge).toThrow(String(DXF_MAX_WORK));
  });
});

describe('text, and what is left out', () => {
  it('TEXT: its %% codes, its height and angle, aligned at its second point when it is centred; MTEXT: one text a line, its formatting dropped', () => {
    const r = run(dxf([
      ent('TEXT', 8, 'T', 10, 1, 20, 2, 40, 3.5, 50, 30, 1, '%%c10 %%p0.1'),
      ent('TEXT', 8, 'T', 10, 0, 20, 0, 11, 50, 21, 60, 40, 2.5, 72, 1, 1, 'MID'),
      ent('MTEXT', 8, 'T', 10, 0, 20, 100, 40, 5, 71, 7, 1, '{\\fArial|b0;FIRST}\\PSECOND'),
    ]));
    const g = geometry(r.entities);
    const texts = g.of('text');
    expect(texts.map((x) => x.text)).toEqual(['Ø10 ±0.1', 'MID', 'FIRST', 'SECOND']);
    expect(close(g.p(texts[0]!.at), [1, 2])).toBe(true);
    expect(texts[0]!.size).toBe(3.5);
    expect(texts[0]!.angle).toBeCloseTo(30, 12);
    expect(texts[1]!.align).toBe('center');
    expect(close(g.p(texts[1]!.at), [50, 60])).toBe(true);
    // bottom-left: the last line's baseline on the point, the first a line pitch (5/3 of the height) above
    expect(close(g.p(texts[3]!.at), [0, 100])).toBe(true);
    expect(close(g.p(texts[2]!.at), [0, 100 + (5 * 5) / 3])).toBe(true);
  });

  it('DIMENSION and HATCH are counted and left out; paper space is not imported; the construction layers come in as construction', () => {
    const r = run(dxf([
      ent('DIMENSION', 8, 'D', 2, '*D1', 10, 0, 20, 0),
      ent('HATCH', 8, 'H'),
      ent('LINE', 8, 'P', 67, 1, 10, 0, 20, 0, 11, 1, 21, 1),
      ent('LINE', 8, 'CENTER', 10, 0, 20, 0, 11, 5, 21, 0),
      ent('LINE', 8, 'OUT', 10, 0, 20, 1, 11, 5, 21, 1),
    ]), { construction: new Set(['CENTER']) });
    expect(r.skipped).toEqual({ DIMENSION: 1, HATCH: 1 });
    const lines = r.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => l.construction)).toHaveLength(1);
    const only = run(dxf([ent('LINE', 8, 'CENTER', 10, 0, 20, 0, 11, 5, 21, 0), ent('LINE', 8, 'OUT', 10, 0, 20, 1, 11, 5, 21, 1)]), { layers: new Set(['OUT']) });
    expect(lineSet(only.entities)).toEqual([[[0, 1], [5, 1]]]);
  });
});

describe('what cannot be imported is said, never changed', () => {
  it('a binary DXF, a file cut short, a stray value: refused in words', () => {
    const bin = new Uint8Array([...new TextEncoder().encode('AutoCAD Binary DXF\r\n\u001a\u0000'), 0, 0]);
    expect(() => dxfText(bin)).toThrow(DxfImportError);
    const cut = dxf([ent('LINE', 8, 'A', 10, 0, 20, 0, 11, 1, 21, 0)]).replace('0\nEOF', '');
    expect(() => run(cut)).toThrow(DxfImportError);
    expect(() => run('0\nSECTION\n2\nENTITIES\nxx\nLINE\n0\nENDSEC\n0\nEOF')).toThrow(DxfImportError);
  });

  it('a value that is not a number, a line of no length, a radius of 0: each said with its entity and layer, nothing made of it, the rest imported', () => {
    const r = run(dxf([
      ent('LINE', 5, '1A', 8, 'A', 10, 'x', 20, 0, 11, 1, 21, 0),
      ent('LINE', 5, '1B', 8, 'A', 10, 3, 20, 3, 11, 3, 21, 3),
      ent('CIRCLE', 5, '1C', 8, 'B', 10, 0, 20, 0, 40, 0),
      ent('LINE', 5, '1D', 8, 'A', 10, 0, 20, 0, 11, 7, 21, 0),
    ]));
    expect(r.problems.map((p) => [p.what, p.layer]).sort()).toEqual([['CIRCLE 1C', 'B'], ['LINE 1A', 'A'], ['LINE 1B', 'A']]);
    expect(new Set(r.problems.map((p) => p.why)).size).toBe(3);
    expect(lineSet(r.entities)).toEqual([[[0, 0], [7, 0]]]);
  });

  it('more curves than a sketch can import: refused, with the number', () => {
    const many = Array.from({ length: DXF_MAX_CURVES + 1 }, (_, k) => ent('LINE', 8, 'A', 10, k, 20, 0, 11, k, 21, 1));
    expect(() => run(dxf(many))).toThrow(DxfImportError);
    expect(run(dxf(many.slice(0, DXF_MAX_CURVES))).made.line).toBe(DXF_MAX_CURVES);
  });

  it('decodes UTF-8, and an older file in its code page (ANSI_950)', () => {
    const utf8 = new TextEncoder().encode(dxf([ent('TEXT', 8, 'A', 10, 0, 20, 0, 40, 1, 1, '孔')]));
    expect(dxfText(utf8)).toContain('孔');
    // 「孔」 in Big5 is 0xA4 0xD5
    const head = new TextEncoder().encode('0\nSECTION\n2\nHEADER\n9\n$DWGCODEPAGE\n3\nANSI_950\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\nA\n10\n0\n20\n0\n40\n1\n1\n');
    const tail = new TextEncoder().encode('\n0\nENDSEC\n0\nEOF\n');
    const big5 = new Uint8Array([...head, 0xa4, 0xd5, ...tail]);
    const r = run(dxfText(big5));
    expect(r.entities.find((e) => e.type === 'text')).toMatchObject({ text: '孔' });
  });
});

describe('the DXF this program writes, read back', () => {
  it('a flat pattern: every line, arc and circle of its outline, to 1e-6 mm, and its bend lines', () => {
    const outline = [
      { kind: 'line' as const, a: [0, 0] as P, b: [80, 0] as P },
      { kind: 'arc' as const, c: [80, 10] as P, r: 10, from: [80, 0] as P, to: [90, 10] as P, mid: [80 + 10 * Math.SQRT1_2, 10 - 10 * Math.SQRT1_2] as P },
      { kind: 'line' as const, a: [90, 10] as P, b: [90, 40] as P },
      { kind: 'line' as const, a: [90, 40] as P, b: [0, 40] as P },
      { kind: 'line' as const, a: [0, 40] as P, b: [0, 0] as P },
      { kind: 'circle' as const, c: [30, 20] as P, r: 4.5 },
    ];
    const text = flatPatternDxf({ outline, bends: [{ a: [45, 0], b: [45, 40], angle: 90, radius: 1, direction: 'up', kFactor: 0.44 }], min: [0, 0], max: [90, 40], width: 90, height: 40, thickness: 1.5 });
    const r = run(text);
    expect(r.problems).toEqual([]);
    const lines = lineSet(r.entities);
    for (const s of outline) if (s.kind === 'line') expect(hasLine(lines, s.a, s.b, 1e-6)).toBe(true);
    expect(hasLine(lines, [45, 0], [45, 40], 1e-6)).toBe(true);
    const g = geometry(r.entities);
    const a = g.of('arc')[0]!;
    expect(close(g.p(a.center), [80, 10], 1e-6) && close(g.p(a.start), [80, 0], 1e-6) && close(g.p(a.end), [90, 10], 1e-6)).toBe(true);
    const c = g.of('circle')[0]!;
    expect(close(g.p(c.center), [30, 20], 1e-6)).toBe(true);
    expect(c.radius).toBeCloseTo(4.5, 6);
    // the outline is one closed chain: every end shared by two curves
    const ends = [...g.of('line').filter((l) => !hasLine([[g.p(l.p1), g.p(l.p2)]], [45, 0], [45, 40])).flatMap((l) => [l.p1, l.p2]), a.start, a.end];
    const uses = new Map<string, number>();
    for (const id of ends) uses.set(id, (uses.get(id) ?? 0) + 1);
    expect([...uses.values()].every((n) => n === 2)).toBe(true);
  });

  it('a drawing: each segment of its polylines a line to 1e-6 mm, its texts, its dimensions and arrowheads left out', async () => {
    const { scene } = await plateScene();
    const r = run(toDxf(scene));
    const lines = lineSet(r.entities);
    let segments = 0;
    const dimensions = new Set(scene.dimensions!.map((d) => d.id));
    for (const item of scene.items) {
      // a dimension's own lines are in the block of its DIMENSION, which is not imported
      if (item.kind !== 'polyline' || item.filled || (item.group !== undefined && dimensions.has(item.group))) continue;
      const pts: P[] = [];
      for (let k = 0; k < item.points.length; k += 2) pts.push([item.points[k]!, item.points[k + 1]!]);
      const n = item.closed ? pts.length : pts.length - 1;
      for (let k = 0; k < n; k++) {
        const a = pts[k]!, b = pts[(k + 1) % pts.length]!;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= r.mergeTolerance) continue;
        segments++;
        expect(hasLine(lines, a, b, 1e-6)).toBe(true);
      }
    }
    expect(segments).toBeGreaterThan(50);
    expect(r.skipped.DIMENSION).toBe(scene.dimensions!.length);
    // filled shapes outside the dimensions are SOLIDs (a fan of triangles), counted and left out
    const solids = scene.items.reduce((n, i) => n + (i.kind === 'polyline' && i.filled && !(i.group !== undefined && dimensions.has(i.group)) ? i.points.length / 2 - 2 : 0), 0);
    expect(r.skipped.SOLID ?? 0).toBe(solids);
    // the dimensions' own lines are in their blocks, which are not inserted: only what is drawn outside them comes in
    expect(r.entities.some((e) => e.type === 'text')).toBe(true);
  });
});

describe('random files (fuzzing)', () => {
  it('200 random DXFs of lines, bulged polylines, arcs, ellipses, splines and nested inserts, some with bad numbers: no crash, every result a valid sketch', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const num = () => (rnd() < 0.03 ? ['NaN', '1e400', '', 'x'][Math.floor(rnd() * 4)]! : (rnd() - 0.5) * 10 ** Math.floor(rnd() * 7 - 2));
    let curves = 0;
    for (let k = 0; k < 200; k++) {
      const list: string[] = [];
      const count = 1 + Math.floor(rnd() * 12);
      for (let j = 0; j < count; j++) {
        const kind = Math.floor(rnd() * 7);
        if (kind === 0) list.push(ent('LINE', 8, 'A', 10, num(), 20, num(), 11, num(), 21, num()));
        else if (kind === 1) list.push(ent('ARC', 8, 'A', 10, num(), 20, num(), 40, num(), 50, num(), 51, num()));
        else if (kind === 2) list.push(ent('CIRCLE', 8, 'B', 10, num(), 20, num(), 40, num()));
        else if (kind === 3) list.push(ent('LWPOLYLINE', 8, 'B', 90, 3, 70, Math.floor(rnd() * 2), 10, num(), 20, num(), 42, (rnd() - 0.5) * 4, 10, num(), 20, num(), 42, (rnd() - 0.5) * 4, 10, num(), 20, num()));
        else if (kind === 4) list.push(ent('ELLIPSE', 8, 'C', 10, num(), 20, num(), 11, num(), 21, num(), 40, rnd(), 41, rnd() * 7, 42, rnd() * 7));
        else if (kind === 5) list.push(ent('SPLINE', 8, 'C', 71, 3, 40, 0, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 40, 1, ...Array.from({ length: 4 }, () => [10, num(), 20, num()]).flat()));
        else list.push(ent('INSERT', 8, 'D', 2, 'N', 10, num(), 20, num(), 41, num(), 42, num(), 50, num()));
      }
      const blocks = [block('N', [0, 0], ent('LINE', 8, '0', 10, 0, 20, 0, 11, 3, 21, 4), ent('INSERT', 8, '0', 2, 'M', 10, 1, 20, 1, 50, 45)), block('M', [0, 0], ent('ARC', 8, '0', 10, 0, 20, 0, 40, 2, 50, 10, 51, 200))];
      let r;
      try {
        r = run(dxf(list, { blocks }));
      } catch (e) {
        expect(e).toBeInstanceOf(DxfImportError);
        continue;
      }
      curves += r.entities.filter((e) => e.type !== 'point' && e.type !== 'text').length;
      expect(sketchError({ entities: r.entities, constraints: [] })).toBeNull();
      for (const e of r.entities) {
        if (e.type === 'point') expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
        if (e.type === 'circle') expect(e.radius > 0 && Number.isFinite(e.radius)).toBe(true);
        if (e.type === 'line') expect(e.p1).not.toBe(e.p2);
      }
      expect(r.approximated.deviation).toBeLessThanOrEqual(DXF_APPROXIMATION);
    }
    // the fuzzing made curves (not only refusals)
    expect(curves).toBeGreaterThan(500);
  });
});
