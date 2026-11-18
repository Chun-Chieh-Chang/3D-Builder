/**
 * ADR 0259 slice 1: a cup (a body of revolution about y) with a window through its wall at +z, cut by an extrusion along z of an outline that is a spline
 * over a straight chord, drafted. The truth is the body made here. `fuzzFile` runs random cases (AGENTS §3.4), each its own `it`.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { isTrap, Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';

const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;

export interface Cup {
  /** The spline over the chord, in the plane z = 10, from one end of the chord to the other. */
  top: number[][];
  /** Degrees; + narrows along +z. */
  draft: number;
  /** Outer radius and wall (the floor is as thick as the wall), height. */
  r: number;
  wall: number;
  height: number;
}

/** The part. Throws `KernelError` when the kernel refuses it (a draft that closes the outline). */
export function cupWithWindow(kernel: Kernel, p: Cup): ShapeId {
  const made: ShapeId[] = [];
  try {
    const prof = [[0, 0], [p.r, 0], [p.r, p.height], [p.r - p.wall, p.height], [p.r - p.wall, p.wall], [0, p.wall]];
    const cup = kernel.revolve(XY as never, [{ outer: prof.map((a, i) => L(a, prof[(i + 1) % prof.length]!, 'p' + i)), holes: [] }] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape;
    made.push(cup);
    const a = p.top[0]!;
    const b = p.top[p.top.length - 1]!;
    const reg = { outer: [{ kind: 'spline', points: p.top, source: 's' }, L(b, a, 'c')], holes: [] };
    const tool = kernel.extrude({ ...XY, origin: [0, 0, 10] } as never, [reg] as never, [0, 0, p.r + 4 - 10], 0, undefined, (p.draft * Math.PI) / 180).shape;
    made.push(tool);
    return kernel.boolean('cut', cup, tool).shape;
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

/** A random cup and window: the window narrower than the wall lets through at any height, its chord above the floor and its top below the rim. */
export function sample(seed: number): Cup {
  const r = rng(seed * 104729);
  const rd = (v: number) => Math.round(v * 1000) / 1000;
  const radius = rd(14 + 8 * r());
  const wall = rd(0.8 + 1.2 * r());
  const height = rd(14 + 8 * r());
  // half-width: inside where the inner and outer cylinders both cross the window's planes
  const half = rd(2 + 2 * r());
  const chord = rd(wall + 1 + 2 * r());
  const n = 3 + Math.floor(r() * 3);
  const peak = rd(Math.min(height - 2, chord + 4 + 6 * r()));
  const top = Array.from({ length: n }, (_, i) => {
    const x = rd(-half + (2 * half * i) / (n - 1));
    return [x, i === 0 || i === n - 1 ? chord : rd(chord + (peak - chord) * (0.4 + 0.6 * r()))];
  });
  const draft = rd((r() < 0.15 ? 0 : 1) * (r() < 0.5 ? -1 : 1) * (0.3 + 2.7 * r()));
  return { top, draft, r: radius, wall, height };
}

/**
 * Seeds `from`–`to`, each its own case. A case is either rebuilt as the same solid (to the recognition tolerance) or refused for a reason recognition gives
 * (`RecognizeError`); a trap or any other error fails it. A part the kernel will not make is skipped and counted. At the end: each kind of draft
 * (none, +, -) must have been rebuilt at least once, so that a rule that stopped working for one of them cannot hide behind the others (DEV_LOG 2026-11-02).
 */
export function fuzzFile(from: number, to: number) {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  const outcomes: string[] = [];
  const rebuilt = { none: 0, plus: 0, minus: 0 };
  it('load', async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
    expect((kernel.oc as unknown as { wasmMemory: { buffer: ArrayBuffer } }).wasmMemory.buffer.byteLength).toBeGreaterThan(0);
  });
  for (let seed = from; seed <= to; seed++) {
    it(`seed ${seed}`, async () => {
      const p = sample(seed);
      let shape: ShapeId;
      try {
        shape = cupWithWindow(kernel, p);
      } catch (e) {
        if (e instanceof KernelError && !isTrap(e)) {
          outcomes.push(`#${seed} not made: ${e.message.slice(0, 40)}`);
          return;
        }
        throw e;
      }
      try {
        const r = await recognizeStep(kernel, solver, shape);
        expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
        expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
        expect(r.doc.features.filter((f) => f.type === 'revolve')).toHaveLength(1);
        rebuilt[p.draft === 0 ? 'none' : p.draft > 0 ? 'plus' : 'minus']++;
        outcomes.push(`#${seed} rebuilt`);
      } catch (e) {
        if (e instanceof RecognizeError) {
          outcomes.push(`#${seed} refused: ${e.message.slice(0, 50)}`);
          return;
        }
        throw e;
      } finally {
        kernel.release(shape);
      }
    }, 300_000);
  }
  it('every kind of draft rebuilt at least once', () => {
    const heap = (kernel.oc as unknown as { wasmMemory: { buffer: ArrayBuffer } }).wasmMemory.buffer.byteLength / 2 ** 20;
    console.log(`seeds ${from}-${to}: ${JSON.stringify(rebuilt)}, heap ${heap.toFixed(0)} MiB\n${outcomes.join('\n')}`);
    expect(rebuilt.none).toBeGreaterThan(0);
    expect(rebuilt.plus).toBeGreaterThan(0);
    expect(rebuilt.minus).toBeGreaterThan(0);
  });
}
