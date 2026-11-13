// Drafted extrusion edge by edge (the user's ruling of 2026-11-13): each profile edge drafted alone, so MakeDraft has no corner to trim (where it
// traps): a line as one longer line, a curve with a tangent line before and after it, a wire of one closed edge (a circle) whole. The sheets and two
// big planes at z = 0 and z = H are split into cells by BOPAlgo_MakerVolume; the cells whose bottom face lies inside the profile region are kept
// (fused when more than one). Checked against DraftAngle on outlines it can do (an L, with lines, and with "splines" through collinear points to
// force this path) and the spline outline.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { isTrap, Kernel } from '@3db/kernel';

const log = (m: string) => appendFileSync('scratch/ff/c7.log', m + String.fromCharCode(10));
const trace = (m: string) => appendFileSync('scratch/ff/c7.trace', `${new Date().toISOString().slice(11, 19)} ${m}\n`);
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });
const S = (a: number[], b: number[], source: string) => ({ kind: 'spline', points: [a, [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2], b], source });

export function draftByEdges(kernel: Kernel, regions: unknown[], H: number, angle: number) {
  const k = kernel as any;
  const oc = k.oc;
  const t0 = performance.now();
  const stages: string[] = [];
  const valid = (x: any) => new oc.BRepCheck_Analyzer(x, true, false, false).IsValid();
  const straight = kernel.extrude(XY as never, regions as never, [0, 0, H]).shape;
  const profiles: any[] = [];
  for (const ex = new oc.TopExp_Explorer(k.get(straight), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const f = oc.TopoDS.Face(ex.Current());
    const ad = new oc.BRepAdaptor_Surface(f, true);
    const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
    if (String(ad.GetType()).includes('Plane') && Math.abs(p.CentreOfMass().Z()) < 1e-9) profiles.push(f);
  }
  const box = new oc.Bnd_Box(); oc.BRepBndLib.Add(k.get(straight), box, false);
  const [lo, hi] = [box.CornerMin(), box.CornerMax()];
  const inset = H * Math.tan(Math.abs(angle));
  const size = Math.hypot(hi.X() - lo.X(), hi.Y() - lo.Y());
  const E = Math.min(size, 4 * inset + 1);
  const dir = new oc.gp_Dir(0, 0, 1);
  const inR = (x: number, y: number) => profiles.some((f) => {
    const uv = oc.GeomLib_Tool.Parameters(oc.BRep_Tool.Surface(f), new oc.gp_Pnt(x, y, 0), 1e-6);
    return String(new oc.BRepClass_FaceClassifier(f, new oc.gp_Pnt2d(uv.U + 1e-12, uv.V + 1e-12), 1e-9).State()).includes('TopAbs_IN');
  });
  const pnt = (q: number[]) => new oc.gp_Pnt(q[0], q[1], q[2]);
  // a sheet drafted from an open or closed wire, leaning the way asked: checked at the top over a sample point of the wire
  const draft = (wire: any, probe: { p: number[]; t: number[] }) => {
    for (const internal of [true, false]) {
      const md = new oc.BRepOffsetAPI_MakeDraft(wire, dir, Math.abs(angle));
      md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI);
      md.SetDraft(internal);
      md.Perform((1.5 * H) / Math.cos(angle) + 1);
      const sh = md.Shape();
      const left = [-probe.t[1]!, probe.t[0]!];
      const v = new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt(probe.p[0]! + left[0]! * inset, probe.p[1]! + left[1]! * inset, H)).Vertex();
      const dist = new oc.BRepExtrema_DistShapeShape(sh, v, oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad, new oc.Message_ProgressRange());
      const leansLeft = dist.Value() < 1e-6 * Math.max(1, inset);
      const materialLeft = inR(probe.p[0]! + left[0]! * 1e-3, probe.p[1]! + left[1]! * 1e-3);
      if (leansLeft === (materialLeft === angle > 0)) return sh;
    }
    throw new Error('no sheet leans the right way');
  };
  const mv = new oc.BOPAlgo_MakerVolume();
  let sheets = 0;
  for (const f of profiles) {
    for (const wex = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); wex.More(); wex.Next()) {
      const w = oc.TopoDS.Wire(wex.Current());
      const edges: { e: any; ad: any; ta: number; tb: number; sgn: number }[] = [];
      for (const ex = new oc.BRepTools_WireExplorer(w, f); ex.More(); ex.Next()) {
        const e = ex.Current();
        const ad = new oc.BRepAdaptor_Curve(e);
        const rev = e.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
        edges.push({ e, ad, ta: rev ? ad.LastParameter() : ad.FirstParameter(), tb: rev ? ad.FirstParameter() : ad.LastParameter(), sgn: rev ? -1 : 1 });
      }
      const P = new oc.gp_Pnt(), V = new oc.gp_Vec();
      const at = (x: (typeof edges)[number], tt: number) => { x.ad.D1(tt, P, V); const l = V.Magnitude(); return { p: [P.X(), P.Y(), P.Z()], t: [(x.sgn * V.X()) / l, (x.sgn * V.Y()) / l, (x.sgn * V.Z()) / l] }; };
      if (edges.length === 1) {
        // one closed edge (a circle, a closed spline): no corner at all, the wire is drafted as it is
        const x = edges[0]!;
        mv.AddArgument(draft(w, at(x, (x.ta + x.tb) / 2)));
        sheets++;
        continue;
      }
      for (const x of edges) {
        const s0 = at(x, x.ta), s1 = at(x, x.tb);
        const mw = new oc.BRepBuilderAPI_MakeWire();
        if (String(x.ad.GetType()).includes('Line')) {
          mw.Add(new oc.BRepBuilderAPI_MakeEdge(pnt(s0.p.map((v, i) => v - E * s0.t[i]!)), pnt(s1.p.map((v, i) => v + E * s1.t[i]!))).Edge());
        } else {
          mw.Add(new oc.BRepBuilderAPI_MakeEdge(pnt(s0.p.map((v, i) => v - E * s0.t[i]!)), pnt(s0.p)).Edge());
          mw.Add(oc.TopoDS.Edge(x.e));
          mw.Add(new oc.BRepBuilderAPI_MakeEdge(pnt(s1.p), pnt(s1.p.map((v, i) => v + E * s1.t[i]!))).Edge());
        }
        mv.AddArgument(draft(mw.Wire(), at(x, (x.ta + x.tb) / 2)));
        sheets++;
      }
    }
  }
  const pad = size + E + inset + 10;
  const plane = (z: number) => new oc.BRepBuilderAPI_MakeFace(new oc.gp_Pln(new oc.gp_Pnt(0, 0, z), dir), lo.X() - pad, hi.X() + pad, lo.Y() - pad, hi.Y() + pad).Face();
  mv.AddArgument(plane(0));
  mv.AddArgument(plane(H));
  mv.SetIntersect(true);
  mv.Perform(new oc.Message_ProgressRange());
  const keep: any[] = [];
  let cells = 0;
  for (const ex = new oc.TopExp_Explorer(mv.Shape(), oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    cells++;
    const cell = oc.TopoDS.Solid(ex.Current());
    let inside = false;
    for (const fx = new oc.TopExp_Explorer(cell, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); fx.More() && !inside; fx.Next()) {
      const f = oc.TopoDS.Face(fx.Current());
      const ad = new oc.BRepAdaptor_Surface(f, true);
      if (!String(ad.GetType()).includes('Plane')) continue;
      const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
      const Q = new oc.gp_Pnt();
      ad.D0((u0 + u1) / 2, (v0 + v1) / 2, Q);
      if (Math.abs(Q.Z()) > 1e-7) continue;
      for (let i = 0; i < 9 && !inside; i++) for (let j = 0; j < 9 && !inside; j++) {
        const [u, v] = [u0 + ((u1 - u0) * (i + 0.5)) / 9, v0 + ((v1 - v0) * (j + 0.5)) / 9];
        if (!String(new oc.BRepClass_FaceClassifier(f, new oc.gp_Pnt2d(u + 1e-12, v + 1e-12), 1e-9).State()).includes('TopAbs_IN')) continue;
        ad.D0(u, v, Q);
        inside = inR(Q.X(), Q.Y());
        j = 9; i = 9;
      }
    }
    if (inside) keep.push(cell);
  }
  stages.push(`cells valid ${keep.map(valid).join(',')}`);
  let out = keep[0];
  for (let i = 1; i < keep.length; i++) out = new oc.BRepAlgoAPI_Fuse(out, keep[i], new oc.Message_ProgressRange()).Shape();
  if (keep.length > 1) {
    const u = new oc.ShapeUpgrade_UnifySameDomain(out, true, true, false);
    u.Build();
    out = u.Shape();
  }
  const id = k.put(out);
  kernel.release(straight);
  return { id, cells, kept: keep.length, sheets, stages, ms: Math.round(performance.now() - t0) };
}

