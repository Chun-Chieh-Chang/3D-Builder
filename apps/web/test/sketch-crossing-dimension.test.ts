/**
 * The crossing of two lines as a thing to dimension to (ADR 0212), driven through the real SketchController, the real solver and a host that does what the
 * store does. Truth by hand: the crossing of y = x / 2 and y = 10 - x / 2 is (10, 5); the fuzz computes crossings with its own parametric algebra, not with
 * the snap under test.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { t } from '@3db/i18n';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { SketchController, type PointerInput, type SketchHost } from '../src/sketcher/controller';

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
  const host: SketchHost = {
    featureId: 's',
    doc: () => history.doc,
    solved: () => solve(),
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
    editDimension: () => {},
  };
  const controller = new SketchController(host);
  const move = (p: P) => controller.pointerMove(input(p), false);
  const click = (p: P) => {
    move(p);
    controller.pointerDown(input(p));
    controller.pointerUp(input(p));
  };
  const add = (entities: SketchEntity[], constraints: SketchConstraint[] = []) => history.execute({ type: 'addSketchItems', featureId: 's', entities, constraints });
  return { history, sketch, solve, notices, controller, click, move, add };
}
type S = ReturnType<typeof session>;

const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
/** Two lines that cross at (10, 5) in the middle of both, and a loose point at (30, 0). */
function cross(S: S) {
  S.add([point('a1', 0, 0), point('a2', 20, 10), point('b1', 0, 10), point('b2', 20, 0), point('q', 30, 0), line('A', 'a1', 'a2'), line('B', 'b1', 'b2')]);
}
const points = (S: S) => S.sketch().entities.filter((e) => e.type === 'point');
const crossingRelations = (S: S) => S.sketch().constraints.filter((c) => c.type === 'intersection');
const dimensions = (S: S) => S.sketch().constraints.filter((c) => c.type === 'distance' || c.type === 'distanceX' || c.type === 'distanceY');
const view = (S: S) => S.controller.getView();

