/**
 * A fixture's master model and what the tests of derived bodies (4a) do with it. The master has three bodies, apart: the workpiece (a reference
 * body, 100 × 60 × 20), the base plate (120 × 80 × 15) and a clamp (30 × 20 × 10) — volumes known by hand.
 */
import { applyCommand, type Feature, type PartDoc } from '@3db/model';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';

const own = (e: Feature): Feature => ({ ...e, merge: false }) as Feature;

/** A fixture's master model: the workpiece (a reference body, 100 × 60 × 20), the base plate (120 × 80 × 15) and a clamp (30 × 20 × 10), apart. */
export function master(baseDepth = '15'): PartDoc {
  let doc = build(
    sketch('sw', front, rectangle('a', 0, 0, 100, 60)),
    own(extrude('ew', 'sw', 'boss', { type: 'blind', depth: '20' })),
    sketch('sb', front, rectangle('b', -10, -100, 120, 80)),
    own(extrude('eb', 'sb', 'boss', { type: 'blind', depth: baseDepth })),
    sketch('sc', front, rectangle('c', 0, 80, 30, 20)),
    own(extrude('ec', 'sc', 'boss', { type: 'blind', depth: '10' })),
  );
  doc = applyCommand(doc, { type: 'setBody', bodyId: 'ew', name: '工件', reference: true });
  doc = applyCommand(doc, { type: 'setBody', bodyId: 'eb', name: '基板' });
  return doc;
}

