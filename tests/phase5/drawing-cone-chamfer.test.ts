import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readPartFile } from '@3db/io';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, viewFeatures, placedViewFeatures, elementFacts, sketchCircleFacts, drawingSketchCircles, drawingSketchFacts, viewEdges, type RebuildResult } from '@3db/regen';
import { applyDrawingCommand, createEmptyDrawing, page, parseDrawing, serializeDrawing, placementRows, placeElementFacts, viewVectors, rightOf, sheetUp, type Dimension } from '@3db/model';
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
it('extracts the solved sketch circle rather than a later model edge and follows changed constraints', () => {
 const before = regen.rebuild({ ...base, features: [...base.features, chamfer] });
 const initial = sketchCircleFacts(before.sketches, 's', 'c');
 expect(initial?.radius).toBeCloseTo(10, 9);
 expect(initial?.point).toEqual([0, 0, 0]);
 const first = base.features[0]!;
 if (first.type !== 'sketch') throw new Error('sketch missing');
 const changed = { ...base, features: [{ ...first, constraints: first.constraints.map(c => c.type === 'radius' ? { ...c, value: '12' } : c) }, ...base.features.slice(1), chamfer] };
 const after = regen.rebuild(changed);
 expect(sketchCircleFacts(after.sketches, 's', 'c')?.radius).toBeCloseTo(12, 9);
 expect(sketchCircleFacts(after.sketches, 's', 'missing')).toBeNull();
});
it('dimensions the selected solved sketch circle on both its edge-on and face-on views and follows edits', () => {
 const first = regen.rebuild({ ...base, features: [...base.features, chamfer] });
 const candidate = drawingSketchCircles(first.sketches).find(c => c.ref.name === 's:c');
 expect(candidate?.sketchName).toBeTruthy();
 if (!candidate) throw new Error('solved circle missing');
 const ref = candidate.ref;
 const dim: Dimension = { id: 'sketch-dim', view: 'v', kind: 'linear', a: { ...ref, point: 'sketchNegative' }, b: { ...ref, point: 'sketchPositive' }, orientation: 'aligned', offset: 10, prefix: 'Ø' };
 const evaluate = (facts: typeof candidate.facts) => evaluateDimension(dim, { elements: [facts, facts] }, axes, placed);
 expect(evaluate(candidate.facts)).toMatchObject({ value: expect.closeTo(20, 9), text: 'Ø20' });
 expect(evaluateDimension(dim, { elements: [candidate.facts, candidate.facts] }, axes, placed, 'in')).toMatchObject({ value: expect.closeTo(20, 9), text: 'Ø0.787' });
 const face: Dimension = { id: 'face', view: 'v', kind: 'diameter', ref, angle: 45 };
 expect(evaluateDimension(face, { elements: [candidate.facts] }, viewVectors('front'), placed)).toMatchObject({ value: expect.closeTo(20, 9), text: 'Ø20' });
 expect(evaluateDimension(face, { elements: [candidate.facts] }, axes, placed)).toHaveProperty('error');
 let drawing = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'v', name: 'side', source: 'shaft.3dbx', direction: 'top' }] });
 drawing = applyDrawingCommand(drawing, { type: 'insertDimensions', dimensions: [dim] });
 expect(page(parseDrawing(serializeDrawing(drawing))).dimensions[0]).toEqual(dim);
 const bad = { ...ref, name: 's:missing' };
 expect(drawingSketchFacts(first.sketches, bad)).toHaveProperty('error');
 for (const name of ['', ':c', 's:', 's:c:extra']) expect(() => applyDrawingCommand(drawing, { type: 'insertDimensions', dimensions: [{ ...face, id: 'bad', ref: { kind: 'sketch', name } }] })).toThrow();
 const sketchFeature = base.features[0]!;
 if (sketchFeature.type !== 'sketch') throw new Error('sketch missing');
 const changed = regen.rebuild({ ...base, features: [{ ...sketchFeature, constraints: sketchFeature.constraints.map(c => c.type === 'radius' ? { ...c, value: '12' } : c) }, ...base.features.slice(1), chamfer] });
 const updated = drawingSketchFacts(changed.sketches, ref);
 if ('error' in updated) throw new Error(updated.error);
 expect(evaluate(updated)).toMatchObject({ value: expect.closeTo(24, 9), text: 'Ø24' });
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

