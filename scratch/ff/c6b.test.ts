// Drafted spline walls: can the kernel make one? The boss outline (three lines and a spline) as a wire at z = 0; the same wire offset in its plane by
// h·tan(α) (BRepOffsetAPI_MakeOffset, Intersection joins) and moved to z = h; a ruled ThruSections between the two. Then: valid, faces and their
// surface types, the angle of each wall's outward normal to the plane (constant = one draft), and the volume against the frustum-like closed form
// is not known for a spline, so against the same body made by OCCT's draft for the all-line outline (control: the method must agree there).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';

const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

it('c6b', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const H = 10;
  const outlines: Record<string, any[]> = {
    lines: [L([0, 0], [28, 0], 'a'), L([28, 0], [28, 25], 'b'), L([28, 25], [0, 25], 'c'), L([0, 25], [0, 0], 'd')],
    spline: [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')],
  };
  for (const [name, outer] of Object.entries(outlines)) for (const deg of [1.5, 5]) {
    const a = (deg * Math.PI) / 180;
    const arena = new (k.constructor.Arena ?? Object)();
    const base = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, H]).shape;
    // the bottom face's outer wire
    let bottom: any = null;
    for (const ex = new oc.TopExp_Explorer(k.get(base), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const f = oc.TopoDS.Face(ex.Current());
      const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
      if (Math.abs(p.CentreOfMass().Z()) < 1e-9 && oc.BRepAdaptor_Surface && String(new oc.BRepAdaptor_Surface(f, true).GetType()).includes('Plane')) bottom = f;
    }
    const w0 = oc.BRepTools.OuterWire(bottom);
    const t0 = performance.now();
    let out = '';
    try {
      const d = H * Math.tan(a);
      let w1: any = null;
      for (const sign of [-1, 1]) {
        const mk = new oc.BRepOffsetAPI_MakeOffset(w0, oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
        mk.Perform(sign * d);
        if (!mk.IsDone()) continue;
        const ex = new oc.TopExp_Explorer(mk.Shape(), oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        const w = oc.TopoDS.Wire(ex.Current());
        const b1 = new oc.Bnd_Box(); oc.BRepBndLib.Add(w, b1, false);
        const b0 = new oc.Bnd_Box(); oc.BRepBndLib.Add(w0, b0, false);
        if (b1.CornerMax().X() - b1.CornerMin().X() < b0.CornerMax().X() - b0.CornerMin().X()) { w1 = w; break; }
      }
      const tr = new oc.gp_Trsf(); tr.SetTranslation(new oc.gp_Vec(0, 0, H));
      const top = oc.TopoDS.Wire(new oc.BRepBuilderAPI_Transform(w1, tr, true).Shape());
      const ts = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-6);
      ts.AddWire(w0); ts.AddWire(top);
      ts.Build(new oc.Message_ProgressRange());
      const id = k.put(ts.Shape());
      const topo = kernel.topology(id);
      const v = kernel.massProps(id, { eps: 1e-10 }).volume;
      const walls = topo.faces.map((f, i) => {
        if (f.geometry?.type === 'plane') return `${i}:plane ${((Math.asin(Math.min(1, Math.abs(f.geometry.normal[2]))) * 180) / Math.PI).toFixed(5)}°`.replace(/90\.00000°/, 'cap');
        return `${i}:${f.surface}`;
      });
      let ctl = '';
      if (name === 'lines') {
        // control: OCCT's draft of the same outline
        const occt = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, H], 0, undefined, a).shape;
        ctl = ` | OCCT draft volume ${kernel.massProps(occt, { eps: 1e-10 }).volume.toFixed(6)}`;
        kernel.release(occt);
      }
      out = `valid ${kernel.check(id).valid} ${Math.round(performance.now() - t0)}ms volume ${v.toFixed(6)}${ctl} | ${walls.join(' ')}`;
      // the spline wall's normal angle
      const fs: any[] = [];
      for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) fs.push(oc.TopoDS.Face(ex.Current()));
      topo.faces.forEach((f, i) => {
        if (f.geometry) return;
        const ad = new oc.BRepAdaptor_Surface(fs[i], true);
        const rev = fs[i].Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
        const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
        const P = new oc.gp_Pnt(), U = new oc.gp_Vec(), V = new oc.gp_Vec();
        let lo = Infinity, hi = -Infinity;
        for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) {
          ad.D1(u0 + ((u1 - u0) * (x + 0.5)) / 9, v0 + ((v1 - v0) * (y + 0.5)) / 9, P, U, V);
          const n = [U.Y() * V.Z() - U.Z() * V.Y(), U.Z() * V.X() - U.X() * V.Z(), U.X() * V.Y() - U.Y() * V.X()];
          const ang = (Math.asin(((rev ? -1 : 1) * n[2]!) / Math.hypot(...n)) * 180) / Math.PI;
          lo = Math.min(lo, ang); hi = Math.max(hi, ang);
        }
        out += ` | f${i} ${String(ad.GetType()).replace('GeomAbs_', '')} deg ${ad.UDegree?.()}x${ad.VDegree?.()} normal angle ${lo.toFixed(5)}°..${hi.toFixed(5)}°`;
      });
      kernel.release(id);
    } catch (e) {
      out = `FAILED: ${String((e as Error).message ?? e).slice(0, 160)}`;
    }
    log(`${name} ${deg}°: ${out}`);
    kernel.release(base);
    void arena;
  }
}, 600_000);
