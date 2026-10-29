/**
 * ADR 0217: a sketch line could not be made collinear with the outline of a curved face. A cylinder seen from the side has no edge along its top, only
 * its outline, and the model items a sketch snaps to and selects were edges only. Now they include the outlines of curved faces, as 「輪廓」 converts
 * them: clicking one in a sketch makes an entity that follows it, and 「共線」 between it and a sketch line is offered, holds and follows the model.
 * Every expected number is worked out from the part as drawn; the outlines come from the real kernel's HLR, nothing is mocked.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, IdAllocator, type Feature, type PartDoc, type Ref, type SketchFeature } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { anchorModelForSelection, type Maker } from '@3db/sketch/ops';
import { applicableRelations, snapModel } from '@3db/sketch/interact';
import { Kernel } from '@3db/kernel';
import { modelSnapItems, Regenerator, silhouetteProjector, type SnapItem } from '@3db/regen';
import { build, circle, extrude, fillet, front, rectangle, revolve, sketch, statuses } from '../phase1/builders';

type P2 = [number, number];
type V3 = [number, number, number];
const right: Ref = { kind: 'datum', name: 'plane:right' };
const top: Ref = { kind: 'datum', name: 'plane:top' };

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

/** A horizontal sketch line l3 and nothing else holding it, as in the report: free to move up and down, and along. */
const looseLine = (id: string, plane: Ref, y: number): Feature => ({
  id,
  type: 'sketch',
  name: id,
  suppressed: false,
  plane,
  entities: [
    { id: 'l3a', type: 'point', x: 2, y },
    { id: 'l3b', type: 'point', x: 12, y },
    { id: 'l3', type: 'line', p1: 'l3a', p2: 'l3b' },
  ],
  constraints: [{ id: 'h3', type: 'horizontal', a: 'l3' }],
});

/** Everything before sketch `id`, its frame, and what it can snap to, with (`outlines`) or without the outlines of curved faces. */
function snapsOf(regen: Regenerator, doc: PartDoc, id: string, outlines = true) {
  const r = regen.rebuild(doc, { until: doc.features.findIndex((f) => f.id === id) });
  if (!r.body) throw new Error('no body: ' + statuses(r).join(' '));
  const body = r.body;
  const frame = r.frames.get(id)!;
  const projector = silhouetteProjector(kernel, body.shape, body.names, body.topology, frame);
  const t0 = performance.now();
  const items = modelSnapItems({ names: body.names, topology: body.topology, frame, ...(outlines ? { outlines: projector.outlines } : {}) }, (i) => edgeFingerprint(body.topology, i));
  return { r, body, frame, items, ms: performance.now() - t0 };
}
const local = (frame: { origin: V3 | number[]; xDir: V3 | number[]; yDir: V3 | number[] }, p: V3): P2 => {
  const d = [p[0] - frame.origin[0]!, p[1] - frame.origin[1]!, p[2] - frame.origin[2]!];
  return [d[0]! * frame.xDir[0]! + d[1]! * frame.xDir[1]! + d[2]! * frame.xDir[2]!, d[0]! * frame.yDir[0]! + d[1]! * frame.yDir[1]! + d[2]! * frame.yDir[2]!];
};
const outlinesOf = (items: SnapItem[]) => items.filter((i): i is Extract<SnapItem, { projected: unknown }> => 'projected' in i && i.ref.kind === 'face');
const lookOf = (i: Extract<SnapItem, { projected: unknown }>) => JSON.stringify(i.projected, (_, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 + 0 : v));
/** Distance of `p` from the infinite line through a and b. */
const offLine = (p: P2, a: P2, b: P2) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

/** A cylinder of radius 5 along +Z, 20 long (a circle on the front plane extruded), and the loose line on the right plane just above its outline. */
const cylinder = (y = 6): PartDoc => build(sketch('s1', front, circle('c', 0, 0, 5)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), looseLine('s3', right, y));

