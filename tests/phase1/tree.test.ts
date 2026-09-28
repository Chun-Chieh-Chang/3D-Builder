/**
 * Phase 1D (handoff §9): FeatureManager operations — suppression with dependents (B2.6),
 * deleting with dependents (B2.8), warnings instead of silent guesses (D1.6), inserting at the
 * rollback bar (B2.4). Behaviour is checked on the rebuilt model, not only on the document.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, IdAllocator, idsInUse, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { deletion, Regenerator, suppressionTargets } from '@3db/regen';
import { build, circle, edge, extrude, face, fillet, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

/**
 * s1 → e1 plate; s2 on the plate's top → e2 boss; s3 on the boss's top → c1 hole through all;
 * f1 fillet on a boss edge. Parents: e1←s1, s2←e1, e2←s2, s3←e2, c1←s3, f1←e2.
 */
const part = (): PartDoc =>
  build(
    sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
    sketch('s2', face('e1:cap:end'), rectangle('b', 10, 10, 20, 10)),
    extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }),
    sketch('s3', face('e2:cap:end'), circle('k', 20, 15, 3)),
    extrude('c1', 's3', 'cut', { type: 'throughAll' }),
    fillet('f1', [edge('{e2:cap:end|e2:side:s2.bl0}')], '1'),
  );

const suppress = (doc: PartDoc, id: string, action: Parameters<typeof suppressionTargets>[2]) =>
  applyCommand(doc, { type: 'setSuppressed', featureIds: suppressionTargets(doc, id, action), value: action === 'suppress' });

describe('suppression with dependents (B2.6)', () => {
  it('suppresses a feature together with everything that depends on it', () => {
    const doc = part();
    expect(suppressionTargets(doc, 'e1', 'suppress')).toEqual(['e1', 's2', 'e2', 's3', 'c1', 'f1']);
    const r = regen.rebuild(suppress(doc, 'e1', 'suppress'));
    expect(statuses(r)).toEqual(['s1=ok', 'e1=suppressed', 's2=suppressed', 'e2=suppressed', 's3=suppressed', 'c1=suppressed', 'f1=suppressed']);
    expect(r.body).toBeNull(); // nothing left, and nothing reports an error
  });

  it('unsuppresses a feature with what it needs, and optionally with its dependents', () => {
    const suppressed = suppress(part(), 'e1', 'suppress');
    expect(suppressionTargets(suppressed, 'c1', 'unsuppress')).toEqual(['e1', 's2', 'e2', 's3', 'c1']); // not f1
    const partly = regen.rebuild(suppress(suppressed, 'c1', 'unsuppress'));
    expect(statuses(partly)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'e2=ok', 's3=ok', 'c1=ok', 'f1=suppressed']);
    const all = regen.rebuild(suppress(suppressed, 'e1', 'unsuppressWithDependents'));
    expect(all.features.every((f) => f.status === 'ok')).toBe(true);
  });

  it('is one undoable command', () => {
    const doc = part();
    const next = suppress(doc, 'e2', 'suppress');
    expect(next.features.filter((f) => f.suppressed).map((f) => f.id)).toEqual(['e2', 's3', 'c1', 'f1']);
  });
});

