// Where the WebAssembly.Exception comes from when recognizing OCCT's own round of the spline boss foot.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { recognizeStep, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
it('trap', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const p = splineBoss(kernel);
  const occt = kernel.fillet(p.shape, p.edges, Number(process.env.R ?? 0.8), undefined, undefined, false);
  let last = '';
  for (const k of Object.getOwnPropertyNames(Kernel.prototype)) {
    const f = (kernel as any)[k]; if (typeof f !== 'function' || k === 'constructor' || k === 'get') continue;
    (kernel as any)[k] = (...a: any[]) => { last = `${k}(${a.filter((x) => typeof x !== 'object').join(',')})`; const me = last; try { return f.apply(kernel, a); } catch (e) { console.log('THREW in', me); throw e; } };
  }
  try { await recognizeStep(kernel, solver, occt.shape); console.log('TRAP none'); }
  catch (e: any) {
    const oc = kernel.oc as any;
    let msg = ''; try { msg = oc.getExceptionMessage ? String(oc.getExceptionMessage(e)) : ''; } catch { /* */ }
    console.log('TRAP last=', last, e?.constructor?.name, msg, '\n', String(e?.stack ?? e).split('\n').slice(0, 25).join('\n'));
  }
}, 600_000);
