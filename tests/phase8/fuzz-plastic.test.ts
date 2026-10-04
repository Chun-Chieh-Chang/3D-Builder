/**
 * Hardening H-5: plastic housings made at random (a seeded generator), checked against what has to be true of any of them: a feature works or says why it cannot; what is made is one
 * valid solid with its faces named once each; the same part rebuilt, or saved and read back, is the same part; and the three analyses run on it and account for every face.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPartFile, writePartFile } from '@3db/io';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { extrude, front, rectangle, sketch } from '../phase1/builders';
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
const datum = (name: string): Ref => ({ kind: 'datum', name });

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

function generate(seed: number): { features: Feature[]; why: string } {
  const r = rng(seed);
  const L = r.round(r.between(50, 150), 5);
  const W = r.round(r.between(40, 100), 5);
  const H = r.round(r.between(20, 60), 5);
  const t = r.round(r.between(1.2, 3), 0.1);
  const floor = r.round(r.between(t, 4), 0.1);
  const draft = r.next() < 0.7 ? r.round(r.between(0.5, 3), 0.5) : 0;
  const features: Feature[] = [
    sketch('s', front, rectangle('r', -L / 2, -W / 2, L, W)),
    extrude('e', 's', 'boss', { type: 'blind', depth: String(H) }),
  ];
  if (draft > 0) features.push({ id: 'd1', type: 'draft', name: 'd1', suppressed: false, neutral: face('e:cap:end'), faces: ['rl0', 'rl1', 'rl2', 'rl3'].map((e) => face(`e:side:s.${e}`)), angle: `${draft}deg` } as Feature);
  features.push({ id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: [face('e:cap:end')], thickness: String(t), faceThickness: floor === t ? undefined : [{ face: face('e:cap:start'), thickness: String(floor) }] } as Feature);
  // the rim, found on the shell as it is made without anything else (the name is the same in the part with everything)
  const shelled = rebuild(build(features));
  let rim: string | null = null;
  if (shelled.features.every((f) => f.status === 'ok')) {
    const i = shelled.body!.topology.faces.findIndex((f) => f.normal && f.normal[2] > 0.99 && Math.abs(f.center[2] - H) < 1e-6);
    if (i >= 0) rim = shelled.body!.names.faces[i]!;
  }
  const parts: string[] = [`${L} × ${W} × ${H}`, `wall ${t}`, `floor ${floor}`, `draft ${draft}`];
  if (rim && r.next() < 0.6) {
    const offset = r.round(r.between(0.2, 0.5 * t), 0.1);
    const width = r.round(r.between(0.4, 0.8 * (t - offset)), 0.1) || 0.4;
    features.push({ id: 'lp', type: 'lipGroove', name: 'lp', suppressed: false, face: face(rim), kind: r.pick(['lip', 'groove']), offset: String(offset), width: String(width), height: String(r.round(r.between(0.5, 1.5), 0.1)) } as Feature);
    parts.push('lip');
  }
  const bosses = r.pick([0, 1, 2, 3]);
  if (bosses > 0) {
    features.push({ id: 'pf', type: 'refPlane', name: 'pf', suppressed: false, def: { mode: 'offset', plane: front, distance: String(floor) } } as Feature);
    const pts = Array.from({ length: bosses }, (_, i) => [r.round(r.between(-L / 2 + 14, L / 2 - 14), 1), r.round(r.between(-W / 2 + 14, W / 2 - 14), 1)] as const).filter((p, i, all) => all.slice(0, i).every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 18));
    features.push({ ...sketch('skb', datum('pf')), entities: pts.map(([x, y], i) => ({ id: `b${i}`, type: 'point', x, y })) } as Feature);
    const diameter = r.round(r.between(5, 8), 0.5);
    features.push({
      id: 'sb',
      type: 'screwBoss',
      name: 'sb',
      suppressed: false,
      sketch: 'skb',
      diameter: String(diameter),
      holeDiameter: String(r.round(r.between(1.8, diameter - 1.5), 0.1)),
      height: String(r.round(r.between(5, Math.max(6, H - floor - 5)), 0.5)),
      ...(r.next() < 0.5 ? { draft: `${r.pick([0.5, 1, 2])}deg` } : {}),
      ...(r.next() < 0.5 ? { holeDraft: `${r.pick([0.25, 0.5, 1])}deg` } : {}),
      ...(r.next() < 0.4 ? { ribs: { count: String(r.pick([3, 4])), thickness: '1', length: String(r.pick([2, 3])), height: '3' } } : {}),
    } as Feature);
    parts.push(`${pts.length} bosses`);
  }
  return { features, why: `plastic seed ${seed}: ${parts.join(', ')}` };
}

const SEEDS = Array.from({ length: 40 }, (_, i) => 2000 + i * 11);
const stats = { ok: 0, said: 0 };

describe('plastic parts made at random', () => {
  it.each(SEEDS)('seed %i: whole or said, the same when rebuilt and when read back, and the analyses account for every face', async (seed) => {
    const { features, why } = generate(seed);
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
    expect(kernel.solidCount(shape), why).toBe(1);
    expect(kernel.isValid(shape), `${why}: valid`).toBe(true);
    const names = r.body!.names.faces;
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup, `${why}: names`).toEqual([]);
    const volume = kernel.massProps(shape).volume;
    expect(volume, why).toBeGreaterThan(0);

    const again = rebuild(build(features));
    expect(again.body!.names.faces.slice().sort(), `${why}: rebuilt`).toEqual(names.slice().sort());
    expect(kernel.massProps(again.body!.shape).volume, why).toBeCloseTo(volume, 6);
    const read = rebuild((await readPartFile(await writePartFile(build(features)))).doc);
    expect(read.features.every((f) => f.status === 'ok'), `${why}: read back`).toBe(true);
    expect(read.body!.names.faces.slice().sort(), `${why}: read back`).toEqual(names.slice().sort());
    expect(kernel.massProps(read.body!.shape).volume, why).toBeCloseTo(volume, 6);

    const stepped = await viaStep(kernel, solver, shape, (g) => kept.push(g));
    expect(stepped.features[0]!.status, `${why}: STEP`).toBe('ok');
    expect(Math.abs(kernel.massProps(stepped.body!.shape).volume - volume) / volume, `${why}: STEP volume`).toBeLessThan(1e-5);
    expect(stepped.body!.topology.faces.length, `${why}: STEP faces`).toBe(r.body!.topology.faces.length);

    // the analyses: a verdict for every face, the areas of the classes adding up to the area of the part
    const area = r.body!.topology.faces.reduce((a, f) => a + f.area, 0);
    const draft = kernel.draftAnalysis(shape, [0, 0, 1], (1 * Math.PI) / 180);
    expect(draft.faces, why).toHaveLength(r.body!.topology.faces.length);
    expect(Object.values(draft.totals).reduce((a, x) => a + x.area, 0), `${why}: draft areas`).toBeCloseTo(area, 3);
    const undercut = kernel.undercutAnalysis(shape, [0, 0, 1]);
    expect(undercut.faces, why).toHaveLength(r.body!.topology.faces.length);
    expect(Object.values(undercut.totals).reduce((a, x) => a + x.area, 0), `${why}: undercut areas`).toBeCloseTo(area, 3);
    const thickness = kernel.thicknessAnalysis(shape, { min: 0.5, max: 5 });
    expect(thickness.faces, why).toHaveLength(r.body!.topology.faces.length);
  }, 120000);

  it('most of them were made, with a reason for the rest', () => {
    expect(stats.ok + stats.said).toBe(SEEDS.length);
    expect(stats.ok).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.6));
  });
});
