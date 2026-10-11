// A2c spike: can a helical knurl be swept over exactly the length asked for, so that the boolean that trims it to length is not needed?
//
// Not part of the product, not in `npm test`. Run: npx vitest run --config spikes/occt-gaps/vitest.config.ts knurl-trim
//
// The question. `Kernel.knurlHelix` sweeps the V groove along a helix drawn over *whole* turns that start a turn or more before `from`, and then cuts it
// square to the axis with `Common(swept, cylinder(from..to))`. The sweep has to overshoot because the spine is a chain of whole-turn edges, and the profile
// is placed at the start of the sweep. If instead the sweep spanned exactly `[from, to]` — a fractional number of turns — both ends would already be the
// profile in its own plane, which is the same square end, and the boolean would be unnecessary. One boolean fewer per hand is one 8.16 MiB leak fewer
// (AGENTS.md §3.5) and most of the time.
//
// The catch, and what this measures. The groove at height z sits at angle 2π(z − shift)/lead, where `shift` is where the sweep starts. The current path
// starts at `−back·lead` with `back` a whole number of turns, so its phase is 2πz/lead — independent of `back`. A sweep starting at `from` instead puts
// the grooves at 2π(z − from)/lead: the whole pattern is turned by 2π·from/lead. So the two are the same shape only once that turn is given back by
// turning the reference direction. This spike finds out whether it is, measures both, and controls for its own mistakes:
//
//   * the replication of the current path must agree with the production `Kernel.knurl` to 1e-9 of its volume, or nothing below is worth reading;
//   * the new path is compared with the current one by `Common(a, b) / volume(a)`, which is 1 exactly when the two are the same shape and falls off as
//     they differ — a rotation does not change a volume, so a volume comparison alone would not see the phase at all;
//   * a deliberate half-pitch offset is run as a negative control: it must NOT match, which is what shows the comparison can fail.
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type KnurlSpec } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const TAU = Math.PI * 2;
const deg = (d: number) => (d * Math.PI) / 180;

/** The V groove in the (radius, along-the-axis) plane of the frame the profile is swept in. */
const KNURL_OVERSHOOT = 0.25;

interface Case {
  radius: number;
  from: number;
  to: number;
  count: number;
  depth: number;
  included: number;
  angle: number;
  phase: number;
}

const CASE: Case = { radius: 6, from: 3, to: 11, count: 12, depth: 0.3, included: deg(90), angle: deg(30), phase: 0 };

