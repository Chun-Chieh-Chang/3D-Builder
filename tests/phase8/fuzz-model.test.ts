/**
 * Hardening H-5: ordinary parts made at random (a block with fillets, bosses, a hole, a pattern of a boss, a mirror of it): a feature works or says why it cannot; what is made is valid
 * with its faces named once each; the same part rebuilt, or saved and read back, is the same part; and a feature suppressed and brought back changes nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPartFile, writePartFile } from '@3db/io';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { circle, extrude, fillet, front, rectangle, sketch } from '../phase1/builders';
import { viaStep } from '../support/viaStep';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
const face = (name: string): Ref => ({ kind: 'face', name });

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (lo: number, hi: number) => lo + (hi - lo) * next();
  const round = (v: number, step = 0.5) => Math.round(v / step) * step;
  return { next, between, round, pick: <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)]! };
}

function generate(seed: number): { features: Feature[]; why: string; movable: string[] } {
  const r = rng(seed);
  const L = r.round(r.between(60, 140), 5);
  const W = r.round(r.between(50, 110), 5);
  const H = r.round(r.between(15, 50), 5);
  const features: Feature[] = [sketch('s', front, rectangle('r', -L / 2, -W / 2, L, W)), extrude('e', 's', 'boss', { type: 'blind', depth: String(H) })];
  const parts = [`${L} × ${W} × ${H}`];
  const movable: string[] = [];
  const room = Math.min(L, W) / 2 - 22; // (the sketch axes of a face may be turned: a position this near the middle is on the face whichever way)
  if (r.next() < 0.5) {
    const radius = r.round(r.between(1, Math.min(L, W) / 6), 0.5);
    features.push(fillet('fl', [['rl0', 'rl1'], ['rl1', 'rl2'], ['rl2', 'rl3'], ['rl3', 'rl0']].map(([a, b]) => ({ kind: 'edge', name: `{e:side:s.${[a, b].sort().join('|e:side:s.')}}` }) as Ref), String(radius)));
    parts.push(`fillet ${radius}`);
    movable.push('fl');
  }
  if (r.next() < 0.8) {
    const x = r.round(r.between(-room, room), 1);
    const y = r.round(r.between(-room, room), 1);
    const w = r.round(r.between(6, 14), 1);
    const d = r.round(r.between(6, 14), 1);
    features.push(sketch('sb', face('e:cap:end'), rectangle('b', x, y, w, d)), extrude('eb', 'sb', 'boss', { type: 'blind', depth: String(r.round(r.between(3, 15), 0.5)) }));
    parts.push('boss');
    movable.push('eb');
    const how = r.pick(['none', 'pattern', 'mirror']);
    if (how === 'pattern') {
      features.push({ id: 'pat', type: 'pattern', name: 'pat', suppressed: false, seeds: ['eb'], def: { mode: 'linear', dir1: { ref: { kind: 'datum', name: 'plane:right' }, spacing: String(r.round(r.between(w + 3, 30), 1)), count: String(r.pick([2, 3, 4])) } } } as Feature);
      parts.push('pattern');
      movable.push('pat');
    } else if (how === 'mirror') {
      features.push({ id: 'mir', type: 'mirror', name: 'mir', suppressed: false, target: 'features', plane: { kind: 'datum', name: 'plane:right' }, seeds: ['eb'], bodies: [] } as Feature);
      parts.push('mirror');
      movable.push('mir');
    }
  }
  if (r.next() < 0.6) {
    features.push(sketch('sh', face('e:cap:end'), circle('c', r.round(r.between(-room, room), 1), r.round(r.between(-room, room), 1), r.round(r.between(1.5, 5), 0.5))), extrude('eh', 'sh', 'cut', { type: 'throughAll' }));
    parts.push('hole');
    movable.push('eh');
  }
  return { features, why: `model seed ${seed}: ${parts.join(', ')}`, movable };
}

const SEEDS = Array.from({ length: 40 }, (_, i) => 3000 + i * 9);
const stats = { ok: 0, said: 0 };

describe('ordinary parts made at random', () => {
  it.each(SEEDS)('seed %i: whole or said, the same when rebuilt, read back, and with a feature suppressed and brought back', async (seed) => {
    const { features, why, movable } = generate(seed);
    const r = rebuild(build(features));
    for (const f of r.features) {
      expect(['ok', 'error'], `${why}: ${f.id}`).toContain(f.status);
      if (f.status === 'error') expect((f.message ?? '').length, `${why}: ${f.id} says nothing`).toBeGreaterThan(0);
    }
    if (r.features.some((f) => f.status === 'error')) {
      stats.said++;
      return;
    }
    stats.ok++;
    const shape = r.body!.shape;
    expect(kernel.isValid(shape), `${why}: valid`).toBe(true);
    const names = r.body!.names.faces;
    expect(names.filter((n, i) => names.indexOf(n) !== i), `${why}: names`).toEqual([]);
    const volume = kernel.massProps(shape).volume;
    const sorted = names.slice().sort();

    const again = rebuild(build(features));
    expect(again.body!.names.faces.slice().sort(), `${why}: rebuilt`).toEqual(sorted);
    expect(kernel.massProps(again.body!.shape).volume, why).toBeCloseTo(volume, 6);
    const read = rebuild((await readPartFile(await writePartFile(build(features)))).doc);
    expect(read.features.every((f) => f.status === 'ok'), `${why}: read back`).toBe(true);
    expect(read.body!.names.faces.slice().sort(), `${why}: read back`).toEqual(sorted);

    const stepped = await viaStep(kernel, solver, shape, (g) => kept.push(g));
    expect(stepped.features[0]!.status, `${why}: STEP`).toBe('ok');
    expect(Math.abs(kernel.massProps(stepped.body!.shape).volume - volume) / volume, `${why}: STEP volume`).toBeLessThan(1e-5);
    expect(stepped.body!.topology.faces.length, `${why}: STEP faces`).toBe(r.body!.topology.faces.length);

    // a feature suppressed and brought back: the part is what it was
    if (movable.length > 0) {
      const id = movable[seed % movable.length]!;
      let d = build(features);
      d = applyCommand(d, { type: 'setSuppressed', featureIds: [id], value: true });
      const off = rebuild(d);
      expect(off.features.find((f) => f.id === id)!.status, `${why}: ${id} suppressed`).toBe('suppressed');
      d = applyCommand(d, { type: 'setSuppressed', featureIds: [id], value: false });
      const on = rebuild(d);
      expect(on.body!.names.faces.slice().sort(), `${why}: ${id} back`).toEqual(sorted);
      expect(kernel.massProps(on.body!.shape).volume, `${why}: ${id} back`).toBeCloseTo(volume, 6);
    }
  }, 120000);

  it('most of them were made, with a reason for the rest', () => {
    expect(stats.ok + stats.said).toBe(SEEDS.length);
    expect(stats.ok).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.6));
  });
});
