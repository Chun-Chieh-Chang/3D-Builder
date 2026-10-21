import type { Pose, Quat, Vec3 } from '@3db/model';
import { compileMate, type MateEnd, type MateSpec, type ResidualN } from './equations';
import { placed } from './geometry';
import { across, add, cross, dot, expRotation, qmul, qnormalize, rotate, scale, sub, unit } from './math';
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
  /** With a goal: the floating components solved together with the goal's (it included), the ones a move can take along. */
  group?: string[];
  ms: number;
}

/**
 * What a move asks of its component (C15.3, A3.5). Points are in the part's coordinates, lines and
 * positions in the assembly's.
 */
export type GoalTerm =
  /** A point of the part onto a line: the part dragged by that point along the line under the cursor. */
  | { kind: 'pointOnLine'; point: Vec3; origin: Vec3; dir: Vec3 }
  /** A point of the part kept in a plane (through `origin`, square to `normal`): a triad's plane handle (ADR 0179). */
  | { kind: 'pointOnPlane'; point: Vec3; origin: Vec3; normal: Vec3 }
  /** A point of the part at a position. */
  | { kind: 'pointAt'; point: Vec3; target: Vec3 }
  /** The part turned to an orientation. */
  | { kind: 'rotation'; rotation: Quat };

/**
 * A move of one component (dragging it, or moving it by numbers). The terms come most important
 * first: each is met as far as the mates allow, and the next only as far as those before it allow.
 */
export interface MoveGoal {
  body: string;
  terms: GoalTerm[];
}

export interface SolveOptions {
  maxIterations?: number;
  /** Moves a component toward the goal through the freedoms its mates leave; the rest is solved as usual. */
  goal?: MoveGoal;
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
  residual: ResidualN;
  /** The body of each element, in the order a, b, `more` (null: the assembly itself); a body may be the body of several. */
  ends: (Body | null)[];
  rows: number;
}

const endsOf = (spec: MateSpec): MateEnd[] => [spec.a, spec.b, ...(spec.more ?? [])];
/** The bodies a mate is on, each once: the assembly itself is not one. */
const involved = (m: Live): Body[] => [...new Set(m.ends.filter((b): b is Body => b !== null))];

const ORIGIN_POSE: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const pose = (b: Body | null): Pose => (b ? { position: b.t, rotation: b.q } : ORIGIN_POSE);

function evaluate(m: Live, L: number): number[] {
  const poses = m.ends.map(pose);
  return m.residual(endsOf(m.spec).map((e, i) => placed(e.geom, poses[i]!)), poses, L);
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
    const ends = endsOf(spec).map((e) => (e.body === null ? null : bodies.get(e.body)));
    if (ends.some((e) => e === undefined)) {
      mates.set(spec.id, { status: 'unsupported', message: '結合參考的零組件不存在' });
      continue;
    }
    const [a, b] = ends as (Body | null)[];
    if ((a === null && b === null) || a === b) {
      mates.set(spec.id, { status: 'unsupported', message: '結合的兩個元素必須在不同的零組件上' });
      continue;
    }
    const compiled = compileMate(spec, endsOf(spec).map((e, i) => placed(e.geom, pose(ends[i]!))));
    if ('unsupported' in compiled) {
      mates.set(spec.id, { status: 'unsupported', message: compiled.unsupported });
      continue;
    }
    const m: Live = { spec, residual: compiled.residual, ends: ends as (Body | null)[], rows: 0 };
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
  for (const m of live) {
    const moving = involved(m).filter(floating);
    for (const other of moving.slice(1)) parent.set(find(other), find(moving[0]!));
  }
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
    const owner = involved(m).find(floating) ?? null;
    if (owner) groups.get(find(owner))!.mates.push(m);
    else {
      // Between things that never move: it holds, or it never will.
      const r = maxAbs(evaluate(m, L));
      if (r > tol.holds) conflicts.set(m, r);
    }
  }

  const dofs = new Map<Body, number>();
  const goal = options.goal;
  const goalBody = goal ? bodies.get(goal.body) : undefined;
  let group: string[] = [];
  for (const g of groups.values()) {
    const held = solveGroup(g.bodies, g.mates, L, tol, maxIterations, conflicts);
    if (goalBody && g.bodies.includes(goalBody)) {
      follow(g.bodies, held, goalBody, goal!.terms, L, tol, maxIterations);
      group = g.bodies.map((b) => b.id);
    }
    freedoms(g.bodies, held, L).forEach((dof, i) => dofs.set(g.bodies[i]!, dof));
  }

  for (const m of live) {
    const r = conflicts.get(m);
    mates.set(m.spec.id, r === undefined ? { status: 'ok' } : { status: 'conflict', residual: r });
  }
  const over = new Set<Body>();
  for (const m of conflicts.keys()) for (const b of involved(m)) if (floating(b)) over.add(b);
  const results = new Map<string, BodyResult>();
  const poses = new Map<string, Pose>();
  for (const b of bodies.values()) {
    poses.set(b.id, { position: b.t, rotation: b.q });
    const dof = b.fixed ? 0 : (dofs.get(b) ?? 6);
    results.set(b.id, { status: b.fixed ? 'fixed' : over.has(b) ? 'over' : dof > 0 ? 'under' : 'full', dof });
  }
  return { poses, bodies: results, mates, ...(goal ? { group } : {}), ms: performance.now() - t0 };
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

