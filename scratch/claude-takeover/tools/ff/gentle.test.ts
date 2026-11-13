import { it } from 'vitest';
import { applyCommand, createEmptyPart } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { reconstructImported, Regenerator } from '@3db/regen';
it('gentle', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const XY: any = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const top: any = [[28.72, 25], [14, 32], [0, 25]];
  const reg: any = { outer: [{ kind: 'line', a: [0, 0], b: [28.72, 0], source: 'a' }, { kind: 'line', a: [28.72, 0], b: top[0], source: 'b' }, { kind: 'spline', points: top, source: 'c' }, { kind: 'line', a: top[2], b: [0, 0], source: 'd' }], holes: [] };
  const s = kernel.extrude(XY, [reg], [0, 0, 20]).shape;
  const bytes = new TextEncoder().encode(kernel.exportStep(s, 'p')); const sha = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' } as any, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  const sec = kernel.sectionCurves(s, { ...XY, origin: [0, 0, 10] }, { u0: -50, u1: 50, v0: -50, v1: 50 });
  require('node:fs').appendFileSync('/tmp/prof.log', JSON.stringify(sec.filter((e: any) => e.kind === 'nurbs' || e.kind === 'bezier').map((e: any) => e.kind === 'nurbs' ? { deg: e.degree, np: e.poles.length, knots: e.knots, mults: e.mults } : { bezier: e.spans.length })) + '\n');
  try { const out = reconstructImported(kernel, regen, doc, 'imp1', solver); require('node:fs').appendFileSync('/tmp/prof.log', 'OK ' + JSON.stringify(out.report) + '\n'); } catch (e) { require('node:fs').appendFileSync('/tmp/prof.log', 'ERR ' + String(e).slice(0, 300) + '\n'); }
}, 120000);
