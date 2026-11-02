import { expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, elementFacts } from '@3db/regen';
import { build, sketch, circle, front } from '../phase1/builders';

it('derives the real planar setback for 100 tapered OCCT solids', async () => {
 const kernel = await Kernel.load();
 const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
 try {
  for (let i = 0; i < 100; i++) {
   const height = 8 + (i * 37 % 100) / 10;
   const radius = 4 + (i * 19 % 40) / 10;
   const slope = (i % 2 ? -1 : 1) * (0.02 + (i * 13 % 18) / 100);
   const d = 0.2 + (i * 7 % 30) / 100;
   const plane = { id: 'p', name: 'p', type: 'refPlane', suppressed: false, def: { mode: 'offset', plane: front, distance: String(height) } } as const;
   const loft = { id: 'loft', name: 'loft', type: 'loft', suppressed: false, op: 'boss', sections: ['s1', 's2'] } as const;
   const doc = build(sketch('s1', front, circle('a', 0, 0, radius)), plane, sketch('s2', { kind: 'datum', name: 'p' }, circle('b', 0, 0, radius + height * slope)), { ...loft, sections: [...loft.sections] });
   const base = regen.rebuild(doc), body = base.body!;
   const edge = body.topology.edges.findIndex(e => e.geometry?.type === 'circle' && Math.abs(e.geometry.center[2]) < 1e-7);
   expect(edge).toBeGreaterThanOrEqual(0);
   const feature = { id: 'ch', name: 'ch', type: 'chamfer', suppressed: false, edges: [{ kind: 'edge', name: body.names.edges[edge]! }], mode: 'angleDistance', distance: String(d), second: '45' } as const;
   const result = regen.rebuild({ ...doc, features: [...doc.features, { ...feature, edges: [...feature.edges] }] });
   expect(result.features.filter(f => f.status === 'error'), `case ${i}`).toEqual([]);
   const b = result.body!, name = b.names.faces.find(n => n.startsWith('ch:chamfer:'));
   expect(name).toBeDefined();
   const facts = elementFacts(b.topology, b.names, { kind: 'face', name: name! });
   if ('error' in facts) throw new Error(facts.error);
   expect(facts.chamferSetback, `case ${i}`).toBeCloseTo(d, 7);
  }
 } finally { regen.dispose(); }
});