/** One mate's derivatives: rows × 6 for each floating body it moves. */
interface Block {
  mate: Live;
  r: number[];
  parts: { body: Body; d: Float64Array }[];
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

/**
 * Each mate's derivatives by central differences: moving one body changes only the mates on it. With `free` a row of a mate with limits that sits exactly on
 * a limit (it is nil on one side and not on the other) is left out: the part may go into its range from there, and is brought back by the solve if the step
 * goes out of it (E4: at the upper limit the half slope of the difference held the part there).
 */
function blocks(mates: Live[], r: number[][], L: number, free = false): Block[] {
  const h = 1e-6;
  const x = [0, 0, 0, 0, 0, 0];
  const derivative = (m: Live, b: Body) => {
    const d = new Float64Array(m.rows * 6);
    const home = { q: b.q, t: b.t };
    const limited = free && (m.spec.min !== undefined || m.spec.max !== undefined);
    const oneSided = new Array<boolean>(m.rows).fill(false);
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
      for (let row = 0; row < m.rows; row++) {
        d[row * 6 + j] = (plus[row]! - minus[row]!) / (2 * h);
        if ((plus[row] === 0) !== (minus[row] === 0)) oneSided[row] = true;
      }
    }
    if (limited) for (let row = 0; row < m.rows; row++) if (oneSided[row]) for (let j = 0; j < 6; j++) d[row * 6 + j] = 0;
    return d;
  };
  return mates.map((m, i) => ({ mate: m, r: r[i]!, parts: involved(m).filter((b) => !b.fixed).map((body) => ({ body, d: derivative(m, body) })) }));
}