describe('picking the crossing of two lines in the dimension tool', () => {
  it('a click on a crossing, a click on a point and a place: a distance from the crossing, with the point and its intersection relation made in the same step', async () => {
    const S = session();
    cross(S);
    const before = { entities: S.sketch().entities.length, constraints: S.sketch().constraints.length };
    S.controller.setTool('dimension');
    S.click([10.1, 5.1]);
    expect(view(S).picks).toHaveLength(1);
    expect(view(S).pickedCrossings).toEqual([[10, 5]]);
    // nothing is made by picking
    expect(S.sketch().entities).toHaveLength(before.entities);
    expect(S.sketch().constraints).toHaveLength(before.constraints);
    S.click([30, 0]);
    S.click([35, -8]); // outside both ranges of the two points: the distance between them
    await tick();
    const made = points(S).filter((p) => !['a1', 'a2', 'b1', 'b2', 'q'].includes(p.id));
    expect(made).toHaveLength(1);
    expect([made[0]!.x, made[0]!.y]).toEqual([10, 5]); // the crossing itself, not where the click was
    const relation = crossingRelations(S);
    expect(relation).toHaveLength(1);
    expect(relation[0]).toMatchObject({ point: made[0]!.id });
    expect([relation[0]!.a, relation[0]!.b].sort()).toEqual(['A', 'B']);
    const d = dimensions(S);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: 'distance', a: made[0]!.id, b: 'q' });
    expect(Number(d[0]!.value)).toBeCloseTo(Math.hypot(20, 5), 4);
    expect(S.solve().status).not.toBe('failed');
    // one step: undo takes the point, the relation and the dimension away together
    S.history.undo();
    expect(S.sketch().entities).toHaveLength(before.entities);
    expect(S.sketch().constraints).toHaveLength(before.constraints);
  });

  it('Esc after picking a crossing leaves nothing behind: no point, no relation, and the marker is gone', () => {
    const S = session();
    cross(S);
    S.controller.setTool('dimension');
    S.click([10, 5]);
    expect(view(S).pickedCrossings).toHaveLength(1);
    S.controller.escape();
    expect(view(S).picks).toHaveLength(0);
    expect(view(S).pickedCrossings).toHaveLength(0);
    expect(points(S)).toHaveLength(5);
    expect(crossingRelations(S)).toHaveLength(0);
  });

  it('the cursor over a crossing shows the snap (a marker and its name) and no line is lit', () => {
    const S = session();
    cross(S);
    S.controller.setTool('dimension');
    S.move([10.1, 4.9]);
    expect(view(S).snap).toMatchObject({ kind: 'intersection', p: [10, 5] });
    expect(view(S).inference).toBe(t('infer.intersection'));
    S.move([5, 2.5]); // on A, far from the crossing: the line
    expect(view(S).snap).toBeNull();
    expect(view(S).hover).toBe('A');
  });

  it('a crossing on the extensions of the lines is not picked: where the lines would meet, not where they are', () => {
    const S = session();
    S.add([point('a1', 0, 0), point('a2', 4, 2), point('b1', 0, 10), point('b2', 20, 0), line('A', 'a1', 'a2'), line('B', 'b1', 'b2')]); // A would meet B at (10, 5), 6 mm past its end
    S.controller.setTool('dimension');
    S.click([10, 5]); // B passes through here: it is picked, as the line it is, and no crossing is made
    expect(view(S).picks).toEqual(['B']);
    expect(view(S).pickedCrossings).toHaveLength(0);
    expect(crossingRelations(S)).toHaveLength(0);
  });

  it('a crossing that already has a point is that point: dimensioning to it makes no second one', async () => {
    const S = session();
    cross(S);
    S.add([point('m', 10, 5)], [{ id: 'x1', type: 'intersection', point: 'm', a: 'A', b: 'B' }]);
    const count = points(S).length;
    S.controller.setTool('dimension');
    S.click([10, 5]);
    expect(view(S).picks).toEqual(['m']);
    expect(view(S).pickedCrossings).toHaveLength(0);
    S.click([30, 0]);
    S.click([35, -8]);
    await tick();
    expect(points(S)).toHaveLength(count);
    expect(crossingRelations(S)).toHaveLength(1);
    expect(dimensions(S)).toHaveLength(1);
  });

  it('a crossing is dimensioned twice: the second time it is the point the first one made', async () => {
    const S = session();
    cross(S);
    S.add([point('r', 0, -10)]);
    S.controller.setTool('dimension');
    for (const [to, place] of [
      [[30, 0], [35, -8]],
      [[0, -10], [-6, -14]],
    ] as [P, P][]) {
      S.click([10, 5]);
      S.click(to);
      S.click(place);
      await tick();
    }
    expect(points(S)).toHaveLength(7); // five, r, and one for the crossing
    expect(crossingRelations(S)).toHaveLength(1);
    expect(dimensions(S)).toHaveLength(2);
  });

  it('a crossing and a line: the distance from the point to the line, with the crossing made as a point', async () => {
    const S = session();
    cross(S);
    S.add([point('c1', 0, -6), point('c2', 40, -6), line('C', 'c1', 'c2')]);
    S.controller.setTool('dimension');
    S.click([10, 5]);
    S.click([25, -6]); // on C
    expect(view(S).picks).toHaveLength(2);
    S.click([18, -2]);
    await tick();
    const d = dimensions(S);
    expect(d).toHaveLength(1);
    expect(Number(d[0]!.value)).toBeCloseTo(11, 6); // 5 - (-6)
    expect(crossingRelations(S)).toHaveLength(1);
  });

  it('a circle crossing a line is not picked as a crossing: that is for lines only, and nothing is made', () => {
    const S = session();
    S.add([point('a1', -20, 0), point('a2', 20, 0), point('o', 0, 0), line('A', 'a1', 'a2'), { id: 'K', type: 'circle', center: 'o', radius: 10 }]);
    S.controller.setTool('dimension');
    S.click([10, 0]);
    expect(view(S).pickedCrossings).toHaveLength(0);
    expect(crossingRelations(S)).toHaveLength(0);
  });

  it('parallel lines, and collinear lines that overlap, have no crossing to pick', () => {
    const S = session();
    S.add([point('a1', 0, 0), point('a2', 20, 0), point('b1', 0, 5), point('b2', 20, 5), point('c1', 5, 0), point('c2', 25, 0), line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), line('C', 'c1', 'c2')]);
    S.controller.setTool('dimension');
    for (const p of [[10, 0], [10, 2.5], [22, 0], [5, 0.1], [20, 0.1]] as P[]) {
      S.click(p);
      expect(view(S).pickedCrossings, `at ${p}`).toHaveLength(0);
      S.controller.escape();
    }
    expect(crossingRelations(S)).toHaveLength(0);
  });

  it('two lines that only meet at an end: the end point is the pick, not a second point', () => {
    const S = session();
    S.add([point('p', 0, 0), point('u', 20, 0), point('v', 0, 20), line('A', 'p', 'u'), line('B', 'p', 'v')]);
    S.controller.setTool('dimension');
    S.click([0.1, 0.1]);
    expect(view(S).picks).toEqual(['p']);
    expect(view(S).pickedCrossings).toHaveLength(0);
  });
});

