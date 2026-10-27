/**
 * Random sweeps against what a relation must not do (ADR 0211): be met by shrinking a line to a point, or be called met when it is not.
 *
 *  1. Directions only. A polyline of three lines sharing ends, random starts, up to four relations among vertical / horizontal / parallel / perpendicular.
 *     Whether such a set can be met without a line of no length is plain arithmetic on the lines' directions (each a direction mod 180°), written out here
 *     and not taken from the code under test: a set that cannot is never accepted, and a set that can and has nothing in it twice is never refused.
 *  2. The way the sketcher goes: relations added one at a time, each solved and its positions stored (the app refuses what does not solve), then a dimension
 *     at its own value (nothing may move) and edited: every relation and the dimension hold in the answer, by formulas written here, and no line is lost.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, resolveSketch, type Command, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedSketch } from '../src/index';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});
const EMPTY: Command = { type: 'insertFeature', index: 0, feature: { id: 's1', type: 'sketch', name: 's', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] } };
const make = (entities: SketchEntity[], constraints: SketchConstraint[] = []): PartDoc =>
  applyCommand(applyCommand(createEmptyPart(), EMPTY), { type: 'addSketchItems', featureId: 's1', entities, constraints });
const sketchOf = (doc: PartDoc) => doc.features.find((f) => f.id === 's1') as SketchFeature;
const solve = (doc: PartDoc): SolvedSketch => solver.solve(resolveSketch(sketchOf(doc), doc), { analyze: false });
let seed = 1;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
type P = [number, number];
const POINTS = ['a', 'b', 'c', 'd'];
const LINES = ['L', 'M', 'N'];
const polyline = (): { entities: SketchEntity[]; pts: Record<string, P> } => {
  const pts: Record<string, P> = { a: [between(-30, 30), between(-30, 30)] };
  for (const [prev, id] of [['a', 'b'], ['b', 'c'], ['c', 'd']] as const) pts[id] = [pts[prev]![0] + between(-25, 25), pts[prev]![1] + between(-25, 25)];
  return {
    pts,
    entities: [
      ...POINTS.map((id) => ({ id, type: 'point', x: pts[id]![0], y: pts[id]![1] }) as SketchEntity),
      { id: 'L', type: 'line', p1: 'a', p2: 'b' },
      { id: 'M', type: 'line', p1: 'b', p2: 'c' },
      { id: 'N', type: 'line', p1: 'c', p2: 'd' },
    ],
  };
};

// ------------------------------------------------------------------ 1. the angles
type Rel = { type: 'vertical' | 'horizontal' | 'parallel' | 'perpendicular'; a: string; b?: string };
/** Can each line have a direction (a quarter turn is the unit, so a direction is 0 or 1 mod 2 once anything is pinned) that meets every relation? */
function consistent(rels: Rel[]): boolean {
  const parent: Record<string, string> = { L: 'L', M: 'M', N: 'N' };
  const delta: Record<string, number> = { L: 0, M: 0, N: 0 }; // theta(x) = theta(root) + delta(x), mod 2
  const find = (x: string): string => {
    if (parent[x] === x) return x;
    const r = find(parent[x]!);
    delta[x] = (delta[x]! + delta[parent[x]!]!) % 2;
    parent[x] = r;
    return r;
  };
  const pins: [string, number][] = [];
  for (const r of rels) {
    if (r.type === 'vertical') pins.push([r.a, 1]);
    else if (r.type === 'horizontal') pins.push([r.a, 0]);
    else {
      const k = r.type === 'parallel' ? 0 : 1;
      const [ra, rb] = [find(r.a), find(r.b!)];
      if (ra === rb) {
        if ((delta[r.a]! + delta[r.b!]!) % 2 !== k) return false;
      } else {
        parent[rb] = ra;
        delta[rb] = (((delta[r.a]! + k - delta[r.b!]!) % 2) + 2) % 2;
      }
    }
  }
  const rootPin: Record<string, number> = {};
  for (const [line, theta] of pins) {
    const root = find(line);
    const want = (((theta - delta[line]!) % 2) + 2) % 2;
    if (rootPin[root] !== undefined && rootPin[root] !== want) return false;
    rootPin[root] = want;
  }
  return true;
}
/** How many independent equations the relations make: a group of n lines related to one another has n − 1, and one more when a line of it is pinned. */
function rank(rels: Rel[]): number {
  const parent: Record<string, string> = { L: 'L', M: 'M', N: 'N' };
  const find = (x: string): string => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (const r of rels) if (r.type === 'parallel' || r.type === 'perpendicular') parent[find(r.b!)] = find(r.a);
  const pinned = new Set(rels.filter((r) => r.type === 'vertical' || r.type === 'horizontal').map((r) => find(r.a)));
  const groups = new Set(LINES.map(find));
  return LINES.length - groups.size + pinned.size;
}

