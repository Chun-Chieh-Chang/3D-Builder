import { describe, expect, it } from 'vitest';
import { IdAllocator, type Ref, type SketchEntity } from '@3db/model';
import { snapModel } from '../src/interact';
import { anchorModel, anchorModelForSelection, type Maker, type ModelEdge } from '../src/ops';
import type { P2, SolvedGeometry } from '../src/types';

const edge = (name: string, projected: ModelEdge['projected']): ModelEdge => ({ ref: { kind: 'edge', name }, projected });
/** A plate 40 × 30 with a hole of radius 5 at (20, 15): the plate's four edges, the hole, and a corner arc of radius 3 at (37, 3). */
const plate = (): ModelEdge[] => [
  edge('bottom', { kind: 'line', a: [0, 0], b: [40, 0] }),
  edge('right', { kind: 'line', a: [40, 0], b: [40, 30] }),
  edge('top', { kind: 'line', a: [40, 30], b: [0, 30] }),
  edge('left', { kind: 'line', a: [0, 30], b: [0, 0] }),
  edge('hole', { kind: 'circle', c: [20, 15], r: 5 }),
  edge('round', { kind: 'arc', c: [37, 3], r: 3, start: [37, 0], end: [40, 3] }),
];

describe('snapping to the model (D5.3b)', () => {
  const items = plate();

  it('takes the end of an edge, the corner of the plate', () => {
    const s = snapModel(items, [39.8, 30.2], 0.5)!;
    expect(s).toMatchObject({ kind: 'model', p: [40, 30] });
    expect(['start', 'end']).toContain(s.part);
    expect(['right', 'top']).toContain(s.item.ref.name); // both edges end there: the first listed wins
  });

  it('takes the middle of a line', () => {
    expect(snapModel(items, [20.2, 0.2], 0.5)).toMatchObject({ part: 'mid', p: [20, 0] });
  });

  it('takes the center of a hole, and the center and ends of an arc', () => {
    expect(snapModel(items, [19.9, 15.1], 0.5)).toMatchObject({ part: 'center', p: [20, 15] });
    expect(snapModel(items, [37.1, 2.9], 0.5)).toMatchObject({ part: 'center', p: [37, 3] });
    expect(snapModel(items, [40, 3.2], 0.5)).toMatchObject({ part: 'end', p: [40, 3] });
  });

  it('takes any place along an edge when no end, center or middle is near, the nearest place on it', () => {
    const along = snapModel(items, [10, 0.3], 0.5)!;
    expect(along).toMatchObject({ part: 'curve' });
    expect(along.p[0]).toBeCloseTo(10, 12);
    expect(along.p[1]).toBeCloseTo(0, 12);
    const onHole = snapModel(items, [25.2, 15], 0.5)!;
    expect(onHole.part).toBe('curve');
    expect(onHole.p[0]).toBeCloseTo(25, 12);
  });

  it('prefers a point to a place along an edge', () => {
    // 0.3 from the middle of the bottom edge and 0.1 from the edge: the middle wins
    expect(snapModel(items, [20.3, 0.1], 0.5)).toMatchObject({ part: 'mid' });
  });

  it('can be asked for points only (a sketch curve is already under the cursor)', () => {
    expect(snapModel(items, [10, 0.3], 0.5, true)).toBeNull();
    expect(snapModel(items, [20.2, 0.2], 0.5, true)).toMatchObject({ part: 'mid' });
  });

  it('finds nothing away from the model, and takes the nearest of two close places', () => {
    expect(snapModel(items, [10, 10], 0.5)).toBeNull();
    const two = [edge('a', { kind: 'line', a: [0, 0], b: [10, 0] }), edge('b', { kind: 'line', a: [0.3, 0], b: [10, 5] })];
    expect(snapModel(two, [0.25, 0], 0.5)!.item.ref.name).toBe('b');
  });

  it('leaves out pierce points, which are not edges in the plane', () => {
    expect(snapModel([{ ref: { kind: 'edge', name: 'p' }, pierce: [5, 5] }], [5, 5], 0.5)).toBeNull();
  });

  it('has a tolerance in sketch units: the same pixels reach less when zoomed in', () => {
    expect(snapModel(items, [40.4, 0.4], 0.5)).not.toBeNull();
    expect(snapModel(items, [40.4, 0.4], 0.2)).toBeNull();
  });
});