/** JᵀJ and −Jᵀr, built block by block: each mate adds to the rows and columns of its two bodies only. */
function normalEquations(bs: Block[], n: number): { A: Float64Array; g: Float64Array } {
  const A = new Float64Array(n * n);
  const g = new Float64Array(n);
  for (const { mate, r, parts: moved_ } of bs) {
    const parts: [Float64Array, number][] = moved_.map((p) => [p.d, 6 * p.body.k]);
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

// ---------------------------------------------------------------- moving a component (C15.3, A3.5)

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];

/** A goal term as equations of the body's pose, all zero when it is met exactly. */
type Term = (q: Quat, t: Vec3, L: number) => number[];

function termOf(g: GoalTerm): Term {
  switch (g.kind) {
    case 'pointOnLine': {
      // The two components of the point's offset across the line.
      const d = unit(g.dir);
      const e1 = unit(across(Math.abs(d[0]) < 0.9 ? X : Y, d));
      const e2 = cross(d, e1);
      return (q, t) => {
        const v = sub(add(rotate(q, g.point), t), g.origin);
        return [dot(v, e1), dot(v, e2)];
      };
    }
    case 'pointOnPlane': {
      const n = unit(g.normal);
      return (q, t) => [dot(sub(add(rotate(q, g.point), t), g.origin), n)];
    }
    case 'pointAt':
      return (q, t) => sub(add(rotate(q, g.point), t), g.target);
    case 'rotation': {
      // Two axes of the part against the same axes turned as asked: rank 3, and no singular angle.
      const target = qnormalize(g.rotation);
      const tx = rotate(target, X);
      const ty = rotate(target, Y);
      return (q, _t, L) => [...scale(sub(rotate(q, X), tx), L), ...scale(sub(rotate(q, Y), ty), L)];
    }
  }
}

/** How far a term is from being met, in mm (an orientation counts as L times its angle, about). */
const distance = (term: Term, b: Body, L: number) => Math.hypot(...term(b.q, b.t, L));

/**
 * Moves a group toward a goal without breaking its mates (C15.3, A3.5). A step goes only where the
 * mates let the group go (the null space of their Jacobian): toward the first term, then with the
 * freedom that leaves toward the next, and no further than needed. The mates are then solved again
 * from there, so the group follows curved paths too (a pin turning in its hole). A step that does not
 * bring the goal closer, term by term in order, is halved.
 */
function follow(bodies: Body[], mates: Live[], body: Body, goal: GoalTerm[], L: number, tol: { converged: number; holds: number }, maxIterations: number): void {
  const terms = goal.map(termOf);
  const distances = () => terms.map((term) => distance(term, body, L));
  // Where the goal cannot be met, the distance is flat at its least: a finer test resolves the turn to about 1e-6 rad.
  const same = 1e-12 * Math.max(1, L);
  let best = distances();
  for (let iteration = 0; iteration < 50; iteration++) {
    const step = goalStep(bodies, mates, body, terms, L);
    if (!step) return;
    // Turning moves points along arcs: at most half a radian a step keeps the mates close to holding.
    let turn = 0;
    for (const b of bodies) turn = Math.max(turn, Math.hypot(step[6 * b.k + 3]!, step[6 * b.k + 4]!, step[6 * b.k + 5]!) / b.size);
    let factor = turn > 0.5 ? 0.5 / turn : 1;
    if (maxAbs(step) * factor < 1e-12 * Math.max(1, L)) return;
    let accepted = false;
    for (let tries = 0; tries < 6 && !accepted; tries++, factor /= 2) {
      const before = snapshot(bodies);
      const x = step.map((v) => v * factor);
      for (const b of bodies) Object.assign(b, moved(b, x, 6 * b.k));
      const holds = mates.length === 0 || levenbergMarquardt(bodies, mates, L, tol, maxIterations).holds;
      const now = distances();
      if (holds && closer(now, best, same)) {
        best = now;
        accepted = true;
      } else {
        restore(bodies, before);
      }
    }
    if (!accepted) return;
  }
}

/** Term by term: the first that differs by more than `same` decides. */
function closer(now: number[], best: number[], same: number): boolean {
  for (let i = 0; i < now.length; i++) {
    if (now[i]! < best[i]! - same) return true;
    if (now[i]! > best[i]! + same) return false;
  }
  return false;
}

/**
 * The linear step toward the goal: least squares for each term in turn, inside the moves the mates
 * and the terms before it leave free; the smallest such step. Null when the mates leave no move.
 */
function goalStep(bodies: Body[], mates: Live[], body: Body, terms: Term[], L: number): Float64Array | null {
  const n = bodies.length * 6;
  let N: Float64Array;
  let k: number;
  if (mates.length === 0) {
    N = new Float64Array(n * n);
    for (let i = 0; i < n; i++) N[i * n + i] = 1;
    k = n;
  } else {
    const { A } = normalEquations(blocks(mates, mates.map((m) => evaluate(m, L)), L, true), n);
    ({ basis: N, count: k } = nullSpace(A, n));
  }
  if (k === 0) return null;
  const o = 6 * body.k;
  const step = new Float64Array(n);
  for (const term of terms) {
    const r = term(body.q, body.t, L);
    const rows = r.length;
    const J = termJacobian(term, body, L, rows);
    // B = J · (the body's rows of N); e = what is left of the term after the steps so far.
    const B = new Float64Array(rows * k);
    const e = Float64Array.from(r);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < 6; j++) {
        const Jij = J[i * 6 + j]!;
        e[i] = e[i]! + Jij * step[o + j]!;
        for (let c = 0; c < k; c++) B[i * k + c] = B[i * k + c]! + Jij * N[(o + j) * k + c]!;
      }
    }
    const M = new Float64Array(k * k);
    const g = new Float64Array(k);
    for (let a = 0; a < k; a++) {
      for (let i = 0; i < rows; i++) g[a] = g[a]! - B[i * k + a]! * e[i]!;
      for (let b = 0; b <= a; b++) {
        let s = 0;
        for (let i = 0; i < rows; i++) s += B[i * k + a]! * B[i * k + b]!;
        M[a * k + b] = s;
        M[b * k + a] = s;
      }
    }
    let top = 0;
    for (let a = 0; a < k; a++) top = Math.max(top, M[a * k + a]!);
    if (top > 0) {
      const y = solveDamped(M, g, k, 1e-12 * top);
      if (y) for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) step[i] = step[i]! + N[i * k + c]! * y[c]!;
    }
    // What this term leaves free, for the terms after it.
    const free = nullSpace(M, k);
    if (free.count === 0) break;
    const next = new Float64Array(n * free.count);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < free.count; c++) {
        let s = 0;
        for (let m = 0; m < k; m++) s += N[i * k + m]! * free.basis[m * free.count + c]!;
        next[i * free.count + c] = s;
      }
    }
    N = next;
    k = free.count;
  }
  return step;
}

/** A term's derivatives by the body's six variables (central differences): rows × 6. */
function termJacobian(term: Term, b: Body, L: number, rows: number): Float64Array {
  const h = 1e-6;
  const d = new Float64Array(rows * 6);
  const x = [0, 0, 0, 0, 0, 0];
  for (let j = 0; j < 6; j++) {
    const at = (s: number) => {
      x[j] = s;
      const m = moved(b, x, 0);
      x[j] = 0;
      return term(m.q, m.t, L);
    };
    const plus = at(h);
    const minus = at(-h);
    for (let row = 0; row < rows; row++) d[row * 6 + j] = (plus[row]! - minus[row]!) / (2 * h);
  }
  return d;
}
