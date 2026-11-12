// C4-1: a disc of B-spline faces whose side is moved off the cylinder by changing its weights in the STEP text: the surface alone (the file is then
// sloppy: edges stay) or the surface and its edge curves (a consistent body that is no cylinder).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => { appendFileSync('scratch/ff/c4i.log', m + String.fromCharCode(10)); };
const bump = (text: string, d: number, what: RegExp) => text.replace(what, (m) => m.replace(/\b0\.5\b/g, String(0.5 + d)));
it('c4i', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const s = kernel.extrude(XY as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape;
  const text = kernel.exportStep(kernel.toBSpline(s), 'p');
  for (const d of [0, 1e-7, 1e-6, 1e-5, 1e-4]) for (const mode of ['surface', 'both'] as const) {
    let x = bump(text, d, /RATIONAL_B_SPLINE_SURFACE\(\([\s\S]*?\)\)/g);
    if (mode === 'both') x = bump(x, d, /RATIONAL_B_SPLINE_CURVE\(\([\s\S]*?\)\)/g);
    const bytes = new TextEncoder().encode(x);
    const id = kernel.importStep(bytes).shape;
    const topo = kernel.topology(id); const ft = kernel.fileTolerance(id);
    const side = topo.faces.findIndex((f) => Math.abs(f.center[2] - 4) < 1e-3);
    const a6 = kernel.analyticFace(id, side, 1e-6), a2 = kernel.analyticFace(id, side, 1e-2);
    const sha = await sha256Hex(bytes);
    const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
    const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
    let out: string;
    try { const r = reconstructImported(kernel, regen, doc, 'imp1', solver); out = `rebuilt ${JSON.stringify(r.report.features)} vol ${r.report.volumeError.toExponential(1)} diff ${r.report.difference.toExponential(1)} ft ${JSON.stringify(r.report.fileTolerance ?? null)}`; }
    catch (e) { out = `${e instanceof RecognizeError ? 'refused' : 'ERROR'} ${String((e as Error).message).slice(0, 160)}`; } finally { regen.dispose(); }
    log(`d ${d} ${mode}: valid ${kernel.check(id).valid} tau side ${(ft.faces[side] ?? 0).toExponential(1)} max ${ft.max.toExponential(1)} | @1e-6 ${a6 ? a6.geometry.type + ' ' + a6.deviation.toExponential(1) : '-'} @1e-2 ${a2 ? a2.geometry.type + ' ' + a2.deviation.toExponential(2) : '-'} | ${out}`);
  }
}, 600_000);