describe('the entities a click on the model makes (D5.3b)', () => {
  const maker = (): Maker => ({ ids: new IdAllocator({}, []), entities: [], constraints: [] });
  const item = (name: string) => plate().find((e) => e.ref.name === name)!;
  const refs = (m: Maker) => m.entities.flatMap((e) => (e.type !== 'point' && e.ref ? [e.ref.name] : []));
  const none = { entities: [] as SketchEntity[] };
  const nothing = new Map<string, SolvedGeometry>();

  it('makes the edge an entity that follows it and returns its end point', () => {
    const m = maker();
    const id = anchorModel(none, nothing, m, item('bottom'), 'end', [40, 0]);
    expect(refs(m)).toEqual(['bottom']);
    const line = m.entities.find((e) => e.type === 'line')!;
    expect(line).toMatchObject({ type: 'line', ref: { name: 'bottom' } });
    expect((line as Extract<SketchEntity, { type: 'line' }>).p2).toBe(id);
    expect(m.entities.filter((e) => e.type === 'point')).toHaveLength(2);
    expect(m.constraints).toEqual([]);
  });

  it('returns the center of a hole and of an arc, and the start of an arc', () => {
    const m = maker();
    const c = anchorModel(none, nothing, m, item('hole'), 'center', [20, 15]);
    expect(m.entities.find((e) => e.type === 'circle')).toMatchObject({ center: c });
    const a = anchorModel(none, nothing, m, item('round'), 'start', [37, 0]);
    expect(m.entities.find((e) => e.type === 'arc')).toMatchObject({ start: a });
  });

  it('uses the entity again for the second click on the same edge, in the same action', () => {
    const m = maker();
    const first = anchorModel(none, nothing, m, item('bottom'), 'start', [0, 0]);
    const second = anchorModel(none, nothing, m, item('bottom'), 'end', [40, 0]);
    expect(refs(m)).toEqual(['bottom']);
    expect(first).not.toBe(second);
  });

  it('uses an entity the sketch already has, and adds nothing for an end of it', () => {
    const have: SketchEntity[] = [
      { id: 'p1', type: 'point', x: 0, y: 0 },
      { id: 'p2', type: 'point', x: 40, y: 0 },
      { id: 'l1', type: 'line', p1: 'p1', p2: 'p2', ref: { kind: 'edge', name: 'bottom' } as Ref },
    ];
    const m = maker();
    expect(anchorModel({ entities: have }, nothing, m, item('bottom'), 'end', [40, 0])).toBe('p2');
    expect(m.entities).toEqual([]);
    expect(m.constraints).toEqual([]);
  });

  it('shares the corner of two edges: the second edge starts at the point the first one ended at', () => {
    const have: SketchEntity[] = [
      { id: 'p1', type: 'point', x: 0, y: 0 },
      { id: 'p2', type: 'point', x: 40, y: 0 },
      { id: 'l1', type: 'line', p1: 'p1', p2: 'p2', ref: { kind: 'edge', name: 'bottom' } as Ref },
    ];
    const solved = new Map<string, SolvedGeometry>([
      ['p1', { type: 'point', p: [0, 0] }],
      ['p2', { type: 'point', p: [40, 0] }],
    ]);
    const m = maker();
    anchorModel({ entities: have }, solved, m, item('right'), 'end', [40, 30]);
    const right = m.entities.find((e) => e.type === 'line') as Extract<SketchEntity, { type: 'line' }>;
    expect(right.p1).toBe('p2'); // the corner at (40, 0) is the existing point
    expect(m.entities.filter((e) => e.type === 'point')).toHaveLength(1); // only (40, 30) is new
  });

  it('makes a new point with a midpoint relation for the middle of a line, and an on-curve relation for anywhere along an edge', () => {
    const m = maker();
    const mid = anchorModel(none, nothing, m, item('bottom'), 'mid', [20, 0]);
    const line = m.entities.find((e) => e.type === 'line')!;
    expect(m.entities).toContainEqual({ id: mid, type: 'point', x: 20, y: 0 });
    expect(m.constraints).toContainEqual(expect.objectContaining({ type: 'midpoint', point: mid, line: line.id }));
    const along = anchorModel(none, nothing, m, item('hole'), 'curve', [25, 15]);
    const circle = m.entities.find((e) => e.type === 'circle')!;
    expect(m.constraints).toContainEqual(expect.objectContaining({ type: 'pointOnCurve', point: along, curve: circle.id }));
  });

  it('allocates ids that never repeat', () => {
    const m = maker();
    for (const [name, part, at] of [['bottom', 'start', [0, 0]], ['hole', 'center', [20, 15]], ['round', 'end', [40, 3]], ['top', 'mid', [20, 30]]] as [string, 'start' | 'end' | 'center' | 'mid' | 'curve', P2][]) anchorModel(none, nothing, m, item(name), part, at);
    const ids = [...m.entities, ...m.constraints].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('direct selection referencing (Plan B: anchorModelForSelection)', () => {
    it('creates construction geometry and returns curve id when clicking curve', () => {
      const m = maker();
      const lineId = anchorModelForSelection(none, nothing, m, item('bottom'), 'curve', [20, 0]);
      expect(lineId).toBeDefined();
      const line = m.entities.find((e) => e.id === lineId && e.type === 'line') as Extract<SketchEntity, { type: 'line' }>;
      expect(line).toBeDefined();
      expect(line.construction).toBe(true);
      expect(line.ref).toMatchObject({ name: 'bottom' });
      // Endpoints are points without extra point-on-curve constraints
      expect(m.entities.filter((e) => e.type === 'point')).toHaveLength(2);
      expect(m.constraints).toHaveLength(0);
    });

    it('returns corner point id when clicking start or end of edge', () => {
      const m = maker();
      const pStart = anchorModelForSelection(none, nothing, m, item('bottom'), 'start', [0, 0]);
      const line = m.entities.find((e) => e.type === 'line') as Extract<SketchEntity, { type: 'line' }>;
      expect(pStart).toBe(line.p1);

      // Calling on the same edge end reuses the existing line
      const pEnd = anchorModelForSelection({ entities: m.entities }, nothing, m, item('bottom'), 'end', [40, 0]);
      expect(pEnd).toBe(line.p2);
    });

    it('reuses existing entity when sketch already has it', () => {
      const m = maker();
      const firstId = anchorModelForSelection(none, nothing, m, item('bottom'), 'curve', [20, 0]);
      const count = m.entities.length;
      const m2 = maker();
      const secondId = anchorModelForSelection({ entities: m.entities }, nothing, m2, item('bottom'), 'curve', [25, 0]);
      expect(secondId).toBe(firstId);
      expect(m2.entities).toHaveLength(0);
    });
  });
});
