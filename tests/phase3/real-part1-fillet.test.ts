/**
 * B1 of the decisions of 2026-10-14: DEV_LOG 「夜間四」 says that on the user's 零件1 (C3C6 檢具), with the profile of the revolve on a plane turned
 * 45° about Y, the four upright edges of the lugs take a 0.3 mm fillet in one feature — the body valid, no bad faces, 149.7053 mm³. Those numbers
 * came from a script that only printed them; here they are checked on the file the result was saved in, 零件1_45度基準面圓角完成.3dbx. It is a
 * customer's part and stays out of the repository: REAL_PART1_DIR names the folder it is in (D:\3DB實機確認\C3C6檢具 on the machine it was made on).
 * Without it these tests are skipped, and the run says so.
 *
 * What this found (2026-10-14):
 * - The rebuild was not the same every time (B3.1). planegcs moves the last digits of its answers with what it solved before, by up to its
 *   convergence threshold (1e-10). In sketch6 (草圖3) each lug line and the arc next to it meet at two points of their own (the line's end "on the
 *   arc", the arc's end "on the line"), solved ~1e-10 apart, on the R 3.125 arc that lies on the cylinder of the revolve; which way that fell decided
 *   whether OCCT left the cylinder in 4 pieces or more, and so the names of the faces and whether the fillet held. The first rebuild after loading
 *   fell one way (the fillet lost), later ones the other (the fillet held, 149.705286 mm³: the DEV_LOG numbers came from such a state).
 * - Now every rebuild starts from a fresh solver whose numbers are put on a grid (PlaneGcsSolver.fresh, canon), and a piece a cut makes on a body face's
 *   surface keeps the body face's name (inheritBodySurface): the same document rebuilds the same way every time. For this file that way loses the
 *   fillet (「圓角失敗」), every time: the sketch has to be mended — each lug corner one point (「合併點」 or 修剪), then the relations the panel lists as
 *   redundant deleted — before the fillet can hold.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PartDoc } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';

const dir = process.env.REAL_PART1_DIR;

describe.skipIf(!dir)('零件1: the 45° plane and the 0.3 fillet on the four lug edges, on the file it was saved in (B1)', () => {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  let saved: PartDoc;
  beforeAll(async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
    const file = await readPartFile(new Uint8Array(readFileSync(join(dir!, '零件1_45度基準面圓角完成.3dbx'))));
    expect(file.warnings).toEqual([]);
    saved = file.doc;
  });
  /** As the app rebuilds: from a solver just loaded (PlaneGcsSolver.fresh). */
  const rebuild = async (doc: PartDoc) => {
    await solver.fresh();
    return new Regenerator(kernel, solver, new Map()).rebuild(doc);
  };
  const problems = (r: RebuildResult) => r.features.filter((f) => f.status !== 'ok' || f.warnings).map((f) => `${f.id}=${f.status} ${f.message ?? ''}`);
  /** What must come out the same: the problems, the names, the volume, and every solved sketch to the bit. */
  const facts = (r: RebuildResult) => ({
    problems: problems(r),
    names: r.body?.names,
    volume: r.body ? kernel.massProps(r.body.shape).volume : null,
    sketches: [...r.sketches].map(([id, s]) => [id, JSON.stringify([...s.solved.geometry], (_k, v) => (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : v.toPrecision(17)) : v))]),
  });

  it('rebuilds the same way every time: four rebuilds, and one after the solver has solved other sketches, the same names and volume to the bit', async () => {
    const first = facts(await rebuild(saved));
    for (let i = 0; i < 3; i++) expect(facts(await rebuild(saved)), `rebuild ${i + 2}`).toEqual(first);
    for (const f of saved.features) if (f.type === 'sketch') solver.solve(f); // what a sketch being edited does between rebuilds
    expect(facts(await rebuild(saved))).toEqual(first);
  });

  it('as saved, that way loses the fillet, every time: the doubled lug corners of sketch6 on the cylinder of the revolve (the sketch must be mended)', async () => {
    const r = await rebuild(saved);
    expect(problems(r)).toEqual(['fillet_lugs=error 圓角失敗']);
    // the edges themselves are found: the failure is the fillet's, not a lost reference
    expect(r.features.find((f) => f.id === 'fillet_lugs')?.unresolved ?? []).toEqual([]);
    const sketch6 = saved.features.find((f) => f.id === 'sketch6');
    const doubled = sketch6?.type === 'sketch' ? sketch6.constraints.filter((k) => k.type === 'pointOnCurve').length : 0;
    expect(doubled).toBe(11); // the lug lines' ends "on" the arcs and the arcs' ends "on" the lines (and two more), where one point each would do
  });
});