describe('deleting with dependents (B2.8)', () => {
  it('lists the children and the sketches the deletion would leave unused', () => {
    expect(deletion(part(), 'e2', { children: false, absorbed: false })).toEqual({ features: ['e2'], children: ['s3', 'c1', 'f1'], absorbed: ['s2'] });
    expect(deletion(part(), 'e2', { children: true, absorbed: true }).features).toEqual(['s2', 'e2', 's3', 'c1', 'f1']);
    expect(deletion(part(), 'e1', { children: false, absorbed: true }).features).toEqual(['s1', 'e1']);
  });

  it('keeps the children when asked to, and they report their missing references', () => {
    const doc = applyCommand(part(), { type: 'deleteFeatures', featureIds: ['e2'] });
    const r = regen.rebuild(doc);
    expect(r.features.map((f) => `${f.id}=${f.status}`)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 's3=error', 'c1=error', 'f1=error']);
    expect(r.features.find((f) => f.id === 's3')!.message).toContain('遺失參考');
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(40 * 30 * 10, 6);
  });

  it('deletes children and absorbed sketches, retires every id and keeps the rollback bar in place', () => {
    const rolled = applyCommand(part(), { type: 'setRollback', index: 6 }); // f1 rolled back
    const doc = applyCommand(rolled, { type: 'deleteFeatures', featureIds: deletion(rolled, 'c1', { children: true, absorbed: true }).features });
    expect(doc.features.map((f) => f.id)).toEqual(['s1', 'e1', 's2', 'e2', 'f1']);
    expect(doc.rollbackIndex).toBe(4); // still right above f1
    // the deleted sketch's contents keep their numbers: a new circle is not "k" reborn
    expect(new IdAllocator(doc.idCounters, idsInUse(doc)).take('c')).toBe('c2');
    expect(regen.rebuild(applyCommand(doc, { type: 'setRollback', index: null })).features.every((f) => f.status === 'ok')).toBe(true);
  });

  it('refuses to delete a feature that does not exist, changing nothing', () => {
    expect(() => applyCommand(part(), { type: 'deleteFeatures', featureIds: ['e1', 'nope'] })).toThrow('找不到特徵');
  });
});

describe('warnings instead of silent guesses (D1.6)', () => {
  /** A 60 × 40 × 10 plate cut through by a slot at x = 20 … 26, so its top face is split in two. */
  const slotted = (fp?: Parameters<typeof edge>[1]) =>
    build(
      sketch('s1', front, rectangle('a', 0, 0, 60, 40)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      sketch('s2', face('e1:cap:end'), rectangle('s', 20, -5, 6, 50)),
      extrude('c1', 's2', 'cut', { type: 'throughAll' }),
      // the front top edge, referenced as it was before the slot split it into two edges
      fillet('f1', [edge('{e1:cap:end|e1:side:s1.al0}', fp)]),
    );

  it('warns when only the geometry could tell which of several same-named edges was meant', () => {
    const r = regen.rebuild(slotted({ type: 'line', size: 34, center: [43, 0, 10], dir: [1, 0, 0] }));
    const f1 = r.features.at(-1)!;
    expect(f1.status).toBe('ok');
    expect(f1.warnings?.[0]).toContain('幾何指紋');
  });

  it('refuses when nothing tells them apart', () => {
    expect(regen.rebuild(slotted()).features.at(-1)).toMatchObject({ status: 'error', unresolved: [{ reason: 'ambiguous' }] });
  });
});

describe('inserting at the rollback bar (B2.4)', () => {
  it('evaluates up to the bar and puts a new feature right above it', () => {
    const rolled = applyCommand(part(), { type: 'setRollback', index: 2 }); // after the plate
    const withHole = [sketch('s9', face('e1:cap:end'), circle('m', 35, 25, 2)), extrude('c9', 's9', 'cut', { type: 'throughAll' })].reduce(
      (doc, feature, i) => applyCommand(doc, { type: 'insertFeature', feature, index: 2 + i }),
      rolled,
    );
    expect(withHole.features.map((f) => f.id)).toEqual(['s1', 'e1', 's9', 'c9', 's2', 'e2', 's3', 'c1', 'f1']);
    expect(withHole.rollbackIndex).toBe(4);
    const r = regen.rebuild(withHole);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's9=ok', 'c9=ok', 's2=rolledBack', 'e2=rolledBack', 's3=rolledBack', 'c1=rolledBack', 'f1=rolledBack']);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(12000 - Math.PI * 4 * 10, 6);
    const rolledForward = regen.rebuild(applyCommand(withHole, { type: 'setRollback', index: null }));
    expect(rolledForward.features.every((f) => f.status === 'ok')).toBe(true);
  });
});