describe('the outline of a curved face is something a sketch line can be related to (ADR 0217)', () => {
  it('a cylinder seen from the side offers its two outlines, at ±r, the whole length of it; before, nothing along them', () => {
    const regen = new Regenerator(kernel, solver, new Map());
    try {
      const { frame, items } = snapsOf(regen, cylinder(), 's3');
      const outlines = outlinesOf(items);
      expect(outlines).toHaveLength(2);
      const ys = [5, -5].map((y) => local(frame, [0, y, 0])[1]).sort((a, b) => a - b);
      const seen = outlines.map((o) => (o.projected.kind === 'line' ? o.projected : null));
      for (const l of seen) {
        expect(l).not.toBeNull();
        expect(l!.a[1]).toBeCloseTo(l!.b[1], 9); // straight across: the outline of a cylinder along the plane is a horizontal line here
        expect(Math.hypot(l!.a[0] - l!.b[0], l!.a[1] - l!.b[1])).toBeCloseTo(20, 6);
      }
      expect(seen.map((l) => l!.a[1]).sort((a, b) => a - b)).toEqual([expect.closeTo(ys[0]!, 6), expect.closeTo(ys[1]!, 6)]);
      for (const o of outlines) expect(o.ref).toMatchObject({ kind: 'face', name: expect.stringMatching(/\S/), silhouette: expect.any(Number) });
      expect(new Set(outlines.map((o) => o.ref.silhouette))).toEqual(new Set([0, 1]));
      // without the outlines there is nothing to snap to along the top: the end circles are seen edge on, the seam is no edge anyone sees
      const before = snapsOf(regen, cylinder(), 's3', false).items;
      const mid = local(frame, [0, 5, 10]);
      expect(snapModel(before, mid, 0.5)).toBeNull();
      expect(snapModel(items, mid, 0.5)).toMatchObject({ kind: 'model', item: { ref: { kind: 'face' } } });
    } finally {
      regen.dispose();
    }
  });

  it('clicking the outline in the sketch makes an entity that follows it, 「共線」 with the line is offered, holds, and follows a changed radius', () => {
    const regen = new Regenerator(kernel, solver, new Map());
    try {
      let doc = cylinder();
      const { frame, items } = snapsOf(regen, doc, 's3');
      const at = local(frame, [0, 5, 10]);
      const snap = snapModel(items, at, 0.5)!;
      expect(snap).not.toBeNull();
      const s3 = doc.features.find((f) => f.id === 's3') as SketchFeature;
      const made: Maker = { ids: new IdAllocator(doc.idCounters, new Set(s3.entities.map((e) => e.id))), entities: [], constraints: [] };
      // what the controller does on a click in select mode: the middle of an edge selects the curve itself
      const outline = anchorModelForSelection(s3, new Map(), made, snap.item, snap.part === 'mid' ? 'curve' : snap.part, snap.p);
      const ref = made.entities.find((e) => e.id === outline);
      expect(ref).toMatchObject({ type: 'line', construction: true, ref: { kind: 'face', silhouette: expect.any(Number) } });
      doc = applyCommand(doc, { type: 'addSketchItems', featureId: 's3', entities: made.entities, constraints: made.constraints });
      let r = regen.rebuild(doc);
      expect(statuses(r).every((s) => s.endsWith('=ok')), statuses(r).join('\n')).toBe(true);
      const sketchNow = doc.features.find((f) => f.id === 's3') as SketchFeature;
      const offered = applicableRelations(r.sketches.get('s3')!.solved.geometry, ['l3', outline], sketchNow);
      expect(offered).toContainEqual({ type: 'collinear', a: 'l3', b: outline });
      // l3's own 水平 is redundant next to it: the controller replaces it in one step (apps/web/test/relation-subsumed-orientation.test.ts)
      doc = applyCommand(doc, { type: 'editSketch', featureId: 's3', remove: ['h3'], add: { entities: [], constraints: [{ id: 'col', type: 'collinear', a: 'l3', b: outline }] } });
      for (const radius of [5, 8, 0.5]) {
        doc = applyCommand(doc, { type: 'setDimension', featureId: 's1', constraintId: 'cr', value: String(radius) });
        r = regen.rebuild(doc);
        expect(statuses(r).every((s) => s.endsWith('=ok')), statuses(r).join('\n')).toBe(true);
        const g = r.sketches.get('s3')!.solved.geometry;
        const l3 = g.get('l3')!;
        const o = g.get(outline)!;
        if (l3.type !== 'line' || o.type !== 'line') throw new Error('not lines');
        // the outline the entity follows is the one on the side that was clicked, at the new radius
        const expected = local(frame, [0, radius, 0])[1];
        expect(o.a[1]).toBeCloseTo(expected, 6);
        expect(o.b[1]).toBeCloseTo(expected, 6);
        expect(offLine(l3.a, o.a, o.b)).toBeLessThan(1e-9);
        expect(offLine(l3.b, o.a, o.b)).toBeLessThan(1e-9);
      }
    } finally {
      regen.dispose();
    }
  });
});

