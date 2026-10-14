/**
 * D-I2 spike (docs/drawing-interaction-gap-plan.md §9, ADR 0129): can each line a view draws be traced back to the edge of the model it came from?
 *
 * The OCCT build the kernel uses (replicad-opencascadejs) exposes `HLRBRep_HLRToShape` only through its compounds (`VCompound`, `Rg1LineVCompound`,
 * `OutLineVCompound`, …): no `CompoundOfEdges(…, In3d)` and no `HLRBRep_Data`, so the algorithm cannot say where a line came from. What is measured here is
 * the fallback: every source edge is projected with the same axes the HLR uses, and a drawn line is matched to the source edges it lies on — all of its points
 * within a small distance of the projected edge. Measured, not assumed: how many drawn lines match exactly one edge, how many several (edges that project onto
 * each other: the near and far edges of a box seen square), how many none (the outlines of curved faces, which are no edge of the model), and the time.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator } from '@3db/regen';
import { type Feature } from '@3db/model';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

type V3 = [number, number, number];
let kernel: Kernel;
const shapes: ShapeId[] = [];
const kept: Regenerator[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
});
afterAll(() => {
  kept.forEach((r) => r.dispose());
  shapes.forEach((s) => kernel.release(s));
});

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

interface Trace {
  lines: number;
  one: number;
  several: number;
  none: number;
  /** Of the lines matching several edges: how many have all their candidates lying on one another (the same line on the sheet, so any of them gives the same number). */
  severalCoincident: number;
  /** Of the visible lines matching several edges that are not one place on the sheet: how many have one candidate clearly nearest the viewer at the line's middle. */
  severalResolved: number;
  severalOther: number;
  ms: number;
  edges: number;
}

/** Projects every edge of `id` as the view `dir`/`up` does (the HLR's frame: x = dir × up, y = (-dir) × x) and matches the view's drawn lines to them. */
function trace(id: ShapeId, dir: V3, up: V3, tol = 0.01): Trace {
  const t0 = performance.now();
  const view = kernel.projectView(id, { dir, up });
  const d = unit(dir);
  const x = unit(cross(d, up));
  const y = cross([-d[0], -d[1], -d[2]], x);
  const mesh = kernel.mesh(id, { tolerance: 1e-3, angular: 0.05 });
  const edges: { pts: number[]; depth: number[]; box: [number, number, number, number] }[] = [];
  for (let r = 0; r < mesh.edgeRanges.length; r += 3) {
    const start = mesh.edgeRanges[r]!;
    const count = mesh.edgeRanges[r + 1]!;
    const pts: number[] = [];
    const depth: number[] = [];
    let box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      const p: V3 = [mesh.edgePoints[3 * (start + i)]!, mesh.edgePoints[3 * (start + i) + 1]!, mesh.edgePoints[3 * (start + i) + 2]!];
      const u = dot(p, x);
      const v = dot(p, y);
      pts.push(u, v);
      depth.push(-dot(p, d)); // larger is nearer the viewer
      box = [Math.min(box[0], u), Math.min(box[1], v), Math.max(box[2], u), Math.max(box[3], v)];
    }
    edges.push({ pts, depth, box });
  }
  // the mesh's float32 points and chord error are on top of the HLR's own sampling
  const reach = tol + 2e-3;
  const near = (px: number, py: number, e: (typeof edges)[number]) => {
    if (px < e.box[0] - reach || px > e.box[2] + reach || py < e.box[1] - reach || py > e.box[3] + reach) return false;
    if (e.pts.length === 2) return Math.hypot(px - e.pts[0]!, py - e.pts[1]!) <= reach;
    for (let i = 0; i + 3 < e.pts.length; i += 2) if (segDist(px, py, e.pts[i]!, e.pts[i + 1]!, e.pts[i + 2]!, e.pts[i + 3]!) <= reach) return true;
    return false;
  };
  const out: Trace = { lines: 0, one: 0, several: 0, none: 0, severalCoincident: 0, severalResolved: 0, severalOther: 0, ms: 0, edges: edges.length };
  const visible = new Set(view.visible);
  for (const line of [...view.visible, ...view.hidden]) {
    out.lines++;
    const cands = edges.filter((e) => {
      for (let i = 0; i < line.length; i += 2) if (!near(line[i]!, line[i + 1]!, e)) return false;
      return true;
    });
    if (cands.length === 1) out.one++;
    else if (cands.length === 0) out.none++;
    else {
      out.several++;
      // coincident: every candidate's points lie on every other candidate, within reach
      const lies = (a: (typeof cands)[number], b: (typeof cands)[number]) => {
        for (let i = 0; i < a.pts.length; i += 2) if (!near(a.pts[i]!, a.pts[i + 1]!, b)) return false;
        return true;
      };
      if (cands.every((a) => cands.every((b) => a === b || lies(a, b) || lies(b, a)))) out.severalCoincident++;
      else if (visible.has(line)) {
        // the depth of each candidate where it is nearest the line's middle
        const m = Math.floor(line.length / 4) * 2;
        const at = cands.map((e) => {
          let best = Infinity;
          let z = 0;
          for (let i = 0; i < e.pts.length; i += 2) {
            const dd = Math.hypot(e.pts[i]! - line[m]!, e.pts[i + 1]! - line[m + 1]!);
            if (dd < best) [best, z] = [dd, e.depth[i / 2]!];
          }
          return z;
        }).sort((a, b) => b - a);
        if (at[0]! - at[1]! > 1e-3) out.severalResolved++;
        else out.severalOther++;
      } else out.severalOther++;
    }
  }
  out.ms = performance.now() - t0;
  return out;
}

