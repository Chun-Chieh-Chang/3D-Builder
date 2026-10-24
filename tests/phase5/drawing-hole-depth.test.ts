/** Regressions found by external export acceptance: total depth starts at the mouth. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, elementFacts, holeFeatures, holeInfo } from '@3db/regen';
import type { Feature } from '@3db/model';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

let reg: Regenerator;
beforeAll(async () => { reg = new Regenerator(await Kernel.load(), await PlaneGcsSolver.create()); });
afterAll(() => reg.dispose());

it.each([
  { kind: 'counterbore', diameter: '9', depth: 15, mouth: { cbDiameter: '15', cbDepth: '8' } },
  { kind: 'countersink', diameter: '6', depth: 12, mouth: { csDiameter: '12', csAngle: '90deg' } },
])('$kind: includes the mouth in the model-derived blind depth', ({ kind, diameter, depth, mouth }) => {
  const doc = build(
    sketch('s1', front, rectangle('r', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
    { ...sketch('s2', face('e1:cap:end')), entities: [{ id: 'p', type: 'point', x: 20, y: 15 }] } as Feature,
    { id: 'h1', name: 'h1', type: 'hole', suppressed: false, sketch: 's2', kind, diameter,
      end: { type: 'blind', depth: String(depth) }, ...mouth } as Feature,
  );
  const result = reg.rebuild(doc);
  expect(result.features.map(f => f.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
  const body = result.body!;
  const index = body.names.faces.indexOf('h1:side:s2.p.wall');
  expect(index).toBeGreaterThanOrEqual(0);
  // No feature input is passed to holeInfo: imported topology uses the same path.
  const info = holeInfo(body.topology, index);
  expect(info?.through).toBe(false);
  expect(info!.depth).toBeCloseTo(depth, 6);
  const facts = elementFacts(body.topology, body.names, face('h1:side:s2.p.wall'), holeFeatures(doc));
  if ('error' in facts) throw new Error(facts.error);
  expect(facts.hole?.depth).toBeCloseTo(depth, 6);
  if (kind === 'counterbore') expect(info!.counterbore).toMatchObject({ diameter: 15, depth: 8 });
  else expect(info!.countersink!.angle).toBeCloseTo(90, 6);
});
