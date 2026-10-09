import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const base: Feature[] = [
  sketch('sk', front, rectangle('r', 0, 0, 100, 60)),
  { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature,
];

function edgeAt(r: RebuildResult, point: [number, number, number]): Ref {
  const i = r.body!.topology.edges.findIndex((edge) => edge.curve === 'line' && Math.hypot(edge.mid[0] - point[0], edge.mid[1] - point[1], edge.mid[2] - point[2]) < 1e-6);
  expect(i, `an edge at ${point}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
}

describe('break corner', () => {
  it('chamfers a flange free-end corner and carries the same cut into the flat pattern', () => {
    const plate = rebuild(build(base));
    expect(failures(plate)).toEqual([]);
    const flange: Feature = { id: 'ef', type: 'edgeFlange', name: 'ef', suppressed: false, edge: edgeAt(plate, [100, 30, 1.5]), length: '30' };
    const features = [...base, flange];
    const plain = rebuild(build(features));
    expect(failures(plain)).toEqual([]);
    const corner = edgeAt(plain, [99.25, 0, 30]);
    const feature = { id: 'bc', type: 'breakCorner', name: 'bc', suppressed: false, corners: [corner], kind: 'chamfer', size: '2' } as unknown as Feature;
    const doc = build([...features, feature]);
    expect(doc.features.map((f) => f?.id)).toEqual(['sk', 'bf', 'ef', 'bc']);
    const result = rebuild(doc);

    expect(failures(result)).toEqual([]);
    expect(kernel.isValid(result.body!.shape)).toBe(true);
    expect(kernel.solidCount(result.body!.shape)).toBe(1);
    expect(kernel.massProps(plain.body!.shape).volume - kernel.massProps(result.body!.shape).volume).toBeCloseTo(0.5 * 2 ** 2 * 1.5, 5);
    expect(new Set(result.body!.names.faces).size).toBe(result.body!.names.faces.length);

    const flat = flatPattern(kernel, result.sheet!);
    const baseFlat = flatPattern(kernel, plain.sheet!);
    try {
      expect(baseFlat.area - flat.area).toBeCloseTo(0.5 * 2 ** 2, 5);
      expect(flat.volume).toBeCloseTo(kernel.massProps(result.body!.shape).volume, 4);
      expect(flat.outline.some((segment) => segment.kind === 'line')).toBe(true);
    } finally {
      kernel.release(flat.shape);
      kernel.release(baseFlat.shape);
    }
  });

  it('rounds a flange free-end corner and carries the arc into the flat pattern', () => {
    const plate = rebuild(build(base));
    const flange: Feature = { id: 'ef', type: 'edgeFlange', name: 'ef', suppressed: false, edge: edgeAt(plate, [100, 30, 1.5]), length: '30' };
    const features = [...base, flange];
    const plain = rebuild(build(features));
    const corner = edgeAt(plain, [99.25, 0, 30]);
    const feature = { id: 'bc', type: 'breakCorner', name: 'bc', suppressed: false, corners: [corner], kind: 'fillet', size: '2' } as unknown as Feature;
    const result = rebuild(build([...features, feature]));

    expect(failures(result)).toEqual([]);
    expect(kernel.isValid(result.body!.shape)).toBe(true);
    expect(kernel.massProps(plain.body!.shape).volume - kernel.massProps(result.body!.shape).volume).toBeCloseTo(2 ** 2 * (1 - Math.PI / 4) * 1.5, 5);
    const flat = flatPattern(kernel, result.sheet!);
    const baseFlat = flatPattern(kernel, plain.sheet!);
    try {
      expect(baseFlat.area - flat.area).toBeCloseTo(2 ** 2 * (1 - Math.PI / 4), 5);
      expect(flat.outline.some((segment) => segment.kind === 'arc')).toBe(true);
    } finally {
      kernel.release(flat.shape);
      kernel.release(baseFlat.shape);
    }
  });
});
