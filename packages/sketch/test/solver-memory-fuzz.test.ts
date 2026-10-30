/**
 * Fuzz of large sketches against the solver's fixed 16 MiB heap (2026-10-30, AGENTS.md §3.4): 200 sketches of up to 320 random shapes, each solved, its
 * geometry checked against the truth to 1e-6 mm, all on one solver module. A file of its own: its own module, and its own heap. Afterwards the module must
 * still hold the largest part a fresh module holds: what a solve left behind in the heap would show there, not in a count of objects (§3.1).
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '../src/index';
import { chain, circle, empty, heapBytes, rectangle } from './large-sketch';

const TOL = 1e-6;
const CASES = 200;

/** A small seeded generator (mulberry32), so that a failure can be made again. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it(`${CASES} random large sketches: solved, exact, and the module keeps its capacity`, async () => {
  const solver = await PlaneGcsSolver.create();
  const heap = heapBytes(solver);
  expect(heap).toBeGreaterThan(0);
  // the capacity probe first holds in a fresh module: a part of 2·290 unknowns and 2·289 equations, near the largest measured (301 points)
  expect((await PlaneGcsSolver.create()).solve(chain(290)).message).toBeUndefined();
  const rnd = random(20261030);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  let shapes = 0;
  for (let k = 0; k < CASES; k++) {
    const built = empty();
    const n = 1 + Math.floor(rnd() * 320);
    const rects: { i: number; w: number; h: number }[] = [];
    for (let i = 0; i < n; i++) {
      const kind = rnd();
      const [gx, gy] = [(i % 25) * 60, Math.floor(i / 25) * 60 + 5];
      const w = round(1 + rnd() * 49);
      const h = round(1 + rnd() * 49);
      const off = round(0.1 + rnd() * 0.4 * Math.min(w, h));
      if (kind < 0.3) rectangle(built, i, gx, gy, w, h, off, 'none');
      else if (kind < 0.6) rectangle(built, i, gx, gy, w, h, off, 'origin');
      else if (kind < 0.75) rectangle(built, i, -(i + 1) * 60, 0, w, h, off, 'axis');
      else circle(built, i, gx + 30, gy + 30, round(1 + rnd() * 25), off);
      if (kind < 0.75) rects.push({ i, w, h });
    }
    shapes += n;
    const r = solver.solve(built.sketch);
    const where = `case ${k}, ${n} shapes`;
    expect(r.message, where).toBeUndefined();
    expect(r.dof, where).toBe(built.dof);
    expect(r.status, where).toBe(built.dof === 0 ? 'fully' : 'under');
    for (const [id, [x, y]] of built.truth) {
      const g = r.geometry.get(id);
      if (g?.type !== 'point') throw new Error(`${where}: ${id} not solved`);
      expect(Math.hypot(g.p[0] - x, g.p[1] - y), `${where}: ${id}`).toBeLessThan(TOL);
    }
    for (const [id, radius] of built.radii) {
      const g = r.geometry.get(id);
      if (g?.type !== 'circle') throw new Error(`${where}: ${id} not solved`);
      expect(Math.abs(g.r - radius), `${where}: ${id}`).toBeLessThan(TOL);
    }
    for (const { i, w, h } of rects) {
      const [a, b, c] = [0, 1, 2].map((m) => r.geometry.get(`p${i}_${m}`)).map((g): [number, number] => (g?.type === 'point' ? g.p : [NaN, NaN])) as [[number, number], [number, number], [number, number]];
      expect(Math.abs(b[0] - a[0] - w), `${where}: width ${i}`).toBeLessThan(TOL);
      expect(Math.abs(c[1] - b[1] - h), `${where}: height ${i}`).toBeLessThan(TOL);
      expect(Math.abs(b[1] - a[1]), `${where}: horizontal ${i}`).toBeLessThan(TOL);
    }
  }
  console.log(`${CASES} sketches, ${shapes} shapes; solver heap ${heap / 2 ** 20} MiB`);
  // the same module, after every one of them: still holds the part a fresh module holds, and its heap is the one it had (it cannot grow)
  expect(solver.solve(chain(290)).message).toBeUndefined();
  expect(heapBytes(solver)).toBe(heap);
}, 300_000);
