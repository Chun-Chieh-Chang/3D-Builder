import { Kernel } from '@3db/kernel';
import { deviation, supportOf } from '../../packages/kernel/src/exactRound';
// C2.11b: sharp bodies whose rounds meet at corners like the real parts' (freeform-generalization.md §6c)
export const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
const sq = (w: number) => ({ outer: [[-w, -w], [w, -w], [w, w], [-w, w]].map((a, i, p) => ({ kind: 'line', a, b: p[(i + 1) % 4], source: 'b' + i })), holes: [] }) as any;
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const A = (c: number[], r: number, from: number[], to: number[], ccw: boolean, s: string) => ({ kind: 'arc', c, r, from, to, ccw, source: s });
/** a stadium (two half circles of radius 6 joined by straight sides, `half` apart) or a lens (two arcs meeting at sharp tips) */
export function outline(kind: 'stadium' | 'lens' | 'oval', half = 5) {
  if (kind === 'oval') { const c = Math.sqrt(55), y = (12 * c) / 8 - c; return { outer: [A([0, -c], 12, [4.5, y], [-4.5, y], true, 'o0'), A([-3, 0], 4, [-4.5, y], [-4.5, -y], true, 'o1'), A([0, c], 12, [-4.5, -y], [4.5, -y], true, 'o2'), A([3, 0], 4, [4.5, -y], [4.5, y], true, 'o3')], holes: [] } as any; }
  if (kind === 'stadium') return { outer: [L([-half, -6], [half, -6], 's0'), A([half, 0], 6, [half, -6], [half, 6], true, 's1'), L([half, 6], [-half, 6], 's2'), A([-half, 0], 6, [-half, 6], [-half, -6], true, 's3')], holes: [] } as any;
  const x = Math.sqrt(49 - 16); return { outer: [A([0, 4], 7, [-x, 0], [x, 0], true, 'l0'), A([0, -4], 7, [x, 0], [-x, 0], true, 'l1')], holes: [] } as any;
}
/** the outline raised with a draft from the top of a 40×40×5 plate, tilted by `tilt` about x; `cy` moves it across (to run its base off the plate's side) */
export function boss(kernel: Kernel, kind: 'stadium' | 'lens' | 'oval', tilt: number, draft: number, cy = 0, turn = 0) {
  const plate = kernel.extrude(XY, [sq(20)], [0, 0, 5]).shape;
  const n = [0, -Math.sin(tilt), Math.cos(tilt)];
  const xd = [Math.cos(turn), Math.sin(turn) * Math.cos(tilt), Math.sin(turn) * Math.sin(tilt)];
  const yd = [n[1]! * xd[2]! - n[2]! * xd[1]!, n[2]! * xd[0]! - n[0]! * xd[2]!, n[0]! * xd[1]! - n[1]! * xd[0]!];
  const b = kernel.extrude({ origin: [0, cy - 2 * Math.sin(tilt), 5 - 2 * Math.cos(tilt)], xDir: xd, yDir: yd, normal: n } as any, [outline(kind)], n.map((v) => v * 12) as any, 0, undefined, (draft * Math.PI) / 180).shape;
  const shape = kernel.boolean('fuse', plate, b).shape;
  const t = kernel.topology(shape);
  const top = t.faces.findIndex((f: any) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6);
  const edges = t.edges.flatMap((e: any, i: number) => (e.faces.length === 2 && e.faces.includes(top) && e.faces.some((f: number) => f !== top && t.faces[f]!.center[2] > 5 + 1e-6) ? [i] : []));
  return { shape, edges, top };
}
/** each round face of a fillet result (generated from an edge), its supports (smooth neighbours that are no round) and its rolling-ball deviation */
export function rounds(kernel: Kernel, res: { shape: any; faceOrigins: any[] }, r: number) {
  const k = kernel as any; const oc = k.oc; const shp = k.get(res.shape);
  const t = kernel.topology(res.shape); const sm = kernel.smoothEdges(res.shape, t.edges.map((_, i) => i));
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const isR = (i: number) => (res.faceOrigins[i] ?? []).some((o: any) => o.rel === 'generated' && o.kind === 'edge');
  return t.faces.flatMap((f, i) => { if (!isR(i)) return []; const sup = [...new Set(t.edges.flatMap((e, k2) => (sm[k2] && e.faces.includes(i) ? e.faces.filter((n) => n !== i && !isR(n)) : [])))]; return [{ i, surface: f.surface, sup, dev: sup.length >= 2 ? deviation(oc, faces[i], sup.map((s) => supportOf(oc, faces[s])), r, 24) : NaN }]; });
}
