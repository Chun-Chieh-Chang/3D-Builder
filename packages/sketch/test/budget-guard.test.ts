/**
 * The C2 ruling (2026-11-01): fewer equations at a time, and a budget that refuses before the solver runs out of memory. A first cut counted the
 * constraints of the whole sketch (over 300: no definition analysis; over 1000: refused), and refused sketches the solver solves exactly part by part;
 * the budget is now the size of one connected part (see solver-memory.test.ts), and these are the same two cases against it.
 */
import { describe, expect, it } from 'vitest';
import { t } from '@3db/i18n';
import { applyCommand, createEmptyPart, resolveSketch } from '@3db/model';
import { PlaneGcsSolver } from '../src/planegcs';
import { chain } from './large-sketch';

function fixedPoints(n: number) {
  const sketch = { id: 's', type: 'sketch' as const, name: 's', suppressed: false, plane: { kind: 'datum' as const, name: 'plane:front' }, entities: [] as any[], constraints: [] as any[] };
  for (let i = 0; i < n; i++) {
    sketch.entities.push({ id: `p${i}`, type: 'point', x: i % 50, y: Math.floor(i / 50) });
    sketch.constraints.push({ id: `f${i}`, type: 'fix', point: `p${i}` });
  }
  const doc = applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature: sketch });
  return resolveSketch(doc.features[0] as any, doc);
}

describe('budget guards (C2)', () => {
  it('350 fixed points: the definition of each one, every point a part of its own', async () => {
    const solver = await PlaneGcsSolver.create();
    const r = solver.solve(fixedPoints(350), { analyze: true });
    expect(r.status).toBe('fully');
    expect(r.entityStatus!.size).toBe(350);
    expect([...r.entityStatus!.values()].every((s) => s === 'fully')).toBe(true);
  }, 60000);

  it('1001 fixed points are solved; one connected part past the budget is refused with a message instead of an OOM', async () => {
    const solver = await PlaneGcsSolver.create();
    const many = solver.solve(fixedPoints(1001));
    expect(many.status).toBe('fully');
    expect(many.message).toBeUndefined();
    const r = solver.solve(chain(600));
    expect(r.status).toBe('failed');
    expect(r.message).toBe(t('regen.sketchTooLarge', { size: 1200 + 2 * 599 }));
    expect(r.geometry.size).toBe(600);
  }, 60000);
});
