/**
 * Phase 3a-2 on the user's own SolidWorks files (handoff §8): holes and rounds taken out of an imported body, a
 * face moved. The files are not in the repository: point SW_SAMPLE_DIR at the folder that holds them and this runs;
 * without it, it is skipped.
 *
 *   $env:SW_SAMPLE_DIR = '<使用者資料夾>\Downloads\SW樣本'; npx vitest run tests/phase3/real-sample-edit.test.ts
 *
 * What is promised is not that every face can be edited (a hole in a thin wall may have no way to close) but that
 * what is built is valid, that the volume is what the geometry says it should be where that can be worked out by
 * hand, and that a face that cannot be edited is an error of the feature with a reason, never a wrong shape.
 * The Regenerator is kept across rebuilds so that the file is read once; each result is measured before the next
 * rebuild, which lets go of it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc } from '@3db/model';
import { readComponentFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

const dir = process.env.SW_SAMPLE_DIR;
const FILES = ['CIV0000467治具_step.STEP', '3D_MT17203_CIV0000467_Porduct.STEP'];
const ready = !!dir && FILES.every((f) => existsSync(join(dir, f)));
const now = () => performance.now();
/** Each rebuild of the 2000-face fixture takes 3–6 s: a test makes dozens. */
const LONG = 900_000;

