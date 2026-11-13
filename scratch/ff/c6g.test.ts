// Why the end cap of a MakeDraft solid is not found again: follow the shell's top face through Sewing (ModifiedSubShape) and MakeSolid/ShapeFix.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';

const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

it('c6g', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const outer = [L([0, 0], [28, 0], 'a'), L([28, 0], [28, 25], 'b'), L([28, 25], [0, 25], 'c'), L([0, 25], [0, 0], 'd')];
  const base = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 10]).shape;
  let bottom: any = null;
  for (const ex = new oc.TopExp_Explorer(k.get(base), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const f = oc.TopoDS.Face(ex.Current());
    const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
    if (Math.abs(p.CentreOfMass().Z()) < 1e-9 && String(new oc.BRepAdaptor_Surface(f, true).GetType()).includes('Plane')) bottom = f;
  }
  const wire = oc.BRepTools.OuterWire(bottom);
  const md = new oc.BRepOffsetAPI_MakeDraft(wire, new oc.gp_Dir(0, 0, 1), 0.03);
  md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI / 2);
  md.SetDraft(true);
  md.Perform(new oc.Geom_Plane(new oc.gp_Pnt(0, 0, 10), new oc.gp_Dir(0, 0, 1)), false);
  const shell = md.Shape();
  const z = (f: any) => { const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false); return p.CentreOfMass().Z().toFixed(3); };
  const faces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(shell, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  log(`shell type ${String(shell.ShapeType())} faces z ${faces.map(z).join(',')}`);
  const sew = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
  sew.Add(shell); sew.Add(bottom);
  sew.Perform(new oc.Message_ProgressRange());
  const sewn = sew.SewedShape();
  const sh = oc.TopoDS.Shell(new oc.TopExp_Explorer(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE).Current());
  const fix = new oc.ShapeFix_Solid(new oc.BRepBuilderAPI_MakeSolid(sh).Solid());
  fix.Perform(new oc.Message_ProgressRange());
  const solid = fix.Solid();
  const sFaces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) sFaces.push(oc.TopoDS.Face(ex.Current()));
  const sewFaces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(sewn, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) sewFaces.push(oc.TopoDS.Face(ex.Current()));
  for (const f of faces) {
    const m = sew.ModifiedSubShape(f);
    log(`  shell face z ${z(f)}: IsModified ${sew.IsModifiedSubShape(f)}; ModifiedSubShape type ${String(m.ShapeType())} z ${m.ShapeType && String(m.ShapeType()).includes('FACE') ? z(m) : '-'}; same as a sewn face ${sewFaces.some((s) => s.IsSame(m))}; same as a solid face ${sFaces.some((s) => s.IsSame(m))}`);
  }
  log(`  sewn faces z ${sewFaces.map(z).join(',')}; solid faces z ${sFaces.map(z).join(',')}`);
}, 300_000);
