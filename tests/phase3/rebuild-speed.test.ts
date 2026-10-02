/**
 * Phase 3a-9a (B3.2, B3.4): is a rebuild fast enough without a cache of feature results? ADR 0017 left this open until the fillets, shells, sweeps and so on
 * existed; this is the measure it asked for: a part of 53 features with 17 bosses and 17 fillets rebuilt from nothing. The budget of the blueprint (§4) is 2 s for
 * 50 features; the test allows 3 s because the whole suite runs at once (ADR 0040).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, face, fillet, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

describe('rebuild speed', () => {
  it('53 features, 17 of them fillets, rebuild in the time of the budget, every one of them fine', () => {
    const features: Feature[] = [sketch('s0', front, rectangle('p', 0, 0, 300, 100)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '10' })];
    for (let i = 1; i <= 17; i++) {
      features.push(sketch(`s${i}`, face('e0:cap:end'), circle(`k${i}`, 10 + i * 16, 50, 4)), extrude(`e${i}`, `s${i}`, 'boss', { type: 'blind', depth: '8' }));
      features.push(fillet(`f${i}`, [{ kind: 'edge', name: `{e${i}:cap:end|e${i}:side:s${i}.k${i}}` }], '1'));
    }
    const doc = build(...features);
    expect(doc.features).toHaveLength(53);
    const t0 = process.cpuUsage();
    const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
    const used = process.cpuUsage(t0);
    const ms = (used.user + used.system) / 1000;
    expect(r.features.filter((f) => f.status !== 'ok')).toEqual([]);
    expect(ms).toBeLessThan(2000);
  });
});
