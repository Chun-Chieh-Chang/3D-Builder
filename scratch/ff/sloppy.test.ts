// A sloppy file made on purpose: a box written to STEP, then only the top PLANE's placement point moved by DZ (its edges and vertices stay): read
// back, OCCT joins it with edge tolerances. What fileTolerance says, and the deviation from the exact box, raw and past the allowance.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
const log = (m: string) => appendFileSync('scratch/ff/sloppy.log', m + String.fromCharCode(10));
it('sloppy', async () => {
  const kernel = await Kernel.load();
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
  const box = kernel.extrude(XY, [{ outer: [[0, 0], [40, 0], [40, 30], [0, 30]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] }] as any, [0, 0, 12]).shape;
  const text = kernel.exportStep(box, 'p');
  const lines = text.split(/\r?\n/);
  const byId = new Map<string, number>(); lines.forEach((l, i) => { const m = /^#(\d+)\s*=/.exec(l); if (m) byId.set(m[1]!, i); });
  let moved = '';
  for (const l of lines) {
    const m = /^#\d+\s*=\s*PLANE\('[^']*',#(\d+)\)/.exec(l); if (!m) continue;
    const ax = lines[byId.get(m[1]!)!]!; const pm = /AXIS2_PLACEMENT_3D\('[^']*',#(\d+)/.exec(ax)!; const pi = byId.get(pm[1]!)!;
    const pt = lines[pi]!; const c = /\(([-\d.E+]+),([-\d.E+]+),([-\d.E+]+)\)/.exec(pt)!;
    if (Math.abs(Number(c[3]) - 12) < 1e-9) { const DZ = Number(process.env.DZ ?? 2e-4); lines[pi] = pt.replace(c[0], `(${c[1]},${c[2]},${(12 + DZ).toFixed(9)})`); moved = `${pt} -> ${lines[pi]}`; }
  }
  log(`moved: ${moved}`);
  const sloppy = kernel.importStep(new TextEncoder().encode(lines.join('\n'))).shape;
  const ft = kernel.fileTolerance(sloppy);
  log(`check valid ${JSON.stringify(kernel.check(sloppy).valid)} volume ${kernel.massProps(sloppy).volume} fileTolerance faces ${ft.count} max ${ft.max.toExponential(2)} volume ${ft.volume.toExponential(2)} area ${ft.area.toExponential(2)} perFace ${ft.faces.map((t) => t.toExponential(1)).join(',')}`);
  const exact = kernel.extrude(XY, [{ outer: [[0, 0], [40, 0], [40, 30], [0, 30]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] }] as any, [0, 0, 12]).shape;
  const ab = kernel.surfaceDeviation(sloppy, exact, undefined, { a: ft.faces }), ba = kernel.surfaceDeviation(exact, sloppy, undefined, { b: ft.faces });
  log(`raw ${ab.integral.toExponential(2)} / ${ba.integral.toExponential(2)}  excess ${ab.excess.toExponential(2)} / ${ba.excess.toExponential(2)}  (1e-6 V = ${(14400e-6).toExponential(2)})`);
}, 600_000);
