/**
 * Hardening H-5: parts made at random with the other features of a part — the hole wizard (straight, counterbore, countersink), chamfers, a face moved, draft, shell — on a block or a
 * cylinder: a feature works or says why it cannot; what is made is valid with its faces named once each; the same part rebuilt, read back, sent out as STEP and read in again, and with
 * a feature suppressed and brought back, is the same part.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPartFile, writePartFile } from '@3db/io';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { circle, extrude, front, rectangle, sketch } from '../phase1/builders';
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
  const block = r.next() < 0.7;
  const L = r.round(r.between(40, 120), 5);
  const W = block ? r.round(r.between(40, 90), 5) : L;
  const H = r.round(r.between(15, 50), 5);
  const features: Feature[] = [block ? sketch('s', front, rectangle('r', -L / 2, -W / 2, L, W)) : sketch('s', front, circle('c0', 0, 0, L / 2)), extrude('e', 's', 'boss', { type: 'blind', depth: String(H) })];
  const parts = [block ? `block ${L} × ${W} × ${H}` : `cylinder Ø${L} × ${H}`];
  const movable: string[] = [];
  const edge = (a: string, b: string): Ref => ({ kind: 'edge', name: `{${[a, b].sort().join('|')}}` });
  if (block && r.next() < 0.5) {
    const side = r.pick(['rl0', 'rl1', 'rl2', 'rl3']);
    features.push({ id: 'mv', type: 'moveFace', name: 'mv', suppressed: false, face: face(`e:side:s.${side}`), distance: String(r.round(r.between(-4, 6), 0.5) || 1) } as Feature);
    parts.push(`move ${side}`);
    movable.push('mv');
  }
  if (block && r.next() < 0.5) {
    features.push({ id: 'ch', type: 'chamfer', name: 'ch', suppressed: false, edges: ['rl0', 'rl1', 'rl2', 'rl3'].map((s) => edge('e:cap:end', `e:side:s.${s}`)), mode: 'angleDistance', distance: String(r.round(r.between(0.5, 3), 0.5)), second: '45deg' } as Feature);
    parts.push('chamfer');
    movable.push('ch');
  }
  if (r.next() < 0.5) {
    features.push({ id: 'sh', type: 'shell', name: 'sh', suppressed: false, faces: [face('e:cap:end')], thickness: String(r.round(r.between(1.2, 4), 0.1)) } as Feature);
    parts.push('shell');
    movable.push('sh');
  }
  const holes = r.pick([0, 1, 2, 3]);
  if (holes > 0) {
    const room = Math.min(L, W) / 2 - 14;
    const pts = Array.from({ length: holes }, () => [r.round(r.between(-room, room), 1), r.round(r.between(-room, room), 1)] as const).filter((p, i, all) => all.slice(0, i).every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 14));
    features.push({ ...sketch('sk', face('e:cap:end')), entities: pts.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y })) } as Feature);
    const kind = r.pick(['straight', 'counterbore', 'countersink'] as const);
    const diameter = r.round(r.between(2, 6), 0.5);
    features.push({
      id: 'hl',
      type: 'hole',
      name: 'hl',
      suppressed: false,
      sketch: 'sk',
      kind,
      diameter: String(diameter),
      end: r.next() < 0.5 ? { type: 'throughAll' } : { type: 'blind', depth: String(r.round(r.between(4, H), 0.5)) },
      ...(kind === 'counterbore' ? { cbDiameter: String(diameter * 1.8), cbDepth: String(r.round(r.between(1.5, 3), 0.5)) } : {}),
      ...(kind === 'countersink' ? { csDiameter: String(diameter * 1.8), csAngle: '90deg' } : {}),
    } as Feature);
    parts.push(`${pts.length} ${kind} holes`);
    movable.push('hl');
  }
  return { features, why: `features seed ${seed}: ${parts.join(', ')}`, movable };
}

const SEEDS = Array.from({ length: 48 }, (_, i) => 4000 + i * 7);
const stats = { ok: 0, said: 0 };

describe('parts with the other features made at random', () => {
  it.each(SEEDS)('seed %i: whole or said, the same rebuilt, read back, through STEP and with a feature suppressed and brought back', async (seed) => {
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
    expect(kernel.solidCount(shape), why).toBe(1);
    const names = r.body!.names.faces;
    expect(names.filter((n, i) => names.indexOf(n) !== i), `${why}: names`).toEqual([]);
    const volume = kernel.massProps(shape).volume;
    expect(volume, why).toBeGreaterThan(0);
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

    if (movable.length > 0) {
      const id = movable[seed % movable.length]!;
      let d = build(features);
      d = applyCommand(d, { type: 'setSuppressed', featureIds: [id], value: true });
      expect(rebuild(d).features.find((f) => f.id === id)!.status, `${why}: ${id} suppressed`).toBe('suppressed');
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
