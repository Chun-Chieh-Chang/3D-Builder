/**
 * 4a-3 (docs/phase4a-plan.md): the dowel pin hole (C4.8). The fit tables against ISO 286-1 by hand, the hole made at its nominal diameter with its entrance
 * chamfer, and what the document keeps and refuses.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, DOWEL_RANGE, fitClearance, holeLimits, parsePart, pinLimits, serializePart, type Feature, type HoleFeature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, face, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);
const plate = (): Feature[] => [sketch('s1', front, rectangle('a', -20, -15, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' })];
const at = (...pts: [number, number][]): Feature => ({ ...sketch('s2', face('e1:cap:end')), entities: pts.map(([x, y], i) => ({ id: `p${i + 1}`, type: 'point', x, y })) }) as Feature;
const dowel = (extra: Partial<HoleFeature> = {}): Feature => ({ id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'dowel', diameter: '6', fit: 'H7', end: { type: 'blind', depth: '8' }, ...extra }) as Feature;
const make = (extra: Partial<HoleFeature> = {}) => build(...plate(), at([0, 0]), dowel(extra));

describe('the fit tables, against ISO 286-1 by hand (mm)', () => {
  it.each([
    [3, 'H7', 0.01],
    [6, 'H7', 0.012], // 6 is in the range over 3 up to and including 6
    [6.5, 'H7', 0.015],
    [8, 'H6', 0.009],
    [10, 'H7', 0.015],
    [12, 'H8', 0.027],
    [25, 'H7', 0.021],
    [40, 'H7', 0.025],
    [100, 'H8', 0.054],
  ] as const)('a hole of Ø%d %s runs from the nominal size up by %d', (nominal, fit, band) => {
    const l = holeLimits(nominal, fit)!;
    expect(l.min).toBe(nominal);
    expect(l.max).toBeCloseTo(nominal + band, 9);
  });

  it('the pins: m6 starts above the nominal size, h6 and h8 end at it', () => {
    expect(pinLimits(6, 'm6')).toEqual({ min: 6.004, max: 6.012 });
    expect(pinLimits(8, 'm6')).toEqual({ min: 8.006, max: 8.015 });
    expect(pinLimits(2, 'm6')).toEqual({ min: 2.002, max: 2.008 });
    expect(pinLimits(6, 'h6')).toEqual({ min: 5.992, max: 6 });
    expect(pinLimits(10, 'h8')).toEqual({ min: 9.978, max: 10 });
  });

  it('a pin in a hole: an m6 pin in an H7 hole of Ø6 is 8 µm loose at its loosest and 12 µm tight at its tightest', () => {
    expect(fitClearance(6, 'H7', 'm6')).toEqual({ loosest: 0.008, tightest: -0.012 });
    expect(fitClearance(6, 'H7', 'h6')!.tightest).toBe(0); // a sliding pin never binds
    expect(fitClearance(6, 'H7', 'h6')!.loosest).toBeCloseTo(0.02, 9);
  });

  it('knows its limits: nothing below 1 mm or above 120 mm', () => {
    expect(DOWEL_RANGE).toEqual({ min: 1, max: 120 });
    expect(holeLimits(0.5, 'H7')).toBeUndefined();
    expect(holeLimits(130, 'H7')).toBeUndefined();
    expect(pinLimits(121, 'm6')).toBeUndefined();
    expect(fitClearance(0.9, 'H7', 'm6')).toBeUndefined();
  });
});

describe('the dowel pin hole (C4.8)', () => {
  const R = 3;

  it('is made at its nominal diameter: Ø6 and 8 deep, the plate loses a cylinder', () => {
    const r = rebuild(make({}));
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(volume(r)).toBeCloseTo(12000 - Math.PI * R * R * 8, 6);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('with an entrance chamfer of 0.5: a 45° cone from Ø7 down to Ø6, named, valid', () => {
    const c = 0.5;
    const r = rebuild(make({ chamfer: '0.5' }));
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    const frustum = (Math.PI * c * ((R + c) ** 2 + (R + c) * R + R ** 2)) / 3;
    expect(volume(r)).toBeCloseTo(12000 - (Math.PI * R * R * 8 + frustum - Math.PI * R * R * c), 6);
    expect(r.body!.names.faces).toContain('h1:side:s2.p1.cone');
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('a through hole, and several points: one pin hole at each', () => {
    const r = rebuild(build(...plate(), at([-10, 0], [10, 0]), dowel({ end: { type: 'throughAll' }, diameter: '8', fit: 'H6' })));
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(volume(r)).toBeCloseTo(12000 - 2 * Math.PI * 16 * 10, 6);
  });

  it('says why it cannot be made: a diameter outside the tables, a chamfer as large as the hole', () => {
    expect(rebuild(make({ diameter: '0.5' })).features.at(-1)!.message).toContain('1 到 120');
    expect(rebuild(make({ diameter: '130' })).features.at(-1)!.status).toBe('error');
    expect(rebuild(make({ chamfer: '3' })).features.at(-1)!.message).toContain('導角');
  });

  it('keeps the fit and the chamfer through setHole and through save and reopen (Schema 27)', () => {
    const doc = applyCommand(make({ chamfer: '0.5' }), { type: 'setHole', featureId: 'h1', hole: { kind: 'dowel', diameter: '8', fit: 'H8', chamfer: '0.3', end: { type: 'blind', depth: '8' } } });
    const h = doc.features.find((f) => f.id === 'h1') as HoleFeature;
    expect([h.kind, h.diameter, h.fit, h.chamfer]).toEqual(['dowel', '8', 'H8', '0.3']);
    expect(JSON.parse(serializePart(doc)).schemaVersion).toBe(27);
    expect(parsePart(serializePart(doc))).toEqual(doc);
  });

  it('the fit and the chamfer are for dowel holes only, and the fit has to be in the tables', () => {
    expect(() => make({ kind: 'straight', fit: 'H7' })).toThrow(/定位銷孔/);
    expect(() => make({ kind: 'straight', chamfer: '1' })).toThrow(/定位銷孔/);
    expect(() => make({ fit: 'G7' as never })).toThrow(/G7/);
    expect(() => applyCommand(make(), { type: 'setHole', featureId: 'h1', hole: { kind: 'tapped', diameter: '5', fit: 'H7', end: { type: 'blind', depth: '8' } } })).toThrow(/定位銷孔/);
  });

  it('the chamfer follows a variable like any length', () => {
    const withVariable = (expr: string) => {
      const declared = applyCommand(build(...plate(), at([0, 0])), { type: 'addVariable', variable: { id: 'v1', name: 'c', expr } });
      return applyCommand(declared, { type: 'insertFeature', index: declared.features.length, feature: dowel({ chamfer: 'c' }) });
    };
    const removed = (c: number) => Math.PI * R * R * 8 + (Math.PI * c * ((R + c) ** 2 + (R + c) * R + R ** 2)) / 3 - Math.PI * R * R * c;
    expect(statuses(rebuild(withVariable('0.4'))).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(volume(rebuild(withVariable('0.4')))).toBeCloseTo(12000 - removed(0.4), 6);
    const changed = applyCommand(withVariable('0.4'), { type: 'setVariable', id: 'v1', expr: '0.6' });
    expect(volume(rebuild(changed))).toBeCloseTo(12000 - removed(0.6), 6);
  });
});
