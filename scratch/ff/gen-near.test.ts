// Writes tests/fixtures/step/spline-outline-near.step (WRITE=1) and checks both spline samples as recognition sees them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';

let kernel: Kernel; let solver: PlaneGcsSolver;
beforeAll(async () => { kernel = await Kernel.load(); solver = await PlaneGcsSolver.create(); });
const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
type P = [number, number];
const GENTLE: P[] = [[28.72, 25], [14, 32], [0, 25]];
const open = (top: P[]): Region => ({ outer: [
  { kind: 'line', a: [0, 0], b: [28.72, 0], source: 'a' }, { kind: 'line', a: [28.72, 0], b: top[0]!, source: 'b' },
  { kind: 'spline', points: top, source: 'c' }, { kind: 'line', a: top[top.length - 1]!, b: [0, 0], source: 'd' } ], holes: [] } as Region);
const OUT = 'tests/fixtures/step/spline-outline-near.step';

async function rec(bytes: Uint8Array, approximate: boolean | undefined) {
  const sha = await sha256Hex(bytes);
  const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    const before = regen.rebuild(doc).mass?.volume;
    try {
      const out = reconstructImported(kernel, regen, doc, 'imp1', solver, undefined, approximate === undefined ? undefined : { approximateSplines: approximate });
      const after = regen.rebuild(out.doc);
      return { ok: true, before, volume: after.mass?.volume, approx: out.report.approximation, types: out.doc.features.map((f) => f.type),
        nurbs: out.doc.features.some((f: any) => f.type === 'sketch' && f.entities.some((e: any) => e.type === 'spline' && e.nurbs)) };
    } catch (e) { if (e instanceof RecognizeError) return { ok: false, before, message: e.message }; throw e; }
  } finally { regen.dispose(); }
}

it('near sample', async () => {
  if (process.env.WRITE || !existsSync(OUT)) {
    const r = open(GENTLE);
    const nudged = r.outer.map((s: any) => (s.kind === 'spline' ? { ...s, points: s.points.map((p: P, i: number) => (i === 1 ? [p[0], p[1] + 1e-8] : p)) } : s));
    const s = kernel.loft([{ frame: XY, outer: r.outer }, { frame: { ...XY, origin: [0, 0, 20] }, outer: nudged }]).shape;
    console.log('made valid', JSON.stringify(kernel.check(s)), 'volume', kernel.massProps(s).volume);
    writeFileSync(OUT, kernel.exportStep(s, 'spline-outline-near'));
  }
  const near = new Uint8Array(readFileSync(OUT));
  const exact = new Uint8Array(readFileSync('tests/fixtures/step/spline-outline.step'));
  for (const [n, b] of [['near', near], ['exact', exact]] as const) { const im: any = kernel.importStep(b); const id = im.shape ?? im.shapes?.[0] ?? im.bodies?.[0]?.shape; console.log(n, 'keys', Object.keys(im), 'valid', JSON.stringify(kernel.check(id)), 'volume', kernel.massProps(id).volume); }
  { const ex = kernel.extrude(XY, [open(GENTLE)], [0, 0, 20]).shape; const r = open(GENTLE); const lo = kernel.loft([{ frame: XY, outer: r.outer }, { frame: { ...XY, origin: [0, 0, 20] }, outer: r.outer }]).shape; console.log('gentle extrude', kernel.massProps(ex).volume, 'loft unnudged', kernel.massProps(lo).volume); }
  const res = { exactOff: await rec(exact, undefined), exactOn: await rec(exact, true), nearOff: await rec(near, undefined), nearOn: await rec(near, true) };
  console.log(JSON.stringify(res, null, 1));
  expect(res.nearOff.ok).toBe(false);
  expect(res.nearOn.ok).toBe(true);
  expect(res.exactOff.ok).toBe(true);
}, 300_000);