const volume = (oc: any, s: any): number => {
  const p = new oc.GProp_GProps();
  try {
    oc.BRepGProp.VolumeProperties(s, p, false, false, false);
    return p.Mass();
  } finally {
    p.delete();
  }
};
const valid = (oc: any, s: any): boolean => new oc.BRepCheck_Analyzer(s, true, false, false).IsValid();
const countOf = (oc: any, s: any, type: number): number => {
  let n = 0;
  for (const ex = new oc.TopExp_Explorer(s, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) n++;
  return n;
};
/** As `Kernel.boolOp`: the three-argument constructor performs the operation, so `Build()` is not called again. */
const common = (oc: any, a: any, b: any): any => {
  const mk = new oc.BRepAlgoAPI_Common(a, b, new oc.Message_ProgressRange());
  if (mk.HasErrors() || !mk.IsDone()) throw new Error('common failed');
  return mk.Shape();
};

/** One hand of grooves, swept along a helix that spans exactly `turns` whole-or-fractional turns from `startZ`. `theta` turns the reference direction. */
function sweepExactly(oc: any, c: Case, startZ: number, turns: number, theta: number, sub = 1): any {
  const lead = TAU * c.radius * Math.tan(c.angle);
  const reach = c.radius + KNURL_OVERSHOOT * c.depth;
  const half = (c.depth + KNURL_OVERSHOOT * c.depth) * Math.tan(c.included / 2);
  const rRef = (c.radius - c.depth + reach) / 2;

  // the reference direction, turned by theta about the axis
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const X = [cos, sin, 0] as const;

  const ax3 = new oc.gp_Ax3(new oc.gp_Pnt(0, 0, startZ), new oc.gp_Dir(0, 0, 1), new oc.gp_Dir(X[0], X[1], 0));
  const surface = new oc.Geom_CylindricalSurface(ax3, rRef);
  const line = new oc.Geom2d_Line(new oc.gp_Pnt2d(0, 0), new oc.gp_Dir2d(TAU, lead));
  const perTurn = Math.hypot(TAU, lead);

  // `sub` edges per turn: the helix is a B-spline fitted to each edge, so how finely the sweep is cut up is how accurately it is followed
  const mw = new oc.BRepBuilderAPI_MakeWire();
  const pieces = Math.max(1, Math.ceil(turns * sub - 1e-9));
  for (let i = 0; i < pieces; i++) {
    const u0 = (turns * i) / pieces;
    const u1 = (turns * (i + 1)) / pieces;
    const edge = new oc.BRepBuilderAPI_MakeEdge(line, surface, u0 * perTurn, u1 * perTurn).Edge();
    if (!oc.BRepLib.BuildCurves3d(edge, 1e-7, oc.GeomAbs_Shape.GeomAbs_C1, 14, 30)) throw new Error('BuildCurves3d');
    mw.Add(edge);
    if (!mw.IsDone()) throw new Error('helix wire');
  }
  const spine = mw.Wire();

  // the profile: the V in the plane through the axis at angle theta, its x the distance from the axis and its y along it
  const poly = new oc.BRepBuilderAPI_MakePolygon();
  const pt = (r: number, z: number) => new oc.gp_Pnt(r * X[0], r * X[1], startZ + z);
  poly.Add(pt(c.radius - c.depth, 0));
  poly.Add(pt(reach, half));
  poly.Add(pt(reach, -half));
  poly.Close();
  const profile = poly.Wire();

  const mk = new oc.BRepOffsetAPI_MakePipeShell(spine);
  mk.SetMode(new oc.gp_Dir(0, 0, 1));
  mk.SetTolerance(1e-6, 1e-6, 1e-4);
  mk.Add(profile, false, false);
  mk.Build(new oc.Message_ProgressRange());
  if (!mk.IsReady() || !mk.MakeSolid()) throw new Error('pipe shell: no solid');
  let shape = mk.Shape();
  if (volume(oc, shape) < 0) shape = shape.Reversed();
  return shape;
}

/** The `count` copies of one groove turned 360°/count about the axis, as one compound (what `Kernel.knurlSet` returns). */
function handOfGrooves(oc: any, c: Case, groove: any): any {
  const compound = new oc.TopoDS_Compound();
  const builder = new oc.TopoDS_Builder();
  builder.MakeCompound(compound);
  for (let k = 0; k < c.count; k++) {
    const trsf = new oc.gp_Trsf();
    trsf.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1)), c.phase + (TAU * k) / c.count);
    builder.Add(compound, new oc.BRepBuilderAPI_Transform(groove, trsf, true, false).Shape());
  }
  return compound;
}

/** The current path, replicated: one groove swept over whole turns back from `from`, cut square to the axis by a cylinder from `from` to `to`, then copied. */
function currentPath(oc: any, c: Case, sub = 1): any {
  const lead = TAU * c.radius * Math.tan(c.angle);
  const reach = c.radius + KNURL_OVERSHOOT * c.depth;
  const half = (c.depth + KNURL_OVERSHOOT * c.depth) * Math.tan(c.included / 2);
  const back = Math.ceil((half - c.from) / lead) + 1;
  const turns = back + Math.ceil((c.to + half) / lead) + 1;
  const shift = -back * lead;

  const swept = sweepExactly(oc, c, shift, turns, 0, sub);
  const box = new oc.BRepPrimAPI_MakeCylinder(new oc.gp_Ax2(new oc.gp_Pnt(0, 0, c.from), new oc.gp_Dir(0, 0, 1), new oc.gp_Dir(1, 0, 0)), reach + 1, c.to - c.from).Shape();
  return handOfGrooves(oc, c, common(oc, swept, box));
}

const spec = (c: Case): KnurlSpec => ({ axis: { origin: [0, 0, 0], dir: [0, 0, 1] }, radius: c.radius, count: c.count, from: c.from, to: c.to, depth: c.depth, included: c.included, pattern: 'helical', angle: c.angle, hand: 'right', phase: c.phase });

const leadOf = (c: Case) => TAU * c.radius * Math.tan(c.angle);

