// Kernel.rollingBall / sharpEdge / distancesToEdge on the open spline boss (foot round), exact and OCCT's own; and a tilted drafted boss (fuzz seed 7).
import { beforeAll, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { openSplineBoss } from './c28spline.test';
import { sample, __body } from '../../packages/kernel/test/exact-round-fuzz.kit';
let kernel: Kernel;
beforeAll(async () => { kernel = await Kernel.load(); });

function check(name: string, plain: { shape: number; edges: number[] }, exact: boolean, r: number) {
  const f = kernel.fillet(plain.shape as any, plain.edges, r, undefined, undefined, exact);
  const t = kernel.topology(f.shape);
  const sm = kernel.smoothEdges(f.shape, t.edges.map((_, i) => i));
  const rounds = t.faces.flatMap((x, i) => ((f.faceOrigins[i] ?? []).some((o: any) => o.rel === 'generated' && o.kind === 'edge') ? [i] : []));
  for (const ri of rounds) {
    const sup = [...new Set(t.edges.flatMap((e, i) => (sm[i] && e.faces.includes(ri) ? e.faces.filter((q) => q !== ri && !rounds.includes(q)) : [])))];
    if (sup.length !== 2) { console.log(name, 'round', ri, 'supports', sup.length); continue; }
    const rb = kernel.rollingBall(f.shape, ri, sup as [number, number], 1e-5);
    const loose = kernel.rollingBall(f.shape, ri, sup as [number, number], 1);
    const sh = kernel.sharpEdge(f.shape, ri, sup as [number, number]);
    let worst = 0, past = 0;
    if (sh) {
      const per = plain.edges.map((e) => kernel.distancesToEdge(plain.shape as any, e, sh.points));
      sh.points.forEach((_, k) => { const ds = per.map((x) => x[k]).filter((d): d is number => d !== null); if (!ds.length) past++; else worst = Math.max(worst, Math.min(...ds)); });
    }
    console.log(`${name} exact=${exact} r=${r} face ${ri} ${t.faces[ri]!.surface} sup ${sup.map((q) => t.faces[q]!.surface)} | rollingBall(1e-5) ${JSON.stringify(rb)} | measured dev ${loose?.deviation.toExponential(2)} convex ${loose?.convex} | sharp ${sh ? sh.points.length + ' pts closed=' + sh.closed + ' worst ' + worst.toExponential(2) + ' past ' + past : 'null'}`);
  }
}

it('kernel C2.8', () => {
  const h0 = (kernel.oc as any).wasmMemory.buffer.byteLength;
  for (const r of [0.5, 1.2]) for (const exact of [true, false]) check('spline foot', openSplineBoss(kernel) as any, exact, r);
  const s = sample(7); const m = __body(kernel, s);
  for (const exact of [true, false]) check('fuzz seed 7 (tilted drafted circle)', m as any, exact, s.r);
  console.log('heap MiB', h0 / 2 ** 20, (kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20);
}, 600_000);
