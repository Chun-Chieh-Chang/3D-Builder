// Probe: for every rolling-ball fuzz seed, the turn of the boss's outline where the spline wall meets the two flat walls beside it (degrees; the
// outline runs counterclockwise, positive is a convex corner), from the wall's own basis curve. Writes out/prof46/ends.json. No fillet is made.
import { writeFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';

it('end turns of every seed', async () => {
  const k = await Kernel.load(); const oc = k.oc as any;
  const rows: any[] = [];
  const turn = (a: number[], b: number[]) => (Math.atan2(a[0]! * b[1]! - a[1]! * b[0]!, a[0]! * b[0]! + a[1]! * b[1]!) * 180) / Math.PI;
  for (let seed = 1; seed <= 100; seed++) {
    const s = sample(seed);
    const m = splineBoss(k, s.top, s.h);
    const shape = (k as any).get(m.shape);
    const t = k.topology(m.shape); const wall = t.faces.findIndex((f) => !f.geometry);
    const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher(); oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
    const c = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(map.FindKey(wall + 1)), true).BasisCurve();
    const p = new oc.gp_Pnt(0, 0, 0), d = new oc.gp_Vec(0, 0, 0);
    c.D1(c.FirstParameter(), p, d); const start = [p.X(), p.Y()], t0 = [d.X(), d.Y()];
    c.D1(c.LastParameter(), p, d); const end = [p.X(), p.Y()], t1 = [d.X(), d.Y()];
    // the curve may run either way along the outline: orient it from top[0] to top[last]
    const first = s.top[0]!, last = s.top[s.top.length - 1]!;
    const forward = Math.hypot(start[0]! - first[0]!, start[1]! - first[1]!) < 1e-6;
    const [ta, tb] = forward ? [t0, t1] : [t1.map((x) => -x), t0.map((x) => -x)];
    const b = [0, 1]; // line b: (w, 0) -> top[0]
    const dLine = [-last[0]!, -last[1]!]; // line d: top[last] -> (0, 0)
    rows.push({ seed, r: s.radius, h: s.h, startTurn: +turn(b, ta).toFixed(2), endTurn: +turn(tb, dLine).toFixed(2), forward });
    k.release(m.shape);
  }
  writeFileSync('out/prof46/ends.json', JSON.stringify(rows, null, 1));
  expect(rows.length).toBe(100);
}, 600_000);
