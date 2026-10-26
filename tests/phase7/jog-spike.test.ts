/**
 * S-3 spike (docs/sheet-metal-drawing-plan.md): can a bend in the middle of a plate be made from what the kernel has? A plate 100 × 50 × 1.5, inside radius 2, K 0.5, bent 90° at the
 * line x = 50: the part before the bend zone stays, the zone is the revolved section, the part after is moved by a rigid motion (slid up to the start of the zone, turned about
 * the axis of the bend), and the three are fused. The volume must be the plate's (K = 0.5 keeps it): 7500 mm³.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const line = (a: [number, number], b: [number, number], source: string) => ({ kind: 'line' as const, a, b, source });
const rect = (x0: number, y0: number, x1: number, y1: number, id: string): Region => ({
  outer: [line([x0, y0], [x1, y0], `${id}.a`), line([x1, y0], [x1, y1], `${id}.b`), line([x1, y1], [x0, y1], `${id}.c`), line([x0, y1], [x0, y0], `${id}.d`)],
  holes: [],
});

const T = 1.5;
const r = 2;
const w = 50;
const L = 50;

function jog(angleDeg: number) {
  const theta = (angleDeg * Math.PI) / 180;
  const BA = theta * (r + 0.5 * T);
  const xA = L - BA / 2;
  const xB = L + BA / 2;
  const floor: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const A = kernel.extrude(floor, [rect(0, 0, xA, w, 'a')], [0, 0, T]).shape;
  const Braw = kernel.extrude(floor, [rect(xB, 0, 100, w, 'b')], [0, 0, T]).shape;
  const section: Frame = { origin: [xA, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] };
  const bend = kernel.revolve(section, [rect(0, 0, w, T, 's')], { origin: [xA, 0, T + r], dir: [0, -1, 0] }, theta).shape;
  // B: slid to the start of the zone, then turned about the axis of the bend (through O = (xA, ·, T + r), along y) by theta toward +x
  const slide = kernel.transformed(Braw, [1, 0, 0, xA - xB, 0, 1, 0, 0, 0, 0, 1, 0]);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const Oz = T + r;
  return { A, bend, slide, theta, xA, Oz, c, s, BA };
}

describe('a bend in the middle of a plate', () => {
  it('the three pieces: the revolved zone has the volume θ·w·T·(r + T/2); the pieces fuse into one valid solid of the plate\'s volume', () => {
    const p = jog(90);
    const zone = kernel.massProps(p.bend).volume;
    expect(zone).toBeCloseTo(p.theta * w * T * (r + T / 2), 6);
    // B turned: the matrix of p' = R (p − O) + O with O = (xA, 0, Oz)
    const R = [p.c, 0, -p.s, 0, 1, 0, p.s, 0, p.c];
    const O = [p.xA, 0, p.Oz];
    const t = [O[0]! - (R[0]! * O[0]! + R[2]! * O[2]!), 0, O[2]! - (R[6]! * O[0]! + R[8]! * O[2]!)];
    const turned = kernel.transformed(p.slide, [R[0]!, R[1]!, R[2]!, t[0]!, R[3]!, R[4]!, R[5]!, t[1]!, R[6]!, R[7]!, R[8]!, t[2]!]);
    let body = kernel.boolean('fuse', p.A, p.bend).shape;
    body = kernel.boolean('fuse', body, turned).shape;
    expect(kernel.isValid(body)).toBe(true);
    expect(kernel.solidCount(body)).toBe(1);
    expect(kernel.massProps(body).volume).toBeCloseTo(7500, 3);
    const b = kernel.bounds(body);
    // the flange rises: it reaches 47.84 + ... above the plate; its outer face is at x = xA + r + T
    expect(b.max[0]).toBeCloseTo(p.xA + r + T, 4);
    expect(b.max[2]).toBeGreaterThan(40);
  });
});