/** The grooves cut square to the axis over `[z0, z1]` — the shape the current path's flat ends give. */
const clip = (oc: any, s: any, c: Case, z0: number, z1: number): any => {
  const box = new oc.BRepPrimAPI_MakeCylinder(
    new oc.gp_Ax2(new oc.gp_Pnt(0, 0, z0), new oc.gp_Dir(0, 0, 1), new oc.gp_Dir(1, 0, 0)),
    c.radius + 1,
    z1 - z0,
  ).Shape();
  return common(oc, s, box);
};

describe('A2c: can the knurl be swept to length instead of trimmed?', () => {
  it('replicates the current path faithfully', () => {
    const oc = kernel.oc as any;
    const c = CASE;
    const a = currentPath(oc, c);
    const prod = kernel.knurl(spec(c));
    const vA = volume(oc, a);
    const vProd = kernel.massProps(prod.shape).volume;
    const replicationError = Math.abs(vA - vProd) / vProd;
    console.log(`replication of the current path vs Kernel.knurl: ${vA.toFixed(4)} vs ${vProd.toFixed(4)} mm3  (rel. err ${replicationError.toExponential(2)})`);
    expect(replicationError).toBeLessThan(1e-9);
  }, 300_000);

  // The two paths are the same pattern turned by the same phase. If they differ, the difference is either at the ends (the current path cuts
  // square to the axis, the new path begins and ends with the profile in its own plane) or all along the groove (a wrong phase, or a spine that
  // is discretised differently). Clipping both a clear margin inside each end separates the two: a middle that coincides says the difference is
  // the ends and nothing else.
  it('says where the two paths differ: at the ends, or all along the groove?', () => {
    const oc = kernel.oc as any;
    const c = CASE;
    const theta = (TAU * c.from) / leadOf(c);
    const inset = 1;

    const a = currentPath(oc, c);
    const b = handOfGrooves(oc, c, sweepExactly(oc, c, c.from, (c.to - c.from) / leadOf(c), theta));
    const vA = volume(oc, a);
    const vB = volume(oc, b);
    console.log(`  volume: current ${vA.toFixed(4)} mm3, new ${vB.toFixed(4)} mm3  (new is ${(((vB - vA) / vA) * 100).toFixed(3)}% of it)`);
    console.log(`  solids: current ${countOf(oc, a, oc.TopAbs_ShapeEnum.TopAbs_SOLID)}, new ${countOf(oc, b, oc.TopAbs_ShapeEnum.TopAbs_SOLID)}`);

    const whole = volume(oc, common(oc, a, b)) / vA;
    const midA = clip(oc, a, c, c.from + inset, c.to - inset);
    const vMidA = volume(oc, midA);
    const middle = volume(oc, common(oc, midA, clip(oc, b, c, c.from + inset, c.to - inset))) / vMidA;
    const wrong = handOfGrooves(oc, c, sweepExactly(oc, c, c.from, (c.to - c.from) / leadOf(c), 0));
    const control = volume(oc, common(oc, midA, clip(oc, wrong, c, c.from + inset, c.to - inset))) / vMidA;
    const half = handOfGrooves(oc, c, sweepExactly(oc, c, c.from, (c.to - c.from) / leadOf(c), theta + Math.PI / c.count));
    const control2 = volume(oc, common(oc, midA, clip(oc, half, c, c.from + inset, c.to - inset))) / vMidA;

    console.log(`  Common/volume over the whole groove           ${whole.toFixed(6)}`);
    console.log(`  Common/volume ${inset} mm inside both ends    ${middle.toFixed(6)}`);
    console.log(`  NEGATIVE CONTROL: no phase correction         ${control.toFixed(6)}`);
    console.log(`  NEGATIVE CONTROL: half a pitch off            ${control2.toFixed(6)}`);

    expect(valid(oc, b)).toBe(true);
    // the metric has to be able to fail, or a match means nothing
    expect(control).toBeLessThan(0.5);
    expect(control2).toBeLessThan(0.1);
    expect(whole).toBeGreaterThan(0.9); // the same pattern; the open question is only how exactly
  }, 300_000);

  // The middle coincides exactly and the residual does not move when the helix is refined, so it is not discretisation. Which end is it? Each window
  // is cut square and compared on its own, and the volumes are printed to nine figures: if the whole volumes agree while a window does not, the two
  // paths are the same pattern with differently shaped ends, not a different pattern.
  it('localises the difference to the ends, one window at a time', () => {
    const oc = kernel.oc as any;
    const c = CASE;
    const theta = (TAU * c.from) / leadOf(c);
    const a = currentPath(oc, c);
    const b = handOfGrooves(oc, c, sweepExactly(oc, c, c.from, (c.to - c.from) / leadOf(c), theta));

    console.log('  window                 volume(a)     volume(b)     Common/volume(a)');
    const win = (label: string, z0: number, z1: number) => {
      const ca = clip(oc, a, c, z0, z1);
      const cb = clip(oc, b, c, z0, z1);
      const va = volume(oc, ca);
      const vb = volume(oc, cb);
      const share = volume(oc, common(oc, ca, cb)) / va;
      console.log(`  ${label.padEnd(22)} ${va.toFixed(9)}  ${vb.toFixed(9)}  ${share.toFixed(9)}`);
      return share;
    };
    win('whole [from, to]', c.from, c.to);
    const start = win('start [from, from+1]', c.from, c.from + 1);
    const end = win('end [to-1, to]', c.to - 1, c.to);
    const middle = win('middle [from+1, to-1]', c.from + 1, c.to - 1);
    console.log(`  full volume: a ${volume(oc, a).toFixed(9)} mm3   b ${volume(oc, b).toFixed(9)} mm3`);

    // the two ends are where they differ, and the middle is where they do not
    expect(start).toBeLessThan(1 - 1e-6);
    expect(end).toBeLessThan(1 - 1e-6);
    expect(middle).toBeGreaterThan(1 - 1e-9);
  }, 300_000);

  // If the middle still falls short of 1, it is the helix that is discretised differently: `sub` edges per turn for both paths, and the middle
  // overlap has to climb towards 1 as both spines are refined. If it plateaus, the two sweeps are not the same surface and the change is off.
  it('studies the discretisation: does the overlap converge as the helix is refined?', () => {
    const oc = kernel.oc as any;
    const c = CASE;
    const theta = (TAU * c.from) / leadOf(c);
    const inset = 1;
    console.log('  sub  turns/edges  volume(a)  volume(b)  overlap(whole)  overlap(mid)  control(mid)');
    for (const sub of [1, 4]) {
      const turns = (c.to - c.from) / leadOf(c);
      const a = currentPath(oc, c, sub);
      const b = handOfGrooves(oc, c, sweepExactly(oc, c, c.from, turns, theta, sub));
      const w = handOfGrooves(oc, c, sweepExactly(oc, c, c.from, turns, 0, sub));
      const vA = volume(oc, a);
      const whole = volume(oc, common(oc, a, b)) / vA;
      const midA = clip(oc, a, c, c.from + inset, c.to - inset);
      const vMidA = volume(oc, midA);
      const mid = volume(oc, common(oc, midA, clip(oc, b, c, c.from + inset, c.to - inset))) / vMidA;
      const ctl = volume(oc, common(oc, midA, clip(oc, w, c, c.from + inset, c.to - inset))) / vMidA;
      console.log(
        `  ${String(sub).padEnd(4)} ${String(Math.ceil(18 * sub)).padStart(2)}/${String(Math.ceil(turns * sub)).padStart(2)}` +
          `       ${vA.toFixed(4)}    ${volume(oc, b).toFixed(4)}    ${whole.toFixed(6)}      ${mid.toFixed(6)}     ${ctl.toFixed(6)}`,
      );
      expect(valid(oc, b)).toBe(true);
    }
  }, 300_000);

  it('measures what it costs: the boolean that would go away', () => {
    const oc = kernel.oc as any;
    const c = CASE;
    const theta = (TAU * c.from) / leadOf(c);
    const runs = 3;

    const timeOf = (label: string, build: () => any) => {
      let total = 0;
      for (let i = 0; i < runs; i++) {
        const t = performance.now();
        const shape = build();
        total += performance.now() - t;
        expect(valid(oc, shape)).toBe(true);
      }
      console.log(`  ${label.padEnd(34)} ${(total / runs).toFixed(0)} ms  (${runs} runs)`);
      return total / runs;
    };

    const current = timeOf('current: sweep whole turns + trim', () => currentPath(oc, c));
    const next = timeOf('new: sweep to length, no trim', () => handOfGrooves(oc, c, sweepExactly(oc, c, c.from, (c.to - c.from) / leadOf(c), theta)));
    console.log(`  the trim boolean costs ${(current - next).toFixed(0)} ms of ${current.toFixed(0)} ms (${(((current - next) / current) * 100).toFixed(0)}%)`);
  }, 300_000);
});
