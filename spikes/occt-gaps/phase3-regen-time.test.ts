// Phase 3a-0 item 3: how long does a full rebuild take as the feature count grows? (B3.x needs a number, not a guess)
// Run: npx vitest run --config spikes/occt-gaps/vitest.config.ts
import { beforeAll, describe, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { PlaneGcsSolver } from '@3db/sketch';
import { build, circle, extrude, face, fillet, edge, front, rectangle, sketch } from '../../tests/phase1/builders';
import type { Feature } from '@3db/model';

let regen: Regenerator;
beforeAll(async () => {
  regen = new Regenerator(await Kernel.load(), await PlaneGcsSolver.create());
});

/** plate + n × (sketch on the top face → blind cut). 2n+2 features. */
function plateWithHoles(n: number, withFillets = false) {
  const features: Feature[] = [sketch('s0', front, rectangle('a', 0, 0, 400, 300)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '20' })];
  const cols = 10;
  for (let i = 0; i < n; i++) {
    const x = 20 + (i % cols) * 38, y = 20 + Math.floor(i / cols) * 38;
    features.push(sketch(`s${i + 1}`, face('e0:cap:end'), circle(`k${i}`, x, y, 6)));
    features.push(extrude(`c${i + 1}`, `s${i + 1}`, 'cut', { type: 'blind', depth: '10' }));
  }
  if (withFillets) features.push(fillet('f1', [edge('{e0:cap:end|e0:side:s0.al0}')], '2'));
  return build(...features);
}

const time = (fn: () => void) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe('regen time', () => {
  for (const n of [5, 12, 25, 49]) {
    it(`${2 * n + 2} features`, () => {
      const doc = plateWithHoles(n);
      regen.rebuild(doc); // warm up
      const runs = [0, 1, 2].map(() => time(() => regen.rebuild(doc)));
      const r = regen.rebuild(doc);
      const bad = r.features.filter((f) => f.status !== 'ok');
      const slowest = [...r.features].sort((a, b) => b.ms - a.ms).slice(0, 3).map((f) => `${f.id} ${f.ms.toFixed(0)}ms`);
      console.log(`${doc.features.length} 個特徵：全部重算 ${runs.map((x) => x.toFixed(0)).join(' / ')} ms；非 ok ${bad.length}${bad.length ? ' ' + bad[0]!.id + ' ' + bad[0]!.message : ''}；最慢 ${slowest}`);
    });
  }
});
