/**
 * A STEP round trip keeps the geometry of free-form parts (2F observation, investigated 2026-09-30).
 * The volume OCCT reports for the user's product part (340 faces: 122 cones, 72 tori, 114 B-spline
 * surfaces, 14 planes, 18 cylinders) moved by 3.5e-6 the first time it was written and read; the second
 * time, not at all (a fixed point). What was found:
 *  - edges, vertices, faces and surface kinds are the same (edges to 1e-9, vertices to 1e-10 mm), and
 *    fine meshes of the two shapes have the same volume to 2e-7: the shape did not change;
 *  - 38 faces (24 cones, 14 B-spline) have another area, by up to 5e-5 of their own, all trimmed by curves
 *    the reader computed (the SolidWorks file has no PCURVEs; the one OCCT writes has 1860);
 *  - it is not the integrator: the adaptive one (BRepGProp.VolumePropertiesGK, 1e-6 and 1e-9, converged)
 *    gives the same 3.49e-6 between the two shapes as the default one;
 *  - about half comes from the precision the written file states: the source says 1e-5, OCCT writes the
 *    shape's own tolerance, 1e-4; read at 1e-5 (or written stating 1e-5) the change is 1.5e-6;
 *  - analytic parts are exact: the fixture (planes, cylinders, tori, 384 B-spline faces) changes by 1e-14.
 * 3.5 ppm of a volume is below the tolerance of the files themselves; nothing was changed for it.
 *
 * Runs on the user's own files when SW_SAMPLE_DIR is set (see tests/phase2/real-sample.test.ts); skipped otherwise.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId, type Topology } from '@3db/kernel';

const dir = process.env.SW_SAMPLE_DIR;
const PRODUCT = '3D_MT17203_CIV0000467_Porduct.STEP';
const FIXTURE = 'CIV0000467治具_step.STEP';
const ready = !!dir && existsSync(join(dir, PRODUCT)) && existsSync(join(dir, FIXTURE));

describe.skipIf(!ready)('STEP round trip of free-form faces', () => {
  let k: Kernel;
  const report: Record<string, unknown> = {};
  beforeAll(async () => {
    k = await Kernel.load();
  });

  const bytesOf = (file: string) => new Uint8Array(readFileSync(join(dir!, file)));
  const volume = (id: ShapeId) => k.massProps(id).volume;
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12); // edges of length 0 (degenerate) exist
  // Order-free: the order of edges and vertices changes on the way, so they are compared sorted, and
  // the vertices by their nearest neighbour.
  const sorted = (v: number[]) => [...v].sort((p, q) => p - q);
  const maxRel = (a: number[], b: number[]) => a.reduce((m, v, i) => Math.max(m, rel(v, b[i]!)), 0);
  const nearest = (a: number[], b: number[]) => {
    let worst = 0;
    for (let i = 0; i < a.length; i += 3) {
      let best = Infinity;
      for (let j = 0; j < b.length; j += 3) best = Math.min(best, Math.hypot(a[i]! - b[j]!, a[i + 1]! - b[j + 1]!, a[i + 2]! - b[j + 2]!));
      worst = Math.max(worst, best);
    }
    return worst;
  };
  const points = (t: Topology) => t.vertices.flatMap((v) => v.point);
  const kinds = (t: Topology) => t.faces.map((f) => f.surface).sort().join();

  /** The volume of the polyhedron of a mesh (signed tetrahedra about the origin), fine enough that only a change of the shape can show. */
  const meshVolume = (id: ShapeId) => {
    const m = k.mesh(id, { tolerance: 3e-4, angular: 0.1 });
    let v = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((i) => [0, 1, 2].map((d) => m.positions[3 * m.indices[t + i]! + d]!));
      v += (a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) - a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!) + a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)) / 6;
    }
    return v;
  };

  for (const file of [PRODUCT, FIXTURE]) {
    it(`${file}: the shape is the same after a round trip, and the second round trip changes nothing`, () => {
      const a = k.importStep(bytesOf(file)).shape;
      const b = k.importStep(k.exportStep(a, 'P')).shape;
      const c = k.importStep(k.exportStep(b, 'P')).shape;
      const [ta, tb, tc] = [k.topology(a), k.topology(b), k.topology(c)];
      report[file] = {
        gpropVolume: { original: volume(a), afterOne: volume(b), afterTwo: volume(c) },
        gpropVolumeChange: { firstRoundTrip: (volume(b) - volume(a)) / volume(a), secondRoundTrip: (volume(c) - volume(b)) / volume(b) },
      };
      // Same faces of the same kinds, the same edges and vertices (to 1e-8: the digits of the text).
      for (const t of [tb, tc]) {
        expect([t.faces.length, t.edges.length, t.vertices.length]).toEqual([ta.faces.length, ta.edges.length, ta.vertices.length]);
        expect(kinds(t)).toBe(kinds(ta));
        expect(maxRel(sorted(t.edges.map((e) => e.length)), sorted(ta.edges.map((e) => e.length)))).toBeLessThan(1e-8);
        expect(Math.max(nearest(points(t), points(ta)), nearest(points(ta), points(t)))).toBeLessThan(1e-8);
      }
      // Written and read once, it is a fixed point.
      expect(rel(volume(c), volume(b))).toBeLessThan(1e-12);
      expect(rel(k.massProps(c).area, k.massProps(b).area)).toBeLessThan(1e-12);
      // The integration may move a little on the first pass (product part: 3.5e-6), never more than 1e-5.
      expect(rel(volume(b), volume(a))).toBeLessThan(1e-5);
      [a, b, c].forEach((s) => k.release(s));
    }, 120_000);
  }

  it('the product part: fine meshes of the original and of the round trip have the same volume, so what moved is the integration', () => {
    const a = k.importStep(bytesOf(PRODUCT)).shape;
    const b = k.importStep(k.exportStep(a, 'P')).shape;
    const [ma, mb] = [meshVolume(a), meshVolume(b)];
    report.fineMeshVolume = { original: ma, afterOne: mb, relativeDifference: (mb - ma) / ma, gpropRelativeDifference: (volume(b) - volume(a)) / volume(a) };
    // The precision a STEP file states: the source says 1e-5; the file OCCT writes says the shape's own tolerance (1e-4 here).
    const uncertainty = (text: string) => Number((text.match(/UNCERTAINTY_MEASURE_WITH_UNIT\s*\(\s*LENGTH_MEASURE\s*\(\s*([0-9.E+-]+)/) ?? [])[1]);
    const withStatic = (name: string, integer: boolean, value: number, run: () => void) => {
      const s = k.oc.Interface_Static;
      const before = integer ? s.IVal(name) : s.RVal(name);
      (integer ? s.SetIVal : s.SetRVal)(name, value);
      try {
        run();
      } finally {
        (integer ? s.SetIVal : s.SetRVal)(name, before);
      }
    };
    const original = volume(a);
    const written = k.exportStep(a, 'P');
    const change: Record<string, number> = { 'default (writes 1e-4)': (volume(b) - original) / original };
    withStatic('read.precision.mode', true, 1, () =>
      withStatic('read.precision.val', false, 1e-5, () => {
        const s = k.importStep(written).shape;
        change['read at the source precision 1e-5'] = (volume(s) - original) / original;
        k.release(s);
      }),
    );
    withStatic('write.precision.mode', true, 2, () =>
      withStatic('write.precision.val', false, 1e-5, () => {
        const text = k.exportStep(a, 'P');
        const s = k.importStep(text).shape;
        change['written stating 1e-5'] = (volume(s) - original) / original;
        expect(uncertainty(text)).toBe(1e-5);
        k.release(s);
      }),
    );
    report.precision = { stated: { source: uncertainty(new TextDecoder().decode(bytesOf(PRODUCT))), writtenByDefault: uncertainty(written) }, volumeChange: change };
    expect(uncertainty(written)).toBe(1e-4);
    // Half of the change comes from the looser precision the written file states, and the rest does not go away with it.
    expect(Math.abs(change['read at the source precision 1e-5']!)).toBeLessThan(Math.abs(change['default (writes 1e-4)']!) * 0.6);
    expect(Math.abs(change['read at the source precision 1e-5']!)).toBeGreaterThan(1e-7);

    expect(rel(mb, ma)).toBeLessThan(1e-6);
    // The shape did not change, and the integration did: the change in what OCCT integrates is the larger one.
    expect(rel(volume(b), volume(a))).toBeGreaterThan(rel(mb, ma));
    [a, b].forEach((s) => k.release(s));
  }, 300_000);

  it('report', () => {
    console.log('ROUNDTRIP ' + JSON.stringify(report, null, 1));
  });
});
