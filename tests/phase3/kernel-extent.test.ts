/**
 * `Kernel.extent`: the box a body's surfaces reach. `bounds` is a cover (on a B-spline face it takes the poles and adds the tolerance), so a size read
 * from it is too large: `cad_inspect_geometry` gave part-3 (R1-10226) 53.22 mm along z, the body is 42.10. Truth here is the body made: a cylinder
 * of radius r and height h, and the same cylinder as B-spline faces (`toBSpline`), whose rational circle has its poles at the square's corners.
 */
import { beforeAll, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;

/** A cylinder about y: radius r, height h, its base at y = 0. */
function cylinder(r: number, h: number): ShapeId {
  const prof = [[0, 0], [r, 0], [r, h], [0, h]];
  return kernel.revolve(XY as never, [{ outer: prof.map((a, i) => L(a, prof[(i + 1) % prof.length]!, 'p' + i)), holes: [] }] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape;
}

const near = (box: { min: number[]; max: number[] }, min: number[], max: number[], tol: number) => {
  for (let k = 0; k < 3; k++) {
    expect(Math.abs(box.min[k]! - min[k]!)).toBeLessThan(tol);
    expect(Math.abs(box.max[k]! - max[k]!)).toBeLessThan(tol);
  }
};

it('is the cylinder exactly, analytic or as B-spline faces; the cover of the B-spline one is larger', () => {
  for (const [r, h] of [[5, 10], [0.3, 40], [17.5, 2]] as const) {
    const cyl = cylinder(r, h);
    const spline = kernel.toBSpline(cyl);
    try {
      near(kernel.extent(cyl), [-r, 0, -r], [r, h, r], 1e-6);
      near(kernel.extent(spline), [-r, 0, -r], [r, h, r], 1e-6);
      // the case is the one that matters: the cover reaches past the B-spline body (else this test would not tell the two apart)
      const cover = kernel.bounds(spline);
      expect(Math.max(cover.max[0]! - r, cover.max[2]! - r)).toBeGreaterThan(0.1 * r);
    } finally {
      kernel.release(spline);
      kernel.release(cyl);
    }
  }
});

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('100 random cylinders as B-spline faces, turned about a random axis and moved: the extent is the analytic one (AGENTS §3.4)', () => {
  // a cylinder of axis a (unit), from c0 to c1: along each axis k it reaches its ends' coordinates ± r·sqrt(1 − a_k²)
  for (let seed = 1; seed <= 100; seed++) {
    const r = rng(seed * 7919);
    const radius = 0.05 + 30 * r();
    const height = 0.05 + 60 * r();
    // a random rotation (a unit quaternion) and a random move
    const q = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5];
    const n = Math.hypot(...q);
    const [w, x, y, z] = q.map((v) => v / n) as [number, number, number, number];
    const R = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
      [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ];
    const t = [200 * r() - 100, 200 * r() - 100, 200 * r() - 100];
    const cyl = cylinder(radius, height);
    const moved = kernel.transformed(cyl, [...R[0]!, t[0]!, ...R[1]!, t[1]!, ...R[2]!, t[2]!]);
    const spline = kernel.toBSpline(moved);
    try {
      const axis = [R[0]![1]!, R[1]![1]!, R[2]![1]!];
      const c0 = t;
      const c1 = t.map((v, k) => v + height * axis[k]!);
      const reach = axis.map((a) => radius * Math.sqrt(Math.max(0, 1 - a * a)));
      const min = [0, 1, 2].map((k) => Math.min(c0[k]!, c1[k]!) - reach[k]!);
      const max = [0, 1, 2].map((k) => Math.max(c0[k]!, c1[k]!) + reach[k]!);
      near(kernel.extent(spline), min, max, 1e-6);
    } finally {
      for (const id of [spline, moved, cyl]) kernel.release(id);
    }
  }
  const heap = (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
  expect(heap).toBeGreaterThan(0);
  console.log(`extent fuzz: heap ${(heap / 2 ** 20).toFixed(0)} MiB`);
}, 120_000);

it('a body turned off the axes and moved: still the surfaces, not the cover', () => {
  const r = 4;
  const h = 6;
  const cyl = cylinder(r, h);
  // a quarter turn about z (y goes to -x), then moved by (10, 20, 30)
  const moved = kernel.transformed(cyl, [0, -1, 0, 10, 1, 0, 0, 20, 0, 0, 1, 30]);
  const spline = kernel.toBSpline(moved);
  try {
    near(kernel.extent(spline), [10 - h, 20 - r, 30 - r], [10, 20 + r, 30 + r], 1e-6);
  } finally {
    for (const id of [spline, moved, cyl]) kernel.release(id);
  }
});
