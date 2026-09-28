/**
 * Phase 1G golden parts (blueprint §3 Phase 1 acceptance ①②): three fixture parts modelled in the
 * browser using only the UI, saved as .3dbx (see README.md). Each one must reopen and rebuild to the
 * volume worked out by hand; changing its key dimensions must keep every fillet, chamfer and sketch
 * on the element it was made on — checked through volumes that only come out right if it does.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Command, type PartDoc, type SketchConstraint } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const { PI, acos, sqrt, tan } = Math;
const open = async (name: string) => {
  const file = await readPartFile(new Uint8Array(readFileSync(new URL(`./${name}`, import.meta.url))));
  expect(file.format).toBe('3dbx');
  expect(file.warnings).toEqual([]);
  return file.doc;
};

/** Everything is read before the next rebuild releases this one's shapes. */
function measure(doc: PartDoc) {
  const r: RebuildResult = regen.rebuild(doc);
  const body = r.body!;
  return {
    problems: r.features.filter((f) => f.status !== 'ok' || f.warnings).map((f) => `${f.id}=${f.status} ${f.message ?? ''} ${f.warnings ?? ''}`),
    underDefined: r.features.filter((f) => f.sketch && f.sketch.status !== 'fully').map((f) => f.id),
    volume: kernel.massProps(body.shape).volume,
    valid: kernel.isValid(body.shape),
    faces: body.names.faces,
    edges: body.names.edges.length,
    bounds: kernel.bounds(body.shape),
    step: (() => {
      const back = kernel.importStep(kernel.exportStep(body.shape, 'golden'));
      try {
        return kernel.massProps(back.shape).volume;
      } finally {
        kernel.release(back.shape);
      }
    })(),
  };
}

/** Sets the dimension of `sketch` whose type and value match (the UI-made ids are not assumed). */
function setDimension(doc: PartDoc, sketch: string, type: SketchConstraint['type'], value: string, to: string): PartDoc {
  const s = doc.features.find((f) => f.name === sketch);
  if (s?.type !== 'sketch') throw new Error(`no sketch ${sketch}`);
  const c = s.constraints.filter((x) => x.type === type && 'value' in x && x.value === value);
  if (c.length === 0) throw new Error(`no ${type} = ${value} in ${sketch}`);
  return c.reduce((d, x) => applyCommand(d, { type: 'setDimension', featureId: s.id, constraintId: x.id, value: to }), doc);
}
const run = (doc: PartDoc, cmd: Command) => applyCommand(doc, cmd);
const featureId = (doc: PartDoc, name: string) => doc.features.find((f) => f.name === name)!.id;

