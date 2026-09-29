import type { Pose, Quat, Vec3 } from '@3db/model';
import { compileMate, type MateSpec, type Residual } from './equations';
import { placed } from './geometry';
import { add, expRotation, qmul, qnormalize, rotate, sub } from './math';
import { nullSpace, rank, solveDamped } from './linalg';

/** A component as the solver sees it (A3.1). */
export interface SolverBody {
  id: string;
  /** Fixed components never move (C15.2); floating ones have six freedoms. */
  fixed: boolean;
  /** Where the component starts: its placement, the intent for any freedom the mates leave open. */
  pose: Pose;
  /** The point it turns about, in its part's coordinates: the middle of the part. Default: the origin. */
  pivot?: Vec3;
  /** About the radius of the part (mm): turning and moving are weighed by how far its points travel. */
  size?: number;
}

export type MateResult =
  | { status: 'ok' }
  /** The mate cannot hold together with the mates before it: the assembly is over-defined (A3.4). */
  | { status: 'conflict'; residual: number }
  | { status: 'unsupported'; message: string };

export interface BodyResult {
  /** SolidWorks' marks: fixed (f), under-defined (-), fully defined (none), over-defined (+). */
  status: 'fixed' | 'under' | 'full' | 'over';
  /** Freedoms left, 0–6 (A3.4). */
  dof: number;
}

export interface Solution {
  /** Where every component is, satisfying the mates that hold; derived, never stored. */
  poses: Map<string, Pose>;
  bodies: Map<string, BodyResult>;
  mates: Map<string, MateResult>;
  ms: number;
}

export interface SolveOptions {
  maxIterations?: number;
}

interface Body {
  id: string;
  fixed: boolean;
  q: Quat;
  t: Vec3;
  pivot: Vec3;
  size: number;
  /** Position among the floating bodies of its cluster (variables 6k … 6k+5). */
  k: number;
}

interface Live {
  spec: MateSpec;
  residual: Residual;
  a: Body | null;
  b: Body | null;
  rows: number;
}

const ORIGIN_POSE: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const pose = (b: Body | null): Pose => (b ? { position: b.t, rotation: b.q } : ORIGIN_POSE);

function evaluate(m: Live, L: number): number[] {
  const pa = pose(m.a);
  const pb = pose(m.b);
  return m.residual(placed(m.spec.a.geom, pa), placed(m.spec.b.geom, pb), pa, pb, L);
}

/** The body moved by x[o … o+5]: a translation of its pivot, then a turn about it (scaled by its size). */
function moved(b: Body, x: ArrayLike<number>, o: number): { q: Quat; t: Vec3 } {
  const E = expRotation([x[o + 3]! / b.size, x[o + 4]! / b.size, x[o + 5]! / b.size]);
  const c = add(rotate(b.q, b.pivot), b.t);
  return { q: qnormalize(qmul(E, b.q)), t: add(add(rotate(E, sub(b.t, c)), c), [x[o]!, x[o + 1]!, x[o + 2]!]) };
}

const maxAbs = (r: ArrayLike<number>) => {
  let m = 0;
  for (let i = 0; i < r.length; i++) m = Math.max(m, Math.abs(r[i]!));
  return m;
};

/**
 * Solves the mates (A3.2, A3.4). Components connected through mates between floating components are
 * solved together, each group on its own. Every group starts from the placements, so the same
 * document always gives the same positions, and freedoms the mates leave open keep the placement.
 * A mate that cannot hold together with the mates before it (in FeatureManager order) is a conflict;
 * the others still hold.
 */
