/**
 * Phase 3a-10 (docs/phase3-plan.md §5): the parts of the acceptance that need no sample of the user's. The tools (`tests/support/acceptance.ts`) are the ones
 * the user's three SolidWorks parts will be put through; here they run on the golden parts, whose volumes are known by hand.
 *
 *  - the tools themselves: the symmetric difference of shapes whose difference is known; a part against its own STEP; a part against one that is not it;
 *  - §5 ②: three key dimensions of each golden part at 50%–200% of their value, each result against the hand-calculated volume (where there is a closed form)
 *    and against the same part built from nothing.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type PatternDefinition, type Ref } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, face, front, rectangle, sketch } from '../phase1/builders';
import { compareToReference, expectSweepPasses, featureIdOf, REFERENCE_LIMITS, runCommand, SWEEP_FACTORS, setSketchDimension, sweepKeyDimensions, symmetricDifference, type KeyDimension } from '../support/acceptance';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const { PI, tan } = Math;
const open = async (name: string): Promise<PartDoc> => (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${name}`, import.meta.url))))).doc;
const setDepth = (feature: string) => (doc: PartDoc, v: number) =>
  runCommand(doc, { type: 'setEndCondition', featureId: featureIdOf(doc, feature), dir: 'dir1', value: { type: 'blind', depth: String(v) } });
const setRadius = (feature: string) => (doc: PartDoc, v: number) => runCommand(doc, { type: 'setFilletRadius', featureId: featureIdOf(doc, feature), value: String(v) });
const setById = (sketch: string, constraintId: string) => (doc: PartDoc, v: number) => {
  const s = doc.features.find((f) => f.name === sketch)!;
  return applyCommand(doc, { type: 'setDimension', featureId: s.id, constraintId, value: String(v) });
};

describe('the tools of the acceptance', () => {
  const plate = async () => new Regenerator(kernel, solver).rebuild(await open('locating-plate.3dbx'));

  it('a part against its own STEP file: the symmetric difference is nothing, volume, area and centre agree', async () => {
    const r = await plate();
    const back = kernel.importStep(kernel.exportStep(r.body!.shape, 'plate'));
    try {
      const c = compareToReference(kernel, r.body!.shape, back.shape);
      expect(c.symmetricDifference).toBeLessThan(REFERENCE_LIMITS.symmetricDifference);
      expect(c.volume).toBeLessThan(REFERENCE_LIMITS.volume);
      expect(c.area).toBeLessThan(REFERENCE_LIMITS.area);
      expect(c.centroid).toBeLessThan(REFERENCE_LIMITS.centroid);
    } finally {
      kernel.release(back.shape);
    }
  });

  it('a part against one that differs: the symmetric difference is the volume of the difference, from either side', async () => {
    const a = new Regenerator(kernel, solver).rebuild(await open('locating-plate.3dbx'));
    const doc = setById('草圖2', 'd4')(await open('locating-plate.3dbx'), 16); // the two Ø8 holes become Ø16
    const b = new Regenerator(kernel, solver).rebuild(doc);
    const hole = (r: number) => 15 * PI * r * r;
    // only the two holes differ: Ø16 take 2 × π(8² − 4²) × 15 more than Ø8; the chamfer is not near them
    const expected = 2 * (hole(8) - hole(4));
    expect(symmetricDifference(kernel, a.body!.shape, b.body!.shape)).toBeCloseTo(expected, 6);
    expect(symmetricDifference(kernel, b.body!.shape, a.body!.shape)).toBeCloseTo(expected, 6);
    const c = compareToReference(kernel, b.body!.shape, a.body!.shape);
    expect(c.symmetricDifference).toBeGreaterThan(1e-3);
  });

  it('the factors are inside 50%–200% and there are five of them (§5 ②)', () => {
    expect(SWEEP_FACTORS).toHaveLength(5);
    for (const f of SWEEP_FACTORS) expect(f).toBeGreaterThanOrEqual(0.5), expect(f).toBeLessThanOrEqual(2);
  });
});

describe('§5 ②: key dimensions at 50%–200%, 0 problems, valid, hand-calculated volume, same as built from nothing', () => {
  it('定位板: thickness, corner radius, the Ø8 holes', async () => {
    // plate 120 × 80 × T, corner radius R, 4 × Ø9, 2 × Ø(d), a 1 × 1 chamfer around the top outline
    const volume = (T: number, R: number, d: number) =>
      T * (120 * 80 - (4 - PI) * R * R) - T * PI * (4 * 4.5 ** 2 + 2 * (d / 2) ** 2) - (0.5 * (2 * (120 - 2 * R) + 2 * (80 - 2 * R)) + 4 * (PI / 2) * 0.5 * (R - 1 / 3));
    const dims: KeyDimension[] = [
      { name: 'thickness', nominal: 15, set: setDepth('伸長1'), volume: (v) => volume(v, 10, 8) },
      { name: 'corner radius', nominal: 10, set: setRadius('圓角1'), volume: (v) => volume(15, v, 8) },
      { name: 'Ø8 holes', nominal: 8, set: setById('草圖2', 'd4'), volume: (v) => volume(15, 10, v) },
    ];
    expectSweepPasses(sweepKeyDimensions(kernel, solver, await open('locating-plate.3dbx'), dims));
  });

  it('V 型塊: the round in the V, the Ø6 holes, their depth', async () => {
    // section 60 × 40 with a 90° V, 30 across, 50 long; a round r in the V; 2 holes Ø(d) and (n) deep
    const a = PI / 2;
    const volume = (r: number, d: number, n: number) => (60 * 40 - 0.5 * 30 * (15 / tan(a / 2))) * 50 + (r * r / tan(a / 2) - ((PI - a) * r * r) / 2) * 50 - 2 * PI * (d / 2) ** 2 * n;
    const dims: KeyDimension[] = [
      { name: 'round in the V', nominal: 2, set: setRadius('圓角1'), volume: (v) => volume(v, 6, 12) },
      { name: 'hole diameter', nominal: 6, set: setById('草圖2', 'd5'), volume: (v) => volume(2, v, 12) },
      { name: 'hole depth', nominal: 12, set: setDepth('除料-伸長1'), volume: (v) => volume(2, 6, v) },
    ];
    expectSweepPasses(sweepKeyDimensions(kernel, solver, await open('v-block.3dbx'), dims));
  });

  it('削邊銷: the length of the pin, the thickness of the flange, the length of the shank', async () => {
    // shank r5 × (s), flange r8 × (t), pin r4 × (L); groove r4.5–5 × 1; C0.5; flats x = ±3 from y = 20 up to the top or 32
    const seg = (r: number, d: number) => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
    const volume = (L: number, t: number) => {
      const top = 15 + t + L;
      // the flats run from y = 20 to 32 or the top; they cut the flange (r8) where it reaches above 20, and the pin (r4) above that. The cut is 12 wide
      // (z from −6 to 6), narrower than the flange at the flat (2·√55 = 14.8), so what lies beyond |z| = 6 stays
      const F = (x: number) => x * Math.sqrt(64 - x * x) + 64 * Math.asin(x / 8);
      const beyond = F(Math.sqrt(28)) - F(3) - 12 * (Math.sqrt(28) - 3);
      const inFlange = Math.max(0, Math.min(15 + t, 32) - 20);
      const inPin = Math.max(0, Math.min(top, 32) - Math.max(20, 15 + t));
      return PI * (25 * 15 + 64 * t + 16 * L) - PI * (25 - 4.5 ** 2) - 2 * PI * (5 - 0.5 / 3) * 0.125 - 2 * (inFlange * (seg(8, 3) - beyond) + inPin * seg(4, 3));
    };
    const dims: KeyDimension[] = [
      { name: 'pin length', nominal: 12, set: setById('草圖1', 'd7'), volume: (v) => volume(v, 4) },
      { name: 'flange thickness', nominal: 4, set: setById('草圖1', 'd5'), volume: (v) => volume(12, v) },
      { name: 'shank length', nominal: 15, set: setById('草圖1', 'd3') },
    ];
    expectSweepPasses(sweepKeyDimensions(kernel, solver, await open('diamond-pin.3dbx'), dims));
  });
});

describe('§5 ②: the other two kinds of part the acceptance asks for (a shelled body, a plate with a patterned post), built here from the builders', () => {
  it('a shelled box (plastic kind): wall thickness, height, width', async () => {
    const volume = (w: number, h: number, t: number) => w * 40 * h - (w - 2 * t) * (40 - 2 * t) * (h - t);
    const doc = build(
      sketch('s1', front, rectangle('p', 0, 0, 60, 40)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      { id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: [face('e1:cap:end')], thickness: '2' } as Feature,
    );
    const dims: KeyDimension[] = [
      { name: 'wall thickness', nominal: 2, set: (d, v) => applyCommand(d, { type: 'setShell', featureId: 'sh1', faces: [face('e1:cap:end')], thickness: String(v) }), volume: (v) => volume(60, 20, v) },
      { name: 'height', nominal: 20, set: setDepth('e1'), volume: (v) => volume(60, v, 2) },
      { name: 'width', nominal: 60, set: (d, v) => applyCommand(d, { type: 'setDimension', featureId: 's1', constraintId: 'pw', value: String(v) }), volume: (v) => volume(v, 20, 2) },
    ];
    expectSweepPasses(sweepKeyDimensions(kernel, solver, doc, dims));
  });

  it('a plate with a post patterned along x (jig kind): the spacing, the radius of the post, its height', async () => {
    const right: Ref = { kind: 'datum', name: 'plane:right' };
    const def = (spacing: number): PatternDefinition => ({ mode: 'linear', dir1: { ref: right, spacing: String(spacing), count: '4' } });
    const pattern = (spacing: number): Feature => ({ id: 'pat1', type: 'pattern', name: 'pat1', suppressed: false, seeds: ['e2'], def: def(spacing) });
    const volume = (r: number, h: number) => 60 * 20 * 5 + 4 * PI * r * r * h;
    const doc = build(
      sketch('s1', front, rectangle('p', 0, 0, 60, 20)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
      sketch('s2', face('e1:cap:end'), circle('k', 5, 10, 1.5)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }),
      pattern(8),
    );
    const dims: KeyDimension[] = [
      { name: 'spacing', nominal: 8, set: (d, v) => applyCommand(d, { type: 'setPattern', featureId: 'pat1', seeds: ['e2'], def: def(v) }), volume: () => volume(1.5, 5) },
      { name: 'post radius', nominal: 1.5, set: setById('s2', 'kr'), volume: (v) => volume(v, 5) },
      { name: 'post height', nominal: 5, set: setDepth('e2'), volume: (v) => volume(1.5, v) },
    ];
    expectSweepPasses(sweepKeyDimensions(kernel, solver, doc, dims));
  });
});

