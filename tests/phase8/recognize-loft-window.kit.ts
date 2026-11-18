/**
 * ADR 0259 slice 2: the cup of slice 1 (a body of revolution about y) with a window through its wall at +z cut by a ruled loft between two sections on
 * planes that are not parallel, as part-3's A windows are (f97: rails on planes 27.98° apart, design doc §6o-A). Each section is a spline over a chord;
 * the first lies on z = `near` inside the cup, the second on a plane through (0, 0, `far`) turned `tilt` degrees about y, outside it. Both chords lie
 * on y = `chord`, so the face they make is a plane. The truth is the body made here. `fuzzFile` runs random cases (AGENTS §3.4), each its own `it`.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { isTrap, Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';

const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;

export interface LoftCup {
  /** The first section's spline, on z = `near`, in its own (x, y): from one end of the chord (y = `chord`) to the other. */
  first: number[][];
  /** The second section's spline, on the turned plane, in its own (x', y). */
  second: number[][];
  chord: number;
  near: number;
  far: number;
  /** Degrees the second plane is turned about y. */
  tilt: number;
  r: number;
  wall: number;
  height: number;
}

/** The part. Throws `KernelError` when the kernel refuses it. */
export function cupWithLoftWindow(kernel: Kernel, p: LoftCup): ShapeId {
  const made: ShapeId[] = [];
  try {
    const prof = [[0, 0], [p.r, 0], [p.r, p.height], [p.r - p.wall, p.height], [p.r - p.wall, p.wall], [0, p.wall]];
    const cup = kernel.revolve(XY as never, [{ outer: prof.map((a, i) => L(a, prof[(i + 1) % prof.length]!, 'p' + i)), holes: [] }] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape;
    made.push(cup);
    const th = (p.tilt * Math.PI) / 180;
    const section = (pts: number[][]) => {
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      return [{ kind: 'spline', points: pts, source: 's' }, L(b, a, 'c')];
    };
    const f1 = { ...XY, origin: [0, 0, p.near] };
    const f2 = { origin: [0, 0, p.far], xDir: [Math.cos(th), 0, -Math.sin(th)], yDir: [0, 1, 0], normal: [Math.sin(th), 0, Math.cos(th)] };
    const tool = kernel.loft([
      { frame: f1, outer: section(p.first) },
      { frame: f2, outer: section(p.second) },
    ] as never).shape;
    made.push(tool);
    return kernel.boolean('cut', cup, tool).shape;
  } finally {
    for (const id of made) kernel.release(id);
  }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random cup and loft window. The first plane inside the cup's cavity where the window is, the second outside the cup where it is (the turn at most
 * 30°, so that over the window's half-width the second plane stays outside), the chord above the floor, the tops below the rim.
 */
export function sample(seed: number): LoftCup {
  const r = rng(seed * 7919);
  const rd = (v: number) => Math.round(v * 1000) / 1000;
  const radius = rd(14 + 8 * r());
  const wall = rd(0.8 + 1.2 * r());
  const height = rd(14 + 8 * r());
  const chord = rd(wall + 1 + 2 * r());
  const spline = (half: number) => {
    const n = 3 + Math.floor(r() * 3);
    const peak = rd(Math.min(height - 2, chord + 4 + 6 * r()));
    return Array.from({ length: n }, (_, i) => {
      const x = rd(-half + (2 * half * i) / (n - 1));
      return [x, i === 0 || i === n - 1 ? chord : rd(chord + (peak - chord) * (0.4 + 0.6 * r()))];
    });
  };
  const h1 = rd(2 + 2 * r());
  const h2 = rd(h1 * (0.8 + 0.6 * r()));
  const tilt = rd((r() < 0.5 ? -1 : 1) * 30 * r());
  const near = rd((radius - wall) * (0.5 + 0.2 * r()));
  const far = rd(radius + 3 + h2 * Math.tan((Math.abs(tilt) * Math.PI) / 180) + 2 * r());
  return { first: spline(h1), second: spline(h2), chord, near, far, tilt, r: radius, wall, height };
}

/**
 * Seeds `from`–`to`, each its own case: rebuilt as the same solid (to the recognition tolerance) or refused for a reason recognition gives
 * (`RecognizeError`); a trap or any other error fails it. A part the kernel will not make is skipped and counted. At the end: both ways of turning the
 * second plane (+, -) must have been rebuilt at least once (DEV_LOG 2026-11-02).
 */
export function fuzzFile(from: number, to: number) {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  const rebuilt = { plus: 0, minus: 0 };
  let notMade = 0;
  it('loads', async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
  }, 60_000);
  for (let seed = from; seed <= to; seed++) {
    it(`seed ${seed}`, async () => {
      const p = sample(seed);
      let shape: ShapeId;
      try {
        shape = cupWithLoftWindow(kernel, p);
      } catch (e) {
        if (e instanceof KernelError && !isTrap(e)) {
          notMade++;
          console.log(`#${seed} not made: ${e.message.slice(0, 80)}`);
          return;
        }
        throw e;
      }
      try {
        const r = await recognizeStep(kernel, solver, shape);
        expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
        expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
        rebuilt[p.tilt >= 0 ? 'plus' : 'minus']++;
        console.log(`#${seed} rebuilt`);
      } catch (e) {
        if (!(e instanceof RecognizeError)) throw e;
        console.log(`#${seed} refused: ${e.message.slice(0, 120)}`);
      } finally {
        kernel.release(shape);
      }
    }, 300_000);
  }
  it('each way of turning was rebuilt at least once; the heap is printed', () => {
    const heap = (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
    expect(heap).toBeGreaterThan(0);
    console.log(`seeds ${from}-${to}: ${JSON.stringify(rebuilt)}, not made ${notMade}, heap ${(heap / 2 ** 20).toFixed(0)} MiB`);
    expect(rebuilt.plus).toBeGreaterThan(0);
    expect(rebuilt.minus).toBeGreaterThan(0);
  });
}

/**
 * The same cup with the window's first rail bent off its plane by up to `bump` mm (at the middle, none at the ends): a ruled wall whose rails are not
 * both flat, which the kernel's loft cannot make (its sections lie on frames). The tool is built in OCCT directly (ThruSections, ruled), written to STEP
 * and read back, then cut from the cup. For the limit on how far the wall may be from flat rails (ADR 0259 slice 2).
 */
export function cupWithBentWindow(kernel: Kernel, p: LoftCup, bump: number): ShapeId {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oc = kernel.oc as any;
  const th = (p.tilt * Math.PI) / 180;
  const live: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(x: T): T => (live.push(x), x);
  const made: ShapeId[] = [];
  try {
    const wire = (pts: number[][]) => {
      const arr = own(new oc.NCollection_Array1_gp_Pnt(1, pts.length));
      pts.forEach((q, i) => arr.SetValue(i + 1, own(new oc.gp_Pnt(q[0], q[1], q[2]))));
      const curve = own(own(new oc.GeomAPI_PointsToBSpline(arr, 3, 8, oc.GeomAbs_Shape.GeomAbs_C2, 1e-9)).Curve());
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const edges = [
        own(own(new oc.BRepBuilderAPI_MakeEdge(curve)).Edge()),
        own(own(new oc.BRepBuilderAPI_MakeEdge(own(new oc.gp_Pnt(b[0], b[1], b[2])), own(new oc.gp_Pnt(a[0], a[1], a[2])))).Edge()),
      ];
      const mw = own(new oc.BRepBuilderAPI_MakeWire());
      for (const e of edges) mw.Add(e);
      return { wire: own(mw.Wire()), edges };
    };
    const dense = (pts: number[][], map: (x: number, y: number, s: number) => number[]) => {
      // through the spline's own points, more of them, so that the bend is the only change
      const out: number[][] = [];
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * (pts.length - 1);
        const k = Math.min(pts.length - 2, Math.floor(u));
        const f = u - k;
        const [x0, y0] = pts[k]!;
        const [x1, y1] = pts[k + 1]!;
        out.push(map(x0! + (x1! - x0!) * f, y0! + (y1! - y0!) * f, i / n));
      }
      return out;
    };
    const first = dense(p.first, (x, y, s) => [x, y, p.near + bump * Math.sin(Math.PI * s)]);
    const second = dense(p.second, (x, y) => [x * Math.cos(th), y, p.far - x * Math.sin(th)]);
    // the side faces by a ruled loft; the bent end closed by a filling through its edges (a bent wire has no plane to cap it), the other by its plane;
    // written as faces, which reading the STEP file sews into the solid
    const [w1, w2] = [wire(first), wire(second)];
    const mk = own(new oc.BRepOffsetAPI_ThruSections(false, true, 1e-6));
    mk.AddWire(w1.wire);
    mk.AddWire(w2.wire);
    mk.Build(own(new oc.Message_ProgressRange()));
    const fill = own(new oc.BRepOffsetAPI_MakeFilling());
    for (const e of w1.edges) fill.Add(e, oc.GeomAbs_Shape.GeomAbs_C0, true);
    fill.Build(own(new oc.Message_ProgressRange()));
    const flatEnd = own(own(new oc.BRepBuilderAPI_MakeFace(w2.wire, true)).Face());
    const builder = own(new oc.BRep_Builder());
    const compound = own(new oc.TopoDS_Compound());
    builder.MakeCompound(compound);
    for (const f of [mk.Shape(), fill.Shape(), flatEnd]) builder.Add(compound, f);
    const w = own(new oc.STEPControl_Writer());
    w.Transfer(compound, oc.STEPControl_StepModelType.STEPControl_AsIs, true, own(new oc.Message_ProgressRange()));
    const path = '/bent-window.step';
    w.Write(path);
    const bytes = new TextEncoder().encode(oc.FS.readFile(path, { encoding: 'utf8' }) as string);
    oc.FS.unlink(path);
    const tool = kernel.importStep(bytes).shape;
    made.push(tool);
    const prof = [[0, 0], [p.r, 0], [p.r, p.height], [p.r - p.wall, p.height], [p.r - p.wall, p.wall], [0, p.wall]];
    const cup = kernel.revolve(XY as never, [{ outer: prof.map((a, i) => L(a, prof[(i + 1) % prof.length]!, 'p' + i)), holes: [] }] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape;
    made.push(cup);
    return kernel.boolean('cut', cup, tool).shape;
  } finally {
    for (const id of made) kernel.release(id);
    for (const x of live.reverse()) x.delete();
  }
}
