import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyCommand, holeSize, parsePart, SCHEMA_VERSION, type Feature, type HoleFeature } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, elementFacts, holeFeatures } from '@3db/regen';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel, regen: Regenerator;
beforeAll(async () => { kernel = await Kernel.load(); regen = new Regenerator(kernel, await PlaneGcsSolver.create()); });
afterAll(() => regen.dispose());
const make = (patch: Partial<HoleFeature> = {}, reverse = false) => build(
  sketch('s1', front, rectangle('a', -30, -20, 60, 40)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
  { ...sketch('s2', reverse ? front : face('e1:cap:end')), entities: [{ id: 'p1', type: 'point', x: -12, y: 0 }, { id: 'p2', type: 'point', x: 12, y: 0 }] } as Feature,
  { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'tapped', size: 'M6', diameter: '5', end: { type: 'blind', depth: '10' }, cosmeticThread: true, threadDepth: '4', reverse, ...patch });

it('rejects mismatched standard diameters, invalid depths and non-threaded settings through commands', () => {
  for (const threadDepth of ['0', '-1', 'NaN', 'Infinity', '11']) expect(() => make({ threadDepth })).toThrow();
  expect(() => make({ diameter: '6' })).toThrow();
  expect(() => make({ kind: 'straight' })).toThrow();
  const doc = make();
  expect(() => applyCommand(doc, { type: 'setHole', featureId: 'h1', hole: { kind: 'tapped', size: 'M8', diameter: '5', cosmeticThread: true, end: { type: 'blind', depth: '10' } } })).toThrow();
});

it('round trips the integrated settings and updates both bore and drawing metadata after a size change', () => {
  const doc = parsePart(JSON.stringify(make()));
  expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  expect(doc.schemaVersion).toBeGreaterThanOrEqual(89);
  const changed = applyCommand(doc, { type: 'setHole', featureId: 'h1', hole: { kind: 'tapped', size: 'M8', diameter: '6.8', cosmeticThread: true, threadDepth: '2+3', toleranceClass: '6H', end: { type: 'blind', depth: '12' } } });
  const r = regen.rebuild(changed);
  expect(r.features.filter(f => f.status !== 'ok')).toEqual([]);
  expect(r.cosmeticThreads).toHaveLength(2);
  for (const ct of r.cosmeticThreads) {
    expect(ct).toMatchObject({ standardDesignation: 'M8', toleranceClass: '6H', depth: 5 });
    // Permit only floating-point representation error, not geometric drift.
    expect(Math.abs(ct.radius - 3.4)).toBeLessThanOrEqual(Number.EPSILON * 3.4);
    expect(elementFacts(r.body!.topology, r.body!.names, ct.targetFace, holeFeatures(changed), r.cosmeticThreads)).toHaveProperty('thread.designation', 'M8');
  }
  const off = { ...changed, features: changed.features.map(f => f.id === 'h1' ? { ...f, suppressed: true } : f) };
  expect(regen.rebuild(off).cosmeticThreads).toEqual([]);
});

it('100 seeded configurations preserve bore volume and expose evaluated thread depth to drawing facts', () => {
  let seed = 74219;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const variants = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const reverse = i % 2 === 0, through = i % 4 < 2;
    const size = ['M3', 'M4', 'M5', 'M6', 'M8'][i % 5]!;
    const d = holeSize(size)!.tapDrill, depth = 6 + random() * 10, threadDepth = 1 + random() * 4;
    const doc = make({ size, diameter: String(d), end: through ? { type: 'throughAll' } : { type: 'blind', depth: String(depth) }, threadDepth: String(threadDepth) }, reverse);
    const r = regen.rebuild(doc);
    expect(r.features.filter(f => f.status !== 'ok')).toEqual([]);
    expect(r.cosmeticThreads).toHaveLength(2);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(48000 - 2 * Math.PI * d * d / 4 * (through ? 20 : depth), 5);
    for (const ct of r.cosmeticThreads) {
      const facts = elementFacts(r.body!.topology, r.body!.names, ct.targetFace, holeFeatures(doc), r.cosmeticThreads);
      expect(facts).toHaveProperty('thread.designation', size);
      expect(facts).toHaveProperty('thread.depth', threadDepth);
      expect(ct.cylinderLength).toBeCloseTo(through ? 20 : depth, 6);
    }
    variants.add(`${reverse}/${through}`);
  }
  expect(variants.size).toBe(4);
});