describe('the crossing pick against random lines', () => {
  /** Where the lines through (p, q) and (r, s) meet: [t, u, point], t and u the parameters along each line (0..1 within the segment). */
  const meet = (p: P, q: P, r: P, s: P): { t: number; u: number; at: P } | null => {
    const d1: P = [q[0] - p[0], q[1] - p[1]];
    const d2: P = [s[0] - r[0], s[1] - r[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-6) return null;
    const t = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / den;
    const u = ((r[0] - p[0]) * d1[1] - (r[1] - p[1]) * d1[0]) / den;
    return { t, u, at: [p[0] + t * d1[0], p[1] + t * d1[1]] };
  };

  it('200 random pairs: a crossing inside both lines is picked and made exactly there; one outside either is not picked', async () => {
    let seed = 20261028;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const between = (a: number, b: number) => a + (b - a) * rnd();
    let inside = 0;
    let outside = 0;
    for (let i = 0; i < 200; i++) {
      const [p, q, r, s]: P[] = Array.from({ length: 4 }, (): P => [between(-40, 40), between(-40, 40)]);
      const m = meet(p!, q!, r!, s!);
      if (!m) continue;
      const S = session();
      S.add([point('a1', ...p!), point('a2', ...q!), point('b1', ...r!), point('b2', ...s!), point('q', 90, 90), line('A', 'a1', 'a2'), line('B', 'b1', 'b2')]);
      const margin = (v: number, len: number) => Math.min(v, 1 - v) * len;
      const lenA = Math.hypot(q![0] - p![0], q![1] - p![1]);
      const lenB = Math.hypot(s![0] - r![0], s![1] - r![1]);
      const clear = Math.min(margin(m.t, lenA), margin(m.u, lenB)); // how far, in mm, the crossing is inside the nearer end of its lines (negative: outside)
      const near = (x: P) => [p!, q!, r!, s!].some((e) => Math.hypot(e[0] - x[0], e[1] - x[1]) < 1.5);
      S.controller.setTool('dimension');
      if (clear > 1 && !near(m.at)) {
        inside++;
        S.click([m.at[0] + between(-0.1, 0.1), m.at[1] + between(-0.1, 0.1)]);
        expect(view(S).pickedCrossings, `pair ${i}`).toHaveLength(1);
        S.click([90, 90]);
        S.click([200, 200]); // outside both ranges of the two points: the distance itself, not one of its sides
        await tick();
        const made = points(S).filter((e) => !['a1', 'a2', 'b1', 'b2', 'q'].includes(e.id));
        expect(made, `pair ${i}`).toHaveLength(1);
        expect(made[0]!.x).toBeCloseTo(m.at[0], 9);
        expect(made[0]!.y).toBeCloseTo(m.at[1], 9);
        expect(crossingRelations(S), `pair ${i}`).toHaveLength(1);
        expect(Number(dimensions(S)[0]!.value), `pair ${i}`).toBeCloseTo(Math.hypot(90 - m.at[0], 90 - m.at[1]), 3);
      } else if (clear < -1 && !near(m.at) && Math.min(Math.abs(m.t), Math.abs(m.t - 1)) * lenA > 1 && Math.min(Math.abs(m.u), Math.abs(m.u - 1)) * lenB > 1) {
        outside++;
        S.click(m.at);
        expect(view(S).pickedCrossings, `pair ${i}`).toHaveLength(0);
        expect(crossingRelations(S), `pair ${i}`).toHaveLength(0);
      }
    }
    // not a run in which one branch never happened
    expect(inside).toBeGreaterThan(20);
    expect(outside).toBeGreaterThan(20);
  });
});
