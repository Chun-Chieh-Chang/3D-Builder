// C5 feasibility, the hypothesis from c5c: each region of part-3 is a drafted extrusion of a spline outline (the ruled face) with rounds along its
// edges. (1) For the ruled face (f80; f97): the plane of each rail, and the angle of every ruling to that plane's normal (constant = one draft angle);
// how far the far rail is from the near rail moved along the normal and offset sideways by h·tan(angle) (an exact draft). (2) For every other face of
// the region: Kernel.rollingBall against every pair of its neighbours, the spline wall included (recognition only asks analytic supports).
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { part3 } from './c5a.test';

const log = (m: string) => appendFileSync('scratch/ff/c5.log', m + String.fromCharCode(10));

it('c5d', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const id = part3(kernel);
  const topo = kernel.topology(id);
  const tau = kernel.fileTolerance(id).faces;
  const { regions } = JSON.parse(readFileSync('scratch/ff/c5-regions.json', 'utf8'));
  const faces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const P = (p: any) => [p.X(), p.Y(), p.Z()];
  const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);
  const add = (a: number[], b: number[], s = 1) => a.map((x, i) => x + b[i]! * s);
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
  const cross = (u: number[], v: number[]) => [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const unit = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const adjOf = (f: number) => [...new Set(topo.edges.filter((e) => e.faces.includes(f)).flatMap((e) => e.faces))].filter((n) => n !== f);
  for (const [r, ruled] of [[0, 97], [2, 80]] as const) {
    log(`== region ${r}: ruled face f${ruled}`);
    const ad = new oc.BRepAdaptor_Surface(faces[ruled], true);
    const inU = ad.UDegree() === 1;
    const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
    const N = 40;
    const rail = (side: 0 | 1) => Array.from({ length: N + 1 }, (_, i) => {
      const t = inU ? v0 + ((v1 - v0) * i) / N : u0 + ((u1 - u0) * i) / N;
      return P(inU ? ad.Value(side ? u1 : u0, t) : ad.Value(t, side ? v1 : v0));
    });
    const [a, b] = [rail(0), rail(1)];
    // the plane of rail a: normal from the cross of two chords
    const n = unit(cross(sub(a[Math.floor(N / 3)]!, a[0]!), sub(a[Math.floor((2 * N) / 3)]!, a[0]!)));
    const angles = a.map((p, i) => { const d = unit(sub(b[i]!, p)); return (Math.acos(Math.min(1, Math.abs(dot(d, n)))) * 180) / Math.PI; });
    const h = a.map((p, i) => Math.abs(dot(sub(b[i]!, p), n)));
    log(`  rail plane normal (${n.map((x) => x.toFixed(4))}); height ${Math.min(...h).toFixed(5)}..${Math.max(...h).toFixed(5)}; ruling angle to normal ${Math.min(...angles).toFixed(4)}°..${Math.max(...angles).toFixed(4)}°`);
    // exact draft: b(i) = a(i) + h·n ± h·tan(α)·(in-plane normal of rail a at i)
    const alpha = (angles.reduce((s, x) => s + x, 0) / angles.length) * (Math.PI / 180);
    const H = h.reduce((s, x) => s + x, 0) / h.length;
    let worst = 0;
    for (let i = 1; i < N; i++) {
      const tg = unit(sub(a[i + 1]!, a[i - 1]!));
      const side = unit(cross(n, tg));
      const ruling = sub(b[i]!, a[i]!);
      const sgn = Math.sign(dot(ruling, side)) || 1;
      const ideal = add(add(a[i]!, n, Math.sign(dot(ruling, n)) * H), side, sgn * H * Math.tan(alpha));
      worst = Math.max(worst, Math.hypot(...sub(ideal, b[i]!)));
    }
    log(`  mean draft ${((alpha * 180) / Math.PI).toFixed(4)}°: far rail off the exact draft of the near rail by up to ${worst.toExponential(2)} mm (τ of the face ${(tau[ruled] ?? 0).toExponential(1)})`);
    ad.delete();
    for (const f of regions[r].faces) {
      if (f === ruled) continue;
      const nb = adjOf(f);
      const rows: string[] = [];
      for (let x = 0; x < nb.length; x++) for (let y = x + 1; y < nb.length; y++) {
        const ball = kernel.rollingBall(id, f, [nb[x]!, nb[y]!], Infinity);
        if (ball && ball.deviation < 1e-2) rows.push(`f${nb[x]}(${topo.faces[nb[x]!]!.geometry?.type ?? 'spline'})+f${nb[y]}(${topo.faces[nb[y]!]!.geometry?.type ?? 'spline'}) r ${ball.radius.toFixed(4)} dev ${ball.deviation.toExponential(1)}`);
      }
      log(`  f${f} (area ${topo.faces[f]!.area.toFixed(2)}, τ ${(tau[f] ?? 0).toExponential(1)}): ${rows.length ? rows.sort((p, q) => Number(p.split('dev ')[1]) - Number(q.split('dev ')[1])).slice(0, 2).join(' ; ') : 'no ball within 1e-2'}`);
    }
  }
}, 600_000);
