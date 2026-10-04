/**
 * Hardening H-5: solids made at random with the features that make a shape from a profile — loft, sweep, revolve, a cut — against the volume worked out by hand (the loft by the
 * prismatoid formula, the cone frustum, the sweep and the revolve by Pappus), and for what has to be true of any part: made or said, valid, every name once, the same rebuilt, read back,
 * sent out as STEP and read in again, and with its last feature suppressed and brought back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPartFile, writePartFile } from '@3db/io';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type SketchEntity } from '@3db/model';
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

const right = { kind: 'datum', name: 'plane:right' } as const;
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string, extra: object = {}): SketchEntity => ({ id, type: 'line', p1, p2, ...extra }) as SketchEntity;
const parts = (...entities: SketchEntity[]) => ({ entities, constraints: [] });
const centred = (id: string, w: number, h: number) => rectangle(id, -w / 2, -h / 2, w, h);

interface Case {
  features: Feature[];
  why: string;
  /** The volume worked out by hand, when there is a formula for it. */
  volume?: number;
}

function generate(seed: number): Case {
  const r = rng(seed);
  const family = r.pick(['loft', 'loftCircle', 'sweep', 'revolve', 'cut', 'loft3', 'sweepTight', 'loftMixed']);
  if (family === 'loft' || family === 'loftCircle') {
    const h = r.round(r.between(8, 40), 1);
    const plane = { id: 'pl', type: 'refPlane', name: 'pl', suppressed: false, def: { mode: 'offset', plane: front, distance: String(h) } } as Feature;
    const on = { kind: 'datum', name: 'pl' } as const;
    const features = (a: ReturnType<typeof rectangle>, b: ReturnType<typeof rectangle>): Feature[] => [plane, sketch('s1', front, a), sketch('s2', on, b), { id: 'lf', type: 'loft', name: 'lf', suppressed: false, sections: ['s1', 's2'], op: 'boss' } as Feature];
    if (family === 'loft') {
      const [a1, b1, a2, b2] = [r.round(r.between(6, 30), 1), r.round(r.between(6, 30), 1), r.round(r.between(6, 30), 1), r.round(r.between(6, 30), 1)];
      // two rectangles joined by straight lines: a prismatoid, h/6 (A1 + 4 Am + A2) with the middle section the mean rectangle
      const volume = (h / 6) * (a1 * b1 + 4 * ((a1 + a2) / 2) * ((b1 + b2) / 2) + a2 * b2);
      return { features: features(centred('a', a1, b1), centred('b', a2, b2)), why: `loft seed ${seed}: ${a1} × ${b1} to ${a2} × ${b2} over ${h}`, volume };
    }
    const [R, rr] = [r.round(r.between(3, 20), 0.5), r.round(r.between(2, 20), 0.5)];
    return { features: features(circle('a', 0, 0, R) as never, circle('b', 0, 0, rr) as never), why: `cone seed ${seed}: R ${R} to ${rr} over ${h}`, volume: ((Math.PI * h) / 3) * (R * R + R * rr + rr * rr) };
  }
  if (family === 'loft3') {
    const z = [r.round(r.between(8, 20), 1), r.round(r.between(8, 20), 1)];
    const planes = z.map((d, i) => ({ id: `pl${i}`, type: 'refPlane', name: `pl${i}`, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z.slice(0, i + 1).reduce((a, b) => a + b, 0)) } }) as Feature);
    const sizes = [0, 1, 2].map(() => r.round(r.between(6, 25), 1));
    return {
      features: [...planes, sketch('s0', front, centred('a0', sizes[0]!, sizes[0]!)), sketch('s1', { kind: 'datum', name: 'pl0' }, centred('a1', sizes[1]!, sizes[1]!)), sketch('s2', { kind: 'datum', name: 'pl1' }, centred('a2', sizes[2]!, sizes[2]!)), { id: 'lf', type: 'loft', name: 'lf', suppressed: false, sections: ['s0', 's1', 's2'], op: 'boss' } as Feature],
      why: `loft of three seed ${seed}: sides ${sizes.join(', ')} at ${z.join(', ')}`,
    };
  }
  if (family === 'sweepTight') {
    // a bend that may be tighter than the profile is wide: the sweep can pass through itself
    const [w, hh] = [r.round(r.between(4, 14), 0.5), r.round(r.between(4, 14), 0.5)];
    const L1 = r.round(r.between(10, 30), 1);
    const R = r.round(r.between(0.5, Math.max(w, hh)), 0.5);
    const path = parts(point('a', 0, 0), point('b', L1, 0), point('c', L1, R), point('d', L1 + R, R), point('e', L1 + R, R + 15), line('l1', 'a', 'b'), { id: 'r1', type: 'arc', center: 'c', start: 'b', end: 'd' } as SketchEntity, line('l2', 'd', 'e'));
    return { features: [sketch('sp', right, centred('r', w, hh)), sketch('sq', front, path), { id: 'sw', type: 'sweep', name: 'sw', suppressed: false, sketch: 'sp', path: 'sq', op: 'boss' } as Feature], why: `tight sweep seed ${seed}: ${w} × ${hh} round a bend of R${R}` };
  }
  if (family === 'loftMixed') {
    // a rectangle, a circle and a rectangle off to one side
    const plane = (id: string, z: number) => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z) } }) as Feature;
    const z1 = r.round(r.between(8, 25), 1);
    const z2 = z1 + r.round(r.between(8, 25), 1);
    const [a, b, c] = [r.round(r.between(8, 24), 1), r.round(r.between(3, 12), 0.5), r.round(r.between(6, 20), 1)];
    const off = r.round(r.between(-10, 10), 1);
    return {
      features: [plane('p1', z1), plane('p2', z2), sketch('s0', front, centred('a0', a, a)), sketch('s1', { kind: 'datum', name: 'p1' }, circle('c1', 0, 0, b) as never), sketch('s2', { kind: 'datum', name: 'p2' }, rectangle('a2', off - c / 2, -c / 2, c, c)), { id: 'lf', type: 'loft', name: 'lf', suppressed: false, sections: ['s0', 's1', 's2'], op: 'boss' } as Feature],
      why: `mixed loft seed ${seed}: square ${a}, circle R${b} at ${z1}, square ${c} shifted ${off} at ${z2}`,
    };
  }
  if (family === 'sweep') {
    const [w, hh] = [r.round(r.between(2, 8), 0.5), r.round(r.between(2, 8), 0.5)];
    const L1 = r.round(r.between(10, 50), 1);
    const R = r.round(r.between(Math.max(w, hh) / 2 + 3, 25), 0.5);
    const L2 = r.round(r.between(5, 40), 1);
    const bent = r.next() < 0.6;
    const path = bent
      ? parts(point('a', 0, 0), point('b', L1, 0), point('c', L1, R), point('d', L1 + R, R), point('e', L1 + R, R + L2), line('l1', 'a', 'b'), { id: 'r1', type: 'arc', center: 'c', start: 'b', end: 'd' } as SketchEntity, line('l2', 'd', 'e'))
      : parts(point('a', 0, 0), point('b', L1, 0), line('l', 'a', 'b'));
    const length = bent ? L1 + (Math.PI * R) / 2 + L2 : L1;
    return {
      features: [sketch('sp', right, centred('r', w, hh)), sketch('sq', front, path), { id: 'sw', type: 'sweep', name: 'sw', suppressed: false, sketch: 'sp', path: 'sq', op: 'boss' } as Feature],
      why: `sweep seed ${seed}: ${w} × ${hh} along ${bent ? `${L1} + quarter R${R} + ${L2}` : L1}`,
      volume: w * hh * length,
    };
  }
  if (family === 'revolve') {
    const [r1, r2] = [r.round(r.between(0, 15), 0.5), 0];
    const outer = r1 + r.round(r.between(3, 20), 0.5);
    const h = r.round(r.between(5, 40), 1);
    const angle = r.pick([360, 360, 270, 180, 90]);
    void r2;
    const profile = rectangle('p', r1, 0, outer - r1, h);
    const sk = { ...sketch('s1', front, profile), entities: [...profile.entities, point('ax1', 0, 0), point('ax2', 0, h), line('axis', 'ax1', 'ax2', { construction: true })] } as Feature;
    const op = r.next() < 0.3 && r1 > 0 ? 'boss' : 'boss';
    return {
      features: [sk, { id: 'rv', type: 'revolve', name: 'rv', suppressed: false, sketch: 's1', axis: 'axis', op, dir1: { type: 'blind', angle: String(angle) } } as Feature],
      why: `revolve seed ${seed}: from ${r1} to ${outer}, ${h} high, ${angle}°`,
      volume: ((outer * outer - r1 * r1) / 2) * h * ((angle * Math.PI) / 180),
    };
  }
  // a block with a blind cut from the top
  const [L, W, H] = [r.round(r.between(40, 100), 5), r.round(r.between(40, 80), 5), r.round(r.between(10, 40), 5)];
  const room = Math.min(L, W) / 2 - 12;
  const [w, d] = [r.round(r.between(4, room), 0.5), r.round(r.between(4, room), 0.5)];
  const depth = r.round(r.between(1, H + 5), 0.5);
  return {
    features: [sketch('s', front, rectangle('r', -L / 2, -W / 2, L, W)), extrude('e', 's', 'boss', { type: 'blind', depth: String(H) }), sketch('sc', { kind: 'face', name: 'e:cap:end' }, centred('c', w, d)), extrude('c', 'sc', 'cut', { type: 'blind', depth: String(depth) })],
    why: `cut seed ${seed}: ${w} × ${d} ${depth} deep in ${L} × ${W} × ${H}`,
    volume: L * W * H - w * d * Math.min(depth, H),
  };
}

