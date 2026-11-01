/**
 * G12 (P4): relation symbols on clear ground and the highlight running both ways. The layout keeps every symbol off every other
 * (nothing is covered whole, so every one stays clickable), keeps the ones the selection is about beside their anchors, and never
 * wanders far; the overlay lights what a picked relation names and folds the symbols that have nothing to do with the selection.
 */
import { describe, expect, it } from 'vitest';
import { createEmptyPart, SKETCH_ORIGIN, type Id, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import type { P2, SolvedGeometry } from '@3db/sketch';
import type { PlaneFrame } from '@3db/render';
import { buildOverlay, layoutRelationLabels, relationLabelSize, SKETCH_COLORS, type RelationLabelRequest } from '../src/sketcher/overlay';
import type { ControllerView } from '../src/sketcher/controller';
import type { SketchSolvePayload } from '../src/worker/protocol';

const FRONT: PlaneFrame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };

/** Two 10 × 6 rectangles side by side, nine relations between them (four horizontal, four vertical, one 「相等」 across the two). */
const line = (id: Id, p1: Id, p2: Id): SketchEntity => ({ id, type: 'line', p1, p2 });
const point = (id: Id, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const ENTITIES: SketchEntity[] = [
  point('p1', 0, 0), point('p2', 10, 0), point('p3', 10, 6), point('p4', 0, 6),
  point('p5', 14, 0), point('p6', 24, 0), point('p7', 24, 6), point('p8', 14, 6),
  line('l1', 'p1', 'p2'), line('l2', 'p2', 'p3'), line('l3', 'p4', 'p3'), line('l4', 'p1', 'p4'),
  line('l5', 'p5', 'p6'), line('l6', 'p6', 'p7'), line('l7', 'p8', 'p7'), line('l8', 'p5', 'p8'),
];
const RELATIONS: SketchConstraint[] = [
  { id: 'c1', type: 'horizontal', a: 'l1' },
  { id: 'c2', type: 'vertical', a: 'l2' },
  { id: 'c3', type: 'horizontal', a: 'l3' },
  { id: 'c4', type: 'vertical', a: 'l4' },
  { id: 'c5', type: 'equal', a: 'l3', b: 'l7' },
  { id: 'c6', type: 'horizontal', a: 'l5' },
  { id: 'c7', type: 'vertical', a: 'l6' },
  { id: 'c8', type: 'horizontal', a: 'l7' },
  { id: 'c9', type: 'vertical', a: 'l8' },
];

const GEOMETRY = new Map<Id, SolvedGeometry>([
  ['p1', { type: 'point', p: [0, 0] }],
  ['p2', { type: 'point', p: [10, 0] }],
  ['p3', { type: 'point', p: [10, 6] }],
  ['p4', { type: 'point', p: [0, 6] }],
  ['p5', { type: 'point', p: [14, 0] }],
  ['p6', { type: 'point', p: [24, 0] }],
  ['p7', { type: 'point', p: [24, 6] }],
  ['p8', { type: 'point', p: [14, 6] }],
  ['l1', { type: 'line', a: [0, 0], b: [10, 0], p1: 'p1', p2: 'p2', construction: false }],
  ['l2', { type: 'line', a: [10, 0], b: [10, 6], p1: 'p2', p2: 'p3', construction: false }],
  ['l3', { type: 'line', a: [0, 6], b: [10, 6], p1: 'p4', p2: 'p3', construction: false }],
  ['l4', { type: 'line', a: [0, 0], b: [0, 6], p1: 'p1', p2: 'p4', construction: false }],
  ['l5', { type: 'line', a: [14, 0], b: [24, 0], p1: 'p5', p2: 'p6', construction: false }],
  ['l6', { type: 'line', a: [24, 0], b: [24, 6], p1: 'p6', p2: 'p7', construction: false }],
  ['l7', { type: 'line', a: [14, 6], b: [24, 6], p1: 'p8', p2: 'p7', construction: false }],
  ['l8', { type: 'line', a: [14, 0], b: [14, 6], p1: 'p5', p2: 'p8', construction: false }],
  [SKETCH_ORIGIN, { type: 'point', p: [0, 0] }],
]);

const sketch = (): SketchFeature => ({ ...(createEmptyPart().features[0] as SketchFeature), entities: ENTITIES, constraints: RELATIONS });
const solve = { seq: 0, geometry: GEOMETRY, status: 'fully', dof: 0, conflicting: [], redundant: [], problems: [], ms: 0 } as unknown as SketchSolvePayload;
const view = (selection: Id[]): ControllerView =>
  ({ tool: 'select', selection, hover: null, snap: null, inference: null, inferLine: null, quickSnap: null, grid: null, preview: [], picks: [], pickedCrossings: [], cursor: null, hint: '', message: null, options: {} }) as unknown as ControllerView;

const PX = 0.05;
const overlay = (selection: Id[]) => buildOverlay(FRONT, sketch(), solve, view(selection), PX, { showRelations: true, dimensionPreview: null });
const marker = (o: ReturnType<typeof overlay>, id: Id) => o.labels.find((l) => l.key === `rel:${id}`);
/** The curve of one entity, by its endpoints (a line is drawn as its two ends). */
const curveOf = (o: ReturnType<typeof overlay>, id: Id) => {
  const g = GEOMETRY.get(id)!;
  if (g.type !== 'line') return undefined;
  return o.curves.find((c) => c.points[0]![0] === g.a[0] && c.points[0]![1] === g.a[1] && c.points[1]![0] === g.b[0] && c.points[1]![1] === g.b[1]);
};

/** Two symbol boxes centred on `a` and `b` share no ground. */
const clearOf = (wa: number, ha: number, pa: P2, wb: number, hb: number, pb: P2): boolean =>
  Math.abs(pa[0] - pb[0]) >= (((wa + wb) / 2 + 1) * PX) || Math.abs(pa[1] - pb[1]) >= (((ha + hb) / 2 + 1) * PX);

describe('relation symbols on clear ground (G12)', () => {
  it('the box is bigger than the stylesheet draws the symbol, so a layout clear of it is clear of the real one', () => {
    expect(relationLabelSize('∥')).toEqual({ w: 20, h: 20 });
    expect(relationLabelSize('a:b').w).toBe(36);
  });

  it('eighteen symbols crowded onto one anchor: none lies on another, every one stays within six rings of it, the same requests lay out the same way', () => {
    const requests: RelationLabelRequest[] = Array.from({ length: 18 }, (_, i) => ({ key: `r${i}`, text: i % 3 === 0 ? 'a:b' : '∥', anchor: [i * 0.1, 0] as P2, rank: 1 }));
    const where = layoutRelationLabels(requests, PX);
    const items = requests.map((r) => ({ r, p: where.get(r.key)!, box: relationLabelSize(r.text) }));
    expect(items.every((it) => it.p)).toBe(true);
    for (let i = 0; i < items.length; i++) {
      const a = items[i]!;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j]!;
        expect(clearOf(a.box.w, a.box.h, a.p, b.box.w, b.box.h, b.p), `${a.r.key} on ${b.r.key}`).toBe(true);
      }
      // 12 + 6·17 px is as far as the rings go
      const reach = Math.hypot((a.p[0] - a.r.anchor[0]) / PX, (a.p[1] - a.r.anchor[1]) / PX);
      expect(reach).toBeLessThanOrEqual(12 + 6 * 17 + 1e-9);
    }
    expect([...layoutRelationLabels(requests, PX).entries()]).toEqual([...where.entries()]);
  });

  it('the relation the selection is about keeps the spot beside its anchor; the ones that have nothing to do with it make room', () => {
    const anchor: P2 = [1, 1];
    const where = layoutRelationLabels(
      [
        { key: 'first', text: '∥', anchor, rank: 1 },
        { key: 'second', text: '∥', anchor, rank: 1 },
        { key: 'mine', text: '=', anchor, rank: 0 },
      ],
      PX,
    );
    expect(where.get('mine')).toEqual([1 + 12 * PX, 1 + 12 * PX]);
    const mine = where.get('mine')!;
    for (const key of ['first', 'second']) {
      const p = where.get(key)!;
      expect(Math.abs(p[0] - mine[0]) >= (relationLabelSize('∥').w + 1) * PX || Math.abs(p[1] - mine[1]) >= (relationLabelSize('∥').h + 1) * PX).toBe(true);
    }
  });
});

