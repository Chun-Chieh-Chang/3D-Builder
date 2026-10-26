import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, viewFeatures, placedViewFeatures, elementFacts, viewEdges, type RebuildResult } from '@3db/regen';
import { applyDrawingCommand, createEmptyDrawing, page, parseDrawing, serializeDrawing, placementRows, placeElementFacts, viewVectors, type Dimension } from '@3db/model';
import { chamferReferenceAt, dimensionModesFor, planDimension, evaluateDimension, visibleElements, toSheet, type PlacedView, type ViewLines } from '@3db/drawing';
import { build, sketch, circle, front, extrude } from '../phase1/builders';
let k: Kernel, regen: Regenerator, result: RebuildResult;
let base: ReturnType<typeof build>, chamfer: Extract<import('@3db/model').Feature, { type: 'chamfer' }>;
const axes = viewVectors('top');
const placed: PlacedView = { id: 'v', at: [150, 150], centre: [0, 10], w: 20, h: 20, scale: 1 };
beforeAll(async () => {
 k = await Kernel.load(); regen = new Regenerator(k, await PlaneGcsSolver.create());
 base = build(sketch('s', front, circle('c', 0, 0, 10)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' }));
 const b = await regen.rebuild(base), body = b.body!;
 const edge = body.topology.edges.findIndex(e => e.geometry?.type === 'circle');
 expect(edge).toBeGreaterThanOrEqual(0);
 chamfer = { id: 'ch', name: 'chamfer', type: 'chamfer', suppressed: false, edges: [{ kind: 'edge', name: body.names.edges[edge]! }], mode: 'distanceDistance', distance: '1', second: '1' };
 result = await regen.rebuild({ ...base, features: [...base.features, chamfer] });
 expect(result.features.every(f => f.status === 'ok'), JSON.stringify(result.features)).toBe(true);
});
beforeEach(() => { result = regen.rebuild({ ...base, features: [...base.features, chamfer] }); });
afterAll(() => regen.dispose());
function make() {
 const b = result.body!, features = viewFeatures(b.topology, b.names, axes), lines = k.projectView(b.shape, axes) as ViewLines;
 const seen = visibleElements(lines, viewEdges(k, b.shape, b.topology, b.names, axes), features);
 const cone = features.find(f => f.type === 'slant' && f.cone);
 expect(cone?.type).toBe('slant');
 if (!cone || cone.type !== 'slant' || !cone.cone) throw new Error('native cone profile missing');
 const picked = chamferReferenceAt(lines, features, cone.at, 0.1, seen)!;
 const plan = planDimension([picked], [190, 180], placed, axes, 'chamfer');
 if (!('draft' in plan)) throw new Error(JSON.stringify(plan));
 const dim = { ...plan.draft, id: 'd', view: 'v' } as Extract<Dimension, { kind: 'chamfer' }>;
 const facts = elementFacts(b.topology, b.names, dim.ref);
 if ('error' in facts) throw new Error(facts.error);
 return { cone, dim, facts };
}
it('selects an actual circular-edge chamfer silhouette, persists its side and anchors the leader to the visible profile', () => {
 const { cone, dim, facts } = make();
 expect(dimensionModesFor(cone)).toEqual(['chamfer']);
 expect(dim.ref.kind).toBe('face'); expect(dim.coneSide).toBe(cone.cone!.side);
 const outcome = evaluateDimension(dim, { elements: [facts] }, axes, placed);
 if ('error' in outcome) throw new Error(outcome.error);
 expect(outcome.value).toBeCloseTo(1, 8); expect(outcome.text).toBe('C1');
 expect(outcome.handle?.kind).toBe('round');
 if (outcome.handle?.kind === 'round') expect(outcome.handle.centre).toEqual(toSheet(placed, ...cone.at));
 let doc = createEmptyDrawing(); doc = applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: 'v', name: 'side', source: 'shaft.3dbx', direction: 'top' }] });
 doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [dim] });
 expect(page(parseDrawing(serializeDrawing(doc))).dimensions[0]).toEqual(dim);
 expect(() => applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd', patch: { size: 9 } })).toThrow();
 const corrupt = JSON.parse(serializeDrawing(doc));
 corrupt.pages[0].dimensions[0].coneSide = 0;
 expect(() => parseDrawing(JSON.stringify(corrupt))).toThrow();
 for (const side of [0, 1.5, NaN]) expect(() => applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [{ ...dim, id: 'bad', coneSide: side } as never] })).toThrow();
});
it('re-evaluates the conical setback after a real model rebuild instead of keeping the saved number', async () => {
 const { dim } = make();
 const rebuilt = await regen.rebuild({ ...base, features: [...base.features, { ...chamfer, distance: '2', second: '2' }] });
 expect(rebuilt.features.every(f => f.status === 'ok')).toBe(true);
 const b = rebuilt.body!, facts = elementFacts(b.topology, b.names, dim.ref);
 if ('error' in facts) throw new Error(facts.error);
 const outcome = evaluateDimension(dim, { elements: [facts] }, axes, placed);
 expect(outcome).toMatchObject({ value: expect.closeTo(2, 8), text: 'C2' });
 result = await regen.rebuild({ ...base, features: [...base.features, chamfer] });
});
it('rejects an end-on cone and validates both sides under 100 native assembly placements including mirrors', () => {
 const { dim, facts } = make();
 expect(evaluateDimension(dim, { elements: [facts] }, viewVectors('front'), placed)).toHaveProperty('error');
 const heap = (k as any).oc.wasmMemory.buffer.byteLength; expect(heap).toBeGreaterThan(0);
 const b = result.body!, live = k.liveShapes;
 for (let i = 0; i < 100; i++) {
  const a = (i * 137.5 % 360) * Math.PI / 180;
  const rows = placementRows({ position: [i / 3, 0, -i / 7], rotation: [axes.dir[0] * Math.sin(a/2), axes.dir[1] * Math.sin(a/2), axes.dir[2] * Math.sin(a/2), Math.cos(a/2)] }, i % 2 === 0);
  const fs = placedViewFeatures(k, b.shape, b.topology, b.names, axes, { rows, in: 'shaft' }).filter(f => f.type === 'slant' && f.cone);
  expect(fs).toHaveLength(2);
  for (const f of fs) {
   if (f.type !== 'slant' || !f.cone) throw new Error('missing cone');
   expect(planDimension([f], [190, 180], placed, axes, 'chamfer')).toHaveProperty('draft');
   const outcome = evaluateDimension({ ...dim, coneSide: f.cone.side }, { elements: [placeElementFacts(facts, rows)] }, axes, placed);
   if ('error' in outcome) throw new Error(outcome.error);
   expect(outcome.value).toBeCloseTo(1, 8);
   if (outcome.handle?.kind !== 'round') throw new Error('missing leader');
   const expected = toSheet(placed, ...f.at);
   outcome.handle.centre.forEach((v, j) => expect(v).toBeCloseTo(expected[j]!, 7));
  }
 }
 expect(k.liveShapes).toBe(live);
 console.log('cone placement native heap', { baseline: heap, end: (k as any).oc.wasmMemory.buffer.byteLength });
});

