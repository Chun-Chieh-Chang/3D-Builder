/**
 * F2.2, A1.7: what the kernel finds in a STEP file and what it does about it. The defective files are made on
 * purpose (tests/support/stepSamples.ts) on a block whose volume is known (1000): surfaces without a solid, surfaces
 * with a gap, an open set of surfaces, a stray face. A STEP reader mends a solid's small flaws by itself, so that
 * defect is made in memory and handed to the repair step.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ImportResult, type ShapeId } from '../src/index';
import { stepSamples, type StepSamples } from '../../../tests/support/stepSamples';

let k: Kernel;
let samples: StepSamples;
beforeAll(async () => {
  k = await Kernel.load();
  samples = stepSamples(k);
});

const live: ShapeId[] = [];
afterEach(() => {
  for (const id of live.splice(0)) k.release(id);
});
const read = (data: Uint8Array | string, options?: Parameters<Kernel['importStep']>[1]): ImportResult => {
  const r = k.importStep(data, options);
  live.push(r.shape);
  return r;
};
const volume = (r: ImportResult) => k.massProps(r.shape).volume;

describe('a clean file', () => {
  it('is read as it is: no repair, nothing left out, the numbers say so', () => {
    const r = read(samples.block());
    expect(volume(r)).toBeCloseTo(1000, 6);
    expect(r.warnings).toEqual([]);
    expect(r.diagnostics).toEqual({ solids: 1, faces: 6, looseFaces: 0, validBefore: true, healed: false, sewn: false, sewTolerance: null, freeEdges: null, validAfter: true });
  });
});

describe('surfaces without a solid (F2.2)', () => {
  it('sews the six faces of a block into a solid', () => {
    const r = read(samples.facesOnly());
    expect(k.isValid(r.shape)).toBe(true);
    expect(volume(r)).toBeCloseTo(1000, 6);
    expect(k.topology(r.shape).faces).toHaveLength(6);
    expect(r.diagnostics).toMatchObject({ solids: 0, faces: 6, sewn: true, sewTolerance: 0.01, freeEdges: 0, validAfter: true });
    expect(r.warnings).toEqual([expect.stringContaining('縫合成 1 個實體')]);
    expect(r.faceOrigins).toHaveLength(6);
  });

  it('sews faces that do not quite meet, within the tolerance', () => {
    const r = read(samples.gapped(0.005));
    expect(k.isValid(r.shape)).toBe(true);
    expect(volume(r)).toBeGreaterThan(999);
    expect(volume(r)).toBeLessThan(1002);
  });

  it('refuses a gap wider than the tolerance and says how many edges stayed open; a wider tolerance closes it', () => {
    const data = samples.gapped(0.05);
    expect(() => k.importStep(data)).toThrow(/仍有 \d+ 條邊沒有接上.*加大縫合容差/);
    const r = read(data, { sewTolerance: 0.1 });
    expect(k.isValid(r.shape)).toBe(true);
    expect(r.diagnostics).toMatchObject({ sewn: true, sewTolerance: 0.1, freeEdges: 0 });
    expect(Math.abs(volume(r) - 1000)).toBeLessThan(10);
  });

  it('refuses an open set of surfaces (a box without its lid) and reports the four open edges', () => {
    expect(() => k.importStep(samples.openBox())).toThrow('仍有 4 條邊沒有接上');
  });

  it('says there is nothing to build a solid from when the file only has lines', () => {
    expect(() => k.importStep(samples.lineOnly())).toThrow('沒有實體');
  });

  it('names the same faces in the same order after sewing, so persistent names hold', () => {
    const data = samples.facesOnly();
    const names = () => k.topology(read(data).shape).faces.map((f) => [f.surface, f.center.map((c) => Math.round(c * 1e6) / 1e6)]);
    expect(names()).toEqual(names());
  });
});

describe('a solid that fails the check (F2.2)', () => {
  it('is healed and the report says it was', () => {
    // A corner of the block moved off the ends of the three edges that meet there: the solid is still one, but the
    // validity check fails. Healing joins the edges up again. (A STEP reader mends this much by itself, so the
    // defect is made in memory and handed to the repair step.)
    const oc = k.oc;
    const box = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0, 0, 0), 20, 10, 5).Shape();
    const vertex = new oc.TopExp_Explorer(box, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE).Current();
    new oc.BRep_Builder().UpdateVertex(oc.TopoDS.Vertex(vertex), new oc.gp_Pnt(0.02, 0.02, 0.02), 1e-7);
    const r = k.repairImport(box);
    live.push(r.shape);
    expect(r.diagnostics.solids).toBe(1);
    expect(r.diagnostics.validBefore).toBe(false);
    expect(r.diagnostics.healed).toBe(true);
    expect(r.diagnostics.validAfter).toBe(true);
    expect(r.warnings).toEqual([expect.stringContaining('已自動修復')]);
    expect(volume(r)).toBeCloseTo(1000, 0);
  });
});

describe('a stray face next to a solid', () => {
  it('is left out, counted and reported', () => {
    const r = read(samples.blockWithStrayFace());
    expect(volume(r)).toBeCloseTo(125, 6);
    expect(r.diagnostics).toMatchObject({ solids: 1, looseFaces: 1, healed: false, sewn: false });
    expect(r.warnings).toEqual(['略過 1 個不屬於實體的面']);
  });
});
