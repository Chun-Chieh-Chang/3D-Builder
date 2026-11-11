/**
 * `Kernel.fileTolerance` and the allowance of `Kernel.surfaceDeviation` (ADR 0249): how far apart the faces of a file are where they meet, and the
 * comparison past that. The sloppy file is made on purpose, so its error is known without the code under test: a box written to STEP, then only the top
 * PLANE's placement point moved up by δ (its edges and vertices stay where they were). Read back, the top face lies δ off its own edges: the joint gap of
 * each top edge is δ, so the top and the four sides get δ and the bottom (whose edges are exact) gets none; and the solid read back is δ above the exact
 * box over its top, so the deviation is 40·30·δ both ways, all of it within the allowance. The negative control is the same file with a hole the exact
 * box has: past the allowance it is still at least the hole's volume.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '../src';
import { __body, sample } from './exact-round-fuzz.kit';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const box = (): ShapeId =>
  kernel.extrude(XY as never, [{ outer: [[0, 0], [40, 0], [40, 30], [0, 30]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] }] as never, [0, 0, 12]).shape;
const cyl = (cx: number, cy: number, z0: number, r: number, h: number): ShapeId =>
  kernel.extrude({ ...XY, origin: [0, 0, z0] } as never, [{ outer: [{ kind: 'circle', c: [cx, cy], r, source: 'c' }], holes: [] }] as never, [0, 0, h]).shape;
const viaStep = (text: string) => kernel.importStep(new TextEncoder().encode(text)).shape;

/** The box's STEP text with the top plane's placement point moved up by `delta` (and nothing else). */
function sloppy(delta: number): string {
  const lines = kernel.exportStep(box(), 'p').split(/\r?\n/);
  const at = new Map<string, number>();
  lines.forEach((l, i) => {
    const m = /^#(\d+)\s*=/.exec(l);
    if (m) at.set(m[1]!, i);
  });
  let moved = 0;
  for (const l of lines) {
    const m = /^#\d+\s*=\s*PLANE\('[^']*',#(\d+)\)/.exec(l);
    if (!m) continue;
    const axis = /AXIS2_PLACEMENT_3D\('[^']*',#(\d+)/.exec(lines[at.get(m[1]!)!]!)!;
    const i = at.get(axis[1]!)!;
    const c = /\(([-\d.E+]+),([-\d.E+]+),([-\d.E+]+)\)/.exec(lines[i]!)!;
    if (Math.abs(Number(c[3]) - 12) > 1e-9) continue;
    lines[i] = lines[i]!.replace(c[0], `(${c[1]},${c[2]},${(12 + delta).toFixed(9)})`);
    moved++;
  }
  // the edit must have happened, once: otherwise every assertion below is about an exact box
  expect(moved).toBe(1);
  return lines.join('\n');
}

describe('fileTolerance: how far apart the faces of a file are where they meet', () => {
  it('a box through a STEP file joined at working precision: no face is off', () => {
    const t = kernel.fileTolerance(viaStep(kernel.exportStep(box(), 'p')));
    expect(t.faces).toHaveLength(6);
    expect(t.count).toBe(0);
    expect(t.max).toBe(0);
    expect(t.volume).toBe(0);
    expect(t.area).toBe(0);
  });

  it('rounds: exact ones join within the floor (6.9e-9 measured), OCCT\'s own are 1e-5 off their neighbours (its pcurves approximate)', () => {
    const input = sample(41);
    const { shape, edges } = __body(kernel, input);
    const exact = kernel.fileTolerance(viaStep(kernel.exportStep(kernel.fillet(shape, edges, input.r, undefined, undefined, true).shape, 'p')));
    // without the floor, all 6 faces about the round would count (6.9e-9): the floor keeps evaluation noise out of the allowance
    expect(exact.count).toBe(0);
    const occt = kernel.fileTolerance(viaStep(kernel.exportStep(kernel.fillet(shape, edges, input.r, undefined, undefined, false).shape, 'p')));
    expect(occt.count).toBeGreaterThan(0);
    expect(occt.max).toBeGreaterThan(1e-6);
    expect(occt.max).toBeLessThan(1e-4);
  });

  it('the top plane moved δ off its edges: the top and the four sides get δ, the bottom none', () => {
    for (const delta of [2e-5, 2e-4, 1e-3]) {
      const s = viaStep(sloppy(delta));
      expect(kernel.check(s).valid).toBe(true);
      const t = kernel.fileTolerance(s);
      const topo = kernel.topology(s);
      expect(t.count).toBe(5);
      expect(Math.abs(t.max / delta - 1)).toBeLessThan(1e-3);
      topo.faces.forEach((f, i) => {
        const bottom = Math.abs(f.center[2]) < 1e-9;
        if (bottom) expect(t.faces[i]).toBe(0);
        else expect(Math.abs(t.faces[i]! / delta - 1)).toBeLessThan(1e-3);
      });
      // Σ τ·area over the top and sides: δ·(40·30 + 2·(40 + 30)·12); Σ 2·gap·length over the four top edges: 2·δ·140
      expect(Math.abs(t.volume / (delta * (1200 + 1680)) - 1)).toBeLessThan(1e-3);
      expect(Math.abs(t.area / (2 * delta * 140) - 1)).toBeLessThan(1e-3);
    }
  });
});

describe('surfaceDeviation past the allowance', () => {
  it('the sloppy box against the exact one: 40·30·δ raw both ways, nothing past the allowance', () => {
    const delta = 2e-4;
    const s = viaStep(sloppy(delta));
    const exact = box();
    const t = kernel.fileTolerance(s);
    const ab = kernel.surfaceDeviation(s, exact, undefined, { a: t.faces });
    const ba = kernel.surfaceDeviation(exact, s, undefined, { b: t.faces });
    for (const d of [ab, ba]) {
      // raw, it is 1.7e-5 of the volume: refused at 1e-6
      expect(Math.abs(d.integral / (1200 * delta) - 1)).toBeLessThan(1e-2);
      expect(d.integral / 14400).toBeGreaterThan(1e-6);
      expect(d.excess).toBeLessThan(1e-9);
    }
    // without the allowance the excess is the integral
    const plain = kernel.surfaceDeviation(s, exact);
    expect(plain.excess).toBe(plain.integral);
  });

  it('the sloppy box with a hole the exact box has not: past the allowance, still at least the hole', () => {
    const delta = 2e-4;
    const s = viaStep(sloppy(delta));
    const t = kernel.fileTolerance(s);
    const holed = kernel.boolean('cut', box(), cyl(20, 15, -1, 0.25, 14)).shape;
    // the hole's wall is seen from the holed box, against the sloppy top and bottom: δ off at most, so its volume less δ over its wall
    const ba = kernel.surfaceDeviation(holed, s, undefined, { b: t.faces });
    const hole = Math.PI * 0.25 ** 2 * 12;
    expect(ba.excess).toBeGreaterThan(hole - delta * 2 * Math.PI * 0.25 * 12);
    expect(ba.excess / 14400).toBeGreaterThan(1e-6);
  });

  it('refuses allowances that do not fit the faces or are no distance', () => {
    const a = box();
    const b = box();
    expect(() => kernel.surfaceDeviation(a, b, undefined, { a: [0, 0, 0] })).toThrow();
    expect(() => kernel.surfaceDeviation(a, b, undefined, { b: [0, 0, 0, 0, 0, Number.NaN] })).toThrow();
    expect(() => kernel.surfaceDeviation(a, b, undefined, { a: [0, 0, 0, 0, 0, -1e-6] })).toThrow();
  });
});
