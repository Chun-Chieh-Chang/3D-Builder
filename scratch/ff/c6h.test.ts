// Why the drafted cut "removes nothing": the same cut with and without a draft, either way, for the spline outline and a rectangle.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import type { Feature, PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import type { SketchConstraint, SketchEntity } from '@3db/model';
import { build, extrude, front, pin, rectangle, sketch, statuses } from '../../tests/phase1/builders';
function outline(id: string, dx = 0, dy = 0) {
  const at: Record<string, [number, number]> = { a: [0, 0], b: [28.72, 0], c: [28.72, 25], m: [14, 32], d: [0, 25] };
  const entities: SketchEntity[] = Object.entries(at).map(([k, [x, y]]) => ({ id: `${id}${k}`, type: 'point', x: x + dx, y: y + dy }));
  entities.push(
    { id: `${id}l0`, type: 'line', p1: `${id}a`, p2: `${id}b` },
    { id: `${id}l1`, type: 'line', p1: `${id}b`, p2: `${id}c` },
    { id: `${id}s`, type: 'spline', points: [`${id}c`, `${id}m`, `${id}d`], closed: false },
    { id: `${id}l2`, type: 'line', p1: `${id}d`, p2: `${id}a` },
  );
  const constraints: SketchConstraint[] = Object.entries(at).flatMap(([k, [x, y]]) => pin(`${id}${k}`, `${id}${k}`, x + dx, y + dy) ?? []);
  return { entities, constraints };
}

const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
it('c6h', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const plate = build(sketch('s0', front, rectangle('r', -10, -10, 50, 50)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '20' }));
  for (const shape of ['spline', 'rect'] as const) for (const reverse of [false, true]) for (const draft of [null, '2deg']) {
    const parts = shape === 'spline' ? outline('o') : rectangle('q', 0, 0, 20, 20);
    const cut = { ...extrude('e1', 's1', 'cut', { type: 'blind', depth: '10' }), ...(reverse ? { reverse: true } : {}), ...(draft ? { draft1: { angle: draft, inward: true } } : {}) } as unknown as Feature;
    const doc: PartDoc = { ...plate, features: [...plate.features, sketch('s1', front, parts), cut] };
    const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
    const v = r.bodies.reduce((a, b) => a + kernel.massProps(b.shape).volume, 0);
    log(`cut ${shape} reverse ${reverse} draft ${draft}: ${statuses(r).join(' ')} volume ${v.toFixed(3)}`);
  }
}, 300_000);
