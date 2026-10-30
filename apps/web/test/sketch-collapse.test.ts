/**
 * What the sketcher itself does when relations and dimensions are added (ADR 0211), driven through the real SketchController (tools, inference, the offered
 * relations, smart dimension, drag) and the real solver, with a host that does what the store does: a vertical line drawn first was shrunk to a point when
 * a line was made parallel to it, and the sketcher said the relation was added. Truth by hand: the lengths drawn, the angles of the lines.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { t } from '@3db/i18n';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type Id, type PartDoc, type SketchConstraint, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { SketchController, type PointerInput, type SketchHost } from '../src/sketcher/controller';
import { relationsOffered } from '../src/sketcher/relationsOffered';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});
type P = [number, number];
const input = (p: P): PointerInput => ({ p: [...p] as P, px: 0.05, ctrl: false, shift: false });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function session() {
  const feature: SketchFeature = { id: 's', type: 'sketch', name: 's', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] };
  const history = new DocHistory(applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature }));
  const sketch = () => history.doc.features[0] as SketchFeature;
  const solve = (s: SketchFeature = sketch(), options?: unknown) => ({ ...solver.solve(resolveSketch(s, history.doc), { analyze: true, ...(options as object) }), seq: 0, ms: 0, problems: [] });
  const notices: string[] = [];
  const pending: { edit: Id | null } = { edit: null };
  // solved once per document, as the store does: planegcs's answer to an under-defined sketch depends on what it solved before (PlaneGcsSolver.fresh),
  // so a host that solved again on every look would make the result depend on how often the controller looks
  let solved: { doc: PartDoc; payload: ReturnType<typeof solve> } | null = null;
  const host: SketchHost = {
    featureId: 's',
    doc: () => history.doc,
    solved: () => (solved?.doc === history.doc ? solved.payload : (solved = { doc: history.doc, payload: solve() }).payload),
    execute: (c) => {
      try {
        history.execute(c);
        return true;
      } catch (e) {
        notices.push(`REFUSED ${c.type}: ${(e as Error).message}`);
        return false;
      }
    },
    trial: async (s, _d, options) => solve(s, options),
    dragPreview: () => {},
    notify: (m) => void notices.push(m),
    editDimension: (id) => {
      pending.edit = id;
    },
  };
  const controller = new SketchController(host);
  const click = (p: P) => {
    controller.pointerMove(input(p), false);
    controller.pointerDown(input(p));
    controller.pointerUp(input(p));
  };
  return { history, sketch, solve, notices, pending, controller, click };
}
type S = ReturnType<typeof session>;
const lineGeometry = (S: S, id: string) => {
  const g = S.solve().geometry.get(id);
  if (g?.type !== 'line') throw new Error(`no line ${id}`);
  return g;
};
const lengthOf = (S: S, id: string) => Math.hypot(lineGeometry(S, id).b[0] - lineGeometry(S, id).a[0], lineGeometry(S, id).b[1] - lineGeometry(S, id).a[1]);
const drawLines = (S: S, ...points: P[]) => {
  S.controller.setTool('line');
  for (const p of points) S.click(p);
  S.controller.escape();
  S.controller.setTool('select');
};
const addRelation = async (S: S, ids: string[], type: string) => {
  S.controller.select(ids, false);
  const body = relationsOffered(S.sketch(), S.solve(), ids).offered.find((r) => r.type === type);
  if (!body) throw new Error(`no ${type} offered for ${ids}`);
  return S.controller.addRelation(body);
};

describe('the sketcher with relations that a line of no length would meet', () => {
  it('a vertical line drawn first, a slanted one from its end, made parallel: both stay lines and the vertical one is still vertical and about 25 long (it became a point)', async () => {
    const S = session();
    drawLines(S, [-20, 5], [-20, -20], [10, 5]);
    expect(lengthOf(S, 'l1')).toBeCloseTo(25, 6);
    expect(S.sketch().constraints.some((c) => c.type === 'vertical' && c.a === 'l1')).toBe(true); // drawn straight down: inferred vertical
    expect(await addRelation(S, ['l1', 'l2'], 'parallel')).toBe(true);
    const sol = S.solve();
    expect(['under', 'fully']).toContain(sol.status);
    // two lines made one leave their common length to the solver: it may differ a little from the 25 drawn, but it is a line, and not a point
    expect(Math.abs(lengthOf(S, 'l1') - 25)).toBeLessThan(0.5);
    expect(lengthOf(S, 'l2')).toBeGreaterThan(20);
    expect(lineGeometry(S, 'l1').a[0]).toBeCloseTo(lineGeometry(S, 'l1').b[0], 8);
    const [u, v] = [lineGeometry(S, 'l1'), lineGeometry(S, 'l2')];
    expect((u.b[0] - u.a[0]) * (v.b[1] - v.a[1]) - (u.b[1] - u.a[1]) * (v.b[0] - v.a[0])).toBeCloseTo(0, 6);
  });

  it('a slanted line made vertical, one of whose ends it shares with a vertical line: it turns vertical and is a line still, and the vertical one keeps its 20', async () => {
    const S = session();
    drawLines(S, [20, -20], [35, -5], [35, -25]);
    expect(await addRelation(S, ['l1'], 'vertical')).toBe(true);
    expect(lengthOf(S, 'l1')).toBeGreaterThan(10);
    expect(lineGeometry(S, 'l1').a[0]).toBeCloseTo(lineGeometry(S, 'l1').b[0], 8);
    expect(lengthOf(S, 'l2')).toBeCloseTo(20, 6);
  });

  it('a line that is horizontal cannot be made vertical, since only a point is both: refused, nothing added, and the reason is said', async () => {
    const S = session();
    drawLines(S, [10, 10], [30, 10]);
    expect(S.sketch().constraints.some((c) => c.type === 'horizontal' && c.a === 'l1')).toBe(true); // drawn level: inferred horizontal
    const before = S.sketch().constraints.length;
    expect(await addRelation(S, ['l1'], 'vertical')).toBe(false);
    expect(S.sketch().constraints).toHaveLength(before);
    expect(S.notices).toContain(t('regen.sketchCollapsed', { names: 'l1' }));
    expect(lengthOf(S, 'l1')).toBeCloseTo(20, 6);
  });

  it('a vertical line with one end dimensioned from the origin: it stays vertical and keeps its length, the dimension is met, nothing is lost', async () => {
    const S = session();
    drawLines(S, [10, 0], [10, 20]);
    const before = S.sketch().constraints.map((c) => c.type);
    S.controller.setTool('dimension');
    S.pending.edit = null;
    S.click([0, 0]);
    S.click([10, 0]); // the lower end
    S.click([5, -6]);
    for (let i = 0; i < 4; i++) await tick();
    const id = S.pending.edit!;
    expect(id).toBeTruthy();
    S.history.execute({ type: 'setDimension', featureId: 's', constraintId: id, value: '25' });
    const after = S.sketch().constraints;
    for (const type of before) expect(after.map((c) => c.type)).toContain(type);
    expect(lineGeometry(S, 'l1').a[0]).toBeCloseTo(25, 6);
    expect(lineGeometry(S, 'l1').b[0]).toBeCloseTo(25, 6);
    expect(lengthOf(S, 'l1')).toBeCloseTo(20, 6);
  });
});

// ------------------------------------------------------------------ a random walk through the tools
let seed = 1;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const near = (x: number, y = 0, tol = 1e-5) => Math.abs(x - y) < tol;
function holds(c: SketchConstraint, S: S): boolean | null {
  const sol = S.solve();
  const pt = (id: string): P => (id === '@origin' ? [0, 0] : (sol.geometry.get(id) as { p: P }).p);
  const ln = (id: string): [P, P] => [(sol.geometry.get(id) as { a: P }).a, (sol.geometry.get(id) as { b: P }).b];
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
    case 'equal': return sol.geometry.get(c.a)?.type === 'line' ? near(len(c.a), len(c.b)) : null;
    case 'coincident': return near(pt(c.a)[0], pt(c.b)[0]) && near(pt(c.a)[1], pt(c.b)[1]);
    case 'midpoint': return sol.geometry.get(c.line)?.type === 'line' ? near(pt(c.point)[0], (ln(c.line)[0][0] + ln(c.line)[1][0]) / 2) && near(pt(c.point)[1], (ln(c.line)[0][1] + ln(c.line)[1][1]) / 2) : null;
    case 'distanceX': return near(Math.abs(pt(c.b)[0] - pt(c.a)[0]), Number(c.value));
    case 'distanceY': return near(Math.abs(pt(c.b)[1] - pt(c.a)[1]), Number(c.value));
    default: return null; // distances to lines and axes, angles, circles: not checked here
  }
}

describe('a random walk through the sketcher (tools, inferred relations, offered relations, smart dimension, drag)', () => {
  it('120 sessions: no relation is lost or left unmet, no line is shrunk to a point, the sketch is not left over defined', async () => {
    seed = 20261029;
    const anomalies: string[] = [];
    let relationsAdded = 0;
    let dimensions = 0;
    for (let n = 0; n < 120; n++) {
      const S = session();
      const log: string[] = [];
      const lines = () => S.sketch().entities.filter((e) => e.type === 'line').map((e) => e.id);
      const points = () => S.sketch().entities.filter((e) => e.type === 'point').map((e) => e.id);
      const lengths = () => Object.fromEntries(lines().map((id) => [id, lengthOf(S, id)]));
      const where = (id: string): P => {
        const g = S.solve().geometry.get(id)!;
        if (g.type === 'point') return g.p as P;
        if (g.type === 'line') return [g.a[0] + (g.b[0] - g.a[0]) * 0.37, g.a[1] + (g.b[1] - g.a[1]) * 0.37] as P;
        return [0, 0];
      };
      const check = (what: string, before: { constraints: number; lengths: Record<string, number> }, tolerateFailure: boolean) => {
        const sol = S.solve();
        const doc = S.sketch();
        const say = (k: string, detail: string) => anomalies.push(`#${n} ${k}: ${detail}\n      ${log.join(' | ')}`);
        if (doc.constraints.length < before.constraints) say('LOST', `${before.constraints} -> ${doc.constraints.length} after ${what}`);
        if (sol.status === 'over') say('OVER', `after ${what}: ${sol.conflicting} ${sol.redundant}`);
        if (sol.status === 'failed') {
          if (!tolerateFailure) say('FAILED', `after ${what}`);
          return; // a value edited to contradict the relations: the sketch says so
        }
        for (const c of doc.constraints) {
          if ('driving' in c && c.driving === false) continue;
          if (holds(c, S) === false) say('UNMET', `${JSON.stringify(c)} after ${what}`);
        }
        for (const [id, was] of Object.entries(before.lengths)) if (was > 1e-2 && !(lengthOf(S, id) > 1e-4)) say('SHRUNK', `${id} ${was} -> ${lengthOf(S, id)} after ${what}`);
      };
      const snapshot = () => ({ constraints: S.sketch().constraints.length, lengths: lengths() });
      S.controller.setTool('line');
      let prev: P | null = null;
      for (let i = 0, count = 1 + Math.floor(rnd() * 3); i < count; i++) {
        const a: P = prev ?? [Math.round(between(-6, 6)) * 5, Math.round(between(-6, 6)) * 5];
        const r = rnd();
        const b: P = r < 0.4 ? [a[0], a[1] + (rnd() < 0.5 ? -1 : 1) * Math.round(between(1, 6)) * 5] : r < 0.7 ? [a[0] + (rnd() < 0.5 ? -1 : 1) * Math.round(between(1, 6)) * 5, a[1]] : [Math.round(between(-6, 6)) * 5, Math.round(between(-6, 6)) * 5];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const before = snapshot();
        for (const p of prev ? [b] : [a, b]) S.click(p);
        prev = rnd() < 0.5 ? b : null;
        if (!prev) S.controller.escape();
        log.push(`line ${JSON.stringify(a)}->${JSON.stringify(b)}`);
        check('drawing a line', before, false);
      }
      S.controller.escape();
      await tick();
      for (let i = 0, count = 1 + Math.floor(rnd() * 4); i < count; i++) {
        const kind = pick(['relation', 'relation', 'dimension', 'dimension', 'drag'] as const);
        const before = snapshot();
        S.controller.setTool('select');
        if (kind === 'relation') {
          const pool = [...lines(), ...points()];
          if (pool.length === 0) continue;
          const ids = [...new Set([pick(pool), ...(rnd() < 0.6 ? [pick(pool)] : [])])];
          S.controller.select(ids, false);
          const { offered } = relationsOffered(S.sketch(), S.solve(), ids);
          if (offered.length === 0) continue;
          const body = pick(offered);
          const ok = await S.controller.addRelation(body);
          log.push(`rel ${body.type} ${ids} -> ${ok ? 'added' : 'refused'}`);
          if (ok) relationsAdded++;
          check(`relation ${body.type} on ${ids}`, before, false);
        } else if (kind === 'dimension') {
          const pool = ['@origin', ...lines(), ...points()];
          const picks = [pick(pool), ...(rnd() < 0.6 ? [pick(pool)] : [])].filter((x, j, all) => all.indexOf(x) === j);
          S.controller.setTool('dimension');
          S.pending.edit = null;
          for (const id of picks) S.click(id === '@origin' ? [0, 0] : where(id));
          S.click([between(-40, 40), between(-40, 40)]);
          for (let k = 0; k < 4; k++) await tick();
          const made = S.pending.edit;
          const c = made ? S.sketch().constraints.find((x) => x.id === made) : undefined;
          let what = `dimension ${picks}`;
          if (c && 'value' in c && c.driving !== false) {
            dimensions++;
            const v = Number(c.value) * between(0.5, 1.8);
            if (v > 1e-3 && rnd() < 0.85) {
              try { S.history.execute({ type: 'setDimension', featureId: 's', constraintId: c.id, value: String(Math.round(v * 1000) / 1000) }); } catch { /* refused: nothing changed */ }
              what = `dimension ${picks} -> ${c.type} ${c.value} edited to ${Math.round(v * 1000) / 1000}`;
            }
          }
          log.push(what);
          S.controller.escape();
          check(what, before, true);
        } else {
          const pool = points();
          if (pool.length === 0) continue;
          const id = pick(pool);
          const from = where(id);
          const to: P = [from[0] + between(-15, 15), from[1] + between(-15, 15)];
          S.controller.pointerMove(input(from), false);
          S.controller.pointerDown(input(from));
          S.controller.pointerMove(input(to), true);
          S.controller.pointerUp(input(to));
          log.push(`drag ${id}`);
          check(`drag ${id}`, before, true);
        }
      }
    }
    expect(anomalies.slice(0, 5)).toEqual([]);
    // a walk that never added a relation or a dimension proves nothing
    expect(relationsAdded).toBeGreaterThan(40);
    expect(dimensions).toBeGreaterThan(40);
  }, 300000);
});
