/**
 * B1 of the decisions of 2026-10-14: DEV_LOG 「夜間四」 says that on the user's 零件1 (C3C6 檢具), with the profile of the revolve on a plane turned
 * 45° about Y, the four upright edges of the lugs take a 0.3 mm fillet in one feature — the body valid, no bad faces, 149.7053 mm³ — and that each of
 * those edges alone takes 0.5 mm. Those numbers came from a script that only printed them; here they are checked on the file the result was saved in,
 * 零件1_45度基準面圓角完成.3dbx. It is a customer's part and stays out of the repository: REAL_PART1_DIR names the folder it is in
 * (D:\3DB實機確認\C3C6檢具 on the machine it was made on). Without it these tests are skipped, and the run says so.
 *
 * Found by this test (2026-10-14): the first rebuild in a kernel just loaded — which is what opening the file is — names the cylinder the lugs sit on
 * after the cut whose arc lies on it (cut2:side:sketch6.a3) instead of after the revolve (revolve1:side:sketch4.l6), so the fillet loses its four
 * edges; every later rebuild names it after the revolve and the fillet holds. The first test fails until that is fixed (B3.1: a rebuild is a pure
 * function of the document).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PartDoc } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { resolveRef } from '@3db/naming';

const dir = process.env.REAL_PART1_DIR;

describe.skipIf(!dir)('零件1: the 45° plane and the 0.3 fillet on the four lug edges, on the file it was saved in (B1)', () => {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  let doc: PartDoc;
  beforeAll(async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
    const file = await readPartFile(new Uint8Array(readFileSync(join(dir!, '零件1_45度基準面圓角完成.3dbx'))));
    expect(file.warnings).toEqual([]);
    doc = file.doc;
  });
  const rebuild = (until?: number) => new Regenerator(kernel, solver, new Map()).rebuild(doc, until === undefined ? {} : { until });
  const problems = (r: ReturnType<typeof rebuild>) => r.features.filter((f) => f.status !== 'ok' || f.warnings).map((f) => `${f.id}=${f.status} ${f.message ?? ''}`);

  // first: the kernel has done nothing else yet, as when the file is opened
  it('opens with every feature rebuilt, the fillet on all four edges', () => {
    expect(problems(rebuild())).toEqual([]);
  });

  it('the same on every rebuild after that', () => {
    for (let i = 0; i < 3; i++) expect(problems(rebuild()), `rebuild ${i + 2}`).toEqual([]);
  });

  it('with the fillet: valid, no bad face, closed, 149.7053 mm³ as DEV_LOG says; it takes away more than the four straight runs alone would', () => {
    const fi = doc.features.findIndex((f) => f.id === 'fillet_lugs');
    const before = kernel.massProps(rebuild(fi).body!.shape).volume;
    const r = rebuild();
    expect(problems(r)).toEqual([]);
    const check = kernel.check(r.body!.shape);
    expect([check.valid, check.badFaces, check.freeEdges, check.solids]).toEqual([true, [], 0, 1]);
    const after = kernel.massProps(r.body!.shape).volume;
    expect(after).toBeCloseTo(149.7053, 4);
    // the section of one lug edge: the plane x = 1.355 against the convex cylinder R 3.125 (axis Y), rounded with r 0.3; worked out by hand, times 4 × 1.2
    const [a, R, rr] = [1.355, 3.125, 0.3];
    const zc = -Math.sqrt((R - rr) ** 2 - (a - rr) ** 2);
    const c0 = [a, -Math.sqrt(R * R - a * a)];
    const t1 = [a, zc];
    const t2 = [((a - rr) * R) / (R - rr), (zc * R) / (R - rr)];
    const tri = Math.abs((c0[0]! - t1[0]!) * (t2[1]! - t1[1]!) - (t2[0]! - t1[0]!) * (c0[1]! - t1[1]!)) / 2;
    const seg = (rho: number, p: number[], q: number[]) => {
      const phi = 2 * Math.asin(Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) / (2 * rho));
      return (rho * rho * (phi - Math.sin(phi))) / 2;
    };
    const straight = (tri + seg(R, c0, t2) - seg(rr, t1, t2)) * 4 * 1.2;
    expect(straight).toBeCloseTo(0.032982, 6);
    expect(before - after).toBeGreaterThan(straight);
  });

  it('each lug edge alone takes a 0.5 mm fillet and stays valid (DEV_LOG: the 45° plane keeps the seam off them)', () => {
    const fi = doc.features.findIndex((f) => f.id === 'fillet_lugs');
    const body = rebuild(fi).body!;
    const fillet = doc.features[fi]!;
    if (fillet.type !== 'fillet') throw new Error('fillet_lugs is not a fillet');
    expect(fillet.edges).toHaveLength(4);
    for (const ref of fillet.edges) {
      const at = resolveRef(ref, body.names, body.topology);
      expect(at.ok, ref.name).toBe(true);
      if (!at.ok) continue;
      expect(body.topology.edges[at.index]!.length).toBeCloseTo(1.2, 9);
      const out = kernel.fillet(body.shape, [at.index], 0.5);
      try {
        expect(kernel.isValid(out.shape), ref.name).toBe(true);
      } finally {
        kernel.release(out.shape);
      }
    }
  });
});
