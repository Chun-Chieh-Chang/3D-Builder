/**
 * Threads (螺牙), T-1 of docs/thread-plan.md: the kernel's thread tool (`Kernel.thread`) fused onto a core or cut from a block, checked against what can be
 * worked out by hand, not against itself.
 *
 * - Volume: a profile carried round the axis in a screw motion fills, at every height z, a slice of area (2π / lead) ∫ (r' + tan·(z − z')) dA over the
 *   profile (r', z' where the profile is drawn); so the volume from `from` to `to` is closed form. What the body already had is taken off the profile
 *   first (a half plane: the bore r ≥ rb, or outside a cone r − tan·z ≥ R0, both kept by the screw motion), so the result's volume is exact too.
 * - Flanks: a solid classifier probes 0.003 mm either side of each flank, at three depths, six angles, every start, the first and the last whole turn.
 *   The probes are placed from the definition (right hand: along the axis as the angle grows counter-clockwise about it; start k turned 360°·k/N; the
 *   whole turned by the start angle), and the same probes placed with the hand, the start angle or the number of starts wrong must fail: otherwise
 *   the probes would prove nothing.
 * - STEP round trip, mesh (closed: every edge of the welded mesh on two triangles, for printing) and time.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type Segment, type ShapeId, type ThreadSpec, type Vec3 } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const deg = Math.PI / 180;
const TAU = Math.PI * 2;
/** The XZ plane: its x is the distance from the Z axis, its y the height. */
const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
const Z_AXIS = { origin: [0, 0, 0] as Vec3, dir: [0, 0, 1] as Vec3 };

type P = [number, number]; // (r, z)
const area2 = (pts: P[]) => pts.reduce((s, [x0, y0], i) => { const [x1, y1] = pts[(i + 1) % pts.length]!; return s + x0 * y1 - x1 * y0; }, 0);
const region = (pts: P[], name = 'p'): Region => {
  const loop = area2(pts) > 0 ? pts : [...pts].reverse();
  const outer: Segment[] = loop.map((a, i) => ({ kind: 'line', a, b: loop[(i + 1) % loop.length]!, source: `${name}${i + 1}` }));
  return { outer, holes: [] };
};
/** Integrated adaptively: OCCT's default rule is about 1e-4 off on a thread's long B-spline faces (Kernel.massProps). */
const volume = (id: ShapeId) => kernel.massProps(id, { eps: 1e-9 }).volume;
const revolve = (pts: P[]): ShapeId => kernel.revolve(XZ, [region(pts, 'b')], Z_AXIS, TAU).shape;

/** A trapezoid that narrows away from the axis: base `wb` wide at radius rb, `h` high, flanks a1 / a2 from the radial line, carried `e` past rb. */
interface Tooth { wb: number; h: number; a1: number; a2: number; e: number }
const toothAt = (rb: number, zc: number, p: Tooth): P[] => {
  const [t1, t2] = [Math.tan(p.a1), Math.tan(p.a2)];
  return [
    [rb - p.e, zc - p.wb / 2 - p.e * t1],
    [rb - p.e, zc + p.wb / 2 + p.e * t2],
    [rb + p.h, zc + p.wb / 2 - p.h * t2],
    [rb + p.h, zc - p.wb / 2 + p.h * t1],
  ];
};

/** Sutherland–Hodgman against a·r + b·z ≥ c. */
const clip = (pts: P[], a: number, b: number, c: number): P[] => {
  const out: P[] = [];
  const f = ([r, z]: P) => a * r + b * z - c;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    const [fp, fq] = [f(p), f(q)];
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) {
      const s = fp / (fp - fq);
      out.push([p[0] + s * (q[0] - p[0]), p[1] + s * (q[1] - p[1])]);
    }
  });
  return out;
};
const moments = (pts: P[]) => {
  let A = 0, cr = 0, cz = 0;
  pts.forEach(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    const w = x0 * y1 - x1 * y0;
    A += w;
    cr += (x0 + x1) * w;
    cz += (y0 + y1) * w;
  });
  return { A: Math.abs(A / 2), cr: cr / (3 * A), cz: cz / (3 * A) };
};
/** The volume of `starts` threads of profile `pts` from `from` to `to` (see the head of the file). */
const threadVolume = (pts: P[], lead: number, starts: number, from: number, to: number, tan: number) => {
  const { A, cr, cz } = moments(pts);
  const L = to - from;
  return ((starts * TAU * A) / lead) * (cr * L + tan * ((to * to - from * from) / 2 - cz * L));
};

