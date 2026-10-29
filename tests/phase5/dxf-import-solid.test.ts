/**
 * 「匯入 DXF」 (F2.6) through the real solver and kernel: closed outlines of a DXF, imported into a sketch, solved by PlaneGCS and extruded by OCCT. The volume
 * is checked against the area worked out by hand from the DXF itself (for the spline, from its own B-spline, integrated exactly apart from the importer).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { IdAllocator } from '@3db/model';
import { importDxf } from '@3db/drawing';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, extrude, front, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

type P = [number, number];
const ent = (type: string, ...pairs: (string | number)[]): string => ['0', type, ...pairs.map(String)].join('\n');
const dxf = (entities: string[]) => ['0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'].join('\n');

/** The DXF's entities as a sketch on the front plane, extruded 10: its status and volume. */
function solid(text: string) {
  const r = importDxf(text, new IdAllocator({}, []));
  expect(r.problems).toEqual([]);
  const result = regen.rebuild(build(sketch('s1', front, { entities: r.entities, constraints: [] }), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' })));
  return { result, volume: result.body ? kernel.massProps(result.body.shape).volume : NaN, imported: r };
}

describe('an imported outline is a profile', () => {
  it('a closed polyline with a bulge (a half circle), a circle and an ellipse as holes: the volume of the area worked out by hand, to 1e-9', () => {
    const text = dxf([
      // 40 × 30, its right side a half circle bulging out (bulge 1 from (40, 0) to (40, 30): to the right of the way up)
      ent('LWPOLYLINE', 8, 'OUT', 90, 4, 70, 1, 10, 0, 20, 0, 10, 40, 20, 0, 42, 1, 10, 40, 20, 30, 10, 0, 20, 30),
      ent('CIRCLE', 8, 'OUT', 10, 10, 20, 15, 40, 5),
      ent('ELLIPSE', 8, 'OUT', 10, 28, 20, 15, 11, 6, 21, 0, 40, 0.5, 41, 0, 42, 2 * Math.PI),
    ]);
    const { result, volume } = solid(text);
    expect(statuses(result)).toEqual(['s1=ok', 'e1=ok']);
    const area = 40 * 30 + (Math.PI * 15 * 15) / 2 - Math.PI * 25 - Math.PI * 6 * 3;
    expect(Math.abs(volume - area * 10) / (area * 10)).toBeLessThan(1e-9);
  });

  it('a closed outline of a cubic SPLINE and a LINE: the Bézier pieces solve, and the volume is the B-spline\'s own area, to 1e-7', () => {
    const poles: P[] = [[0, 0], [10, 20], [25, 25], [40, 20], [50, 0]];
    const knots = [0, 0, 0, 0, 1, 2, 2, 2, 2];
    const text = dxf([
      ent('SPLINE', 8, 'A', 70, 8, 71, 3, 72, knots.length, 73, poles.length, ...knots.flatMap((k) => [40, k]), ...poles.flatMap((q) => [10, q[0], 20, q[1], 30, 0])),
      ent('LINE', 8, 'A', 10, 50, 20, 0, 11, 0, 21, 0),
    ]);
    const { result, volume, imported } = solid(text);
    expect(statuses(result)).toEqual(['s1=ok', 'e1=ok']);
    expect(imported.entities.filter((e) => e.type === 'spline')).toHaveLength(2);
    // the area under the B-spline, ∫ y dx over each knot span: x(u), y(u) are cubics there, found from four points of Cox–de Boor; Gauss–Legendre with
    // three nodes is exact for the quintic y·x'
    const at = (u: number): P => deBoor(3, knots, poles, u);
    let area = 0;
    for (const [lo, hi] of [[0, 1], [1, 2]] as const) {
      const us = [0, 1 / 3, 2 / 3, 1].map((s) => lo + (hi - lo) * s);
      const pts = us.map(at);
      const lagrange = (k: 0 | 1, u: number) => us.reduce((sum, uj, j) => sum + pts[j]![k] * us.reduce((prod, um, m) => (m === j ? prod : prod * ((u - um) / (uj - um))), 1), 0);
      const derivative = (k: 0 | 1, u: number) => (lagrange(k, u + 1e-4) - lagrange(k, u - 1e-4)) / 2e-4; // central difference of a cubic: exact up to rounding
      for (const [x, w] of [[-Math.sqrt(3 / 5), 5 / 9], [0, 8 / 9], [Math.sqrt(3 / 5), 5 / 9]] as const) {
        const u = (lo + hi) / 2 + ((hi - lo) / 2) * x;
        area += ((hi - lo) / 2) * w * lagrange(1, u) * derivative(0, u);
      }
    }
    expect(area).toBeGreaterThan(500);
    expect(Math.abs(volume - area * 10) / (area * 10)).toBeLessThan(1e-7);
  });

  it('issue21.dxf, saved by LibreCAD: a rectangle and two closed polylines of mixed bulges in it extrude to the area of the raw vertices and bulges, to 1e-9', () => {
    const text = readFileSync(fileURLToPath(new URL('../fixtures/public-dxf/bjnortier-dxf/issue21.dxf', import.meta.url)), 'latin1');
    const { result, volume } = solid(text);
    expect(statuses(result)).toEqual(['s1=ok', 'e1=ok']);
    // each LWPOLYLINE read from the text: vertices (10, 20) and the bulge (42) of the segment that leaves each
    const lines = text.split(/\r?\n/).map((s) => s.trim());
    const closed: { p: P; bulge: number }[][] = [];
    let loop: { p: P; bulge: number }[] | null = null;
    for (let k = 0; k + 1 < lines.length; k += 2) {
      const [code, value] = [lines[k]!, lines[k + 1]!];
      if (code === '0') {
        loop = value === 'LWPOLYLINE' ? [] : null;
        if (loop) closed.push(loop);
      } else if (loop && code === '10') loop.push({ p: [Number(value), 0], bulge: 0 });
      else if (loop && code === '20') loop.at(-1)!.p[1] = Number(value);
      else if (loop && code === '42') loop.at(-1)!.bulge = Number(value);
    }
    expect(closed.map((l) => l.length)).toEqual([4, 4, 4]);
    // the signed area of each: the polygon (shoelace) and, for each bulge b over a chord c, the circular segment r²/2·(θ − sin θ), θ = 4·atan|b|,
    // r = c / (2·sin(θ/2)), on the side the sign of b says
    const signedArea = (l: { p: P; bulge: number }[]) =>
      l.reduce((sum, { p, bulge }, i) => {
        const q = l[(i + 1) % l.length]!.p;
        const theta = 4 * Math.atan(Math.abs(bulge));
        const r = Math.hypot(q[0] - p[0], q[1] - p[1]) / (2 * Math.sin(theta / 2));
        return sum + (p[0] * q[1] - q[0] * p[1]) / 2 + (bulge ? Math.sign(bulge) * ((r * r) / 2) * (theta - Math.sin(theta)) : 0);
      }, 0);
    const areas = closed.map((l) => Math.abs(signedArea(l))).sort((a, b) => b - a);
    const area = areas[0]! - areas[1]! - areas[2]!;
    expect(areas[1]).toBeGreaterThan(100);
    expect(Math.abs(volume - area * 10) / (area * 10)).toBeLessThan(1e-9);
  });
});

function deBoor(degree: number, knots: number[], poles: P[], u: number): P {
  const basis = (i: number, p: number): number => {
    if (p === 0) return (knots[i]! <= u && u < knots[i + 1]!) || (u === knots[knots.length - 1] && knots[i + 1] === u && knots[i]! < u) ? 1 : 0;
    const a = knots[i + p]! - knots[i]! === 0 ? 0 : ((u - knots[i]!) / (knots[i + p]! - knots[i]!)) * basis(i, p - 1);
    const b = knots[i + p + 1]! - knots[i + 1]! === 0 ? 0 : ((knots[i + p + 1]! - u) / (knots[i + p + 1]! - knots[i + 1]!)) * basis(i + 1, p - 1);
    return a + b;
  };
  let x = 0, y = 0;
  poles.forEach((q, i) => {
    const b = basis(i, degree);
    x += b * q[0];
    y += b * q[1];
  });
  return [x, y];
}