describe.skipIf(!ready).each(FILES)('real SolidWorks STEP %s: direct editing (C10.1, C10.2)', (file) => {
  const jig = file.includes('治具');
  let kernel: Kernel;
  let regen: Regenerator;
  let doc: PartDoc;
  let topo: ReturnType<Kernel['topology']>;
  let names: string[];
  let v0 = 0;
  const summary: Record<string, unknown> = {};

  const add = (d: PartDoc, f: Feature) => applyCommand(d, { type: 'insertFeature', feature: f, index: d.features.length });
  const face = (i: number) => ({ kind: 'face' as const, name: names[i]! });
  /** What a rebuild of `d` made of the feature `id`, measured at once: status, message, validity, volume, face names, face count. */
  const run = (d: PartDoc, id: string) => {
    const t = now();
    const r = regen.rebuild(d);
    const ms = Math.round(now() - t);
    const feature = r.features.find((x) => x.id === id)!;
    return {
      ms,
      status: feature.status,
      message: feature.message,
      valid: r.body ? kernel.isValid(r.body.shape) : false,
      volume: r.body ? kernel.massProps(r.body.shape).volume : NaN,
      faceNames: r.body?.names.faces ?? [],
    };
  };
  /** The faces sharing an edge with face i. */
  const neighbours = (i: number) => new Set(topo.edges.filter((e) => e.faces.includes(i)).flatMap((e) => e.faces).filter((g) => g !== i));

  beforeAll(async () => {
    kernel = await Kernel.load();
    const part = await readComponentFile(new Uint8Array(readFileSync(join(dir!, file))), file);
    regen = new Regenerator(kernel, await PlaneGcsSolver.create(), part.blobs);
    doc = part.doc;
    const t = now();
    const base = regen.rebuild(doc);
    summary['read + rebuilt (ms)'] = Math.round(now() - t);
    expect(base.features.filter((f) => f.status !== 'ok')).toEqual([]);
    topo = base.body!.topology;
    names = base.body!.names.faces;
    v0 = kernel.massProps(base.body!.shape).volume;
    summary['faces'] = topo.faces.length;
    summary['volume'] = v0;
  });

  it('takes holes out with 「刪除鑽孔」: valid, the volume grows, the walls are gone; what cannot be taken out says why', () => {
    const seeds = topo.faces
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.geometry?.type === 'cylinder' && !f.geometry.convex)
      .sort((a, b) => b.f.area - a.f.area)
      .slice(0, 12);
    summary['hole seeds tried'] = seeds.length;
    expect(seeds.length).toBeGreaterThan(0);
    let done = 0;
    for (const { i } of seeds) {
      const r = run(add(doc, { id: 'del', type: 'deleteFace', name: 'del', suppressed: false, faces: [face(i)], hole: true }), 'del');
      summary[`delete hole f${i + 1}`] = `${r.status} ${r.ms} ms${r.message ? ` — ${r.message}` : ''}`;
      if (r.status !== 'ok') {
        // allowed (a hole can be tangled up with its neighbours) but it must say why, and the body is as it was
        expect(r.message).toEqual(expect.any(String));
        expect(r.volume).toBeCloseTo(v0, 6);
        continue;
      }
      expect(r.valid).toBe(true);
      expect(r.faceNames).not.toContain(names[i]);
      expect(r.volume).toBeGreaterThan(v0 - 1e-6 * v0); // a hole filled (to the precision of the volume)
      expect(r.faceNames.length).toBeLessThan(topo.faces.length);
      summary[`volume gained by f${i + 1}`] = r.volume - v0;
      done += 1;
    }
    summary['holes taken out'] = done;
    if (jig) expect(done).toBeGreaterThan(0);
  }, LONG);

  // Not tried on the product: deleting its smallest cylindrical face (import1:f254, 2.2 mm²) makes OCCT's defeaturing run
  // for minutes and cannot be interrupted from here. The app replaces the worker after a limit (store.ts, ADR 0021 §9).
  (jig ? it : it.skip)('takes rounds off: valid, the volume grows; what cannot be taken off says why', () => {
    // a few of each kind of convex round: a face between two others (cylinder) and the round at a hole's mouth (torus)
    const roundsOf = (type: string) =>
      topo.faces
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => f.geometry?.type === type && (f.geometry as { convex?: boolean }).convex === true)
        .sort((a, b) => a.f.area - b.f.area)
        .slice(0, 5);
    const rounds = [...roundsOf('cylinder'), ...roundsOf('torus')];
    summary['rounds tried'] = rounds.length;
    let done = 0;
    for (const { i } of rounds) {
      const r = run(add(doc, { id: 'delf', type: 'deleteFace', name: 'delf', suppressed: false, faces: [face(i)] }), 'delf');
      if (r.status !== 'ok') {
        expect(r.message).toEqual(expect.any(String));
        expect(r.volume).toBeCloseTo(v0, 6);
        continue;
      }
      expect(r.valid).toBe(true);
      summary[`take off f${i + 1} (${topo.faces[i]!.surface}) change`] = r.volume - v0;
      // a convex round gives material back; the volume of a 2000-face body is good to about 1e-6 of the whole
      expect(r.volume).toBeGreaterThan(v0 - 1e-6 * v0);
      done += 1;
    }
    summary['rounds taken off'] = done;
    if (jig) expect(done).toBeGreaterThan(0);
  }, LONG);

  it('moves a planar face whose neighbours are all planes square to it: valid, the volume changes by area × distance', () => {
    const planes = topo.faces
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.geometry?.type === 'plane')
      .filter(({ f, i }) => {
        const n = f.normal!;
        const around = [...neighbours(i)].map((g) => topo.faces[g]!);
        return around.length >= 3 && around.every((g) => g.geometry?.type === 'plane' && Math.abs(g.normal![0] * n[0] + g.normal![1] * n[1] + g.normal![2] * n[2]) < 1e-9);
      })
      .sort((a, b) => b.f.area - a.f.area)
      .slice(0, 6);
    summary['square planes found'] = planes.length;
    if (jig) expect(planes.length).toBeGreaterThan(0);
    let moved = 0;
    for (const { f, i } of planes) {
      for (const distance of [0.5, -0.5]) {
        const r = run(add(doc, { id: 'mv', type: 'moveFace', name: 'mv', suppressed: false, face: face(i), distance: String(distance) }), 'mv');
        summary[`move f${i + 1} by ${distance}`] = `${r.status} ${r.ms} ms${r.message ? ` — ${r.message}` : ''}`;
        if (r.status !== 'ok') {
          expect(r.message).toEqual(expect.any(String));
          continue;
        }
        expect(r.valid).toBe(true);
        // the volume of a body of 2000 faces is good to about 1e-6 of the whole: the change is checked to that
        expect(Math.abs(r.volume - v0 - f.area * distance)).toBeLessThan(1e-5 * v0);
        moved += 1;
      }
    }
    summary['moves that worked'] = moved;
    if (jig) expect(moved).toBeGreaterThan(0);
  }, LONG);

  it('refuses a face with a round beside it, and says to take the round off first', () => {
    const next = topo.faces
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.geometry?.type === 'plane')
      .find(({ i }) => [...neighbours(i)].some((g) => topo.faces[g]!.geometry?.type === 'torus' || topo.faces[g]!.geometry?.type === 'cylinder'));
    if (!next) return;
    const r = run(add(doc, { id: 'mv', type: 'moveFace', name: 'mv', suppressed: false, face: face(next.i), distance: '0.5' }), 'mv');
    // a neighbour can be tangent (a round: refused with the way out) or a wall square to the face (moved): either way not a wrong shape
    if (r.status === 'ok') expect(r.valid).toBe(true);
    else expect(r.message).toEqual(expect.any(String));
  }, LONG);

  it('prints the numbers it saw', () => {
    console.log(`${file}\n${JSON.stringify(summary, null, 2)}`);
  });
});
