import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver, findProfiles } from '@3db/sketch';
it('glyph', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const { entities } = JSON.parse(readFileSync('/tmp/glyph8.json', 'utf8'));
  const sk: any = { id: 's', type: 'sketch', name: 's', suppressed: false, plane: { kind: 'datum', name: 'plane:top' }, entities, constraints: [] };
  const solved = solver.solve(sk);
  console.log('solve', solved.status, solved.dof);
  const prof = findProfiles(sk, solved);
  console.log('regions', prof.regions.length, prof.regions.map((r: any) => [r.outer.length, r.holes.map((h: any) => h.length)]), 'open', JSON.stringify((prof as any).problems ?? (prof as any).open ?? '').slice(0, 300));
  const frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const reg: any = prof.regions[0];
  const variants: [string, any][] = [['outer', { outer: reg.outer, holes: [] }], ['hole0', { outer: [...reg.holes[0]].reverse(), holes: [] }], ['hole0-raw', { outer: reg.holes[0], holes: [] }], ['full', reg]];
  for (const [n, rg] of variants) { try { const r = kernel.extrude(frame, [rg], [0, 0, 0.3]); console.log('V', n, kernel.massProps(r.shape).volume.toFixed(6), kernel.isValid(r.shape), JSON.stringify((kernel as any).check(r.shape)).slice(0, 200)); } catch (e) { console.log('V', n, 'failed', String(e).slice(0, 200)); } }
  console.log('segs', JSON.stringify(reg.outer.slice(0, 2).map((s: any) => ({ k: s.kind, n: s.nurbs ? { deg: s.nurbs.degree, np: s.nurbs.poles.length, knots: s.nurbs.knots.length, first: s.nurbs.poles[0], last: s.nurbs.poles.at(-1) } : null, p0: s.points[0], pl: s.points.at(-1) }))));
  try { const r = kernel.extrude(frame, prof.regions, [0, 0, 0.3]); console.log('vol', kernel.massProps(r.shape).volume, 'valid', kernel.isValid(r.shape)); } catch (e) { console.log('extrude failed', String(e)); }
});
