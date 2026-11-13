// C5 feasibility on part-3, run one job per process through c5a-run.mjs (JOB):
//   del:<faces>   Kernel.deleteFaces on those face indices (a control: one analytic round; one face of a region)
//   partition     each region boxed out of the body (Kernel.boolean cut with a box around the region's vertices, PAD mm larger):
//                 is what is left recognized by the native features (recognize(), exact, no approximation)? and the boxed pieces: faces, volume
// Trace before every step (AGENTS §4 2026-11-07).
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { recognize, RecognizeError } from '../../packages/regen/src/recognize';
import { frameFor } from '../../packages/regen/src/recognize/reconstruct';
import { part3 } from './c5a.test';

const log = (m: string) => appendFileSync('scratch/ff/c5.log', m + String.fromCharCode(10));
const trace = (m: string) => appendFileSync('scratch/ff/c5.trace', `${new Date().toISOString().slice(11, 19)} ${m}\n`);

it('c5b', async () => {
  const job = process.env.JOB!;
  const kernel = await Kernel.load();
  const heap = () => ((kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20).toFixed(0);
  const id = part3(kernel);
  const topo = kernel.topology(id);
  const { regions } = JSON.parse(readFileSync('scratch/ff/c5-regions.json', 'utf8'));
  trace(`${job}: start`);
  if (job.startsWith('del:')) {
    const faces = job.slice(4).split('+').map(Number);
    const t0 = performance.now();
    try {
      const r = kernel.deleteFaces(id, faces);
      log(`${job}: returned ${Math.round(performance.now() - t0)} ms, valid ${kernel.check(r.shape).valid}, faces ${topo.faces.length}->${kernel.topology(r.shape).faces.length}`);
    } catch (e) {
      log(`${job}: refused ${Math.round(performance.now() - t0)} ms: ${String((e as Error).message).slice(0, 140)}`);
    }
    trace(`${job}: done`);
    return;
  }
  // partition
  const PAD = +(process.env.PAD ?? 0.5);
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
  const box = (lo: number[], hi: number[]) =>
    kernel.extrude({ ...XY, origin: [0, 0, lo[2]! - PAD] } as never, [{ outer: [[lo[0]! - PAD, lo[1]! - PAD], [hi[0]! + PAD, lo[1]! - PAD], [hi[0]! + PAD, hi[1]! + PAD], [lo[0]! - PAD, hi[1]! + PAD]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'b' + i)), holes: [] }] as never, [0, 0, hi[2]! - lo[2]! + 2 * PAD]).shape;
  let rest = id;
  const v0 = kernel.massProps(id, { eps: 1e-10 }).volume;
  let pieces = 0;
  for (const [k, r] of regions.entries()) {
    trace(`partition: cut region ${k}`);
    const b = box(r.box[0], r.box[1]);
    const t0 = performance.now();
    const piece = kernel.boolean('common', id, b).shape;
    const next = kernel.boolean('cut', rest, b).shape;
    const pt = kernel.topology(piece);
    log(`  region ${k}: box pad ${PAD}; piece ${pt.faces.length} faces (${pt.faces.filter((f) => !f.geometry).length} with no simple surface), volume ${kernel.massProps(piece, { eps: 1e-10 }).volume.toFixed(4)}; ${Math.round(performance.now() - t0)} ms`);
    pieces += kernel.massProps(piece, { eps: 1e-10 }).volume;
    rest = next;
  }
  const rt = kernel.topology(rest);
  const vr = kernel.massProps(rest, { eps: 1e-10 }).volume;
  log(`partition: rest ${rt.faces.length} faces, ${rt.faces.filter((f) => !f.geometry).length} with no simple surface, solids ${kernel.solidCount(rest)}, valid ${kernel.check(rest).valid}; rest + pieces − whole = ${(vr + pieces - v0).toExponential(2)} mm³`);
  trace('partition: recognize rest');
  const t1 = performance.now();
  try {
    const rec = recognize(kernel, rest, frameFor as never, undefined, undefined, {});
    log(`partition: rest RECOGNIZED in ${Math.round(performance.now() - t1)} ms: base ${rec.base.type}, holes ${rec.holes.length}, blends ${rec.blends.length}, counts ${JSON.stringify(rec.counts)}`);
  } catch (e) {
    log(`partition: rest ${e instanceof RecognizeError ? 'refused' : 'ERROR'} in ${Math.round(performance.now() - t1)} ms: ${String((e as Error).message).slice(0, 300)}`);
  }
  log(`  heap ${heap()} MiB`);
  trace('partition: done');
}, 900_000);
