// C2.7d: closed and open rounds of a drafted boss on a plate, OCCT's round replaced by the exact rolling ball (rb-replace.ts).
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { deviation, supportOf } from './rb-lib';
import { exactify, trace } from './rb-replace';

it('exact rounds, closed and open', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any; const oc = k.oc;
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const sq = (w: number) => ({ outer: [[-w, -w], [w, -w], [w, w], [-w, w]].map((a, i, p) => ({ kind: 'line', a, b: p[(i + 1) % 4], source: 'b' + i })), holes: [] }) as any;
  const list = (s: any, kind: any) => { const out: any[] = []; for (const ex = new oc.TopExp_Explorer(s, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) out.push(ex.Current()); return out; };
  const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE, EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
  const res: any = {};
  const cases = (process.env.CASES ?? 'closed:0.25:5:0,closed:0:0:0,open:0:0:17,open:0.25:5:17,open:0.25:5:-17').split(',');
  for (const cs of cases) for (const r of [0.381, 1.5]) {
    const [kind, tiltS, draftS, cyS] = cs.split(':'); const tilt = Number(tiltS), draft = Number(draftS), cy = Number(cyS);
    const key = `${cs} r=${r}`; let step = 'build';
    try {
      const plate = kernel.extrude(XY, [sq(20)], [0, 0, 5]).shape;
      const frame = (kind === 'open' ? { origin: [0, cy, 5], xDir: [0, Math.sign(cy) * Math.cos(tilt), Math.sign(cy) * Math.sin(tilt)], yDir: [-Math.sign(cy), 0, 0], normal: [0, -Math.sin(tilt), Math.cos(tilt)] } : { origin: [0, cy, 5], xDir: [1, 0, 0], yDir: [0, Math.cos(tilt), Math.sin(tilt)], normal: [0, -Math.sin(tilt), Math.cos(tilt)] }) as any; // an open case puts the boss's seam off the plate, so the edge to round is one piece
      const boss = kernel.extrude({ ...frame, origin: [0, cy - 2 * Math.sin(tilt), 5 - 2 * Math.cos(tilt)] }, [{ outer: [{ kind: 'circle', c: [0, 0], r: 6, source: 'c' }], holes: [] }], frame.normal.map((x: number) => x * 12), 0, undefined, (draft * Math.PI) / 180).shape;
      const s = kernel.boolean('fuse', plate, boss).shape;
      const t = kernel.topology(s);
      const isTop = (f: any) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6;
      const isSide = (f: any) => f.geometry?.type === 'cone' || f.geometry?.type === 'cylinder';
      const top = t.faces.findIndex(isTop), side = t.faces.findIndex(isSide);
      const edgeIdx = t.edges.findIndex((e: any) => e.faces.includes(top) && e.faces.includes(side));
      const m = t.edges[edgeIdx].mid;
      const sharpE = list(k.get(s), EDGE).map((x) => oc.TopoDS.Edge(x)).find((ed: any) => { const ad = new oc.BRepAdaptor_Curve(ed); const pm = ad.Value((ad.FirstParameter() + ad.LastParameter()) / 2); return Math.hypot(pm.X() - m[0], pm.Y() - m[1], pm.Z() - m[2]) < 1e-6; });
      const sharp = new oc.BRepAdaptor_Curve(sharpE);
      step = 'fillet'; const fil = kernel.fillet(s, [edgeIdx], r).shape;
      const volOcct = kernel.massProps(fil).volume;
      const shape = new oc.BRepBuilderAPI_Copy(k.get(fil), true, false).Shape();
      const tt = kernel.topology(k.put(shape));
      const faces = list(shape, FACE).map((x) => oc.TopoDS.Face(x));
      const fTop = tt.faces.findIndex(isTop), fSide = tt.faces.findIndex(isSide);
      const rounds = tt.faces.flatMap((f: any, i: number) => (!['plane', 'cone', 'cylinder'].includes(f.geometry?.type ?? f.surface) && i !== fTop && i !== fSide && tt.edges.some((e: any) => e.faces.includes(i) && e.faces.includes(fTop)) && tt.edges.some((e: any) => e.faces.includes(i) && e.faces.includes(fSide)) ? [i] : []));
      if (rounds.length !== 1) throw new Error(`${rounds.length} round faces`);
      const Fold = faces[rounds[0]];
      const supF = [faces[fTop], faces[fSide]];
      const devOcct = deviation(oc, Fold, supF.map((f) => supportOf(oc, f)), r);
      step = 'exactify'; const out = exactify(oc, shape, Fold, supF, sharp, r, 1, true, k.get(s));
      step = 'check';
      const valid = new oc.BRepCheck_Analyzer(out.shape, true, false, false).IsValid();
      const status: any = {};
      if (!valid) { const chk = new oc.BRepCheck_Analyzer(out.shape, true, false, false); const names = new Map<any, string>(); for (const [n, v] of Object.entries(oc.BRepCheck_Status)) names.set((v as any)?.value ?? v, n);
        const lst = (l: any) => { const c = new oc.NCollection_List_BRepCheck_Status(l); const o: string[] = []; for (let q = 0; q < 12; q++) { let empty = false; try { empty = c.IsEmpty ? c.IsEmpty() : c.Size() === 0; } catch { empty = true; } if (empty) break; const st = c.First(); const n = names.get(st?.value ?? st) ?? String(st); if (n !== 'BRepCheck_NoError') o.push(n.replace('BRepCheck_', '')); c.RemoveFirst(); } return o; };
        for (const [kn, kd] of [['F', FACE], ['W', oc.TopAbs_ShapeEnum.TopAbs_WIRE], ['E', EDGE], ['V', oc.TopAbs_ShapeEnum.TopAbs_VERTEX]] as const) list(out.shape, kd).forEach((x: any, i: number) => { let rr: any; try { rr = chk.Result(x); } catch { return; } if (!rr) return; const o = lst(rr.Status()); try { rr.InitContextIterator(); let q = 0; while (rr.MoreShapeInContext() && q++ < 10) { o.push(...lst(rr.StatusOnShape()).map((z) => 'ctx:' + z)); rr.NextShapeInContext(); } } catch {} if (o.length) { let key2 = kn + i; try { key2 = kn + i + (kn === 'E' ? ':' + (() => { const c = oc.BRep_Tool.Curve(oc.TopoDS.Edge(x), 0, 0); const cc = c.returnValue ?? c; const g = new oc.GeomAdaptor_Curve(cc); const rr2 = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(x)); return cc.DynamicType().Name() + ` dom[${g.FirstParameter().toFixed(6)},${g.LastParameter().toFixed(6)}] rng[${rr2.FirstParameter().toFixed(6)},${rr2.LastParameter().toFixed(6)}]`; })() : '') + (kn === 'F' ? ':' + (new oc.BRepAdaptor_Surface(oc.TopoDS.Face(x), false).GetType()?.value ?? '') + (x.IsSame(out.round) ? '(round)' : '') : ''); } catch (er: any) { key2 += ':' + (oc.getExceptionMessage ? String(oc.getExceptionMessage(er)) : String(er)).slice(0, 60); } status[key2] = [...new Set(o)]; } }); }
      let volExact: any = null; try { volExact = kernel.massProps(k.put(out.shape)).volume; } catch (e: any) { volExact = 'err'; }
      const devExact = deviation(oc, out.round, out.info.sup, r);
      const gv = (sh: any, eps: number) => { const pr = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(sh, pr, eps, false, false); return pr.Mass(); };
      let fine: any = null; try { const o1 = gv(shape, 1e-11), e1 = gv(out.shape, 1e-11); fine = { rel: +((e1 - o1) / o1).toExponential(3) }; } catch (e: any) { fine = 'err'; }
      const maxTol = (sh: any) => Math.max(...list(sh, EDGE).map((x: any) => oc.BRep_Tool.Tolerance(oc.TopoDS.Edge(x))));
      const { sup: _s, ...info } = out.info;
      res[key] = { valid, devOcct: +devOcct.toExponential(3), devExact: +devExact.toExponential(3), dVolume: typeof volExact === 'number' ? +(volExact - volOcct).toExponential(3) : volExact, relVolume: typeof volExact === 'number' ? +((volExact - volOcct) / volOcct).toExponential(3) : null, faces: tt.faces.length, status, fine, tolOcct: maxTol(shape), tolExact: maxTol(out.shape), ...info };
    } catch (e: any) { let mm = ''; try { mm = oc.getExceptionMessage ? String(oc.getExceptionMessage(e)) : ''; } catch {} res[key] = `${step}/${trace.step}: ${e?.message ?? ''} ${mm}`; }
  }
  writeFileSync(process.env.OUT ?? 'exactopen.json', JSON.stringify(res, null, 1));
}, 600000);
