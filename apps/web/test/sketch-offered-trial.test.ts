/**
 * The buttons of 「加入限制條件」 that the solver would refuse are found by trying each one (ADR 0216), through the real SketchController and solver.
 * Truth by hand: two horizontal lines are already parallel (asking again is implied), cannot be perpendicular (conflict), and can still be equal in length.
 * Consistency: a type is refused by `refusedRelations` exactly when pressing it is refused by `addRelation`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { SketchController, type SketchHost } from '../src/sketcher/controller';
import { relationsOffered } from '../src/sketcher/relationsOffered';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

function session() {
  const feature: SketchFeature = { id: 's', type: 'sketch', name: 's', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] };
  const history = new DocHistory(applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature }));
  const sketch = () => history.doc.features[0] as SketchFeature;
  const solve = (s: SketchFeature = sketch(), options?: unknown) => ({ ...solver.solve(resolveSketch(s, history.doc), { analyze: true, ...(options as object) }), seq: 0, ms: 0, problems: [] });
  const host: SketchHost = {
    featureId: 's',
    doc: () => history.doc,
    solved: () => solve(),
    execute: (c) => {
      try {
        history.execute(c);
        return true;
      } catch {
        return false;
      }
    },
    trial: async (s, _d, options) => solve(s, options),
    dragPreview: () => {},
    notify: () => {},
    editDimension: () => {},
  };
  const controller = new SketchController(host);
  const add = (entities: SketchEntity[], constraints: SketchConstraint[] = []) => history.execute({ type: 'addSketchItems', featureId: 's', entities, constraints });
  return { history, sketch, solve, controller, add };
}
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });

function twoHorizontals() {
  const S = session();
  S.add(
    [point('a', 0, 0), point('b', 10, 0), point('c', 0, 5), point('d', 7, 5), line('l1', 'a', 'b'), line('l2', 'c', 'd')],
    [
      { id: 'k1', type: 'horizontal', a: 'a', b: 'b' },
      { id: 'k2', type: 'horizontal', a: 'c', b: 'd' },
    ],
  );
  S.controller.select(['l1', 'l2'], false);
  return S;
}

describe('refusedRelations', () => {
  it('two horizontal lines: parallel is implied and perpendicular conflicts, equal length is still open', async () => {
    const S = twoHorizontals();
    const { offered } = relationsOffered(S.sketch(), S.solve(), ['l1', 'l2']);
    const types = offered.map((r) => r.type);
    expect(types).toContain('parallel');
    expect(types).toContain('perpendicular');
    expect(types).toContain('equal');
    const refused = await S.controller.refusedRelations(offered);
    expect(refused).not.toBeNull();
    expect(refused!.has('parallel')).toBe(true);
    expect(refused!.has('perpendicular')).toBe(true);
    expect(refused!.has('equal')).toBe(false);
  });

  it('reads only: the sketch is not changed by trying', async () => {
    const S = twoHorizontals();
    const before = JSON.stringify(S.sketch());
    await S.controller.refusedRelations(relationsOffered(S.sketch(), S.solve(), ['l1', 'l2']).offered);
    expect(JSON.stringify(S.sketch())).toBe(before);
  });

  it('agrees with pressing each button: refused exactly when addRelation refuses', async () => {
    const S = twoHorizontals();
    const offered = relationsOffered(S.sketch(), S.solve(), ['l1', 'l2']).offered;
    const refused = await S.controller.refusedRelations(offered);
    expect(refused).not.toBeNull();
    let accepted = 0;
    let rejected = 0;
    for (const body of offered) {
      const fresh = twoHorizontals();
      const ok = await fresh.controller.addRelation(body);
      expect(refused!.has(body.type), body.type).toBe(!ok);
      ok ? accepted++ : rejected++;
    }
    // both sides happened
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it('gives up (null) when the document changes while trying', async () => {
    const S = twoHorizontals();
    const offered = relationsOffered(S.sketch(), S.solve(), ['l1', 'l2']).offered;
    const pending = S.controller.refusedRelations(offered);
    S.add([point('z', 99, 99)]);
    expect(await pending).toBeNull();
  });

  it('no offer, nothing to try', async () => {
    const S = session();
    expect(await S.controller.refusedRelations([])).toBeNull();
  });
});