describe('direction relations: what is consistent is met, what is not is refused, and no line is lost either way', () => {
  it('800 random sets: no contradictory set is accepted; no set that is consistent and independent is refused; nothing accepted has a line of no length', () => {
    seed = 20261027;
    let accepted = 0;
    let refused = 0;
    for (let k = 0; k < 800; k++) {
      const { entities } = polyline();
      const rels: Rel[] = [];
      for (let i = 0, n = 1 + Math.floor(rnd() * 4); i < n; i++) {
        const type = pick(['vertical', 'horizontal', 'parallel', 'perpendicular'] as const);
        if (type === 'vertical' || type === 'horizontal') rels.push({ type, a: pick(LINES) });
        else {
          const a = pick(LINES);
          rels.push({ type, a, b: pick(LINES.filter((x) => x !== a)) });
        }
      }
      let doc: PartDoc;
      try {
        doc = make(entities, rels.map((r, i) => ({ id: `r${i}`, ...r }) as SketchConstraint));
      } catch {
        continue; // the same relation twice in a place the model itself refuses
      }
      const s = solve(doc);
      const label = `${k} ${JSON.stringify(rels)} -> ${s.status} ${s.message ?? ''}`;
      const ok = consistent(rels);
      const independent = rels.length <= rank(rels);
      if (s.status === 'failed' || s.status === 'over') refused++;
      else accepted++;
      if (!ok) expect(['failed', 'over'], label).toContain(s.status);
      else if (independent) expect(['under', 'fully'], label).toContain(s.status);
      if (s.status === 'under' || s.status === 'fully') {
        for (const id of LINES) {
          const g = s.geometry.get(id);
          if (g?.type !== 'line') throw new Error('no line');
          expect(Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), `${label} ${id}`).toBeGreaterThan(1e-4);
        }
      }
    }
    // both outcomes happened: a run that only accepted, or only refused, proves nothing
    expect(accepted).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });
});

// ------------------------------------------------------------------ 2. the way the sketcher goes
const near = (x: number, y = 0, t = 1e-6) => Math.abs(x - y) < t;
function holds(c: SketchConstraint, s: SolvedSketch): boolean {
  const pt = (id: string): P => (id === '@origin' ? [0, 0] : (s.geometry.get(id) as { p: P }).p);
  const ln = (id: string): [P, P] => [(s.geometry.get(id) as { a: P }).a, (s.geometry.get(id) as { b: P }).b];
  const len = (id: string) => Math.hypot(ln(id)[1][0] - ln(id)[0][0], ln(id)[1][1] - ln(id)[0][1]);
  const dir = (id: string): P => {
    const [a, b] = ln(id);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  switch (c.type) {
    case 'vertical': return c.b === undefined ? near(ln(c.a)[0][0], ln(c.a)[1][0]) : near(pt(c.a)[0], pt(c.b)[0]);
    case 'horizontal': return c.b === undefined ? near(ln(c.a)[0][1], ln(c.a)[1][1]) : near(pt(c.a)[1], pt(c.b)[1]);
    case 'parallel': { const [u, v] = [dir(c.a), dir(c.b)]; return near(u[0] * v[1] - u[1] * v[0]); }
    case 'perpendicular': { const [u, v] = [dir(c.a), dir(c.b)]; return near(u[0] * v[0] + u[1] * v[1]); }
    case 'collinear': { const [u, v] = [dir(c.a), dir(c.b)]; const [a] = ln(c.a); const [b] = ln(c.b); return near(u[0] * v[1] - u[1] * v[0]) && near((b[0] - a[0]) * u[1] - (b[1] - a[1]) * u[0]); }
    case 'equal': return near(len(c.a), len(c.b));
    case 'coincident': return near(pt(c.a)[0], pt(c.b)[0]) && near(pt(c.a)[1], pt(c.b)[1]);
    case 'midpoint': { const [a, b] = ln(c.line); const p = pt(c.point); return near(p[0], (a[0] + b[0]) / 2) && near(p[1], (a[1] + b[1]) / 2); }
    case 'distanceX': return near(Math.abs(pt(c.b)[0] - pt(c.a)[0]), Number(c.value));
    case 'distanceY': return near(Math.abs(pt(c.b)[1] - pt(c.a)[1]), Number(c.value));
    case 'distance': return c.b === undefined ? near(len(c.a), Number(c.value)) : near(Math.hypot(pt(c.b)[0] - pt(c.a)[0], pt(c.b)[1] - pt(c.a)[1]), Number(c.value));
    default: return true;
  }
}
const RELATIONS: ((n: number) => SketchConstraint)[] = [
  (n) => ({ id: `r${n}`, type: 'vertical', a: pick(LINES) }),
  (n) => ({ id: `r${n}`, type: 'horizontal', a: pick(LINES) }),
  (n) => ({ id: `r${n}`, type: 'vertical', a: pick(POINTS), b: pick(POINTS) }),
  (n) => ({ id: `r${n}`, type: 'horizontal', a: pick(POINTS), b: pick(POINTS) }),
  (n) => ({ id: `r${n}`, type: 'parallel', a: pick(LINES), b: pick(LINES) }),
  (n) => ({ id: `r${n}`, type: 'perpendicular', a: pick(LINES), b: pick(LINES) }),
  (n) => ({ id: `r${n}`, type: 'collinear', a: pick(LINES), b: pick(LINES) }),
  (n) => ({ id: `r${n}`, type: 'equal', a: pick(LINES), b: pick(LINES) }),
  (n) => ({ id: `r${n}`, type: 'coincident', a: pick(POINTS), b: pick(POINTS) }),
  (n) => ({ id: `r${n}`, type: 'midpoint', point: pick(POINTS), line: pick(LINES) }),
];
const lengths = (s: SolvedSketch) => Object.fromEntries(LINES.map((id) => [id, (() => { const g = s.geometry.get(id) as { a: P; b: P }; return Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]); })()]));

