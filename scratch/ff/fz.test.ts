import { appendFileSync } from "node:fs";
import { beforeAll, it } from 'vitest';
import { applyCommand, createEmptyPart } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';


let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});


const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength;
const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const at = (z: number): Frame => ({ ...XY, origin: [0, 0, z] });
const rect = (x: number, y: number, w: number, h: number): Region => {
  const p: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return { outer: p.map((a, i) => ({ kind: 'line', a, b: p[(i + 1) % 4]!, source: `e${i}` })), holes: [] };
};
const disc = (r: number): Region => ({ outer: [{ kind: 'circle', c: [0, 0], r, source: 'c' }], holes: [] });

/** A small deterministic generator (mulberry32), so that a failure can be run again by its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
import { surfaceDeviation } from '../../packages/kernel/src/surfaceDeviation';
const log = (m: string) => appendFileSync('scratch/ff/fz.log', m + String.fromCharCode(10));
it('fz', async () => {
  for (const seed of [21, 35]) {
    const r = rng(seed);
    const round = (v: number) => Math.round(v * 100) / 100;
    const w = round(30 + r() * 50);
    const d = round(20 + r() * 40);
    const t = round(6 + r() * 14);
    const hr = round(1.5 + r() * Math.min(w, d) * 0.12);
    const kind = Math.floor(r() * 3);
    const fr = round(0.5 + r() * Math.min(w, d) * 0.15);
    const cr = round(0.3 + r() * Math.min(t, d) * 0.2);
    const made: ShapeId[] = []; const own = (id: ShapeId) => (made.push(id), id); let drafted = 0, tipped = 0; try {
      const draft = r() < 0.5 ? round(1 + r() * 4) : 0;
      let s = own(kernel.extrude(XY, [rect(-w / 2, -d / 2, w, d)], [0, 0, t], 0, undefined, (draft * Math.PI) / 180).shape);
      if (draft) drafted++;
      // the hole, square to the top, at the middle
      if (kind === 0) s = own(kernel.boolean('cut', s, own(kernel.extrude(at(-1), [disc(hr)], [0, 0, t + 2]).shape)).shape);
      else if (kind === 1) {
        // a blind hole, half of them with a drill point (118° to 140°) at the bottom
        const bottom = round(t * 0.4);
        // the point must stay inside the plate (0.5 mm short of its bottom): one that comes out of the bottom is another shape, a cone opening
        // there, which is none of the features recognized (and is refused, as it should be)
        const point = hr / Math.tan(((118 + r() * 22) / 2) * (Math.PI / 180)); log(`point ${point}`);
        if (r() < 0.5 && bottom - point > 0.5) {
          const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
          const p: [number, number][] = [[0, t + 1], [hr, t + 1], [hr, bottom], [0, bottom - point]];
          s = own(kernel.boolean('cut', s, own(kernel.revolve(XZ, [{ outer: p.map((a, i) => ({ kind: 'line', a, b: p[(i + 1) % p.length]!, source: `p${i}` })), holes: [] }], { origin: [0, 0, 0], dir: [0, 0, 1] }, 2 * Math.PI).shape)).shape);
          tipped++;
        } else s = own(kernel.boolean('cut', s, own(kernel.extrude(at(bottom), [disc(hr)], [0, 0, t]).shape)).shape);
      }
      else {
        s = own(kernel.boolean('cut', s, own(kernel.extrude(at(t * 0.6), [disc(hr * 1.8)], [0, 0, t]).shape)).shape);
        s = own(kernel.boolean('cut', s, own(kernel.extrude(at(-1), [disc(hr)], [0, 0, t + 2]).shape)).shape);
      }
      // half of them get a round boss on the +x side, along x (a feature along another direction than the plate)
      const side = r() < 0.5 && !draft;
      const br = round(1 + r() * Math.min(d, t) * 0.25);
      if (side) {
        const YZ: Frame = { origin: [w / 2, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] };
        const boss = own(kernel.extrude(YZ, [{ outer: [{ kind: 'circle', c: [-d / 4, t / 2], r: br, source: 'c' }], holes: [] }], [round(2 + r() * 8), 0, 0]).shape);
        s = own(kernel.boolean('fuse', s, boss).shape);
      }
      const topo = kernel.topology(s);
      // the edges by where they are, not by exact numbers (a draft leans them and moves them in): the corner edge at +x +y, the top edge at -y
      const pick = <T,>(xs: T[], score: (x: T) => number) => xs.reduce((a, b) => (score(b) > score(a) ? b : a));
      const vertical = pick(topo.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.curve === 'line' && e.dir && Math.abs(e.dir[2]) > 0.9), ({ e }) => e.mid[0] + e.mid[1]).i;
      s = own(kernel.fillet(s, [vertical], fr).shape);
      const t2 = kernel.topology(s);
      const top = pick(t2.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.curve === 'line' && e.dir && Math.abs(e.dir[0]) > 0.99 && Math.abs(e.mid[2] - t) < 1e-6), ({ e }) => -e.mid[1]).i;
      const frontFace = pick(t2.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.surface === 'plane' && f.normal), ({ f }) => -f.normal![1]).i;
      s = own(kernel.chamfer(s, [{ edge: top, face: frontFace }], 'distanceDistance', cr, round(cr * (0.5 + r())) ).shape);
      const bytes = new TextEncoder().encode(kernel.exportStep(s, `fuzz-${seed}`));
      const k = kernel as any; const oc = k.oc;
      const b = kernel.importStep(bytes).shape; let nn = 0; const fx2 = (x: number) => x.toFixed(4); (globalThis as any).__TRACE__ = (q: any) => { if (q.d > 1e-6 && nn++ < 12) log(`   OUT f${q.f} p(${q.p.map(fx2)}) start(${fx2(q.u0)},${fx2(q.v0)}) end(${fx2(q.u)},${fx2(q.v)}) ${q.s} d ${q.d.toExponential(2)}`); };
      log(`params w ${w} d ${d} t ${t} hr ${hr} fr ${fr} cr ${cr} draft ${draft} bottom ${round(t * 0.4)}`); log(`seed ${seed} kind ${kind} draft ${draft} side ${side} whole ${kernel.surfaceDeviation(s, b).integral} / ${kernel.surfaceDeviation(b, s).integral}`);
      const faces = (x: any) => { const out: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(x), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) out.push(oc.TopoDS.Face(ex.Current())); return out; };
      for (const [x, y, n] of [[s, b, 'a'], [b, s, 'b']] as const) {
        const fx = faces(x), fy = faces(y);
        fx.forEach((f, i) => { const d = surfaceDeviation(oc, [f], fy, 0.02); if (d.integral > 1e-12) { const ad = new oc.BRepAdaptor_Surface(f, true); log(`  ${n} face ${i} ${String(ad.GetType().value ?? ad.GetType())} integral ${d.integral.toExponential(3)} max ${d.max.toExponential(3)} area ${d.area.toFixed(3)} u ${ad.FirstUParameter().toFixed(3)}..${ad.LastUParameter().toFixed(3)} v ${ad.FirstVParameter().toFixed(3)}..${ad.LastVParameter().toFixed(3)} uper ${ad.IsUPeriodic()}`); ad.delete(); } });
      }
    } finally { for (const id of made) kernel.release(id); }
  }
}, 600_000);
