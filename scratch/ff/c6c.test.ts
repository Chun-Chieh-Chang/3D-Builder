// Drafted spline walls with OCCT's BRepOffsetAPI_MakeDraft: the outline wire at z = 0, drafted along +z by α up to the plane z = H, RightCorner
// transitions. What comes back (shape type, faces, surface types), the angle of each wall's outward normal to the xy plane at 9×9 places (exact
// draft: α everywhere), and, made into a solid with both caps, the volume against OCCT's own DraftAngle on the all-line outline (control).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';

const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

it('c6c', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const H = 10;
  const outlines: Record<string, any[]> = {
    lines: [L([0, 0], [28, 0], 'a'), L([28, 0], [28, 25], 'b'), L([28, 25], [0, 25], 'c'), L([0, 25], [0, 0], 'd')],
    spline: [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')],
  };
  const shapeType = (s: any) => String(s.ShapeType()).replace('TopAbs_', '');
  for (const [name, outer] of Object.entries(outlines)) for (const deg of [1.5, 5, -3]) {
    const a = (deg * Math.PI) / 180;
    const base = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, H]).shape;
    let bottom: any = null;
    for (const ex = new oc.TopExp_Explorer(k.get(base), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const f = oc.TopoDS.Face(ex.Current());
      const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
      if (Math.abs(p.CentreOfMass().Z()) < 1e-9 && String(new oc.BRepAdaptor_Surface(f, true).GetType()).includes('Plane')) bottom = f;
    }
    const wire = oc.BRepTools.OuterWire(bottom);
    const t0 = performance.now();
    let out = '';
    for (const internal of [false, true]) {
      try {
        const md = new oc.BRepOffsetAPI_MakeDraft(wire, new oc.gp_Dir(0, 0, 1), a);
        md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI / 2);
        md.SetDraft(internal);
        md.Perform(new oc.Geom_Plane(new oc.gp_Pnt(0, 0, H), new oc.gp_Dir(0, 0, 1)), false);
        if (!md.IsDone()) { out += ` [internal=${internal}: not done]`; continue; }
        const sh = md.Shape();
        const id = k.put(sh);
        const topo = kernel.topology(id);
        // sew the walls with the two caps into a solid: the bottom face, and the top cap from the free edges at z = H
        const sew = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
        sew.Add(sh); sew.Add(bottom);
        // top: the free boundary of the walls at z = H
        const fb = new oc.ShapeAnalysis_FreeBounds(sh, 1e-6, false, false);
        const closed = fb.GetClosedWires();
        let topFace: any = null;
        for (const ex = new oc.TopExp_Explorer(closed, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
          const w = oc.TopoDS.Wire(ex.Current());
          const bb = new oc.Bnd_Box(); oc.BRepBndLib.Add(w, bb, false);
          if (Math.abs(bb.CornerMin().Z() - H) < 1e-6) topFace = new oc.BRepBuilderAPI_MakeFace(w, true).Face();
        }
        if (topFace) sew.Add(topFace);
        sew.Perform(new oc.Message_ProgressRange());
        const sewn = sew.SewedShape();
        let solidId: number | null = null;
        try {
          const ms = new oc.BRepBuilderAPI_MakeSolid(oc.TopoDS.Shell(new oc.TopExp_Explorer(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE).Current()));
          const so = ms.Solid();
          const fix = new oc.ShapeFix_Solid(so); fix.Perform(new oc.Message_ProgressRange());
          solidId = k.put(fix.Solid());
        } catch (e) { out += ` [solid failed ${String(e).slice(0, 60)}]`; }
        // angle spread per wall
        const fs: any[] = [];
        for (const ex = new oc.TopExp_Explorer(sh, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) fs.push(oc.TopoDS.Face(ex.Current()));
        const spread = fs.map((f) => {
          const ad = new oc.BRepAdaptor_Surface(f, true);
          const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
          const P = new oc.gp_Pnt(), U = new oc.gp_Vec(), V = new oc.gp_Vec();
          let lo = Infinity, hi = -Infinity;
          for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) {
            ad.D1(u0 + ((u1 - u0) * (x + 0.5)) / 9, v0 + ((v1 - v0) * (y + 0.5)) / 9, P, U, V);
            const n = [U.Y() * V.Z() - U.Z() * V.Y(), U.Z() * V.X() - U.X() * V.Z(), U.X() * V.Y() - U.Y() * V.X()];
            const ang = Math.abs(Math.asin(n[2]! / Math.hypot(...n)));
            lo = Math.min(lo, ang); hi = Math.max(hi, ang);
          }
          return `${String(ad.GetType()).replace('GeomAbs_', '')} ${((lo * 180) / Math.PI).toFixed(6)}..${((hi * 180) / Math.PI).toFixed(6)}°`;
        });
        let vol = '';
        if (solidId !== null) {
          vol = ` solid valid ${kernel.check(solidId as never).valid} volume ${kernel.massProps(solidId as never, { eps: 1e-10 }).volume.toFixed(6)}`;
        }
        let ctl = '';
        if (name === 'lines') {
          const occt = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, H], 0, undefined, a).shape;
          ctl = ` | DraftAngle volume ${kernel.massProps(occt, { eps: 1e-10 }).volume.toFixed(6)}`;
          kernel.release(occt);
        }
        out += ` [internal=${internal}: ${shapeType(sh)} ${topo.faces.length} faces, top cap ${topFace ? 'yes' : 'no'},${vol}${ctl} | walls ${spread.join('; ')}]`;
      } catch (e) {
        out += ` [internal=${internal}: threw ${String((e as Error).message ?? e).slice(0, 100)}]`;
      }
    }
    log(`MakeDraft ${name} ${deg}° (${Math.round(performance.now() - t0)}ms):${out}`);
    kernel.release(base);
  }
}, 600_000);
