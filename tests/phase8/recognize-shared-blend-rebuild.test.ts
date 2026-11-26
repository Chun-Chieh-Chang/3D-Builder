/**
 * Recognition finds a round far from the ones placed since the last rebuild on that rebuild (`ReconstructOptions.shareBlendRebuilds`, `blendsApart`;
 * 2026-11-26). Before, every blend had a rebuild of all the features before it: window-rounds fuzz seed 54 (four rounded windows) grew the heap 979 MiB
 * and was stopped by the 512 MiB job budget, where a rebuild of the result alone took 137. Each case here is recognized both ways: the commands must be
 * the same, and the shared way must have made fewer rebuilds (the branch is taken).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyCommand, createEmptyPart } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { blendsApart, reconstructImported, RECOGNIZE_LIMITS, RECOGNIZE_TOLERANCE, Regenerator, type BlendRecord } from '@3db/regen';
import { cupWithRoundedWindows, sample } from './recognize-window-rounds.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
}, 60_000);

afterAll(() => vi.restoreAllMocks());

const circle = (cx: number, r: number): BlendRecord => ({ type: 'fillet', radius: r, edges: [{ kind: 'circle', center: [cx, 0, 0], normal: [0, 0, 1], radius: 2 }] });

describe('blendsApart', () => {
  // circles of radius 2 centred 10 apart: 6 between the edges, less the spacing of their 48 samples (2 × 2 sin(π/48) = 0.262 each): 5.477
  it('apart when the edges are further apart than twice what the two may reach (4 r each): r 0.25 needs 4', () => {
    expect(blendsApart(circle(0, 0.25), [circle(10, 0.25)])).toBe(true);
    expect(blendsApart(circle(0, 0.25), [])).toBe(true);
  });
  it('not apart when they are nearer: r 0.5 needs 8, and r 0.68 beside r 0.0 needs 5.44 + 0 (just apart) against 5.48', () => {
    expect(blendsApart(circle(0, 0.5), [circle(10, 0.5)])).toBe(false);
    expect(blendsApart(circle(0, 0.68), [circle(10, 0.0001)])).toBe(true);
    expect(blendsApart(circle(0, 0.69), [circle(10, 0.0001)])).toBe(false);
  });
  it('a chamfer reaches its larger distance, and one blend near any of the others is not apart', () => {
    const line = (x: number, d: number): BlendRecord => ({ type: 'chamfer', edges: [{ edge: { kind: 'line', origin: [x, 0, 0], dir: [0, 1, 0], ends: [[x, 0, 0], [x, 16, 0]] }, distances: [d / 2, d], supports: [{ type: 'plane', origin: [0, 0, 0], normal: [1, 0, 0] }, { type: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] }] as never }] });
    // lines 5 apart, spacing 1 each: 3 against 2 × 4 × 0.3 = 2.4 (apart), 2 × 4 × 0.4 = 3.2 (not)
    expect(blendsApart(line(0, 0.3), [line(5, 0)])).toBe(true);
    expect(blendsApart(line(0, 0.4), [line(5, 0)])).toBe(false);
    expect(blendsApart(line(0, 0.3), [line(50, 0), line(5, 0.1)])).toBe(false);
  });
});

/** A seed's part, from its first attempt the kernel makes. */
function part(seed: number): ShapeId {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { cup, R } = sample(seed, attempt);
    try { return cupWithRoundedWindows(kernel, cup, R); } catch (e) { if (!(e instanceof KernelError)) throw e; }
  }
  throw new Error(`seed ${seed}: no part`);
}

async function recognizeBoth(shape: ShapeId) {
  const bytes = new TextEncoder().encode(kernel.exportStep(shape, 'p'));
  const sha = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
  const spy = vi.spyOn(Regenerator.prototype, 'rebuild');
  const run = (share: boolean) => {
    const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
    spy.mockClear();
    try {
      // the way before has no budget of its own here: seed 54 is past 512 MiB that way, which is what this change is for
      const r = reconstructImported(kernel, regen, doc, 'imp1', solver, share ? RECOGNIZE_LIMITS : { ms: 600_000, heapGrowth: 3 * 2 ** 30 }, { shareBlendRebuilds: share });
      return { ...r, rebuilds: spy.mock.calls.length };
    } finally {
      regen.dispose();
    }
  };
  const shared = run(true);
  const each = run(false);
  spy.mockRestore();
  return { shared, each };
}

/** A 30 × 20 × 10 box with a round of 1 on the top edge at y = 0, and one of 0.5 on the top edge at y = 20 (far: 16.25 apart less the spacing, against 2 × 4 × 1.5 = 12) or at x = 0 (beside it, at the corner). */
function box(second: 'far' | 'beside'): ShapeId {
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;
  const p: [number, number][] = [[0, 0], [30, 0], [30, 20], [0, 20]];
  const body = kernel.extrude(XY as never, [{ outer: p.map((a, i) => ({ kind: 'line', a, b: p[(i + 1) % 4]!, source: `e${i}` })), holes: [] }] as never, [0, 0, 10]).shape;
  const edge = (s: ShapeId, at: (m: readonly number[]) => boolean) => kernel.topology(s).edges.flatMap((e, i) => (e.curve === 'line' && at(e.mid) ? [i] : []));
  const one = kernel.fillet(body, edge(body, (m) => Math.abs(m[2]! - 10) < 1e-6 && Math.abs(m[1]!) < 1e-6), 1).shape;
  kernel.release(body);
  const pick = second === 'far' ? (m: readonly number[]) => Math.abs(m[2]! - 10) < 1e-6 && Math.abs(m[1]! - 20) < 1e-6 : (m: readonly number[]) => Math.abs(m[2]! - 10) < 1e-6 && Math.abs(m[0]!) < 1e-6;
  const two = kernel.fillet(one, edge(one, pick), 0.5).shape;
  kernel.release(one);
  return two;
}

describe.each(['far', 'beside'] as const)('a box with rounds of 1 and 0.5, the second %s the first', (second) => {
  it(second === 'far' ? 'one rebuild fewer, the same commands' : 'the same rebuilds (they are not apart), the same commands', async () => {
    const shape = box(second);
    try {
      const { shared, each } = await recognizeBoth(shape);
      expect(shared.doc.features.filter((f) => f.type === 'fillet').length).toBe(2);
      expect(JSON.stringify(shared.commands)).toBe(JSON.stringify(each.commands));
      expect(shared.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(shared.rebuilds).toBe(second === 'far' ? each.rebuilds - 1 : each.rebuilds);
    } finally {
      kernel.release(shape);
    }
  }, 120_000);
});

describe.each([54, 88])('window-rounds fuzz seed %i, recognized with and without shared blend rebuilds', (seed) => {
  it('the same commands, the same solid, fewer rebuilds', async () => {
    const shape = part(seed);
    try {
      const { shared, each } = await recognizeBoth(shape);
      expect(shared.doc.features.filter((f) => f.type === 'fillet').length).toBeGreaterThan(1);
      expect(JSON.stringify(shared.commands)).toBe(JSON.stringify(each.commands));
      expect(shared.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(shared.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(shared.rebuilds).toBeLessThan(each.rebuilds);
      console.log(`seed ${seed}: rebuilds ${each.rebuilds} -> ${shared.rebuilds}`);
    } finally {
      kernel.release(shape);
    }
  }, 600_000);
});
