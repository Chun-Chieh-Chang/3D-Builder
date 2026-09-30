/**
 * B4.3: a reference that stopped resolving is repaired with one command from the candidates the rebuild
 * offers, and the feature then does what the user meant. (The UI only sends `replaceRef`; see ADR 0018.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createDemoPart, type Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const TRUE_EDGE = '{extrude1:cap:end|extrude1:side:sketch1.l2}';
const fingerprint = { type: 'line', size: 10, center: [20, 5, -5] as [number, number, number], dir: [0, 0, -1] as [number, number, number] };

/** The demo part whose fillet points at an edge name that does not exist, but remembers where the edge was. */
const broken = () =>
  applyCommand(createDemoPart(), { type: 'setEdges', featureId: 'fillet1', edges: [{ kind: 'edge', name: '{extrude1:cap:end|extrude1:side:sketch1.l9}', fingerprint }] });

describe('repairing a missing reference (B4.3)', () => {
  it('offers candidates that carry their own fingerprint, the nearest first', () => {
    const f = regen.rebuild(broken()).features.find((x) => x.id === 'fillet1')!;
    expect(f.status).toBe('error');
    const [best, next] = f.unresolved![0]!.candidates;
    expect(best!.name).toBe(TRUE_EDGE);
    expect(best!.fingerprint).toMatchObject({ type: 'line', size: 10 });
    expect(next!.distance).toBeGreaterThan(best!.distance);
  });

  it('one replaceRef with the first candidate makes the fillet work again, on the intended edge', () => {
    const doc = broken();
    const candidate = regen.rebuild(doc).features.find((x) => x.id === 'fillet1')!.unresolved![0]!.candidates[0]!;
    const fixed = applyCommand(doc, { type: 'replaceRef', featureId: 'fillet1', from: doc.features[2]!.type === 'fillet' ? doc.features[2]!.edges[0]! : { kind: 'edge', name: '' }, to: { kind: 'edge', name: candidate.name, fingerprint: candidate.fingerprint } });
    const r = regen.rebuild(fixed);
    expect(r.features.find((x) => x.id === 'fillet1')!.status).toBe('ok');
    const volume = kernel.massProps(r.body!.shape).volume;
    // 20 × 10 × 5 block, R2 fillet along a 10 mm edge: the corner loses (1 − π/4)·r²·L
    expect(volume).toBeCloseTo(1000 - (1 - Math.PI / 4) * 4 * 10, 4);
    // the reference now carries the candidate's own fingerprint, so it can be found by geometry later too
    const edges = (fixed.features[2] as Extract<Feature, { type: 'fillet' }>).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ name: TRUE_EDGE, fingerprint: { type: 'line' } });
  });
});