const SEEDS = Array.from({ length: 72 }, (_, i) => 6000 + i * 5);
const stats = { ok: 0, said: 0, hand: 0 };

describe('solids made at random from profiles', () => {
  it.each(SEEDS)('seed %i: the volume by hand where there is a formula, and whole, the same and through STEP', async (seed) => {
    const { features, why, volume: hand } = generate(seed);
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
    if (hand !== undefined) {
      stats.hand++;
      expect(Math.abs(volume - hand) / hand, `${why}: ${volume} against ${hand}`).toBeLessThan(2e-5);
    }
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
    // the last feature suppressed and brought back
    const last = features[features.length - 1]!.id;
    let d = applyCommand(build(features), { type: 'setSuppressed', featureIds: [last], value: true });
    expect(rebuild(d).features.find((f) => f.id === last)!.status, `${why}: ${last} suppressed`).toBe('suppressed');
    d = applyCommand(d, { type: 'setSuppressed', featureIds: [last], value: false });
    const on = rebuild(d);
    expect(on.body!.names.faces.slice().sort(), `${why}: ${last} back`).toEqual(sorted);
  }, 120000);

  it('most of them were made, and most of those against a formula', () => {
    expect(stats.ok + stats.said).toBe(SEEDS.length);
    expect(stats.ok).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.7));
    expect(stats.hand).toBeGreaterThan(20);
  });
});