it('non-equal setbacks use native axial length and actual angle, not a C symbol', () => {
 const { dim } = make();
 const rebuilt = regen.rebuild({ ...base, features: [...base.features, { ...chamfer, distance: '1', second: '2' }] });
 expect(rebuilt.features.every(f => f.status === 'ok')).toBe(true);
 const b = rebuilt.body!, index = b.topology.faces.findIndex(f => f.geometry?.type === 'cone');
 expect(index).toBeGreaterThanOrEqual(0);
 const edges = b.topology.edges.filter(e => e.faces.includes(index) && e.geometry?.type === 'circle');
 expect(edges).toHaveLength(2);
 const circles = edges.map(e => e.geometry).filter((g): g is Extract<NonNullable<typeof g>, { type: 'circle' }> => g?.type === 'circle');
 const axial = Math.hypot(...circles[0]!.center.map((v, i) => v - circles[1]!.center[i]!));
 const radial = Math.abs(circles[0]!.radius - circles[1]!.radius);
 const facts = elementFacts(b.topology, b.names, dim.ref);
 if ('error' in facts) throw new Error(facts.error);
 const outcome = evaluateDimension(dim, { elements: [facts] }, axes, placed);
 if ('error' in outcome) throw new Error(outcome.error);
 expect(outcome.value).toBeCloseTo(axial, 8);
 expect(outcome.chamfer!.angle).toBeCloseTo(Math.atan2(radial, axial) * 180 / Math.PI, 8);
 expect(outcome.text).toContain(' × ');
 expect(outcome.text).not.toMatch(/^C/);
});
