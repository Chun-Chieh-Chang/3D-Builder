// C2.7c prototype: OCCT's round on a drafted boss over a tilted plate, its surface and contact edges replaced in place by the exact rolling ball.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { exactRound, supportOf, deviation, type V3, len, sub, dot, cross, unit, mul } from './rb-lib';

it('replace a round by the exact rolling ball', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any; const oc = k.oc;
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const sq = (w: number) => ({ outer: [[-w, -w], [w, -w], [w, w], [-w, w]].map((a, i, p) => ({ kind: 'line', a, b: p[(i + 1) % 4], source: 'b' + i })), holes: [] }) as any;
  const res: any = {};
  const tilt = Number(process.env.TILT ?? 0.25), draft = Number(process.env.DRAFT ?? 5);
  const plate = kernel.extrude(XY, [sq(20)], [0, 0, 5]).shape;
  const frame = { origin: [0, 0, 5], xDir: [1, 0, 0], yDir: [0, Math.cos(tilt), Math.sin(tilt)], normal: [0, -Math.sin(tilt), Math.cos(tilt)] } as any;
  const boss = kernel.extrude({ ...frame, origin: [0, -2 * Math.sin(tilt), 5 - 2 * Math.cos(tilt)] }, [{ outer: [{ kind: 'circle', c: [0, 0], r: 6, source: 'c' }], holes: [] }], frame.normal.map((x: number) => x * 12), 0, undefined, (draft * Math.PI) / 180).shape;
  const s = kernel.boolean('fuse', plate, boss).shape;
  const t = kernel.topology(s);
  const isTop = (f: any) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6;
  const isSide = (f: any) => f.geometry?.type === 'cone' || f.geometry?.type === 'cylinder';
  const top = t.faces.findIndex(isTop), side = t.faces.findIndex(isSide);
  const edgeIdx = t.edges.findIndex((e: any) => e.faces.includes(top) && e.faces.includes(side));
  const list = (shape: any, kind: any) => { const out: any[] = []; for (const ex = new oc.TopExp_Explorer(shape, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) out.push(ex.Current()); return out; };
  const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE, EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE, VERT = oc.TopAbs_ShapeEnum.TopAbs_VERTEX;
  const nearEdge = (shape: any, m: number[]) => list(shape, EDGE).map((x) => oc.TopoDS.Edge(x)).find((ed: any) => { const ad = new oc.BRepAdaptor_Curve(ed); const pm = ad.Value((ad.FirstParameter() + ad.LastParameter()) / 2); return Math.hypot(pm.X() - m[0], pm.Y() - m[1], pm.Z() - m[2]) < 1e-6; });
  const sharp = new oc.BRepAdaptor_Curve(nearEdge(k.get(s), t.edges[edgeIdx].mid));
  const pt = (p: any): V3 => [p.X(), p.Y(), p.Z()];

  for (const r of [0.381, 1.5]) for (const seamSwap of [false, true]) {
    const key = `r=${r} seamSwap=${seamSwap}`;
    let step = 'start';
    try {
      step = 'fillet'; const fil = kernel.fillet(s, [edgeIdx], r).shape;
      const volOcct = kernel.massProps(fil).volume;
      step = 'copy'; const shape = new oc.BRepBuilderAPI_Copy(k.get(fil), true, false).Shape();
      const id = k.put(shape); const tt = kernel.topology(id);
      const faces = list(shape, FACE).map((x) => oc.TopoDS.Face(x));
      const fTop = tt.faces.findIndex(isTop), fSide = tt.faces.findIndex(isSide);
      const fRound = tt.faces.findIndex((f: any, i: number) => i !== fTop && i !== fSide && tt.edges.some((e: any) => e.faces.includes(i) && e.faces.includes(fTop)));
      const Fold = faces[fRound];
      const sTop = supportOf(oc, faces[fTop]), sSide = supportOf(oc, faces[fSide]);
      step = 'devOcct'; const devOcct = deviation(oc, Fold, [sTop, sSide], r);
      // orientation: the exact surface's normal must agree with the face's
      let sup = [sTop, sSide], supFace = [faces[fTop], faces[fSide]];
      step = 'exactRound'; let ex = exactRound(oc, sup[0]!, sup[1]!, sharp, r, 1);
      {
        const ad = new oc.BRepAdaptor_Surface(Fold, true); const um = (ad.FirstUParameter() + ad.LastUParameter()) / 2, vm = (ad.FirstVParameter() + ad.LastVParameter()) / 2;
        const d = ad.EvalD1(um, vm); let n0 = unit(cross(pt(d.D1U), pt(d.D1V))); /* the face's own (unoriented) normal: the wires are copied from it and its orientation in the shell is kept */
        const pr = new oc.GeomAPI_ProjectPointOnSurf(d.Point, ex.surf); const uv = pr.LowerDistanceParameters(0, 0);
        const e1 = new oc.GeomAdaptor_Surface(ex.surf).EvalD1(uv.U, uv.V); const n1 = unit(cross(pt(e1.D1U), pt(e1.D1V)));
        if (dot(n0, n1) < 0) { sup = [sSide, sTop]; supFace = [faces[fSide], faces[fTop]]; ex = exactRound(oc, sup[0]!, sup[1]!, sharp, r, 1); }
      }
      // start the round's u at the seam OCCT put: the sharp edge's parameter nearest the seam's start
      { const Fe: any[] = []; for (const e of list(Fold, EDGE)) if (!Fe.some((x) => x.IsSame(e))) Fe.push(oc.TopoDS.Edge(e)); const se = Fe.find((e) => oc.BRep_Tool.IsClosed(e, Fold)); if (se) { const c = new oc.BRepAdaptor_Curve(se); const q = pt(c.Value(c.FirstParameter())); let best = Infinity, bt = 0; const N = 4000; const a = sharp.FirstParameter(), b = sharp.LastParameter(); for (let i = 0; i < N; i++) { const tt2 = a + ((b - a) * i) / N; const d2 = len(sub(pt(sharp.Value(tt2)), q)); if (d2 < best) { best = d2; bt = tt2; } } let lo = bt - (b - a) / N, hi = bt + (b - a) / N; for (let it = 0; it < 80; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (len(sub(pt(sharp.Value(m1)), q)) < len(sub(pt(sharp.Value(m2)), q))) hi = m2; else lo = m1; } { const sideI = supFace[0] === faces[fSide] ? 0 : 1; const adS = new oc.BRepAdaptor_Surface(faces[fSide], true); ex = exactRound(oc, sup[0]!, sup[1]!, sharp, r, 1, 200, 5, (lo + hi) / 2, adS.IsUPeriodic() ? { index: sideI * 2, value: adS.FirstUParameter(), period: adS.UPeriod() } : undefined); } } }
      const L = ex.u1; const tol = 1e-7; const B = new oc.BRep_Builder(); const loc = new oc.TopLoc_Location();
      const info: any = { volOcct, devOcct, closed: ex.closed, residual: ex.residual, edges: [] };
      const Fedges: any[] = []; for (const e of list(Fold, EDGE)) if (!Fedges.some((x) => x.IsSame(e))) Fedges.push(oc.TopoDS.Edge(e));
      const kinds = Fedges.map((e) => (oc.BRep_Tool.IsClosed(e, Fold) ? 'seam' : 'contact'));
      const iso0 = ex.surf.VIso(0), iso1 = ex.surf.VIso(1);
      const seamI = kinds.indexOf('seam');
      if (seamI < 0 || !ex.closed) throw new Error('only a closed round with a seam is handled yet');
      const us = 0;
      info.us = us; info.kinds = kinds;
      const FWD = oc.TopAbs_Orientation.TopAbs_FORWARD, REV = oc.TopAbs_Orientation.TopAbs_REVERSED;
      const mkV = (p: any) => { const v = new oc.TopoDS_Vertex(); B.MakeVertex(v, p, tol); return v; };
      // keep the vertices the rest of the body shares (the side's own seam ends at one), only moved onto the exact contact curves
      const oldV = (ei: number) => oc.TopoDS.Vertex(list(Fedges[ei], VERT)[0].Oriented(FWD));
      const contactOn = Fedges.map((e) => { const c = new oc.BRepAdaptor_Curve(e); const p = pt(c.Value((c.FirstParameter() + c.LastParameter()) / 2)); return sup[0]!.dist(p) < sup[1]!.dist(p) ? 0 : 1; });
      const V0 = oldV(kinds.findIndex((k2, i) => k2 === 'contact' && contactOn[i] === 0)), V1 = oldV(kinds.findIndex((k2, i) => k2 === 'contact' && contactOn[i] === 1));
      info.foldOrientation = Fold.Orientation() === FWD ? 'F' : 'R';
      for (const [V, p] of [[V0, ex.surf.Value(us, 0)], [V1, ex.surf.Value(us, 1)]] as const) {
        const before = oc.BRep_Tool.Pnt(V); (info.vertexMoved ??= []).push(before.Distance(p));
        B.UpdateVertex(V, p, tol);
        // every other edge ending at V: its parameter there and its range
        const seen: any[] = [];
        for (const f of faces) for (const e of list(f, EDGE)) {
          const ed = oc.TopoDS.Edge(e.Oriented(FWD)); if (Fedges.some((x) => x.IsSame(ed)) || seen.some((x) => x.IsSame(ed))) continue; seen.push(ed);
          for (const vv of list(ed, VERT)) if (vv.IsSame(V)) {
            const c = new oc.BRepAdaptor_Curve(ed); const C = oc.BRep_Tool.Curve(ed, 0, 0); const crv = C.returnValue ?? C;
            const par = new oc.GeomAPI_ProjectPointOnCurve(p, crv).LowerDistanceParameter();
            const isF = vv.Orientation() === FWD;
            B.UpdateVertex(oc.TopoDS.Vertex(vv), par, ed, tol);
            const f0 = c.FirstParameter(), f1 = c.LastParameter();
            B.Range(ed, isF ? par : f0, isF ? f1 : par, false);
            (info.otherEdges ??= []).push(isF ? par - f0 : par - f1);
          }
        }
      }
      step = 'newFace'; const Fnew = new oc.TopoDS_Face(); B.MakeFace(Fnew, ex.surf, loc, tol);
      const surfOf = (f: any) => oc.BRep_Tool.Surface(f);
      const newOf: any[] = []; const flips: boolean[] = [];
      Fedges.forEach((e, ei) => {
        const ca = new oc.BRepAdaptor_Curve(e); const a0 = ca.FirstParameter(), a1 = ca.LastParameter();
        const E2 = new oc.TopoDS_Edge();
        if (kinds[ei] === 'seam') {
          step = 'seam';
          const p0 = pt(ca.Value(a0));
          flips[ei] = !(sup[0]!.dist(p0) < sup[1]!.dist(p0));
          B.MakeEdge(E2, ex.surf.UIso(us), tol);
          B.Add(E2, V0.Oriented(FWD)); B.Add(E2, V1.Oriented(REV));
          B.Range(E2, 0, 1, false);
          const line = (u: number) => new oc.Geom2d_Line(new oc.gp_Pnt2d(u, 0), new oc.gp_Dir2d(0, 1));
          const [c1, c2] = seamSwap ? [line(us + L), line(us)] : [line(us), line(us + L)];
          B.UpdateEdge(E2, c1, c2, Fnew, tol);
          B.UpdateVertex(oc.TopoDS.Vertex(V0.Oriented(FWD)), 0, E2, tol); B.UpdateVertex(oc.TopoDS.Vertex(V1.Oriented(REV)), 1, E2, tol);
          info.edges.push({ kind: 'seam', flip: flips[ei] });
        } else {
          step = 'contact';
          const pm = ca.Value((a0 + a1) / 2);
          const which = sup[0]!.dist(pt(pm)) < sup[1]!.dist(pt(pm)) ? 0 : 1; const vc = which; const iso = which ? iso1 : iso0;
          const d = ca.EvalD1((a0 + a1) / 2); const um = new oc.GeomAPI_ProjectPointOnCurve(d.Point, iso).LowerDistanceParameter();
          const same = dot(pt(d.D1), pt(new oc.GeomAdaptor_Curve(iso).EvalD1(um).D1)) > 0;
          flips[ei] = !same;
          if (!(ca.Value(a0).Distance(ca.Value(a1)) < 1e-7)) throw new Error('open contact edge not handled yet');
          const V = which ? V1 : V0;
          B.MakeEdge(E2, iso, tol);
          B.Add(E2, V.Oriented(FWD)); B.Add(E2, V.Oriented(REV));
          B.Range(E2, us, us + L, false);
          B.UpdateEdge(E2, new oc.Geom2d_Line(new oc.gp_Pnt2d(0, vc), new oc.gp_Dir2d(1, 0)), Fnew, tol);
          step = 'projPcurve'; const G = supFace[which]; const adG = new oc.BRepAdaptor_Surface(G, true); const old2 = new oc.BRepAdaptor_Curve2d(e, G); const s2 = old2.Value(flips[ei] ? old2.LastParameter() : old2.FirstParameter()); const pcG = ex.pcurve(which ? 2 : 0, [adG.IsUPeriodic() ? adG.UPeriod() : 0, adG.IsVPeriodic() ? adG.VPeriod() : 0], [s2.X(), s2.Y()]);
          B.UpdateEdge(E2, pcG, G, tol);
          B.UpdateVertex(oc.TopoDS.Vertex(V.Oriented(FWD)), us, E2, tol); B.UpdateVertex(oc.TopoDS.Vertex(V.Oriented(REV)), us + L, E2, tol);
          info.edges.push({ kind: 'contact', support: which, flip: flips[ei] });
        }
        newOf[ei] = E2;
      });
      step = 'wires';
      for (const w of list(Fold.Oriented(FWD), oc.TopAbs_ShapeEnum.TopAbs_WIRE)) {
        const W = new oc.TopoDS_Wire(); B.MakeWire(W);
        for (const e of list(w.Oriented(FWD), EDGE)) { const ei = Fedges.findIndex((x) => x.IsSame(e)); B.Add(W, newOf[ei].Oriented(flips[ei] ? (e.Orientation() === FWD ? REV : FWD) : e.Orientation())); }
        B.Add(Fnew, W.Oriented(w.Orientation()));
      }
      const FnewO = Fnew.Oriented(Fold.Orientation());
      step = 'rebuild';
      const repl = (e: any) => { const i = Fedges.findIndex((x) => x.IsSame(e)); return i >= 0 ? newOf[i] : null; };
      const shell = new oc.TopoDS_Shell(); B.MakeShell(shell);
      for (const f of faces) {
        if (f.IsSame(Fold)) { B.Add(shell, FnewO); continue; }
        const touched = list(f, EDGE).some((e) => repl(e));
        if (!touched) { B.Add(shell, f); continue; }
        const G2 = new oc.TopoDS_Face(); const Sf = oc.BRep_Tool.Surface(f); B.MakeFace(G2, Sf, f.Location(), oc.BRep_Tool.Tolerance(f));
        for (const w of list(f.Oriented(FWD), oc.TopAbs_ShapeEnum.TopAbs_WIRE)) {
          const W = new oc.TopoDS_Wire(); B.MakeWire(W);
          for (const e of list(w.Oriented(FWD), EDGE)) { const i2 = Fedges.findIndex((x) => x.IsSame(e)); B.Add(W, i2 >= 0 ? newOf[i2].Oriented(flips[i2] ? (e.Orientation() === FWD ? REV : FWD) : e.Orientation()) : e); }
          B.Add(G2, W.Oriented(w.Orientation()));
        }
        B.Add(shell, G2.Oriented(f.Orientation()));
      }
      const solid = new oc.TopoDS_Solid(); B.MakeSolid(solid); B.Add(solid, shell);
      const shape2 = solid;
      const facesN = list(shape2, FACE).map((x) => oc.TopoDS.Face(x));
      const shapeOld = shape;
      step = 'diag'; const okOf = (x: any) => new oc.BRepCheck_Analyzer(x, true, false, false).IsValid();
      info.faceOk = { round: okOf(Fnew), top: okOf(facesN[fTop]), side: okOf(facesN[fSide]) };
      info.edgeOk = newOf.map((e) => okOf(e));
      info.edgeTol = newOf.map((e) => oc.BRep_Tool.Tolerance(e));
      // wire closure in uv on the round
      { const w = 0; info.wires = list(Fnew, oc.TopAbs_ShapeEnum.TopAbs_WIRE).map((x: any) => okOf(x)); }
      { const sa = new oc.ShapeAnalysis_Edge(); info.sameParam = newOf.map((e) => { try { const r2 = sa.CheckSameParameter(e, 0, 23); return r2.returnValue !== undefined ? [r2.returnValue, r2.maxdev] : r2; } catch (er) { return 'x'; } }); }
      info.roundInShape = list(shape2, FACE).some((f: any) => f.IsSame(Fnew));
      const id2 = k.put(shape2); step = 'check'; const chk = new oc.BRepCheck_Analyzer(shape2, true, false, false);
      info.valid = chk.IsValid();
      { const names = new Map<any, string>(); for (const [n, v] of Object.entries(oc.BRepCheck_Status)) names.set((v as any)?.value ?? v, n);
        const lst = (l: any) => { const c = new oc.NCollection_List_BRepCheck_Status(l); const out: string[] = []; for (let q = 0; q < 12; q++) { let empty = false; try { empty = c.IsEmpty ? c.IsEmpty() : c.Size() === 0; } catch { empty = true; } if (empty) break; const st = c.First(); const n = names.get(st?.value ?? st) ?? String(st?.value ?? st); if (n !== 'BRepCheck_NoError') out.push(n); c.RemoveFirst(); } return out; };
        const rep = (x: any, label: string) => { let rr: any; try { rr = chk.Result(x); } catch { (info.status ??= {})[label] = 'not in map'; return; } if (!rr) return; const o: any = { self: lst(rr.Status()) }; try { rr.InitContextIterator(); let q = 0; while (rr.MoreShapeInContext() && q++ < 10) { const ss = lst(rr.StatusOnShape()); if (ss.length) (o.ctx ??= []).push(ss); rr.NextShapeInContext(); } } catch {} if (o.self.length || o.ctx) (info.status ??= {})[label] = o; };
        rep(Fnew, 'round'); rep(facesN[fSide], 'side'); rep(facesN[fTop], 'top');
        list(Fnew, oc.TopAbs_ShapeEnum.TopAbs_WIRE).forEach((w: any, i: number) => rep(w, 'roundWire' + i));
        list(facesN[fSide], oc.TopAbs_ShapeEnum.TopAbs_WIRE).forEach((w: any, i: number) => rep(w, 'sideWire' + i));
        newOf.forEach((e: any, i: number) => rep(e, 'edge' + i + kinds[i]));
        list(facesN[fSide], EDGE).forEach((e: any, i: number) => rep(e, 'sideEdge' + i));
        list(shape2, VERT).forEach((v: any, i: number) => rep(v, 'v' + i)); }
      res[key] = info; try { info.volExact = kernel.massProps(id2).volume; } catch (e: any) { info.volExact = 'err ' + (k.oc.getExceptionMessage ? String(k.oc.getExceptionMessage(e)) : String(e)); }
      step = 'devExact'; info.devExact = deviation(oc, Fnew, sup, r);
      info.maxTol = null;
      info.dVolume = typeof info.volExact === 'number' ? info.volExact - volOcct : null; try { const pr = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape2, pr, 1e-9, false, false); info.volGprop = pr.Mass() - volOcct; } catch (e: any) { info.volGprop = 'err'; }
      res[key] = info;
    } catch (e: any) { let m = ''; try { m = k.oc.getExceptionMessage ? String(k.oc.getExceptionMessage(e)) : ''; } catch {} res[key] = (typeof step !== 'undefined' ? step : '?') + ': ' + (e?.message ?? '') + ' ' + m; }
  }
  writeFileSync(process.env.OUT ?? 'exactreplace.json', JSON.stringify(res, null, 1));
}, 600000);