it('c7a', async () => {
  const kernel = await Kernel.load();
  const H = 10;
  const only = process.env.ONLY;
  const Lshape = (mk: typeof L) => [mk([0, 0], [30, 0], 'a'), mk([30, 0], [30, 12], 'b'), mk([30, 12], [12, 12], 'c'), mk([12, 12], [12, 25], 'e'), mk([12, 25], [0, 25], 'f'), mk([0, 25], [0, 0], 'd')];
  const hole = [{ kind: 'circle', c: [6, 6], r: 3, source: 'h' }];
  const cases: Record<string, { regions: any[]; ref?: any[] }> = {
    'L lines': { regions: [{ outer: Lshape(L), holes: [] }], ref: [{ outer: Lshape(L), holes: [] }] },
    'L as splines': { regions: [{ outer: Lshape(S as never), holes: [] }], ref: [{ outer: Lshape(L), holes: [] }] },
    'L+hole as splines': { regions: [{ outer: Lshape(S as never), holes: [hole] }], ref: [{ outer: Lshape(L), holes: [hole] }] },
    spline: { regions: [{ outer: [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')], holes: [] }] },
    'seed 4 (trapped)': { regions: [{ outer: [L([0, 0], [38.091, 0], 'a'), L([38.091, 0], [38.091, 17.995], 'b'), { kind: 'spline', points: [[38.091, 17.995], [19.046, 15.941], [0, 17.995]], source: 'c' }, L([0, 17.995], [0, 0], 'd')], holes: [] }] },
  };
  const degs = (process.env.DEGS ?? '3,-3').split(',').map(Number);
  for (const [name, c] of Object.entries(cases).filter(([n]) => !only || n === only)) for (const deg of degs) {
    const a = (deg * Math.PI) / 180;
    trace(`${name} ${deg}: start`);
    try {
      const r = draftByEdges(kernel, c.regions, H, a);
      const v = kernel.massProps(r.id as never, { eps: 1e-10 }).volume;
      let ref = '';
      if (c.ref) {
        const d = kernel.extrude(XY as never, c.ref as never, [0, 0, H], 0, undefined, a).shape;
        const vd = kernel.massProps(d, { eps: 1e-10 }).volume;
        ref = ` | DraftAngle ${vd.toFixed(6)} rel diff ${(Math.abs(v - vd) / vd).toExponential(2)}`;
        kernel.release(d);
      }
      log(`${name} ${deg}°: [${r.stages.join('; ')}] ${r.sheets} sheets, ${r.cells} cells, kept ${r.kept}, valid ${kernel.check(r.id as never).valid}, solids ${kernel.solidCount(r.id as never)}, faces ${kernel.topology(r.id as never).faces.length}, volume ${v.toFixed(6)}${ref}, ${r.ms} ms`);
      kernel.release(r.id as never);
    } catch (e) {
      log(`${name} ${deg}°: ${isTrap(e) ? 'TRAP' : 'threw'} ${String((e as Error).message ?? e).slice(0, 140)}`);
      if (isTrap(e)) return;
    }
    trace(`${name} ${deg}: done`);
  }
}, 900_000);