export function solve(input: SolverBody[], specs: MateSpec[], options: SolveOptions = {}): Solution {
  const t0 = performance.now();
  const bodies = new Map<string, Body>();
  for (const b of input) {
    bodies.set(b.id, { id: b.id, fixed: b.fixed, q: qnormalize(b.pose.rotation), t: [...b.pose.position], pivot: b.pivot ?? [0, 0, 0], size: b.size && b.size > 0 ? b.size : 50, k: -1 });
  }
  const sizes = [...bodies.values()].map((b) => b.size);
  const L = sizes.length ? sizes.reduce((s, v) => s + v, 0) / sizes.length : 50;
  const tol = { converged: 1e-10 * Math.max(1, L), holds: 1e-6 * Math.max(1, L) };
  const maxIterations = options.maxIterations ?? 100;

  const mates = new Map<string, MateResult>();
  const live: Live[] = [];
  for (const spec of specs) {
    const a = spec.a.body === null ? null : bodies.get(spec.a.body);
    const b = spec.b.body === null ? null : bodies.get(spec.b.body);
    if (a === undefined || b === undefined) {
      mates.set(spec.id, { status: 'unsupported', message: '結合參考的零組件不存在' });
      continue;
    }
    if ((a === null && b === null) || a === b) {
      mates.set(spec.id, { status: 'unsupported', message: '結合的兩個元素必須在不同的零組件上' });
      continue;
    }
    const compiled = compileMate(spec, placed(spec.a.geom, pose(a)), placed(spec.b.geom, pose(b)));
    if ('unsupported' in compiled) {
      mates.set(spec.id, { status: 'unsupported', message: compiled.unsupported });
      continue;
    }
    const m: Live = { spec, residual: compiled.residual, a, b, rows: 0 };
    m.rows = evaluate(m, L).length;
    live.push(m);
  }

  // Groups: floating bodies joined by mates between floating bodies.
  const parent = new Map<Body, Body>();
  const find = (b: Body): Body => {
    let r = b;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const b of bodies.values()) if (!b.fixed) parent.set(b, b);
  const floating = (b: Body | null): b is Body => b !== null && !b.fixed;
  for (const m of live) if (floating(m.a) && floating(m.b)) parent.set(find(m.a), find(m.b));
  const groups = new Map<Body, { bodies: Body[]; mates: Live[] }>();
  for (const b of bodies.values()) {
    if (b.fixed) continue;
    const g = groups.get(find(b)) ?? { bodies: [], mates: [] };
    b.k = g.bodies.length;
    g.bodies.push(b);
    groups.set(find(b), g);
  }
  const conflicts = new Map<Live, number>();
  for (const m of live) {
    const owner = floating(m.a) ? m.a : floating(m.b) ? m.b : null;
    if (owner) groups.get(find(owner))!.mates.push(m);
    else {
      // Between things that never move: it holds, or it never will.
      const r = maxAbs(evaluate(m, L));
      if (r > tol.holds) conflicts.set(m, r);
    }
  }

  const dofs = new Map<Body, number>();
  for (const g of groups.values()) {
    const held = solveGroup(g.bodies, g.mates, L, tol, maxIterations, conflicts);
    freedoms(g.bodies, held, L).forEach((dof, i) => dofs.set(g.bodies[i]!, dof));
  }

  for (const m of live) {
    const r = conflicts.get(m);
    mates.set(m.spec.id, r === undefined ? { status: 'ok' } : { status: 'conflict', residual: r });
  }
  const over = new Set<Body>();
  for (const m of conflicts.keys()) for (const b of [m.a, m.b]) if (floating(b)) over.add(b);
  const results = new Map<string, BodyResult>();
  const poses = new Map<string, Pose>();
  for (const b of bodies.values()) {
    poses.set(b.id, { position: b.t, rotation: b.q });
    const dof = b.fixed ? 0 : (dofs.get(b) ?? 6);
    results.set(b.id, { status: b.fixed ? 'fixed' : over.has(b) ? 'over' : dof > 0 ? 'under' : 'full', dof });
  }
  return { poses, bodies: results, mates, ms: performance.now() - t0 };
}

/**
 * One group: all its mates at once. If they cannot all hold, the mates are taken in FeatureManager
 * order and the first one that cannot hold together with those before it is found by bisection; it
 * is a conflict, and the search goes on with the mates after it. Trials start where the last trial
 * that held ended; the positions returned are solved once more from the placements, so they are the
 * same as if the conflicting mates had never been there. Returns the mates kept.
 */
