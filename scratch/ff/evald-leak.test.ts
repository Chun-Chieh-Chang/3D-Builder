import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
it('d3', async () => { const k: any = await Kernel.load(); const oc = k.oc; const H = () => oc.wasmMemory.buffer.byteLength / 2 ** 20;
  const S = new oc.Geom_ConicalSurface(new oc.gp_Ax3(), 0.1, 5); const ga = new oc.GeomAdaptor_Surface(S);
  const t = (p: any) => { const o = [p.X(), p.Y(), p.Z()]; p.delete(); return o; };
  const out: any[] = [process.env.W, H()];
  const N = 2e6;
  if (process.env.W === 'evald1') for (let i = 0; i < N; i++) { const d = ga.EvalD1(0.3, 0.2); t(d.Point); t(d.D1U); t(d.D1V); }
  if (process.env.W === 'd1') { const P = new oc.gp_Pnt(), U = new oc.gp_Vec(), V = new oc.gp_Vec(); for (let i = 0; i < N; i++) { ga.D1(0.3, 0.2, P, U, V); P.X(); } }
  if (process.env.W === 'value') for (let i = 0; i < N; i++) { const p = ga.Value(0.3, 0.2); p.delete(); }
  out.push(H()); console.log('D3', JSON.stringify(out));
}, 170_000);
