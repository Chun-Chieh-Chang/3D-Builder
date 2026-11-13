import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => { appendFileSync('scratch/ff/c4j.log', m + String.fromCharCode(10)); };
const bump = (text: string, d: number, what: RegExp) => text.replace(what, (m) => m.replace(/\b0\.5\b/g, String(0.5 + d)));
it('c4j', async () => {
  const kernel = await Kernel.load();
  const s = kernel.extrude(XY as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape;
  const text = kernel.exportStep(kernel.toBSpline(s), 'p');
  for (const d of [1e-7, 1e-5]) {
    const id = kernel.importStep(new TextEncoder().encode(bump(text, d, /RATIONAL_B_SPLINE_SURFACE\(\([\s\S]*?\)\)/g))).shape;
    const half = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] } as never;
    const edges = kernel.sectionCurves(id, half, { u0: 0, u1: 20, v0: -2, v1: 10 });
    log(`d ${d}: ${edges.length} edges`);
    for (const e of edges as any[]) log('  ' + (e.kind === 'bezier' ? `bezier spans ${e.spans.length} deg ${e.spans[0].length - 1} from ${e.spans[0][0].slice(0, 2).map((x: number) => (x / e.spans[0][0][3]).toFixed(7))} to ${e.spans.at(-1).at(-1).slice(0, 2).map((x: number) => (x / e.spans.at(-1).at(-1)[3]).toFixed(7))}` : JSON.stringify(e)));
    const t = kernel.topology(id); log('  faces ' + t.faces.map((f, i) => `${f.surface}@${f.center.map((x) => x.toFixed(2))}`).join(' ; '));
  }
}, 600_000);