function solveGroup(bodies: Body[], mates: Live[], L: number, tol: { converged: number; holds: number }, maxIterations: number, conflicts: Map<Live, number>): Live[] {
  if (mates.length === 0) return [];
  const start = snapshot(bodies);
  if (settle(bodies, mates, L, tol, maxIterations)) return mates;
  let good = start;
  const holds = (set: Live[]) => {
    restore(bodies, good);
    if (!settle(bodies, set, L, tol, maxIterations)) return false;
    good = snapshot(bodies);
    return true;
  };
  let kept: Live[] = [];
  let rest = mates;
  const found: Live[] = [];
  // All of them together is already known not to hold; after each conflict, the rest is tried again.
  let unknown = false;
  while (rest.length > 0 && !(unknown && holds([...kept, ...rest]))) {
    // The shortest prefix of `rest` that cannot hold with `kept` ends at the conflict.
    let lo = 0;
    let hi = rest.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (holds([...kept, ...rest.slice(0, mid + 1)])) lo = mid + 1;
      else hi = mid;
    }
    found.push(rest[lo]!);
    kept = [...kept, ...rest.slice(0, lo)];
    rest = rest.slice(lo + 1);
    unknown = true;
  }
  if (rest.length > 0) kept = [...kept, ...rest];
  restore(bodies, start);
  settle(bodies, kept, L, tol, maxIterations);
  for (const m of found) conflicts.set(m, maxAbs(evaluate(m, L)));
  return kept;
}

const snapshot = (bodies: Body[]) => bodies.map((b) => ({ q: b.q, t: b.t }));
const restore = (bodies: Body[], s: { q: Quat; t: Vec3 }[]) => bodies.forEach((b, i) => Object.assign(b, s[i]!));

/**
 * Levenberg–Marquardt, and once more from a slightly turned start if that fails: a part facing
 * exactly the wrong way sits where every small turn looks equally bad, and cannot start turning.
 */
function settle(bodies: Body[], mates: Live[], L: number, tol: { converged: number; holds: number }, maxIterations: number): boolean {
  if (levenbergMarquardt(bodies, mates, L, tol, maxIterations).holds) return true;
  const turn = expRotation([0.3 / Math.sqrt(14), 0.6 / Math.sqrt(14), 0.9 / Math.sqrt(14)]);
  for (const b of bodies) {
    const c = add(rotate(b.q, b.pivot), b.t);
    b.q = qnormalize(qmul(turn, b.q));
    b.t = add(rotate(turn, sub(b.t, c)), c);
  }
  return levenbergMarquardt(bodies, mates, L, tol, maxIterations).holds;
}

/** One mate's derivatives: rows × 6 for each floating body it moves (a, then b). */
interface Block {
  mate: Live;
  r: number[];
  da: Float64Array | null;
  db: Float64Array | null;
}

function levenbergMarquardt(bodies: Body[], mates: Live[], L: number, tol: { converged: number; holds: number }, maxIterations: number): { holds: boolean; progressed: boolean } {
  const n = bodies.length * 6;
  const residuals = () => mates.map((m) => evaluate(m, L));
  const cost = (r: number[][]) => r.reduce((s, row) => row.reduce((t, v) => t + v * v, s), 0);
  const worst = (r: number[][]) => r.reduce((s, row) => Math.max(s, maxAbs(row)), 0);
  let r = residuals();
  let c = cost(r);
  let lambda = 1e-3;
  // Steps that hardly lower the error, twice in a row: stuck in a minimum that is not a solution.
  // Converging to zero, even slowly, lowers it by a steady fraction; converging to something above
  // zero lowers it by ever smaller fractions.
  let stalled = 0;
  let progressed = false;
  for (let iteration = 0; iteration < maxIterations && worst(r) > tol.converged && stalled < 2; iteration++) {
    const { A, g } = normalEquations(blocks(mates, r, L), n);
    let improved = false;
    // Up to six ever more cautious tries per step; if none helps, this is as good as it gets.
    for (let tries = 0; tries < 6 && !improved; tries++) {
      const dx = solveDamped(A, g, n, lambda);
      if (!dx) {
        lambda *= 10;
        continue;
      }
      const before = snapshot(bodies);
      for (const b of bodies) Object.assign(b, moved(b, dx, 6 * b.k));
      const r2 = residuals();
      const c2 = cost(r2);
      if (c2 < c) {
        stalled = c - c2 < 1e-6 * c ? stalled + 1 : 0;
        r = r2;
        c = c2;
        lambda = Math.max(lambda / 3, 1e-9);
        improved = progressed = true;
      } else {
        restore(bodies, before);
        lambda *= 10;
      }
    }
    if (!improved) break;
  }
  return { holds: worst(r) <= tol.holds, progressed };
}

