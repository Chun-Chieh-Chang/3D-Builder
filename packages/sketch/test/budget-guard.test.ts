import { describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, resolveSketch, SKETCH_ORIGIN } from '@3db/model';
import { PlaneGcsSolver } from '../src/planegcs';

describe('budget guards (C2)', () => {
  it('skips entity analysis above the analyze budget, without failing the solve', async () => {
    const solver = await PlaneGcsSolver.create();
    const sketch = { id: 's', type: 'sketch' as const, name: 's', suppressed: false, plane: { kind: 'datum' as const, name: 'plane:front' }, entities: [] as any[], constraints: [] as any[] };
    // 350 fixed points: well above ANALYZE_BUDGET (300), below SOLVE_BUDGET (1000)
    for (let i = 0; i < 350; i++) {
      sketch.entities.push({ id: `p${i}`, type: 'point', x: i % 50, y: Math.floor(i / 50) });
      sketch.constraints.push({ id: `f${i}`, type: 'fix', point: `p${i}` });
    }
    const doc = applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature: sketch });
    const f = (doc.features[0] as any);
    const r = solver.solve(resolveSketch(f, doc), { analyze: true });
    expect(r.status).toBe('fully');
    // analyze was skipped to avoid the per-point probe explosion: no entityStatus/entityFreedom
    expect((r as any).entityStatus).toBeUndefined();
    expect((r as any).entityFreedom).toBeUndefined();
  }, 60000);

  it('refuses to solve above the solve budget, with a message instead of an OOM', async () => {
    const solver = await PlaneGcsSolver.create();
    const sketch = { id: 's', type: 'sketch' as const, name: 's', suppressed: false, plane: { kind: 'datum' as const, name: 'plane:front' }, entities: [] as any[], constraints: [] as any[] };
    for (let i = 0; i < 1001; i++) {
      sketch.entities.push({ id: `p${i}`, type: 'point', x: i % 50, y: Math.floor(i / 50) });
      sketch.constraints.push({ id: `f${i}`, type: 'fix', point: `p${i}` });
    }
    const doc = applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature: sketch });
    const f = (doc.features[0] as any);
    const r = solver.solve(resolveSketch(f, doc), { analyze: true });
    expect(r.status).toBe('failed');
    expect(r.message).toContain('拘束過多');
  }, 60000);
});