describe('red team: outlines added without changing what was there (ADR 0217)', () => {
  /** A plate 40 × 30, 10 thick, with a hole of radius 5 through it, and a sketch s3 on `plane`. */
  const plate = (plane: Ref): PartDoc =>
    build(
      sketch('s1', front, rectangle('r', 0, 0, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      sketch('s2', front, circle('h', 20, 15, 5)),
      extrude('e2', 's2', 'cut', { type: 'midPlane', depth: '30' }),
      sketch('s3', plane),
    );

  it('a hole seen along its axis has no outline of its own: what the sketch snaps to is what it was', () => {
    const regen = new Regenerator(kernel, solver, new Map());
    try {
      const withOutlines = snapsOf(regen, plate(front), 's3').items.map((i) => JSON.stringify(i));
      const without = snapsOf(regen, plate(front), 's3', false).items.map((i) => JSON.stringify(i));
      expect(withOutlines).toEqual(without);
    } finally {
      regen.dispose();
    }
  });

  it('the same hole seen from above: its two outlines, 10 deep at x = 15 and 25, and the edges as before', () => {
    const regen = new Regenerator(kernel, solver, new Map());
    try {
      const { frame, items } = snapsOf(regen, plate(top), 's3');
      const without = snapsOf(regen, plate(top), 's3', false).items;
      const outlines = outlinesOf(items);
      expect(outlines).toHaveLength(2);
      const xs = outlines.map((o) => (o.projected.kind === 'line' ? o.projected.a : null)).map((p) => {
        expect(p).not.toBeNull();
        return p!;
      });
      const expected = [15, 25].map((x) => local(frame, [x, 15, 0])[0]).sort((a, b) => a - b);
      expect(xs.map((p) => p[0]).sort((a, b) => a - b)).toEqual([expect.closeTo(expected[0]!, 6), expect.closeTo(expected[1]!, 6)]);
      for (const o of outlines) if (o.projected.kind === 'line') expect(Math.hypot(o.projected.a[0] - o.projected.b[0], o.projected.a[1] - o.projected.b[1])).toBeCloseTo(10, 6);
      // every edge item that was there still is, in the same order
      expect(items.filter((i) => i.ref.kind !== 'face').map((i) => JSON.stringify(i))).toEqual(without.map((i) => JSON.stringify(i)));
    } finally {
      regen.dispose();
    }
  });

  it('a fillet whose outline is its own boundary edge is offered once, as the edge; a torus outline is offered without error', () => {
    const regen = new Regenerator(kernel, solver, new Map());
    try {
      // the cylinder with its far rim rounded (R2): a torus, whose outline from the side ends on edges
      const base = cylinder();
      const r0 = regen.rebuild(base, { until: 2 });
      const body = r0.body!;
      const rim = body.topology.edges.findIndex((e) => e.curve === 'circle' && e.geometry?.type === 'circle' && Math.abs(e.geometry.center[2] - 20) < 1e-9);
      expect(rim).toBeGreaterThanOrEqual(0);
      const doc = build(...base.features.slice(0, 2), fillet('f1', [{ kind: 'edge', name: body.names.edges[rim]!, fingerprint: edgeFingerprint(body.topology, rim) }], '2'), looseLine('s3', right, 6));
      const { items, r } = snapsOf(regen, doc, 's3');
      // the rebuild stops at the sketch (it is the one being edited): everything before it is built
      expect(statuses(r).filter((s) => !s.startsWith('s3=')).every((s) => s.endsWith('=ok')), statuses(r).join('\n')).toBe(true);
      const projected = items.filter((i): i is Extract<SnapItem, { projected: unknown }> => 'projected' in i);
      const looks = projected.map(lookOf);
      expect(new Set(looks).size).toBe(looks.length); // nothing offered twice
      const torus = r.body!.topology.faces.findIndex((f) => f.surface === 'torus');
      expect(torus).toBeGreaterThanOrEqual(0);
      const ofTorus = outlinesOf(items).filter((o) => o.ref.name === r.body!.names.faces[torus]);
      expect(ofTorus.length).toBeGreaterThan(0);
      for (const o of ofTorus) expect(['line', 'arc', 'circle', 'spline']).toContain(o.projected.kind);
      // the cylinder is now 18 long before the round begins: its outlines are that long, and still at ±5
      const side = outlinesOf(items).filter((o) => o.ref.name === r.body!.names.faces[r.body!.topology.faces.findIndex((f) => f.surface === 'cylinder')]);
      expect(side).toHaveLength(2);
      for (const o of side) if (o.projected.kind === 'line') expect(Math.hypot(o.projected.a[0] - o.projected.b[0], o.projected.a[1] - o.projected.b[1])).toBeCloseTo(18, 6);
    } finally {
      regen.dispose();
    }
  });

  it('a cone seen from the side: its outlines end at the apex, and the apex is still the vertex a point snaps to, not the end of an outline', () => {
    // a right triangle 10 wide and 20 high at the origin of the front plane, turned about the sketch's vertical axis (manual-sketch-vertex.js)
    const profile: Feature = {
      id: 's1',
      type: 'sketch',
      name: 's1',
      suppressed: false,
      plane: front,
      entities: [
        { id: 'p0', type: 'point', x: 0, y: 0 },
        { id: 'p1', type: 'point', x: 10, y: 0 },
        { id: 'p2', type: 'point', x: 0, y: 20 },
        { id: 'la', type: 'line', p1: 'p0', p2: 'p1' },
        { id: 'lb', type: 'line', p1: 'p1', p2: 'p2' },
        { id: 'lc', type: 'line', p1: 'p2', p2: 'p0' },
      ],
      constraints: ['p0', 'p1', 'p2'].map((point) => ({ id: `f${point}`, type: 'fix' as const, point })),
    };
    const doc = build(profile, revolve('r1', 's1', '@axisV'), looseLine('s3', right, 30));
    const regen = new Regenerator(kernel, solver, new Map());
    try {
      const { frame, items, r } = snapsOf(regen, doc, 's3');
      expect(statuses(r).filter((s) => !s.startsWith('s3=')).every((s) => s.endsWith('=ok')), statuses(r).join('\n')).toBe(true);
      const apex = local(frame, [0, 20, 0]);
      const outlines = outlinesOf(items);
      expect(outlines).toHaveLength(2);
      for (const o of outlines) {
        if (o.projected.kind !== 'line') throw new Error(`a cone's outline is a line, not ${o.projected.kind}`);
        expect([o.projected.a, o.projected.b].some((p) => Math.hypot(p[0] - apex[0], p[1] - apex[1]) < 1e-6)).toBe(true);
        expect(Math.hypot(o.projected.a[0] - o.projected.b[0], o.projected.a[1] - o.projected.b[1])).toBeCloseTo(Math.hypot(10, 20), 6);
      }
      expect(items.some((i) => 'vertex' in i && Math.hypot(i.vertex[0] - apex[0], i.vertex[1] - apex[1]) < 1e-6)).toBe(true);
      expect(snapModel(items, [apex[0] + 0.05, apex[1] - 0.05], 0.5, true)).toMatchObject({ part: 'vertex', item: { ref: { kind: 'vertex' } } });
    } finally {
      regen.dispose();
    }
  });

  it('fuzz: 100 cylinders of random radius and length, each seen from the side, give exactly their two outlines; the real heap is read', () => {
    const initial = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(initial).toBeGreaterThan(0);
    let seed = 20261027;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const regen = new Regenerator(kernel, solver, new Map());
    try {
      for (let i = 0; i < 100; i++) {
        const radius = 0.1 + rand() * 20;
        const length = 0.1 + rand() * 50;
        const doc = build(sketch('s1', front, circle('c', 0, 0, radius)), extrude('e1', 's1', 'boss', { type: 'blind', depth: String(length) }), looseLine('s3', right, radius + 1));
        const { frame, items } = snapsOf(regen, doc, 's3');
        const outlines = outlinesOf(items);
        expect(outlines, `r ${radius} l ${length}`).toHaveLength(2);
        const ys = outlines.map((o) => {
          if (o.projected.kind !== 'line') throw new Error(`outline ${o.projected.kind} at r ${radius}`);
          expect(Math.hypot(o.projected.a[0] - o.projected.b[0], o.projected.a[1] - o.projected.b[1])).toBeCloseTo(length, 6);
          return o.projected.a[1];
        });
        const want = [radius, -radius].map((y) => local(frame, [0, y, 0])[1]).sort((a, b) => a - b);
        expect(ys.sort((a, b) => a - b)).toEqual([expect.closeTo(want[0]!, 6), expect.closeTo(want[1]!, 6)]);
      }
    } finally {
      regen.dispose();
    }
    console.info('outline snap heap growth bytes', (kernel.oc as any).wasmMemory.buffer.byteLength - initial);
  });

  it('a plate with 36 holes seen from above: their outlines, one item where columns line up, and how long it takes is printed', () => {
    const holes = Array.from({ length: 36 }, (_, i) => circle(`h${i}`, 5 + (i % 6) * 10, 5 + Math.floor(i / 6) * 10, 2));
    const parts = { entities: holes.flatMap((h) => h.entities), constraints: holes.flatMap((h) => h.constraints) };
    const doc = build(
      sketch('s1', front, rectangle('r', 0, 0, 60, 60)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      sketch('s2', front, parts),
      extrude('e2', 's2', 'cut', { type: 'midPlane', depth: '30' }),
      sketch('s3', top),
    );
    const regen = new Regenerator(kernel, solver, new Map());
    try {
      const { items, ms } = snapsOf(regen, doc, 's3');
      const { ms: edgesOnly } = snapsOf(regen, doc, 's3', false);
      console.info(`36-hole plate: ${items.length} snap items, ${outlinesOf(items).length} outlines; snap items ${ms.toFixed(1)} ms, ${edgesOnly.toFixed(1)} ms without outlines`);
      // the holes in a row along the view line up: six rows of six seen edge on, each column's twelve outlines at the same two x — one item each
      expect(outlinesOf(items)).toHaveLength(12);
    } finally {
      regen.dispose();
    }
  });
});
