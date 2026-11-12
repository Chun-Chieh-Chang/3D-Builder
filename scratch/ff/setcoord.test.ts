// What gp_Pnt2d.SetCoord(a, b) and gp_Pnt.SetCoord(a, b, c) do in these bindings.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
it('setcoord', async () => {
  const oc = (await Kernel.load()).oc as any;
  const msg = (e: any) => { try { return String(oc.getExceptionMessage(e)); } catch { return String(e); } };
  const p = new oc.gp_Pnt2d(0, 0);
  for (const [a, b] of [[1, 7], [2, 9], [3.5, 4.25], [0, 5], [0.5, 6]]) {
    p.SetX(0); p.SetY(0);
    try { p.SetCoord(a, b); console.log('SC2', a, b, '->', p.X(), p.Y()); } catch (e) { console.log('SC2', a, b, 'THROW', msg(e)); }
  }
  const q = new oc.gp_Pnt(); q.SetCoord(3.5, 4.25, 5.5); console.log('SC3', q.X(), q.Y(), q.Z());
  console.log('SC2 names', Object.keys(Object.getPrototypeOf(p)).filter((k) => /Coord|Set/.test(k)).join(','));
}, 60_000);
