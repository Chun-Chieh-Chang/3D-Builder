// C2.8 sample: a closed spline boss on a plate, its foot rounded exactly. (a) plain recognized? (b) rounds' surface types, (c) deleteFaces,
// (d) support surfaces intersected (GeomAPI_IntSS): how far the foot edge of the plain body is from that curve.
import { beforeAll, it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';

let kernel: Kernel; let solver: PlaneGcsSolver;
beforeAll(async () => { kernel = await Kernel.load(); solver = await PlaneGcsSolver.create(); });
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

async function rec(s: ShapeId): Promise<string> {
  const bytes = new TextEncoder().encode(kernel.exportStep(s, 'p'));
  const sha = await sha256Hex(bytes);
  const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try { const out = reconstructImported(kernel, regen, doc, 'imp1', solver); return 'OK ' + JSON.stringify(out.report.features) + ' dV=' + out.report.volumeError?.toExponential(2); }
  catch (e) { if (e instanceof RecognizeError) return 'REFUSED ' + e.message.slice(0, 200); throw e; } finally { regen.dispose(); }
}

export function splineBoss(kernel: Kernel, n = 7, amp = 1.5, lobes = 3, h = 10) {
  const sq = { outer: [[-20, -20], [20, -20], [20, 20], [-20, 20]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'b' + i)), holes: [] } as any;
  const plate = kernel.extrude(XY, [sq], [0, 0, 5]).shape;
  const pts = Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n; const r = 6 + amp * Math.sin(lobes * a); return [r * Math.cos(a), r * Math.sin(a)]; });
  const boss = kernel.extrude({ ...XY, origin: [0, 0, 4] }, [{ outer: [{ kind: 'spline', closed: true, points: pts, source: 'c' }], holes: [] }] as any, [0, 0, h + 1]).shape;
  const shape = kernel.boolean('fuse', plate, boss).shape;
  const t = kernel.topology(shape);
  const top = t.faces.findIndex((f) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6);
  const edges = t.edges.flatMap((e, i) => (e.faces.length === 2 && e.faces.includes(top) && e.faces.some((f) => f !== top && t.faces[f]!.geometry?.type !== 'plane') ? [i] : []));
  return { shape, edges };
}

/** An open spline outline (three lines and a spline, as recognize-approximate's GENTLE) raised on a plate; the edge rounded is the one where the spline wall meets the plate, or the top. */
export function openSplineBoss(kernel: Kernel, top: number[][] = [[28.72, 25], [14, 32], [0, 25]], h = 10, at: 'foot' | 'top' = 'foot') {
  const plate = kernel.extrude({ ...XY, origin: [-10, -10, -5] }, [{ outer: [[0, 0], [50, 0], [50, 52], [0, 52]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] } as any], [0, 0, 5]).shape;
  const reg = { outer: [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], top[0]!, 'b'), { kind: 'spline', points: top, source: 'c' }, L(top[top.length - 1]!, [0, 0], 'd')], holes: [] } as any;
  const shape = kernel.boolean('fuse', plate, kernel.extrude({ ...XY, origin: [0, 0, -1] }, [reg], [0, 0, h + 1]).shape).shape;
  const t = kernel.topology(shape);
  const wall = t.faces.findIndex((f) => !f.geometry);
  const cap = t.faces.findIndex((f) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2]) > 0.5 && Math.abs(f.center[2] - (at === 'foot' ? 0 : h)) < 1e-6 && t.edges.some((e) => e.faces.includes(wall) && e.faces.includes(t.faces.indexOf(f))));
  const edges = t.edges.flatMap((e, i) => (e.faces.includes(wall) && e.faces.includes(cap) ? [i] : []));
  return { shape, edges };
}

it('spline boss', async () => {
  const m = process.env.CLOSED ? splineBoss(kernel) : openSplineBoss(kernel, undefined, 10, (process.env.AT as any) ?? 'foot');
  const t0 = kernel.topology(m.shape);
  console.log('plain faces', t0.faces.map((f) => f.surface).join(','), 'foot edges', m.edges.map((i) => t0.edges[i]!.curve).join(','));
  console.log('plain:', await rec(m.shape));
  for (const r of [0.5, 1.2]) {
    const f = kernel.fillet(m.shape, m.edges, r, undefined, undefined, true);
    const t = kernel.topology(f.shape);
    const rounds = t.faces.flatMap((x, i) => ((f.faceOrigins[i] ?? []).some((o: any) => o.rel === 'generated' && o.kind === 'edge') ? [i] : []));
    console.log(`r=${r} rounds [${rounds.map((i) => t.faces[i]!.surface).join(',')}] exact=${JSON.stringify(((kernel as any).exactRoundLog ?? []).map((x: any) => x.outcome))}`);
    console.log('  rounded:', await rec(f.shape));
    try {
      const d = kernel.deleteFaces(f.shape, rounds);
      const v0 = kernel.massProps(m.shape).volume, v1 = kernel.massProps(d.shape).volume;
      const td = kernel.topology(d.shape);
      console.log(`  deleteFaces ok, vol rel ${((v1 - v0) / v0).toExponential(2)}, faces ${td.faces.length} vs ${t0.faces.length}, recognized: ${await rec(d.shape)}`);
    } catch (e) { if (e instanceof KernelError) console.log('  deleteFaces FAILED ' + e.message.slice(0, 80)); else throw e; }
    // the supports: the faces tangent to the round, intersected as surfaces
    const k = kernel as any; const oc = k.oc; const shp = k.get(f.shape);
    const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
    const sm = kernel.smoothEdges(f.shape, t.edges.map((_, i) => i));
    const sup = [...new Set(t.edges.flatMap((e, i) => (sm[i] && e.faces.some((q) => rounds.includes(q)) ? e.faces.filter((q) => !rounds.includes(q)) : [])))];
    console.log('  supports', sup.map((i) => t.faces[i]!.surface).join(','));
    if (sup.length === 2) {
      const S = sup.map((i) => oc.BRep_Tool.Surface(faces[i]));
      const ii = new oc.GeomAPI_IntSS(S[0], S[1], 1e-9);
      console.log('  IntSS done', ii.IsDone(), 'lines', ii.NbLines());
      // distance of the plain body's foot edge points to the intersection curves
      const kk = kernel as any; let worst = 0;
      for (const ei of m.edges) for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const p = (kernel as any).edgePoint ? null : null; void p;
      }
      for (let c = 1; c <= ii.NbLines(); c++) {
        const C = ii.Line(c); const g = C.get ? C.get() : C;
        const a = g.FirstParameter(), b = g.LastParameter();
        let dmax = 0;
        for (let q = 0; q <= 20; q++) {
          const P = g.Value(a + ((b - a) * q) / 20); const pt = [P.X(), P.Y(), P.Z()];
          const near = kernel.edgeNearest(m.shape, m.edges[0]!, pt as any) as any;
          if (q === 0) console.log('   edgeNearest keys', Object.keys(near).join(','));
          if (q >= 2 && q <= 18) dmax = Math.max(dmax, near.distance ?? Math.hypot(...near.point.map((x: number, k: number) => x - pt[k]!)));
        }
        console.log(`  curve ${c} ${g.DynamicType ? '' : ''} range [${a.toFixed(3)}, ${b.toFixed(3)}] max dist to plain foot ${dmax.toExponential(2)}`);
      }
      void kk; void worst;
    }
  }
}, 600_000);
