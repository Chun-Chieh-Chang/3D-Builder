// MakeDraft with a profile FACE (holes included): does it lean the hole the right way, how is the result closed into a solid, and does Generated()
// map each profile edge to its wall. Control: the analytic profile (rectangle with a round hole) against OCCT's DraftAngle (the current path).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';

const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

it('c6e', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const H = 10;
  const hole = [{ kind: 'circle', c: [12, 10], r: 4, source: 'h' }];
  const profiles: Record<string, { outer: any[]; holes: any[][] }> = {
    'rect+hole': { outer: [L([0, 0], [28, 0], 'a'), L([28, 0], [28, 25], 'b'), L([28, 25], [0, 25], 'c'), L([0, 25], [0, 0], 'd')], holes: [hole] },
    'spline+hole': { outer: [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')], holes: [hole] },
  };
  for (const [name, region] of Object.entries(profiles)) for (const deg of [2, -2]) {
    const a = (deg * Math.PI) / 180;
    const straight = kernel.extrude(XY as never, [region] as never, [0, 0, H]).shape;
    let bottom: any = null;
    for (const ex = new oc.TopExp_Explorer(k.get(straight), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const f = oc.TopoDS.Face(ex.Current());
      const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
      if (Math.abs(p.CentreOfMass().Z()) < 1e-9 && String(new oc.BRepAdaptor_Surface(f, true).GetType()).includes('Plane')) bottom = f;
    }
    let ctl = '';
    if (name === 'rect+hole') {
      const occt = kernel.extrude(XY as never, [region] as never, [0, 0, H], 0, undefined, a).shape;
      ctl = `DraftAngle ${kernel.massProps(occt, { eps: 1e-10 }).volume.toFixed(6)}`;
      kernel.release(occt);
    }
    const row: string[] = [];
    for (const internal of [true, false]) {
      try {
        const md = new oc.BRepOffsetAPI_MakeDraft(bottom, new oc.gp_Dir(0, 0, 1), a);
        md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI / 2);
        md.SetDraft(internal);
        md.Perform(new oc.Geom_Plane(new oc.gp_Pnt(0, 0, H), new oc.gp_Dir(0, 0, 1)), false);
        if (!md.IsDone()) { row.push(`internal ${internal}: not done`); continue; }
        const sh = md.Shape();
        const nf = (() => { let n = 0; for (const ex = new oc.TopExp_Explorer(sh, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) n++; return n; })();
        // Generated per profile edge
        const gen: number[] = [];
        for (const ex = new oc.TopExp_Explorer(bottom, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
          const l = md.Generated(ex.Current());
          gen.push(l.Size());
        }
        // close: the shell with the bottom face, sewn, then a solid
        const sew = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
        sew.Add(sh); sew.Add(bottom);
        sew.Perform(new oc.Message_ProgressRange());
        const sewn = sew.SewedShape();
        let vol = 'no solid';
        const shells: any[] = [];
        for (const ex = new oc.TopExp_Explorer(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) shells.push(oc.TopoDS.Shell(ex.Current()));
        if (shells.length === 1) {
          const ms = new oc.BRepBuilderAPI_MakeSolid(shells[0]);
          const fix = new oc.ShapeFix_Solid(ms.Solid()); fix.Perform(new oc.Message_ProgressRange());
          const id = k.put(fix.Solid());
          vol = `solid valid ${kernel.check(id).valid} volume ${kernel.massProps(id, { eps: 1e-10 }).volume.toFixed(6)} free edges ${new oc.ShapeAnalysis_FreeBounds(fix.Solid(), 1e-6, false, false).GetClosedWires ? 'n/a' : ''}`;
          kernel.release(id);
        } else vol = `${shells.length} shells`;
        row.push(`internal ${internal}: ${String(sh.ShapeType()).replace('TopAbs_', '')} ${nf} faces, Generated per edge [${gen.join(',')}], ${vol}`);
      } catch (e) {
        row.push(`internal ${internal}: threw ${String((e as Error).message ?? e).slice(0, 100)}`);
      }
    }
    log(`face input ${name} ${deg}° ${ctl}: ${row.join(' | ')}`);
    kernel.release(straight);
  }
}, 600_000);
