/** Blueprint §4 budget: a 100-entity sketch solves a drag frame in < 16 ms. Prints the analysis cost too. */
import { beforeAll, expect, it } from 'vitest';
import type { SketchConstraint, SketchEntity, SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '../src/index';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

/** n rectangles in a row, each with horizontal/vertical relations and a width; heights left free. */
function rectangles(n: number): SketchFeature {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  for (let i = 0; i < n; i++) {
    const x = i * 30;
    const p = [0, 1, 2, 3].map((k) => `p${i}_${k}`);
    const corners: [number, number][] = [[x, 0], [x + 20, 0], [x + 20, 10], [x, 10]];
    p.forEach((id, k) => entities.push({ id, type: 'point', x: corners[k]![0], y: corners[k]![1] }));
    const l = [0, 1, 2, 3].map((k) => `l${i}_${k}`);
    l.forEach((id, k) => entities.push({ id, type: 'line', p1: p[k]!, p2: p[(k + 1) % 4]! }));
    constraints.push(
      { id: `h${i}a`, type: 'horizontal', a: l[0]! },
      { id: `h${i}b`, type: 'horizontal', a: l[2]! },
      { id: `v${i}a`, type: 'vertical', a: l[1]! },
      { id: `v${i}b`, type: 'vertical', a: l[3]! },
      { id: `w${i}`, type: 'distance', a: l[0]!, value: '20' },
      { id: `y${i}`, type: 'distanceY', a: '@origin', b: p[0]!, value: '1' },
    );
  }
  return { id: 's', type: 'sketch', name: 's', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities, constraints };
}

it('solves a 100-entity drag frame within the 16 ms budget', () => {
  const s = rectangles(13); // 52 points + 52 lines
  solver.solve(s); // warm-up
  const drag = (k: number) => solver.solve(s, { drag: { points: [{ id: 'p5_2', x: 170 + k, y: 12 + k }] } });
  const times = Array.from({ length: 10 }, (_, k) => {
    const t = performance.now();
    drag(k);
    return performance.now() - t;
  });
  const t = performance.now();
  const analyzed = solver.solve(s, { analyze: true });
  const analyzeMs = performance.now() - t;
  const median = times.sort((a, b) => a - b)[5]!;
  console.table({ 'entities': s.entities.length, 'drag frame, median (ms)': median.toFixed(2), 'solve + analyze (ms)': analyzeMs.toFixed(1) });
  expect(analyzed.entityStatus!.get('l0_1')).toBe('under');
  expect(median).toBeLessThan(16);
});