describe('定位板 (locating plate): plate, 4 × Ø9 and 2 × Ø8 through, R10 corners, C1 around the top', () => {
  /** w × h × 15 plate with corner radius R; 4 Ø9 and 2 Ø8 holes; a 1 × 1 chamfer around the top outline. */
  const volume = (w: number, h: number, R: number) =>
    15 * (w * h - (4 - PI) * R * R) - 15 * PI * (4 * 4.5 ** 2 + 2 * 4 ** 2) - (0.5 * (2 * (w - 2 * R) + 2 * (h - 2 * R)) + 4 * (PI / 2) * 0.5 * (R - 1 / 3));

  it('rebuilds to the hand-computed volume, fully defined, with names made from how faces were made', async () => {
    const m = measure(await open('locating-plate.3dbx'));
    expect(m.problems).toEqual([]);
    expect(m.underDefined).toEqual([]);
    expect(m.volume).toBeCloseTo(volume(120, 80, 10), 6);
    expect(m.valid).toBe(true);
    expect(m.faces).toHaveLength(24); // top, bottom, 4 sides, 4 fillets, 8 chamfer faces, 6 holes
    expect(m.faces.filter((n) => /:face(#|$)/.test(n))).toEqual([]);
    expect(m.bounds.min.map((x) => x + 0)).toEqual([expect.closeTo(-60, 6), expect.closeTo(0, 6), expect.closeTo(-40, 6)]);
    expect(m.bounds.max).toEqual([expect.closeTo(60, 6), expect.closeTo(15, 6), expect.closeTo(40, 6)]);
    expect(m.step).toBeCloseTo(m.volume, 5);
  });

  it('keeps fillets, chamfers and holes in place when the plate and the radius change', async () => {
    const doc = await open('locating-plate.3dbx');
    let d = setDimension(doc, '草圖1', 'distance', '120', '150');
    d = setDimension(d, '草圖1', 'distance', '80', '100');
    d = setDimension(d, '草圖2', 'distanceX', '50', '60'); // bolt holes spread with the plate
    d = run(d, { type: 'setFilletRadius', featureId: featureId(d, '圓角1'), value: '12' });
    const m = measure(d);
    expect(m.problems).toEqual([]);
    expect(m.volume).toBeCloseTo(volume(150, 100, 12), 6);
  });
});

describe('V 型塊 (V-block): 90° V, symmetric extrusion, R2 in the V, 2 × Ø6 blind holes', () => {
  /** Section 60 × H with a V of the given included angle and a 30 mm opening, 50 long; R2 in the V; 2 × Ø6 × 12. */
  const volume = (H: number, includedDeg: number) => {
    const a = (includedDeg * PI) / 180;
    const depth = 15 / tan(a / 2);
    const fill = 4 / tan(a / 2) - ((PI - a) * 4) / 2; // what an R2 round adds in a concave corner of angle a
    return (60 * H - 0.5 * 30 * depth) * 50 + fill * 50 - 2 * PI * 9 * 12;
  };

  it('rebuilds to the hand-computed volume, fully defined', async () => {
    const m = measure(await open('v-block.3dbx'));
    expect(m.problems).toEqual([]);
    expect(m.underDefined).toEqual([]);
    expect(m.volume).toBeCloseTo(volume(40, 90), 6);
    expect(m.valid).toBe(true);
    expect(m.faces).toHaveLength(14); // 7 sides, 2 ends, the round in the V, 2 holes × (wall + bottom)
    expect(m.faces.filter((n) => /:face(#|$)/.test(n))).toEqual([]);
    expect(m.bounds.min).toEqual([expect.closeTo(-30, 6), expect.closeTo(0, 6), expect.closeTo(-25, 6)]);
    expect(m.bounds.max).toEqual([expect.closeTo(30, 6), expect.closeTo(40, 6), expect.closeTo(25, 6)]);
    expect(m.step).toBeCloseTo(m.volume, 5);
  });

  it('keeps the round in the V and the side holes when the V opens up and the block grows', async () => {
    const doc = await open('v-block.3dbx');
    // The angle dimension was placed inside the V, so it measures the V's opening, as in SolidWorks
    // (before the fix of the 1G acceptance it turned the lines as drawn, and 100 made an 80° V).
    let d = setDimension(doc, '草圖1', 'angle', '90', '100');
    d = setDimension(d, '草圖1', 'distance', '40', '50');
    const m = measure(d);
    expect(m.problems).toEqual([]);
    expect(m.volume).toBeCloseTo(volume(50, 100), 6);
  });
});

describe('削邊銷 (diamond pin): revolved, grooved, chamfered, two flats cut from offset planes', () => {
  const seg = (r: number, d: number) => r * r * acos(d / r) - d * sqrt(r * r - d * d); // circular segment beyond a chord at d
  /**
   * Shank r5 × 15, flange r × 4, pin L long; groove r4.5–5 × 1; C0.5 at the bottom; flats x = ±3 from
   * y = 20 to 32. The profile is dimensioned as a chain of steps (as it was drawn): the pin radius is
   * the flange radius less 4, so it follows the flange.
   */
  const volume = (flangeR: number, L: number) => {
    const pinR = flangeR - 4;
    const top = 19 + L;
    return PI * (25 * 15 + flangeR ** 2 * 4 + pinR ** 2 * L) - PI * (25 - 4.5 ** 2) - 2 * PI * (5 - 0.5 / 3) * 0.125 - 2 * (Math.min(top, 32) - 20) * seg(pinR, 3);
  };

  it('rebuilds to the hand-computed volume, fully defined, every revolved face named by its profile line', async () => {
    const m = measure(await open('diamond-pin.3dbx'));
    expect(m.problems).toEqual([]);
    expect(m.underDefined).toEqual([]);
    expect(m.volume).toBeCloseTo(volume(8, 12), 6);
    expect(m.valid).toBe(true);
    expect(m.faces).toHaveLength(16); // 8 revolved (shank split by the groove), 3 in the groove, the chamfer, 2 × (flat + step)
    expect(m.faces.filter((n) => /:face(#|$)/.test(n))).toEqual([]);
    expect(m.bounds.min).toEqual([expect.closeTo(-8, 6), expect.closeTo(0, 6), expect.closeTo(-8, 6)]);
    expect(m.bounds.max).toEqual([expect.closeTo(8, 6), expect.closeTo(31, 6), expect.closeTo(8, 6)]);
    expect(m.step).toBeCloseTo(m.volume, 5);
  });

  it('keeps the groove, chamfer and flats in place when the flange and the pin change', async () => {
    const doc = await open('diamond-pin.3dbx');
    let d = setDimension(doc, '草圖1', 'distance', '3', '4'); // flange radius 8 → 9
    d = setDimension(d, '草圖1', 'distance', '12', '16'); // pin 12 → 16 long: the flats now stop short of the top
    const m = measure(d);
    expect(m.problems).toEqual([]);
    expect(m.volume).toBeCloseTo(volume(9, 16), 6);
  });
});