const DIRS: { name: string; dir: V3; up: V3 }[] = [
  { name: 'front', dir: [0, 0, -1], up: [0, 1, 0] },
  { name: 'top', dir: [0, -1, 0], up: [0, 0, -1] },
  { name: 'right', dir: [-1, 0, 0], up: [0, 1, 0] },
  { name: 'isometric', dir: [-1, -1, -1], up: [0, 1, 0] },
];

function report(label: string, id: ShapeId): Trace[] {
  return DIRS.map((v) => {
    const r = trace(id, v.dir, v.up);
    console.log(`${label.padEnd(18)} ${v.name.padEnd(9)} lines ${String(r.lines).padStart(4)}  one ${String(r.one).padStart(4)}  several ${String(r.several).padStart(3)} (coincident ${r.severalCoincident}, by depth ${r.severalResolved}, other ${r.severalOther})  none ${String(r.none).padStart(3)}  edges ${r.edges}  ${r.ms.toFixed(0)} ms`);
    return r;
  });
}

describe('D-I2 spike: tracing drawn lines back to model edges by geometry', () => {
  it('a plate with a blind hole, filleted and chamfered', async () => {
    const solver = await PlaneGcsSolver.create();
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    const plate = regen.rebuild(
      build(
        sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
        { ...sketch('s2', face('e1:cap:end')), entities: [{ id: 'p1', type: 'point', x: 10, y: 5 }] } as Feature,
        { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'straight', diameter: '8', end: { type: 'blind', depth: '10' } } as Feature,
      ),
    ).body!.shape;
    const topo = kernel.topology(plate);
    const straight = topo.edges.map((e, i) => (e.curve === 'line' ? i : -1)).filter((i) => i >= 0);
    const filleted = kernel.fillet(plate, [straight[0]!], 3).shape;
    shapes.push(filleted);
    const t2 = kernel.topology(filleted);
    const chamferEdge = t2.edges.findIndex((e) => e.curve === 'line');
    const chamfered = kernel.chamfer(filleted, [{ edge: chamferEdge, face: t2.edges[chamferEdge]!.faces[0]! }], 'distanceDistance', 2, 2).shape;
    shapes.push(chamfered);
    const all = [...report('plate+hole', plate), ...report('+fillet+chamfer', chamfered)];
    // every drawn line is accounted for, and a line matched to several edges is one place on the sheet
    for (const r of all) {
      expect(r.lines).toBeGreaterThan(0);
      expect(r.one + r.several + r.none).toBe(r.lines);
    }
  });

  it('real parts from STEP (public-cad fixtures)', () => {
    for (const name of ['mounting-bracket.step', 'astm-d695-mold.step']) {
      const text = readFileSync(new URL(`../fixtures/public-cad/osf-sheet-press/${name}`, import.meta.url), 'utf8');
      const id = kernel.importStep(text).shape;
      shapes.push(id);
      for (const r of report(name.replace('.step', ''), id)) expect(r.one + r.several + r.none).toBe(r.lines);
    }
  });
});