interface Case {
  name: string;
  mode: 'fuse' | 'cut';
  /** Core radius (fuse, at z = 0 for a cone) or bore radius (cut). */
  rb: number;
  outer?: number;
  body: [number, number];
  from: number;
  to: number;
  tooth: Tooth;
  pitch: number;
  starts: number;
  hand: 'right' | 'left';
  taper?: number;
  phase?: number;
}

interface Made { c: Case; result: ShapeId; tool: ShapeId; faceOrigins: ReturnType<Kernel['thread']>['faceOrigins']; body: ShapeId; ms: number; profile: P[] }

const make = (c: Case): Made => {
  const tan = Math.tan(c.taper ?? 0);
  const [z0, z1] = c.body;
  const body =
    c.mode === 'cut'
      ? revolve([[c.rb, z0], [c.outer!, z0], [c.outer!, z1], [c.rb, z1]])
      : revolve([[0, z0], [c.rb + tan * z0, z0], [c.rb + tan * z1, z1], [0, z1]]);
  const zc = c.from; // the profile is drawn where the thread starts
  const profile = toothAt(c.rb + tan * zc, zc, c.tooth);
  const spec: ThreadSpec = { axis: Z_AXIS, pitch: c.pitch, starts: c.starts, hand: c.hand, from: c.from, to: c.to, ...(c.taper ? { taper: c.taper } : {}), ...(c.phase ? { phase: c.phase } : {}) };
  const t0 = performance.now();
  const tool = kernel.thread(XZ, [region(profile)], spec);
  const result = kernel.boolean(c.mode, body, tool.shape);
  return { c, result: result.shape, tool: tool.shape, faceOrigins: tool.faceOrigins, body, ms: performance.now() - t0, profile };
};

/** What the thread added or took away, by hand. */
const expectedChange = (m: Made) => {
  const { c } = m;
  const tan = Math.tan(c.taper ?? 0);
  // keep the part of the profile the body did not already have: past the bore (cut), outside the core (fuse)
  const kept = c.mode === 'cut' ? clip(m.profile, 1, 0, c.rb) : clip(m.profile, 1, -tan, c.rb);
  return threadVolume(kept, c.pitch * c.starts, c.starts, c.from, c.to, tan);
};

/** Probes either side of every flank; returns how many came out wrong, and how many there were. */
const probe = (m: Made, assume: { hand?: 'right' | 'left'; phase?: number; starts?: number } = {}) => {
  const { c } = m;
  const hand = (assume.hand ?? c.hand) === 'left' ? -1 : 1;
  const phase = assume.phase ?? c.phase ?? 0;
  const starts = assume.starts ?? c.starts;
  const lead = c.pitch * c.starts;
  const tan = Math.tan(c.taper ?? 0);
  const { wb, h, a1, a2 } = c.tooth;
  const wide = wb / 2 + 0.05;
  const lo0 = Math.max(c.from, c.body[0]) + wide;
  const hi0 = Math.min(c.to, c.body[1]) - wide;
  const inside = c.mode === 'cut' ? 'out' : 'in';
  const outside = c.mode === 'cut' ? 'in' : 'out';
  const d = 0.003;
  const points: Vec3[] = [];
  const wants: string[] = [];
  for (const th of [0.3, 1.1, 2.0, 3.0, 4.2, 5.5]) {
    for (let k = 0; k < starts; k++) {
      // how far along the axis this start's profile has moved when it is at angle th
      const base = (hand * lead * (th - phase)) / TAU + (k * lead) / starts;
      const first = Math.ceil((lo0 - c.from - base) / lead);
      const last = Math.floor((hi0 - c.from - base) / lead);
      for (const turn of new Set([first, last])) {
        if (turn < first || turn > last) continue;
        const shift = base + turn * lead;
        for (const f of [0.25, 0.5, 0.75]) {
          const dr = h * f;
          const r = c.rb + tan * c.from + dr + tan * shift;
          const zl = c.from - wb / 2 + dr * Math.tan(a1) + shift;
          const zh = c.from + wb / 2 - dr * Math.tan(a2) + shift;
          for (const [z, want] of [[zl - d, outside], [zl + d, inside], [zh - d, inside], [zh + d, outside]] as const) {
            points.push([r * Math.cos(th), r * Math.sin(th), z]);
            wants.push(want);
          }
        }
      }
    }
  }
  const got = kernel.classify(m.result, points);
  return { bad: got.filter((g, i) => g !== wants[i]).length, n: points.length };
};

