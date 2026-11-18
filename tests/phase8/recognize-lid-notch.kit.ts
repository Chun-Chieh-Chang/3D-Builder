/**
 * ADR 0259 slice 3: a closed cup (a body of revolution about y: walls, floor, and a lid on top) with the drafted window of slice 1 at +z, and the lid cut
 * back to a cross by four notches, one in each quadrant away from the window, as part-3's lid is (design doc / DEV_LOG 2026-11-18, c17c). A notch is
 * cut along y through the lid and `below` mm down the wall: its outline a line on z = ±`a`, an arc of radius `round` tangent to both, and a line on
 * x = ±`b`, closed outside the cup. The truth is the body made here. `fuzzFile` runs random cases (AGENTS §3.4), each its own `it`.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { isTrap, Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';

const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;

export interface LidCup {
  /** The window of slice 1: its spline on z = 10 over a chord, and its draft in degrees. */
  top: number[][];
  draft: number;
  r: number;
  wall: number;
  /** Height of the cavity; the lid, `lid` thick, is on top of it. */
  height: number;
  lid: number;
  /** The notch: half-widths of the cross's arms (|z| < a, |x| < b), the radius of its inner corners, and how far below the lid it reaches. */
  a: number;
  b: number;
  round: number;
  below: number;
}

/** The part. Throws `KernelError` when the kernel refuses it. */
export function cupWithLidNotch(kernel: Kernel, p: LidCup): ShapeId {
  const made: ShapeId[] = [];
  const keep = (id: ShapeId) => (made.push(id), id);
  try {
    const top = p.height + p.lid;
    const prof = [[0, 0], [p.r, 0], [p.r, top], [0, top], [0, p.height], [p.r - p.wall, p.height], [p.r - p.wall, p.wall], [0, p.wall]];
    let body = keep(kernel.revolve(XY as never, [{ outer: prof.map((q, i) => L(q, prof[(i + 1) % prof.length]!, 'p' + i)), holes: [] }] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape);
    const a0 = p.top[0]!;
    const b0 = p.top[p.top.length - 1]!;
    const win = { outer: [{ kind: 'spline', points: p.top, source: 's' }, L(b0, a0, 'c')], holes: [] };
    const tool = keep(kernel.extrude({ ...XY, origin: [0, 0, 10] } as never, [win] as never, [0, 0, p.r + 4 - 10], 0, undefined, (p.draft * Math.PI) / 180).shape);
    body = keep(kernel.boolean('cut', body, tool).shape);
    // the notches: on a frame square to y with (u, v) = (z, x), one region per quadrant
    const far = p.r + 3;
    const y0 = p.height - p.below;
    for (const [sz, sx] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const P = (u: number, v: number) => [sz * u, sx * v];
      const arcEnd1 = P(p.a, p.b + p.round);
      const arcEnd2 = P(p.a + p.round, p.b);
      const c = P(p.a + p.round, p.b + p.round);
      const region = {
        outer: [
          L(P(p.a, far), arcEnd1, 'l1'),
          { kind: 'arc', c, r: p.round, from: arcEnd1, to: arcEnd2, ccw: sz * sx > 0, source: 'r' },
          L(arcEnd2, P(far, p.b), 'l2'),
          L(P(far, p.b), P(far, far), 'l3'),
          L(P(far, far), P(p.a, far), 'l4'),
        ],
        holes: [],
      };
      const frame = { origin: [0, y0, 0], xDir: [0, 0, 1], yDir: [1, 0, 0], normal: [0, 1, 0] };
      const cut = keep(kernel.extrude(frame as never, [region] as never, [0, p.below + p.lid + 1, 0]).shape);
      body = keep(kernel.boolean('cut', body, cut).shape);
    }
    made.splice(made.indexOf(body), 1);
    return body;
  } finally {
    for (const id of made) kernel.release(id);
  }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random case: the window below the lid and narrower than the cross's z-arm (|x| < b), the notch corners inside the lid. */
export function sample(seed: number): LidCup {
  const r = rng(seed * 6271);
  const rd = (v: number) => Math.round(v * 1000) / 1000;
  const radius = rd(14 + 8 * r());
  const wall = rd(0.8 + 1.2 * r());
  const height = rd(16 + 6 * r());
  const half = rd(2 + 2 * r());
  const chord = rd(wall + 1 + 2 * r());
  const n = 3 + Math.floor(r() * 3);
  const peak = rd(Math.min(height - 3, chord + 4 + 6 * r()));
  const top = Array.from({ length: n }, (_, i) => [rd(-half + (2 * half * i) / (n - 1)), i === 0 || i === n - 1 ? chord : rd(chord + (peak - chord) * (0.4 + 0.6 * r()))]);
  const draft = rd((r() < 0.15 ? 0 : 1) * (r() < 0.5 ? -1 : 1) * (0.3 + 2.7 * r()));
  const b = rd(half + 2 + 3 * r());
  const a = rd(3 + 3 * r());
  const round = rd(1 + 3 * r());
  return { top, draft, r: radius, wall, height, lid: rd(1 + 1.5 * r()), a, b, round, below: rd(r() < 0.3 ? 0.5 : 1 + 2 * r()) };
}

/**
 * Seeds `from`–`to`, each its own case: rebuilt as the same solid (to the recognition tolerance) with four notch cuts, or refused for a reason
 * recognition gives; a trap or any other error fails it. A part the kernel will not make is skipped and counted. At the end at least one case was
 * rebuilt.
 */
export function fuzzFile(from: number, to: number) {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  let rebuilt = 0;
  let notMade = 0;
  it('loads', async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
  }, 60_000);
  for (let seed = from; seed <= to; seed++) {
    it(`seed ${seed}`, async () => {
      const p = sample(seed);
      let shape: ShapeId;
      try {
        shape = cupWithLidNotch(kernel, p);
      } catch (e) {
        if (e instanceof KernelError && !isTrap(e)) {
          notMade++;
          console.log(`#${seed} not made: ${e.message.slice(0, 80)}`);
          return;
        }
        throw e;
      }
      try {
        const r = await recognizeStep(kernel, solver, shape);
        expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
        expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
        rebuilt++;
        console.log(`#${seed} rebuilt`);
      } catch (e) {
        if (!(e instanceof RecognizeError)) throw e;
        console.log(`#${seed} refused: ${e.message.slice(0, 120)}`);
      } finally {
        kernel.release(shape);
      }
    }, 300_000);
  }
  it('at least one case was rebuilt; the heap is printed', () => {
    const heap = (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
    expect(heap).toBeGreaterThan(0);
    console.log(`seeds ${from}-${to}: rebuilt ${rebuilt}, not made ${notMade}, heap ${(heap / 2 ** 20).toFixed(0)} MiB`);
    expect(rebuilt).toBeGreaterThan(0);
  });
}