it('measures a 45-degree chamfer from the virtual intersection of a tapered wall and its end plane', () => {
 const plane = { id: 'p', name: 'p', type: 'refPlane', suppressed: false, def: { mode: 'offset', plane: front, distance: '10' } } as const;
 const loft = { id: 'loft', name: 'loft', type: 'loft', suppressed: false, op: 'boss', sections: ['s1', 's2'] } as const;
 const doc = build(sketch('s1', front, circle('a', 0, 0, 5)), plane, sketch('s2', { kind: 'datum', name: 'p' }, circle('b', 0, 0, 6)), { ...loft, sections: [...loft.sections] });
 const initial = regen.rebuild(doc), body = initial.body!;
 const edge = body.topology.edges.findIndex(e => e.geometry?.type === 'circle' && Math.abs(e.geometry.center[2]) < 1e-7);
 expect(edge).toBeGreaterThanOrEqual(0);
 const operation = { ...chamfer, id: 'taperChamfer', edges: [{ kind: 'edge' as const, name: body.names.edges[edge]! }], mode: 'angleDistance' as const, distance: '0.5', second: '45' };
 const rebuilt = regen.rebuild({ ...doc, features: [...doc.features, operation] });
 expect(rebuilt.features.filter(f => f.status === 'error')).toEqual([]);
 const b = rebuilt.body!, name = b.names.faces.find(n => n.startsWith('taperChamfer:chamfer:'))!;
 const facts = elementFacts(b.topology, b.names, { kind: 'face', name });
 if ('error' in facts) throw new Error(facts.error);
 expect(facts.chamferSetback).toBeCloseTo(0.5, 8);
 const actualSpan = Math.abs(facts.ends![1][2] - facts.ends![0][2]);
 expect(Math.abs(actualSpan - 0.5)).toBeGreaterThan(0.01);
 const features = viewFeatures(b.topology, b.names, axes);
 const pick = features.find(f => f.type === 'slant' && f.ref.name === name && f.cone);
 expect(pick?.type).toBe('slant');
 if (!pick || pick.type !== 'slant' || !pick.cone) throw new Error('cone profile missing');
 const plan = planDimension([pick], [190, 180], placed, axes, 'chamfer');
 if (!('draft' in plan) || plan.draft.kind !== 'chamfer') throw new Error('chamfer plan missing');
 expect(plan.draft.size).toBeCloseTo(0.5, 8);
 const outcome = evaluateDimension({ ...plan.draft, id: 'd', view: 'v' }, { elements: [facts] }, axes, placed);
 expect(outcome).toMatchObject({ value: expect.closeTo(0.5, 8), text: 'C0.5' });
});

if (process.env.CHAMFER_SAMPLE) it('uses the intersection with the tapered wall for the actual sample and follows feature edits', async () => {
 const file = await readPartFile(new Uint8Array(await readFile(process.env.CHAMFER_SAMPLE!)));
 const feature = file.doc.features.find(f => f.id === 'chamfer3');
 expect(feature?.type).toBe('chamfer');
 if (!feature || feature.type !== 'chamfer') throw new Error('sample chamfer missing');
 for (const distance of [0.5, 0.6]) {
  const doc = { ...file.doc, features: file.doc.features.map(f => f.id === feature.id ? { ...feature, distance: String(distance) } : f) };
  const rebuilt = regen.rebuild(doc), body = rebuilt.body!;
  expect(rebuilt.features.filter(f => f.status === 'error')).toEqual([]);
  const name = body.names.faces.find(n => n.startsWith('chamfer3:chamfer:'));
  expect(name).toBeDefined();
  const facts = elementFacts(body.topology, body.names, { kind: 'face', name: name! });
  if ('error' in facts) throw new Error(facts.error);
  expect(facts.chamferSetback).toBeCloseTo(distance, 8);
  const outcome = evaluateDimension({ id: 'd', view: 'v', kind: 'chamfer', ref: { kind: 'face', name: name! }, angle: 135, size: 0.5174, chamferAngle: 45, coneSide: 1, chamferFormat: 'c' }, { elements: [facts] }, axes, placed);
  if ('error' in outcome) throw new Error(outcome.error);
  expect(outcome.value).toBeCloseTo(distance, 8);
  expect(outcome.text).toBe(`C${distance}`);
 }
});

if (process.env.CHAMFER_SAMPLE) it('extracts the solved sketch circle at its original plane even when a chamfer removes the edge', async () => {
 const file = await readPartFile(new Uint8Array(await readFile(process.env.CHAMFER_SAMPLE!)));
 const first = regen.rebuild(file.doc);
 const facts = sketchCircleFacts(first.sketches, 'sketch1', 'ci1');
 expect(facts?.type).toBe('circle');
 expect(facts?.radius).toBeCloseTo(10.41 / 2, 9);
 expect(facts?.point[2]).toBeCloseTo(0.5, 9);
 const ref = { kind: 'sketch' as const, name: 'sketch1:ci1' };
 const dim: Dimension = { id: 'd', view: 'v', kind: 'linear', a: { ...ref, point: 'sketchNegative' }, b: { ...ref, point: 'sketchPositive' }, orientation: 'vertical', offset: 10, prefix: 'Ø' };
 const left = viewVectors('left');
 const result = evaluateDimension(dim, { elements: [facts!, facts!] }, left, placed);
 expect(result).toMatchObject({ value: expect.closeTo(10.41, 8), text: 'Ø10.41' });
 if ('error' in result || result.handle?.kind !== 'linear') throw new Error('no linear dimension geometry');
 const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, n, i) => s + n * b[i]!, 0);
 const centre = toSheet(placed, dot(facts!.point, rightOf(left)), dot(facts!.point, sheetUp(left)));
 expect((result.handle.a[0] + result.handle.b[0]) / 2).toBeCloseTo(centre[0], 9);
 expect((result.handle.a[1] + result.handle.b[1]) / 2).toBeCloseTo(centre[1], 9);
 expect(Math.hypot(result.handle.a[0] - result.handle.b[0], result.handle.a[1] - result.handle.b[1])).toBeCloseTo(10.41 * placed.scale, 8);
 expect(sketchCircleFacts(first.sketches, 'sketch1', 'missing')).toBeNull();
});
