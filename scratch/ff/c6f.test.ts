// The kernel's new drafted extrusion of spline outlines (Kernel.extrude with a draft, MakeDraft path). Per case: valid, solids, faces and their
// origins (each wall named by a profile edge, caps start/end), volume between the straight prisms of the bottom and of the top section (a drafted
// body lies between them), and the walls' distance from the exact draft (as c6d, inside each face).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';

const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

it('c6f', async () => {
  const kernel = await Kernel.load();
  const H = 10;
  const spl = { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' };
  const outer = [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), spl, L([0, 25], [0, 0], 'd')];
  const cases: Record<string, any[]> = {
    spline: [{ outer, holes: [] }],
    'spline+hole': [{ outer, holes: [[{ kind: 'circle', c: [12, 10], r: 4, source: 'h' }]] }],
    'two regions': [{ outer, holes: [] }, { outer: [L([40, 0], [50, 0], 'p'), L([50, 0], [50, 10], 'q'), { kind: 'spline', points: [[50, 10], [45, 14], [40, 10]], source: 'r' }, L([40, 10], [40, 0], 's')], holes: [] }],
    'spline+arc': [{ outer: [L([0, 0], [20, 0], 'a'), { kind: 'arc', c: [20, 8], r: 8, from: [20, 0], to: [28, 8], ccw: true, source: 'b' }, L([28, 8], [28, 25], 'e'), spl.points ? { ...spl, points: [[28, 25], [14, 32], [0, 25]] } : spl, L([0, 25], [0, 0], 'd')], holes: [] }],
  };
  for (const [name, regions] of Object.entries(cases)) for (const deg of [2, -2]) {
    const a = (deg * Math.PI) / 180;
    try {
      const straight = kernel.extrude(XY as never, regions as never, [0, 0, H]).shape;
      const r = kernel.extrude(XY as never, regions as never, [0, 0, H], 0, undefined, a);
      const topo = kernel.topology(r.shape);
      const named = r.faceOrigins.map((o) => (o.length === 0 ? '-' : o.map((x: any) => (x.rel === 'cap' ? `cap:${x.which}` : x.source ?? x.rel)).join('+')));
      const unnamed = named.filter((x) => x === '-').length;
      const v = kernel.massProps(r.shape, { eps: 1e-10 }).volume;
      const v0 = kernel.massProps(straight, { eps: 1e-10 }).volume;
      log(`extrude ${name} ${deg}°: valid ${kernel.check(r.shape).valid} solids ${kernel.solidCount(r.shape)} faces ${topo.faces.length} [${topo.faces.map((f) => f.surface).join(',')}] names [${named.join(',')}] unnamed ${unnamed}; volume ${v.toFixed(4)} vs straight ${v0.toFixed(4)} (${deg > 0 ? 'must be less' : 'must be more'}: ${deg > 0 ? v < v0 : v > v0})`);
      kernel.release(r.shape);
      kernel.release(straight);
    } catch (e) {
      log(`extrude ${name} ${deg}°: THREW ${String((e as Error).message ?? e).slice(0, 160)}`);
    }
  }
}, 600_000);
