// Recognizing part-3's B regions, probe 2: is f80 the drafted wall of its own lower rail, built by this program (ADR 0251), and does that tool cut part-3?
// f80 is ruled in u (degree 1), its rails flat at z 20.598 / 15.687 (c8a). The lower rail (UIso at the end whose z is lower) is taken exactly, as a
// NURBS sketch edge in the plane z = z_b; the outline is closed outside the material (along the face's outward normal, D mm out). Extruded up to the upper
// rail's level with a draft of +α and −α. For each: valid; the largest distance from 81 points inside f80 to the tool's wall named 'w'. Then the better
// tool cut from part-3: does the Boolean return (timed), and the volume change (the tool lies in air up to the file's precision, so the change is small).
// JOB=fit | cut. Trace before every step; product code untouched.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { part3 } from './c5a.test';

const log = (m: string) => appendFileSync('scratch/ff/c8.log', m + String.fromCharCode(10));
const trace = (m: string) => appendFileSync('scratch/ff/c8.trace', `${new Date().toISOString().slice(11, 19)} ${m}\n`);
const WALL = 80;
const D = 30;

it('c8b', async () => {
  const job = process.env.JOB ?? 'fit';
  trace(`c8b ${job} load`);
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const id = part3(kernel);
  const tau = kernel.fileTolerance(id).faces[WALL] ?? 0;
  const faces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const face = faces[WALL];
  const ad = new oc.BRepAdaptor_Surface(face, true);
  if (ad.UDegree() !== 1) throw new Error('f80 is not ruled in u');
  const s = ad.BSpline();
  const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
  const zAt = (u: number) => ad.Value(u, (v0 + v1) / 2).Z();
  const [uLow, uHigh] = zAt(u0) < zAt(u1) ? [u0, u1] : [u1, u0];
  const zb = zAt(uLow);
  const H = zAt(uHigh) - zb;
  const rail = oc.GeomConvert.CurveToBSplineCurve(s.UIso(uLow));
  const np = rail.NbPoles();
  const poles: [number, number][] = [];
  const weights: number[] = [];
  let zoff = 0;
  for (let i = 1; i <= np; i++) { const p = rail.Pole(i); poles.push([p.X(), p.Y()]); zoff = Math.max(zoff, Math.abs(p.Z() - zb)); weights.push(rail.Weight(i)); }
  const knots: number[] = [];
  const mults: number[] = [];
  for (let i = 1; i <= rail.NbKnots(); i++) { knots.push(rail.Knot(i)); mults.push(rail.Multiplicity(i)); }
  const pa = rail.Value(rail.FirstParameter());
  const pm = rail.Value((rail.FirstParameter() + rail.LastParameter()) / 2);
  const pb = rail.Value(rail.LastParameter());
  const [A, M, B] = [[pa.X(), pa.Y()], [pm.X(), pm.Y()], [pb.X(), pb.Y()]] as [number, number][];
  // outward: the face's normal (oriented) at the middle, horizontal part
  const gp = new oc.BRepGProp_Face(face, false);
  const P0 = new oc.gp_Pnt();
  const N0 = new oc.gp_Vec();
  gp.Normal((u0 + u1) / 2, (v0 + v1) / 2, P0, N0);
  const out = (() => { const l = Math.hypot(N0.X(), N0.Y()); return [N0.X() / l, N0.Y() / l]; })();
  log(`== c8b ${job}: z_b ${zb.toFixed(5)} H ${H.toFixed(5)}; rail degree ${rail.Degree()} poles ${np} rational ${rail.IsRational()} off its plane ${zoff.toExponential(1)}; outward (${out.map((x) => x.toFixed(4))}); τ ${tau.toExponential(1)}`);
  const L = (a: [number, number], b: [number, number], source: string) => ({ kind: 'line', a, b, source });
  const far = (p: [number, number]): [number, number] => [p[0] + out[0]! * D, p[1] + out[1]! * D];
  const outline = [
    { kind: 'spline', points: [A, M, B], nurbs: { poles, degree: rail.Degree(), knots, mults, ...(rail.IsRational() ? { weights } : {}) }, source: 'w' },
    L(B, far(B), 'x1'), L(far(B), far(A), 'x2'), L(far(A), A, 'x3'),
  ];
  const frame = { origin: [0, 0, zb], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const alpha = (1.5 * Math.PI) / 180;
  // points inside f80
  const pts: any[] = [];
  const P = new oc.gp_Pnt();
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    const [u, v] = [u0 + ((u1 - u0) * (i + 0.5)) / 9, v0 + ((v1 - v0) * (j + 0.5)) / 9];
    const cls = new oc.BRepClass_FaceClassifier(face, new oc.gp_Pnt2d(u + 1e-9, v + 1e-9), 1e-9);
    if (String(cls.State()).includes('TopAbs_IN')) { ad.D0(u, v, P); pts.push(new oc.gp_Pnt(P.X(), P.Y(), P.Z())); }
    cls.delete();
  }
  let best: { sign: number; worst: number; tool: any } | null = null;
  for (const sign of [1, -1]) {
    trace(`extrude ${sign}`);
    let r: any;
    try { r = kernel.extrude(frame as never, [{ outer: outline, holes: [] }] as never, [0, 0, H], 0, undefined, sign * alpha); }
    catch (e) { log(`  draft ${sign > 0 ? '+' : '−'}1.5°: refused — ${(e as Error).message.slice(0, 160)}`); continue; }
    const valid = kernel.check(r.shape).valid;
    const tf: any[] = [];
    for (const ex = new oc.TopExp_Explorer(k.get(r.shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) tf.push(oc.TopoDS.Face(ex.Current()));
    const wi = r.faceOrigins.findIndex((o: any[]) => o.some((x) => x.rel === 'generated' && x.source === 'w'));
    let worst = 0;
    for (const p of pts) {
      const vtx = new oc.BRepBuilderAPI_MakeVertex(p).Vertex();
      const d = new oc.BRepExtrema_DistShapeShape(vtx, tf[wi], oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad, new oc.Message_ProgressRange());
      worst = Math.max(worst, d.IsDone() ? d.Value() : Infinity);
      d.delete();
    }
    log(`  draft ${sign > 0 ? '+' : '−'}1.5°: valid ${valid}; wall face ${wi} (${String(new oc.BRepAdaptor_Surface(tf[wi], true).GetType()).replace('GeomAbs_', '')}); f80's ${pts.length} points off it by up to ${worst.toExponential(2)} mm`);
    if (!best || worst < best.worst) { if (best) kernel.release(best.tool); best = { sign, worst, tool: r.shape }; } else kernel.release(r.shape);
  }
  if (job === 'cut' && best) {
    const v0m = kernel.massProps(id).volume;
    trace('cut');
    const t0 = Date.now();
    const cut = kernel.boolean('cut', id, best.tool);
    const v1m = kernel.massProps(cut.shape).volume;
    log(`  cut part-3 by the ${best.sign > 0 ? '+' : '−'} tool: ${((Date.now() - t0) / 1000).toFixed(1)} s, valid ${kernel.check(cut.shape).valid}, volume ${v0m.toFixed(4)} → ${v1m.toFixed(4)} (Δ ${(v1m - v0m).toExponential(2)} mm³)`);
  }
  trace(`c8b ${job} done`);
}, 600_000);
