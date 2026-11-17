// Recognizing part-3's B regions as a drafted spline extrusion (after ADR 0251), probe 1: what the drafted boss around f80 is made of.
// (1) n and α from f80's rails (as c5d). (2) Every face within two steps of region 2 (faces 80, 81, 150, 152, 154): its surface (as the file has it, or
// as Kernel.analyticFace reads it within max(1e-6, τ_f)), and its relation to n: a plane's normal angle to n (90-α: a drafted wall; 0: a cap), a cone's
// axis to n and half-angle, a torus's axis to n. (3) The sharp edges the two rounds took off (Kernel.sharpEdge): their distance to f79's plane, and
// whether they lie on the drafted extension of f80's near rail. Trace before every step; product code untouched.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { part3 } from './c5a.test';

const log = (m: string) => appendFileSync('scratch/ff/c8.log', m + String.fromCharCode(10));
const trace = (m: string) => appendFileSync('scratch/ff/c8.trace', `${new Date().toISOString().slice(11, 19)} ${m}\n`);
const REGION = [80, 81, 150, 152, 154];
const WALL = 80;

it('c8a', async () => {
  trace('load');
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const id = part3(kernel);
  const topo = kernel.topology(id);
  const tau = kernel.fileTolerance(id).faces;
  trace('loaded');
  const faces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const P = (p: any) => [p.X(), p.Y(), p.Z()];
  const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
  const cross = (u: number[], v: number[]) => [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const unit = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const deg = (r: number) => (r * 180) / Math.PI;
  const angle = (a: number[], b: number[]) => deg(Math.acos(Math.min(1, Math.abs(dot(unit(a), unit(b))))));
  const adjOf = (f: number) => [...new Set(topo.edges.filter((e) => e.faces.includes(f)).flatMap((e) => e.faces))].filter((x) => x !== f);

  // (1) n, α, H from f80's rails
  const ad = new oc.BRepAdaptor_Surface(faces[WALL], true);
  const inU = ad.UDegree() === 1;
  const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
  const N = 40;
  const rail = (side: 0 | 1) => Array.from({ length: N + 1 }, (_, i) => {
    const t = inU ? v0 + ((v1 - v0) * i) / N : u0 + ((u1 - u0) * i) / N;
    return P(inU ? ad.Value(side ? u1 : u0, t) : ad.Value(t, side ? v1 : v0));
  });
  const [a, b] = [rail(0), rail(1)];
  ad.delete();
  const n = unit(cross(sub(a[Math.floor(N / 3)]!, a[0]!), sub(a[Math.floor((2 * N) / 3)]!, a[0]!)));
  const rulingAngles = a.map((p, i) => angle(sub(b[i]!, p), n));
  const alpha = rulingAngles.reduce((s, x) => s + x, 0) / rulingAngles.length;
  const levelA = dot(a[0]!, n);
  const levelB = dot(b[0]!, n);
  log(`== c8a part-3 region 2: n (${n.map((x) => x.toFixed(5))}), α ${alpha.toFixed(4)}°, rail levels ${levelA.toFixed(5)} / ${levelB.toFixed(5)}; rail a closed: ${Math.hypot(...sub(a[0]!, a[N]!)) < 1e-6}`);

  // (2) the neighbourhood
  const ring = new Set<number>(REGION);
  for (let step = 0; step < 2; step++) for (const f of [...ring]) for (const x of adjOf(f)) ring.add(x);
  const describe = (f: number) => {
    let g: any = topo.faces[f]!.geometry;
    let how = 'file';
    if (!g) {
      const read = kernel.analyticFace(id, f, Math.max(1e-6, tau[f] ?? 0));
      if (read) { g = read.geometry; how = `read dev ${read.deviation.toExponential(1)}`; }
    }
    if (!g) return 'spline (no simple surface)';
    const rel =
      g.type === 'plane' ? `normal∠n ${angle(g.normal, n).toFixed(4)}° level ${dot(g.origin, n).toFixed(5)}`
      : g.type === 'cone' ? `axis∠n ${angle(g.axis, n).toFixed(4)}° half ${deg(g.halfAngle).toFixed(4)}°`
      : g.type === 'cylinder' ? `axis∠n ${angle(g.axis, n).toFixed(4)}° r ${g.radius.toFixed(4)}`
      : g.type === 'torus' ? `axis∠n ${angle(g.axis, n).toFixed(4)}° R ${g.major.toFixed(4)} r ${g.minor.toFixed(4)}`
      : '';
    return `${g.type} (${how}) ${rel}`;
  };
  for (const f of [...ring].sort((x, y) => x - y)) {
    trace(`describe f${f}`);
    log(`  f${f}${REGION.includes(f) ? '*' : ' '} area ${topo.faces[f]!.area.toFixed(3)} τ ${(tau[f] ?? 0).toExponential(1)} | ${describe(f)} | adj ${adjOf(f).join(',')}`);
  }

  // (3) the sharp edges the rounds took off
  for (const [round, s] of [[81, [79, 80]], [150, [76, 80]]] as const) {
    trace(`sharp f${round}`);
    const e = kernel.sharpEdge(id, round, s as [number, number]);
    if (!e) { log(`  sharp edge of f${round}: none`); continue; }
    const lv = e.points.map((p) => dot(p as number[], n));
    log(`  sharp edge of f${round} (${s.join('+')}): ${e.points.length} points, closed ${e.closed}, level along n ${Math.min(...lv).toFixed(5)}..${Math.max(...lv).toFixed(5)}`);
  }
  trace('done');
}, 600_000);