/** Each mate's derivatives by central differences: moving one body changes only the mates on it. */
function blocks(mates: Live[], r: number[][], L: number): Block[] {
  const h = 1e-6;
  const x = [0, 0, 0, 0, 0, 0];
  const derivative = (m: Live, b: Body) => {
    const d = new Float64Array(m.rows * 6);
    const home = { q: b.q, t: b.t };
    for (let j = 0; j < 6; j++) {
      const at = (step: number) => {
        x[j] = step;
        Object.assign(b, moved({ ...b, ...home }, x, 0));
        x[j] = 0;
        return evaluate(m, L);
      };
      const plus = at(h);
      const minus = at(-h);
      Object.assign(b, home);
      for (let row = 0; row < m.rows; row++) d[row * 6 + j] = (plus[row]! - minus[row]!) / (2 * h);
    }
    return d;
  };
  const moves = (b: Body | null): b is Body => b !== null && !b.fixed;
  return mates.map((m, i) => ({ mate: m, r: r[i]!, da: moves(m.a) ? derivative(m, m.a) : null, db: moves(m.b) ? derivative(m, m.b) : null }));
}

/** JᵀJ and −Jᵀr, built block by block: each mate adds to the rows and columns of its two bodies only. */
function normalEquations(bs: Block[], n: number): { A: Float64Array; g: Float64Array } {
  const A = new Float64Array(n * n);
  const g = new Float64Array(n);
  for (const { mate, r, da, db } of bs) {
    const parts: [Float64Array, number][] = [];
    if (da) parts.push([da, 6 * mate.a!.k]);
    if (db) parts.push([db, 6 * mate.b!.k]);
    for (const [d1, o1] of parts) {
      for (let i = 0; i < 6; i++) {
        let s = 0;
        for (let row = 0; row < mate.rows; row++) s -= d1[row * 6 + i]! * r[row]!;
        g[o1 + i] = g[o1 + i]! + s;
        for (const [d2, o2] of parts) {
          for (let j = 0; j < 6; j++) {
            let t = 0;
            for (let row = 0; row < mate.rows; row++) t += d1[row * 6 + i]! * d2[row * 6 + j]!;
            A[(o1 + i) * n + o2 + j] = A[(o1 + i) * n + o2 + j]! + t;
          }
        }
      }
    }
  }
  return { A, g };
}

/**
 * Freedoms left to each body (A3.4): the moves that break no mate form the null space of the mates'
 * Jacobian; a body's freedoms are how many independent moves of its own that space holds. A part
 * that can only ride along with another counts as free, as in SolidWorks: it can still move.
 */
function freedoms(bodies: Body[], mates: Live[], L: number): number[] {
  if (mates.length === 0) return bodies.map(() => 6);
  const n = bodies.length * 6;
  const { A } = normalEquations(blocks(mates, mates.map((m) => evaluate(m, L)), L), n);
  const { basis, count } = nullSpace(A, n);
  if (count === 0) return bodies.map(() => 0);
  return bodies.map((b) => rank(basis.subarray(6 * b.k * count, (6 * b.k + 6) * count), 6, count, 1e-5));
}