/** A welded mesh is closed when every edge belongs to exactly two triangles. */
const closedMesh = (id: ShapeId) => {
  const mesh = kernel.mesh(id, { tolerance: 0.02, angular: 0.3 });
  const key = (i: number) => `${Math.round(mesh.positions[i * 3]! * 1e5)},${Math.round(mesh.positions[i * 3 + 1]! * 1e5)},${Math.round(mesh.positions[i * 3 + 2]! * 1e5)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [0, 1, 2].map((j) => key(mesh.indices[t + j]!));
    for (let j = 0; j < 3; j++) {
      const [a, b] = [v[j]!, v[(j + 1) % 3]!];
      if (a === b) continue;
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  const open = [...edges.values()].filter((x) => x !== 2).length;
  return { triangles: mesh.indices.length / 3, open };
};

const symmetric: Tooth = { wb: 1.6, h: 0.4, a1: 30 * deg, a2: 30 * deg, e: 0.2 };
const CASES: Record<string, Case> = {
  A: { name: '外螺紋，圓柱，單線，右旋（螺距 2，對稱 30°）', mode: 'fuse', rb: 4, body: [0, 20], from: 0, to: 20, tooth: { wb: 1.4, h: 0.9, a1: 30 * deg, a2: 30 * deg, e: 0.2 }, pitch: 2, starts: 1, hand: 'right' },
  B: { name: '內螺紋，圓柱，雙線，右旋（螺距 2.5，導程 5）', mode: 'cut', rb: 3.6, outer: 6, body: [0, 9], from: 0, to: 9, tooth: symmetric, pitch: 2.5, starts: 2, hand: 'right' },
  C: { name: '外螺紋，圓錐 6 %（半角 1.718°），雙線', mode: 'fuse', rb: 4, body: [0, 12], from: 0, to: 12, taper: Math.atan(0.03), tooth: symmetric, pitch: 2.5, starts: 2, hand: 'right' },
  D: { name: '內螺紋，雙線，非對稱牙型（30° / 20°）', mode: 'cut', rb: 3.6, outer: 7, body: [0, 8], from: 0, to: 8, tooth: { wb: 1.7, h: 0.4, a1: 30 * deg, a2: 20 * deg, e: 0.2 }, pitch: 2.5, starts: 2, hand: 'right' },
  E: { name: '內螺紋，左旋，起始角 60°，雙線', mode: 'cut', rb: 3.6, outer: 6, body: [0, 9], from: 0, to: 9, tooth: symmetric, pitch: 2.5, starts: 2, hand: 'left', phase: 60 * deg },
  F: { name: '內螺紋，只做中段（3 到 9），雙線', mode: 'cut', rb: 3.6, outer: 6, body: [0, 12], from: 3, to: 9, tooth: symmetric, pitch: 2.5, starts: 2, hand: 'right' },
  G: { name: '外螺紋，三線，左旋，起始角 25°', mode: 'fuse', rb: 5, body: [0, 15], from: 0, to: 15, tooth: { wb: 1.2, h: 0.5, a1: 30 * deg, a2: 30 * deg, e: 0.2 }, pitch: 2, starts: 3, hand: 'left', phase: 25 * deg },
  H: { name: '細牙多圈：外螺紋 M3 × 0.5 樣式，長 15（約 30 圈）', mode: 'fuse', rb: 1.2, body: [0, 15], from: 0, to: 15, tooth: { wb: 0.4, h: 0.27, a1: 30 * deg, a2: 30 * deg, e: 0.05 }, pitch: 0.5, starts: 1, hand: 'right' },
};

describe('thread tool: volume, flanks, STEP, mesh, time (T-1)', () => {
  for (const [id, c] of Object.entries(CASES)) {
    it(`${id} ${c.name}`, { timeout: 120_000 }, () => {
      const m = make(c);
      expect(kernel.isValid(m.tool), 'tool valid').toBe(true);
      expect(kernel.isValid(m.result), 'result valid').toBe(true);
      expect(kernel.solidCount(m.result)).toBe(1);

      const v0 = volume(m.body);
      const got = volume(m.result);
      const change = expectedChange(m);
      const measured = c.mode === 'cut' ? v0 - got : got - v0;
      const rel = Math.abs(measured - change) / change;
      expect(rel, `thread volume ${measured.toFixed(5)} against ${change.toFixed(5)} by hand`).toBeLessThan(c.taper ? 1e-3 : 1e-5); // docs/thread-plan.md asks ≤ 0.5 %; this holds it to what the kernel now does

      const p = probe(m);
      expect(p.n).toBeGreaterThan(0);
      expect(p.bad, `${p.bad} of ${p.n} probes wrong`).toBe(0);

      const back = kernel.importStep(kernel.exportStep(m.result)).shape;
      expect(kernel.isValid(back)).toBe(true);
      expect(Math.abs(volume(back) - got) / got).toBeLessThan(1e-6);

      const mesh = closedMesh(m.result);
      expect(mesh.triangles).toBeLessThan(200_000);
      expect(mesh.open, 'edges not on exactly two triangles').toBe(0);

      if (process.env.PERF_CHECK) {
        expect(m.ms, 'thread + boolean').toBeLessThan(5000);
      }
      console.log(`[thread ${id}] ${m.ms.toFixed(0)} ms, ${mesh.triangles} triangles, volume error ${rel.toExponential(2)}, ${p.n} probes`);
      for (const s of [m.result, m.tool, m.body, back]) kernel.release(s);
    });
  }
});

describe('the probes can tell a wrong thread from a right one', () => {
  it('a wrong hand, start angle or number of starts is caught', { timeout: 120_000 }, () => {
    const b = make(CASES.B!);
    expect(probe(b, { hand: 'left' }).bad).toBeGreaterThan(0);
    expect(probe(b, { starts: 4 }).bad).toBeGreaterThan(0);
    const e = make(CASES.E!);
    expect(probe(e, { phase: -60 * deg }).bad).toBeGreaterThan(0);
    expect(probe(e, { hand: 'right' }).bad).toBeGreaterThan(0);
    const g = make(CASES.G!);
    expect(probe(g, { starts: 1 }).bad).toBe(0); // fewer starts probes a subset: it cannot fail, which is why `starts: 4` above is the real test
    expect(probe(g, { phase: 0 }).bad).toBeGreaterThan(0);
    for (const m of [b, e, g]) for (const s of [m.result, m.tool, m.body]) kernel.release(s);
  });
});

describe('names of the faces of the tool', () => {
  it('each side face is one turn of its profile edge along the helix of its start; the faces on the end planes are the caps', { timeout: 60_000 }, () => {
    const m = make(CASES.B!);
    const names = m.faceOrigins.map((o) => o.map((x) => (x.rel === 'generated' && x.kind === 'profileEdge' ? x.source : x.rel === 'cap' ? `cap:${x.which}` : '?')).join('+'));
    expect(names.every((n) => n.length > 0 && !n.includes('?')), names.join(', ')).toBe(true);
    for (const s of [1, 2]) for (const e of [1, 2, 3, 4]) for (const turn of [0, 1]) expect(names, `p${e}@helix${s}:${turn}`).toContain(`p${e}@helix${s}:${turn}`);
    expect(names.filter((n) => n === 'cap:start').length).toBe(2); // one per start
    expect(names.filter((n) => n === 'cap:end').length).toBe(2);
    for (const s of [m.result, m.tool, m.body]) kernel.release(s);
  });
});

describe('a thread that cannot be made says why', () => {
  const ok = (): ThreadSpec => ({ axis: Z_AXIS, pitch: 2.5, starts: 2, hand: 'right', from: 0, to: 9 });
  const tooth = region(toothAt(3.6, 0, symmetric));
  const cases: [string, () => unknown, RegExp][] = [
    ['pitch 0', () => kernel.thread(XZ, [tooth], { ...ok(), pitch: 0 }), /螺距/],
    ['1.5 starts', () => kernel.thread(XZ, [tooth], { ...ok(), starts: 1.5 }), /線數/],
    ['no length', () => kernel.thread(XZ, [tooth], { ...ok(), to: 0 }), /長度/],
    ['taper 40°', () => kernel.thread(XZ, [tooth], { ...ok(), taper: 40 * deg }), /錐度/],
    ['axis off the plane', () => kernel.thread(XZ, [tooth], { ...ok(), axis: { origin: [0, 1, 0], dir: [0, 0, 1] } }), /平面沒有通過/],
    ['axis across the plane', () => kernel.thread(XZ, [tooth], { ...ok(), axis: { origin: [0, 0, 0], dir: [0, 1, 0] } }), /平面沒有通過/],
    ['profile across the axis', () => kernel.thread(XZ, [region([[-1, 0], [1, 0], [1, 1], [-1, 1]])], ok()), /軸的一側/],
    ['profile as wide as the lead', () => kernel.thread(XZ, [region(toothAt(3.6, 0, { ...symmetric, wb: 5.2 }))], ok()), /導程/],
    ['too many turns', () => kernel.thread(XZ, [region(toothAt(3.6, 0, { wb: 0.01, h: 0.005, a1: 0, a2: 0, e: 0 }))], { ...ok(), pitch: 0.02, starts: 1 }), /上限/],
    ['a taper that shrinks onto the axis', () => kernel.thread(XZ, [tooth], { ...ok(), to: 40, taper: -20 * deg }), /軸/],
  ];
  for (const [name, run, why] of cases) it(name, () => expect(run).toThrow(why));
});

describe('T-2 risk verification: booleans with chamfer, fillet, and step face', () => {
  it('thread cut into a bore with pre-existing entrance chamfer succeeds', () => {
    // 1. Bore with pre-existing 45° chamfer at entrance (z=0, bore r=3.6, chamfer to r=4.1 at z=0.5)
    const [z0, z1] = [0, 9];
    const preChamferBody = revolve([
      [4.1, z0],
      [7.0, z0],
      [7.0, z1],
      [3.6, z1],
      [3.6, 0.5],
    ]);
    const tooth = toothAt(3.6, 0, symmetric);
    const spec: ThreadSpec = { axis: Z_AXIS, pitch: 2.5, starts: 2, hand: 'right', from: 0, to: 9 };
    const tool = kernel.thread(XZ, [region(tooth)], spec);
    const cut = kernel.boolean('cut', preChamferBody, tool.shape);
    expect(kernel.isValid(cut.shape), 'pre-chamfer cut valid').toBe(true);
    expect(kernel.solidCount(cut.shape)).toBe(1);
    expect(cut.faceOrigins.length).toBeGreaterThan(0);

    for (const s of [preChamferBody, tool.shape, cut.shape]) kernel.release(s);
  });

  it('post-thread boolean cuts (entrance chamfer cut and exit step face counterbore) succeed and preserve single valid solid', () => {
    // 2. Base bore cut with thread first
    const b = make(CASES.B!);
    expect(kernel.isValid(b.result)).toBe(true);

    // Cut entrance chamfer (45° conical cutter at z=0)
    const chamferCutter = kernel.revolve(XZ, [region([[3.0, -0.1], [4.2, -0.1], [3.6, 0.5], [3.0, 0.5]])], Z_AXIS, TAU).shape;
    const chamfered = kernel.boolean('cut', b.result, chamferCutter).shape;
    expect(kernel.isValid(chamfered), 'post-chamfer cut valid').toBe(true);
    expect(kernel.solidCount(chamfered)).toBe(1);

    // Cut exit step face / counterbore at z=7..9
    const stepCutter = kernel.revolve(XZ, [region([[3.6, 7], [5.5, 7], [5.5, 9.5], [3.6, 9.5]])], Z_AXIS, TAU).shape;
    const stepped = kernel.boolean('cut', chamfered, stepCutter).shape;
    expect(kernel.isValid(stepped), 'step face cut valid').toBe(true);
    expect(kernel.solidCount(stepped)).toBe(1);

    // Verify STEP export/import round-trip of the combined result
    const stepBytes = kernel.exportStep(stepped);
    const imported = kernel.importStep(stepBytes).shape;
    expect(kernel.isValid(imported)).toBe(true);

    for (const s of [b.result, b.tool, b.body, chamferCutter, chamfered, stepCutter, stepped, imported]) kernel.release(s);
  });
});
