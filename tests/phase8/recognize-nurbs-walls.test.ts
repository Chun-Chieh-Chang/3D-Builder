/**
 * Feature recognition of walls that are B-spline curves carried straight (C1): an outline of clamped cubics cut into a plate or raised on it comes back
 * as sketches whose splines are those B-splines exactly, fully defined and editable; a wall that is not straight (drafted) is refused, never rebuilt
 * wrong. Each part is made here (tests/phase8/nurbs-walls.kit.ts) and checked against itself by cutting each solid from the other, not by the code under test.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';
import { at, cubic, outline, plate, region, rng, type P } from './nurbs-walls.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

/** Recognizes `s` through STEP; the rebuilt document and its solid, or the refusal. */
async function recognizeStep(s: ShapeId): Promise<{ doc: PartDoc; regen: Regenerator } | RecognizeError> {
  const bytes = new TextEncoder().encode(kernel.exportStep(s, 'part'));
  const sha = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'p.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' } as never, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    return { doc: reconstructImported(kernel, regen, doc, 'imp1', solver).doc, regen };
  } catch (e) {
    regen.dispose();
    if (e instanceof RecognizeError) return e;
    throw e;
  }
}

/** The volume each has that the other has not, over the first's volume: two cuts, measured on their pieces. */
function apart(a: ShapeId, b: ShapeId): number {
  const one = kernel.boolean('cut', a, b);
  const two = kernel.boolean('cut', b, a);
  try {
    return (kernel.massProps(one.shape).volume + kernel.massProps(two.shape).volume) / kernel.massProps(a).volume;
  } finally {
    kernel.release(one.shape);
    kernel.release(two.shape);
  }
}

const made: ShapeId[] = [];
const own = (id: ShapeId) => (made.push(id), id);

describe('recognized exactly', () => {
  for (const bspline of [false, true]) {
    it(`an outline of rational cubics with a hole, cut into the top (${bspline ? 'B-spline' : 'extrusion'} walls)`, async () => {
      const r = rng(7);
      const outer = outline(r, [2, -1], 12, 14, 3, true, false);
      const hole = outline(r, [2, -1], 4.5, 9, 2, false, false);
      const s = plate(kernel, 50, 40, 8, region(outer, hole), 0.6, false, bspline, own);
      const res = await recognizeStep(s);
      if (res instanceof RecognizeError) throw res;
      try {
        const rebuilt = res.regen.rebuild(res.doc);
        expect(rebuilt.features.every((f) => f.status === 'ok')).toBe(true);
        expect(rebuilt.features.filter((f) => f.sketch && f.sketch.dof !== 0)).toEqual([]);
        expect(apart(s, rebuilt.body!.shape)).toBeLessThan(1e-9);
        // the walls are B-splines in the sketch: 3 + 2 of them, each with the poles it was made with
        const splines = res.doc.features.flatMap((f) => (f.type === 'sketch' ? f.entities.filter((e) => e.type === 'spline' && e.nurbs) : []));
        expect(splines).toHaveLength(5);
        expect(splines.map((e) => (e.type === 'spline' ? e.points.length : 0)).sort((a, b) => a - b)).toEqual([5, 5, 6, 6, 6].sort((a, b) => a - b));
        // and the cut's depth is a dimension to change
        const deep = res.doc.features.find((f) => f.type === 'extrude' && f.dir1.type === 'blind' && Math.abs(Number(f.dir1.depth) - 0.6) < 1e-9);
        expect(deep).toBeDefined();
      } finally {
        res.regen.dispose();
      }
    });
  }

  it('an outline of cubics and one straight piece, raised on the top', async () => {
    const r = rng(11);
    const outer = outline(r, [-3, 4], 10, 12, 3, false, true);
    const s = plate(kernel, 40, 40, 6, region(outer), 1.2, true, true, own);
    const res = await recognizeStep(s);
    if (res instanceof RecognizeError) throw res;
    try {
      const rebuilt = res.regen.rebuild(res.doc);
      expect(rebuilt.features.every((f) => f.status === 'ok')).toBe(true);
      expect(apart(s, rebuilt.body!.shape)).toBeLessThan(1e-9);
    } finally {
      res.regen.dispose();
    }
  });
});

describe('refused, not rebuilt wrong', () => {
  it('a B-spline outline carried straight but slanting (not square to any face of the plate)', async () => {
    const outer = [cubic([[0, 0], [8, -3], [16, 0], [16, 8]] as P[]), cubic([[16, 8], [10, 14], [4, 12], [0, 0]] as P[])];
    const box = own(kernel.extrude(at(0), [{ outer: [[-10, -10], [30, -10], [30, 25], [-10, 25]].map((a, i, p) => ({ kind: 'line' as const, a: a as P, b: p[(i + 1) % 4] as P, source: `b${i}` })), holes: [] }], [0, 0, 6]).shape);
    const tool = own(kernel.extrude(at(4), [region(outer)], [1.5, 0.5, 3]).shape);
    const s = own(kernel.boolean('cut', box, tool).shape);
    const res = await recognizeStep(s);
    if (!(res instanceof RecognizeError)) {
      // if it is rebuilt at all, it must be the same solid
      try {
        expect(apart(s, res.regen.rebuild(res.doc).body!.shape)).toBeLessThan(1e-6);
      } finally {
        res.regen.dispose();
      }
    }
  });
});
