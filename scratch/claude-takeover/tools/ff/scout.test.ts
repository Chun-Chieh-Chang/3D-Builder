import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel, KernelError } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
import { stepAsPart } from '../../packages/io/src/stepPart';
import { CadSession } from '../../apps/mcp/src/session';
import { callTool } from '../../apps/mcp/src/server';
const D = process.env.STEP_DIR!;
const TARGETS: [string, number | null][] = JSON.parse(process.env.TARGETS!);
const ANALYTIC = new Set(['plane', 'cylinder', 'cone', 'sphere', 'torus']);
it('scouts', async () => {
  const kernel = await Kernel.load();
  const out: any[] = [];
  for (const [rel, part] of TARGETS) {
    let bytes = new Uint8Array(readFileSync(`${D}/${rel}`));
    if (part !== null) bytes = stepAssemblyPlan(kernel, bytes).prototypes.filter((p: any) => p.part)[part]!.part!.step;
    const imp = kernel.importStep(bytes);
    const topo = kernel.topology(imp.shape);
    const ff = topo.faces.flatMap((f, i) => (ANALYTIC.has(f.surface) && f.geometry ? [] : [i]));
    const T0 = performance.now(); const log = (m: string) => require('node:fs').appendFileSync('/tmp/scout.log', `${Math.round(performance.now() - T0)}ms ${m}\n`);
    log(`import ${rel} ${part} ff=${ff.length}`);
    let r: any = null, kept: number[] = [];
    try { r = kernel.deleteFaces(imp.shape, ff); kept = ff; log('delete all ok'); } catch (e) { log('delete all failed: ' + String(e).slice(0, 150));
      if (!(e instanceof KernelError)) throw e;
      for (const f of (process.env.GREEDY ? ff : [])) { log('try ' + f); try { const n = kernel.deleteFaces(imp.shape, [...kept, f]); if (r) kernel.release(r.shape); r = n; kept.push(f); } catch (e2) { if (!(e2 instanceof KernelError)) throw e2; } }
    }
    const rec: any = { rel, part, faces: topo.faces.length, freeform: ff.length, removed: kept.length };
    if (r) {
      const t2 = kernel.topology(r.shape);
      rec.after = { faces: t2.faces.length, nonAnalytic: t2.faces.filter((f) => !(ANALYTIC.has(f.surface) && f.geometry)).length, valid: kernel.check(r.shape).valid, solids: kernel.solidCount(r.shape) };
      log('after ' + JSON.stringify(rec.after)); const step = kernel.exportStep(r.shape); log('exported');
      const s = await CadSession.create({ root: '/tmp' });
      try {
        const p = await stepAsPart(new TextEncoder().encode(step), 'x.step');
        await s.load(p.doc, p.blobs);
        const t0 = performance.now();
        const resp = await callTool(s, 'recognize_features', { feature: 'import1', approximate_splines: false });
        rec.ms = Math.round(performance.now() - t0); log('recognized in ' + rec.ms);
        const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
        rec.recognized = !resp.isError; rec.reply = resp.isError ? text.slice(0, 500) : JSON.parse(text).recognized?.features;
      } finally { s.dispose(); }
      kernel.release(r.shape);
    }
    out.push(rec); console.log(JSON.stringify(rec));
    kernel.release(imp.shape);
  }
  writeFileSync(process.env.OUT!, JSON.stringify(out, null, 1));
}, 900000);
