/**
 * ADR 0259 slice 4a: the cup of slices 1 and 2 (a body of revolution about y) with several windows, each made at +z as slice 1 makes a drafted one
 * (`recognize-revolved-window.kit.ts`) or slice 2 a ruled loft one (`recognize-loft-window.kit.ts`), then turned about y by `at` (0, 90, 180 or 270
 * degrees). Part-3 has windows at ±x and ±z, so that no half-plane along a default direction is clear of them. The truth is the body made here.
 * `fuzzFile` runs random cases (AGENTS §3.4), each its own `it`.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { isTrap, Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';

const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;

export type Window =
  | { kind: 'drafted'; at: number; top: number[][]; draft: number }
  | { kind: 'loft'; at: number; first: number[][]; second: number[][]; chord: number; near: number; far: number; tilt: number };

export interface MultiCup {
  r: number;
  wall: number;
  height: number;
  windows: Window[];
}

/** The tool of one window at +z, as slices 1 and 2 make it. */
function toolAtZ(kernel: Kernel, p: MultiCup, w: Window): ShapeId {
  const section = (pts: number[][]) => [{ kind: 'spline', points: pts, source: 's' }, L(pts[pts.length - 1]!, pts[0]!, 'c')];
  if (w.kind === 'drafted') {
    return kernel.extrude({ ...XY, origin: [0, 0, 10] } as never, [{ outer: section(w.top), holes: [] }] as never, [0, 0, p.r + 4 - 10], 0, undefined, (w.draft * Math.PI) / 180).shape;
  }
  const th = (w.tilt * Math.PI) / 180;
  const f1 = { ...XY, origin: [0, 0, w.near] };
  const f2 = { origin: [0, 0, w.far], xDir: [Math.cos(th), 0, -Math.sin(th)], yDir: [0, 1, 0], normal: [Math.sin(th), 0, Math.cos(th)] };
  return kernel.loft([
    { frame: f1, outer: section(w.first) },
    { frame: f2, outer: section(w.second) },
  ] as never).shape;
}

/** The part. Throws `KernelError` when the kernel refuses it. */
export function cupWithWindows(kernel: Kernel, p: MultiCup): ShapeId {
  const made: ShapeId[] = [];
  const keep = (id: ShapeId) => (made.push(id), id);
  try {
    const prof = [[0, 0], [p.r, 0], [p.r, p.height], [p.r - p.wall, p.height], [p.r - p.wall, p.wall], [0, p.wall]];
    let body = keep(kernel.revolve(XY as never, [{ outer: prof.map((a, i) => L(a, prof[(i + 1) % prof.length]!, 'p' + i)), holes: [] }] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape);
    for (const w of p.windows) {
      const z = keep(toolAtZ(kernel, p, w));
      const t = (w.at * Math.PI) / 180;
      const [c, s] = [Math.round(Math.cos(t)), Math.round(Math.sin(t))];
      // a turn about y by `at`: +z goes to (sin, 0, cos)
      const tool = w.at === 0 ? z : keep(kernel.transformed(z, [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]));
      body = keep(kernel.boolean('cut', body, tool).shape);
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

/**
 * A random cup with two to four windows at distinct quarter turns, each drafted or lofted as slices 1 and 2 sample them: narrow enough (half-width at
 * most 4 on a radius of at least 14) that windows a quarter turn apart stay apart, their chords above the floor and tops below the rim.
 */
export function sample(seed: number): MultiCup {
  const r = rng(seed * 104729);
  const rd = (v: number) => Math.round(v * 1000) / 1000;
  const radius = rd(14 + 8 * r());
  const wall = rd(0.8 + 1.2 * r());
  const height = rd(16 + 6 * r());
  const spline = (half: number, chord: number) => {
    const n = 3 + Math.floor(r() * 3);
    const peak = rd(Math.min(height - 3, chord + 4 + 6 * r()));
    return Array.from({ length: n }, (_, i) => [rd(-half + (2 * half * i) / (n - 1)), i === 0 || i === n - 1 ? chord : rd(chord + (peak - chord) * (0.4 + 0.6 * r()))]);
  };
  const quarters = [0, 90, 180, 270].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 3));
  const windows: Window[] = quarters.map((at) => {
    const chord = rd(wall + 1 + 2 * r());
    if (r() < 0.5) {
      const draft = rd((r() < 0.2 ? 0 : 1) * (r() < 0.5 ? -1 : 1) * (0.3 + 2.7 * r()));
      return { kind: 'drafted', at, top: spline(rd(2 + 2 * r()), chord), draft };
    }
    const near = rd(radius - wall - 1.5 - 2 * r());
    return { kind: 'loft', at, first: spline(rd(2 + 1.5 * r()), chord), second: spline(rd(2 + 1.5 * r()), chord), chord, near, far: rd(radius + 2 + 2 * r()), tilt: rd((r() < 0.5 ? -1 : 1) * 30 * r()) };
  });
  return { r: radius, wall, height, windows };
}

/**
 * Seeds `from`–`to`, each its own case: rebuilt as the same solid (to the recognition tolerance), or refused for a reason recognition gives; a trap or
 * any other error fails it. A part the kernel will not make is skipped and counted. At the end at least one case was rebuilt.
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
        shape = cupWithWindows(kernel, p);
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
        console.log(`#${seed} rebuilt (${p.windows.length} windows)`);
      } catch (e) {
        if (!(e instanceof RecognizeError)) throw e;
        console.log(`#${seed} refused (${p.windows.length} windows): ${e.message.slice(0, 120)}`);
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