describe('the highlight runs both ways (G12)', () => {
  it('with nothing selected no symbol is folded or lit', () => {
    const o = overlay([]);
    expect(o.labels.filter((l) => l.className?.includes('dim')).length).toBe(0);
    expect(o.labels.filter((l) => l.className?.includes('related')).length).toBe(0);
    expect(o.labels.filter((l) => l.key.startsWith('rel:')).length).toBe(RELATIONS.length);
  });

  it('selecting the first rectangle\'s top edge lights the two relations naming it (the 「相等」 across the rectangles too) and folds the rest', () => {
    const o = overlay(['l3']);
    const cls = (id: Id) => marker(o, id)?.className ?? '';
    expect(cls('c3')).toContain('related'); // the edge's own horizontal
    expect(cls('c5')).toContain('related'); // equal(l3, l7): names the edge
    expect(cls('c1')).toContain('dim'); // the bottom edge's horizontal: nothing to do with it
    expect(cls('c6')).toContain('dim');
    expect(o.labels.filter((l) => l.className?.includes('related')).length).toBe(2);
    expect(o.labels.filter((l) => l.className?.includes('dim')).length).toBe(RELATIONS.length - 2);
  });

  it('selecting a relation lights the geometry it names — the far rectangle\'s edge too — and its own symbol is the selected one', () => {
    const o = overlay(['c5']);
    expect(marker(o, 'c5')?.className).toContain('selected');
    expect(curveOf(o, 'l3')?.color).toBe(SKETCH_COLORS.hover);
    expect(curveOf(o, 'l7')?.color).toBe(SKETCH_COLORS.hover);
    expect(curveOf(o, 'l5')?.color).not.toBe(SKETCH_COLORS.hover);
    expect(o.labels.filter((l) => l.className?.includes('dim')).length).toBe(RELATIONS.length - 1);
  });

  it('a conflicting relation never folds, selected or not', () => {
    const conflicted = { ...solve, conflicting: ['c6'] } as unknown as SketchSolvePayload;
    const o = buildOverlay(FRONT, sketch(), conflicted, view(['l3']), PX, { showRelations: true, dimensionPreview: null });
    expect(marker(o, 'c6')?.className).toContain('over');
    expect(marker(o, 'c6')?.className).not.toContain('dim');
  });

  it('the placed symbols of a real overlay never share ground either', () => {
    const o = overlay(['l3']);
    const rels = o.labels.filter((l) => l.key.startsWith('rel:')).map((l) => ({ text: l.text, p: l.p as P2, box: relationLabelSize(l.text) }));
    for (let i = 0; i < rels.length; i++) {
      const a = rels[i]!;
      for (let j = i + 1; j < rels.length; j++) {
        const b = rels[j]!;
        expect(clearOf(a.box.w, a.box.h, a.p, b.box.w, b.box.h, b.p), `${i} on ${j}`).toBe(true);
      }
    }
  });
});