describe('the way the sketcher goes: relations one at a time, then a dimension', () => {
  it('1200 random flows: every relation and the dimension hold in what is accepted, no line is lost, and a dimension at its own value moves nothing', () => {
    seed = 20261028;
    let flows = 0;
    let added = 0;
    for (let k = 0; k < 1200; k++) {
      const { entities } = polyline();
      let doc = make(entities);
      const rels: SketchConstraint[] = [];
      let alive = true;
      for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n && alive; i++) {
        const c = RELATIONS[Math.floor(rnd() * RELATIONS.length)]!(i);
        const names = Object.values(c).filter((v) => typeof v === 'string' && v.length === 1);
        if (new Set(names).size !== names.length) continue;
        let next: PartDoc;
        try { next = applyCommand(doc, { type: 'addSketchItems', featureId: 's1', entities: [], constraints: [c] }); } catch { continue; }
        const s = solve(next);
        if (s.status === 'over' || s.status === 'failed') continue; // refused, as the sketcher does
        expect(holds(c, s), `relation ${JSON.stringify(c)} after ${JSON.stringify(rels)}`).toBe(true);
        for (const [id, length] of Object.entries(lengths(s))) expect(length, `${id} after ${JSON.stringify(c)}`).toBeGreaterThan(1e-4);
        // store the positions back, as the sketcher does when the solve is accepted
        doc = applyCommand(next, { type: 'setSketchGeometry', featureId: 's1', points: POINTS.map((id) => ({ id, x: (s.geometry.get(id) as { p: P }).p[0], y: (s.geometry.get(id) as { p: P }).p[1] })) });
        rels.push(c);
        added++;
      }
      if (rels.length === 0) continue;
      flows++;
      const now = solve(doc);
      const pos = (s: SolvedSketch, id: string): P => (s.geometry.get(id) as { p: P }).p;
      const kind = pick(['distanceX', 'distanceY', 'distance', 'length'] as const);
      let dim: SketchConstraint;
      let value: number;
      if (kind === 'length') {
        const l = pick(LINES);
        dim = { id: 'D', type: 'distance', a: l, value: '1' };
        value = lengths(now)[l]!;
      } else {
        const a = pick(['@origin', ...POINTS]);
        const b = pick(POINTS.filter((x) => x !== a));
        dim = { id: 'D', type: kind, a, b, value: '1' } as SketchConstraint;
        const [pa, pb] = [a === '@origin' ? ([0, 0] as P) : pos(now, a), pos(now, b)];
        value = kind === 'distanceX' ? Math.abs(pb[0] - pa[0]) : kind === 'distanceY' ? Math.abs(pb[1] - pa[1]) : Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      }
      if (!(value > 1e-2)) continue;
      const label = `${k} ${JSON.stringify(rels.map((r) => r.type))} + ${dim.type}`;
      const atOwn = applyCommand(doc, { type: 'addSketchItems', featureId: 's1', entities: [], constraints: [{ ...dim, value: String(value) } as SketchConstraint] });
      const s1 = solve(atOwn);
      if (s1.status !== 'over' && s1.status !== 'failed') {
        for (const id of POINTS) expect(Math.hypot(pos(s1, id)[0] - pos(now, id)[0], pos(s1, id)[1] - pos(now, id)[1]), `${label} moved ${id} at its own value`).toBeLessThan(1e-3);
      }
      const edited = applyCommand(atOwn, { type: 'setDimension', featureId: 's1', constraintId: 'D', value: String(value * between(0.5, 1.8)) });
      const s2 = solve(edited);
      if (s2.status === 'over' || s2.status === 'failed') continue; // the sketch says no
      for (const c of sketchOf(edited).constraints) expect(holds(c, s2), `${label}: ${JSON.stringify(c)}`).toBe(true);
      for (const [id, length] of Object.entries(lengths(s2))) expect(length, `${label} ${id}`).toBeGreaterThan(1e-4);
    }
    expect(flows).toBeGreaterThan(300);
    expect(added).toBeGreaterThan(300);
  });
});
