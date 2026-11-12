import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel, nurbsEval } from '@3db/kernel';
it('wall areas against the exact length', async () => {
  const kernel = await Kernel.load();
  const A = kernel.importStep(new Uint8Array(readFileSync(process.env.A!))).shape;
  const B = kernel.importStep(new Uint8Array(readFileSync(process.env.B!))).shape;
  const frame = { origin: [0, 0, 9.85], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const es = kernel.sectionCurves(A, frame, { u0: -80, u1: 60, v0: -55, v1: 55 });
  // exact length: adaptive Gauss on each knot span, halving until two levels agree to 1e-15
  const g = [-0.9324695142, -0.6612093865, -0.2386191861, 0.2386191861, 0.6612093865, 0.9324695142], w = [0.1713244924, 0.3607615730, 0.4679139346, 0.4679139346, 0.3607615730, 0.1713244924];
  let L = 0;
  for (const e of es) {
    if (e.kind !== 'nurbs') continue;
    const seg = (a: number, b: number) => { let s = 0; for (let i = 0; i < 6; i++) { const { d } = nurbsEval(e as any, (a + b) / 2 + ((b - a) / 2) * g[i]!); s += w[i]! * Math.hypot(d[0], d[1]); } return (s * (b - a)) / 2; };
    const rec = (a: number, b: number, whole: number, depth: number): number => { const m = (a + b) / 2; const l = seg(a, m), r = seg(m, b); return depth > 30 || Math.abs(l + r - whole) < 1e-15 ? l + r : rec(a, m, l, depth + 1) + rec(m, b, r, depth + 1); };
    for (let k = 0; k < e.knots.length - 1; k++) L += rec(e.knots[k]!, e.knots[k + 1]!, seg(e.knots[k]!, e.knots[k + 1]!), 0);
  }
  const wallArea = (s: number) => kernel.topology(s).faces.filter((f) => !['plane', 'cylinder', 'cone', 'sphere', 'torus'].includes(f.surface)).reduce((a, f) => a + f.area, 0);
  const exact = L * 0.3;
  const wa = wallArea(A), wb = wallArea(B);
  writeFileSync(process.env.OUT!, JSON.stringify({ exact, original: wa, rebuilt: wb, relOriginal: (wa - exact) / exact, relRebuilt: (wb - exact) / exact, totalA: kernel.massProps(A).area, totalB: kernel.massProps(B).area, surfB: [...new Set(kernel.topology(B).faces.map((f) => f.surface))] }, null, 1));
}, 600000);
