import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializePart } from '@3db/model';
import { stepAsPart, writePartFile } from '@3db/io';
import type { Kernel } from '@3db/kernel';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import { PLATE_WITH_HOLE } from '../src/examples';

let s: CadSession;
const root = mkdtempSync(join(tmpdir(), 'cad-tools-'));
beforeAll(async () => { s = await CadSession.create({ root, locale: 'en' }); });
afterAll(() => { s?.dispose(); rmSync(root, { recursive: true, force: true }); });
it('builds a box, refuses invalid input without changing its snapshot and continues', async () => {
  const r = await callTool(s, 'cad_execute_feature', { feature: { operation: 'create_primitive', shape: 'box', id: 'box', name: 'cyl:profile', width: 20, depth: 30, height: 10 } });
  expect(r.isError, JSON.stringify(r.content[0])).toBeFalsy();
  expect(r.content.some((c) => c.type === 'image')).toBe(true);
  expect(s.summary().mass!.volume).toBeCloseTo(6000, 6);
  const snapshot = serializePart(s.doc);
  const bad = await callTool(s, 'cad_execute_feature', { feature: { operation: 'fillet', id: 'bad', edges: [{ kind: 'edge', name: 'missing' }], radius: 10000 } });
  expect(bad.isError).toBe(true);
  expect(serializePart(s.doc)).toBe(snapshot);
  const next = await callTool(s, 'cad_execute_feature', { feature: { operation: 'create_primitive', shape: 'cylinder', id: 'cyl', radius: 2, height: 5 } });
  expect(next.isError, JSON.stringify(next.content[0])).toBeFalsy();
  expect(s.doc.features.find((f) => f.id === 'cyl:profile')?.name).toBe('cyl:profile2');
});
it('returns exact body metrics and rejects fractional pattern counts', async () => {
  const result = await callTool(s, 'cad_inspect_geometry', {});
  expect(result.isError, JSON.stringify(result.content[0])).toBeFalsy();
  const snapshot = serializePart(s.doc);
  const result2 = await callTool(s, 'cad_execute_feature', { feature: { operation: 'pattern', id: 'p', seeds: ['box'], direction: { kind: 'datum', name: 'axis:x' }, count: 1.5, spacing: 40 } });
  expect(result2.isError).toBe(true);
  expect(serializePart(s.doc)).toBe(snapshot);
});

it('records bounded geometric repair, commits only the successful attempt, and can undo it', async () => {
  await s.newPart();
  const create = await callTool(s, 'cad_execute_feature', { feature: { operation: 'create_primitive', shape: 'box', id: 'base', width: 20, depth: 30, height: 10 } });
  expect(create.isError).toBeFalsy();
  const snapshot = serializePart(s.doc);
  const edges = s.elements({ kind: 'edge', type: 'line', direction: [0, 1, 0] }).map(({ ref }) => ({ kind: ref.kind, name: ref.name }));
  const result = await callTool(s, 'cad_execute_feature', { feature: { operation: 'fillet', id: 'round', edges, radius: 100 }, repair: { maxAttempts: 8, factor: 0.5, minValue: 0.1 } });
  expect(result.isError, JSON.stringify(result.content[0])).toBeFalsy();
  const report = JSON.parse((result.content[0] as { text: string }).text);
  expect(report.attempts.length).toBeGreaterThan(1);
  expect(report.attempts[0].committed).toBe(false);
  expect(report.attempts.at(-1).committed).toBe(true);
  expect(s.doc.features.filter((f) => f.id === 'round')).toHaveLength(1);
  await s.undo();
  expect(serializePart(s.doc)).toBe(snapshot);
});

it('executes extrude, chamfer, hole, boolean and pattern through the standard tool', async () => {
  const run = async (feature: unknown) => {
    const r = await callTool(s, 'cad_execute_feature', { feature });
    expect(r.isError, JSON.stringify(r.content[0])).toBeFalsy();
  };
  await s.newPart();
  expect((await s.apply(PLATE_WITH_HOLE.slice(0, 1))).committed).toBe(true);
  await run({ operation: 'extrude', id: 'extrusion', sketch: 's1', depth: 10 });
  const edges = s.elements({ kind: 'edge', type: 'line', direction: [0, 1, 0] }).map(({ ref }) => ({ kind: ref.kind, name: ref.name }));
  await run({ operation: 'chamfer', id: 'bevel', edges, distance: 1 });
  await s.newPart();
  expect((await s.apply([...PLATE_WITH_HOLE.slice(0, 2), { type: 'insertFeature', index: 2, feature: { id: 's2', type: 'sketch', name: 'Hole positions', suppressed: false, plane: { kind: 'datum', name: 'plane:top' }, entities: [{ id: 'p', type: 'point', x: 0, y: 0 }], constraints: [{ id: 'fixed', type: 'fix', point: 'p' }] } }])).committed).toBe(true);
  await run({ operation: 'hole', id: 'bore', sketch: 's2', diameter: 10, reverse: true });
  expect(s.inspectBodies()[0]!.holes.some((h) => h.radius === 5 && h.rims.length === 2)).toBe(true);
  await s.newPart();
  await run({ operation: 'create_primitive', shape: 'box', id: 'block', width: 20, depth: 20, height: 10 });
  await run({ operation: 'create_primitive', shape: 'cylinder', id: 'tool', radius: 2, height: 10 });
  const bodies = s.summary().bodies;
  await run({ operation: 'boolean', id: 'difference', mode: 'subtract', main: { kind: 'body', name: bodies[0]!.id }, tools: [{ kind: 'body', name: bodies[1]!.id }] });
  expect(s.inspectBodies()[0]!.mass!.volume).toBeCloseTo(4000 - Math.PI * 4 * 10, 5);
  await s.newPart();
  expect((await s.apply(PLATE_WITH_HOLE.slice(0, 2))).committed).toBe(true);
  await run({ operation: 'pattern', id: 'copies', seeds: ['e1'], direction: { kind: 'datum', name: 'plane:right' }, count: 2, spacing: 100 });
  expect(s.summary().mass!.volume).toBeCloseTo(48000, 4);
});

it('renders all requested cameras and rejects invalid custom axes', async () => {
  for (const camera of ['isometric', 'top', 'front', 'right', 'custom']) {
    const result = await callTool(s, 'cad_get_viewport_screenshot', { camera, size: 128, ...(camera === 'custom' ? { dir: [-1, -1, -1], up: [0, 1, 0] } : {}) });
    expect(result.isError, JSON.stringify(result.content[0])).toBeFalsy();
    const image = result.content.find((c) => c.type === 'image');
    expect(image?.type).toBe('image');
    if (image?.type === 'image') expect(Buffer.from(image.data, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }
  expect((await callTool(s, 'cad_get_viewport_screenshot', { camera: 'custom', dir: [0, 0, 0], up: [0, 1, 0] })).isError).toBe(true);
});

it('exhausts repair without altering the original document or requested value', async () => {
  await s.newPart();
  await callTool(s, 'cad_execute_feature', { feature: { operation: 'create_primitive', shape: 'box', id: 'base', width: 20, depth: 30, height: 10 } });
  const snapshot = serializePart(s.doc);
  const edges = s.elements({ kind: 'edge', type: 'line', direction: [0, 1, 0] }).map(({ ref }) => ref);
  const result = await callTool(s, 'cad_execute_feature', { feature: { operation: 'fillet', id: 'impossible', edges, radius: 100 }, repair: { maxAttempts: 2, factor: 0.5, minValue: 0.1 } });
  expect(result.isError).toBe(true);
  expect(serializePart(s.doc)).toBe(snapshot);
  const report = JSON.parse((result.content[0] as { text: string }).text);
  expect(report.attempts.map((a: { feature: { radius: number } }) => a.feature.radius)).toEqual([100, 50]);
  expect(report.geometryWarnings[0].certifiedLimit).toBeNull();
  const missing = await callTool(s, 'cad_execute_feature', { feature: { operation: 'fillet', id: 'missing', edges: [{ kind: 'edge', name: 'not-an-edge' }], radius: 100 }, repair: { maxAttempts: 8, factor: 0.5, minValue: 0.1 } });
  expect(missing.isError).toBe(true);
  expect(JSON.parse((missing.content[0] as { text: string }).text).attempts).toHaveLength(1);
  expect(serializePart(s.doc)).toBe(snapshot);
});

it('gives the extent of a body with B-spline faces, not the cover its poles make', async () => {
  // a cylinder r 5, h 10 about y as B-spline faces, imported from STEP as a part: the cover reaches to the rational circle's poles (part-3, R1-10226,
  // was given 53.22 mm along z for a body of 42.10)
  const kernel = (s as unknown as { kernel: Kernel }).kernel;
  const L = (a: number[], b: number[], n: string) => ({ kind: 'line', a, b, source: n });
  const prof = [[0, 0], [5, 0], [5, 10], [0, 10]];
  const cyl = kernel.revolve({ origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as never, [{ outer: prof.map((a, i) => L(a, prof[(i + 1) % 4]!, 'p' + i)), holes: [] }] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape;
  const spline = kernel.toBSpline(cyl);
  const step = new TextEncoder().encode(kernel.exportStep(spline, 'c'));
  kernel.release(spline);
  kernel.release(cyl);
  const file = await stepAsPart(step, 'c.step');
  writeFileSync(join(root, 'spline-cylinder.3dbx'), await writePartFile(file.doc, file.blobs));
  await s.open('spline-cylinder.3dbx');
  const shape = (s as unknown as { result: { bodies: { shape: import("@3db/kernel").ShapeId }[] } }).result.bodies[0]!.shape;
  const cover = kernel.bounds(shape);
  expect(cover.max[0]! - cover.min[0]!).toBeGreaterThan(11);
  const box = s.inspectBodies()[0]!.box;
  for (const [got, want] of [...box.min.map((v, i) => [v, [-5, 0, -5][i]!]), ...box.max.map((v, i) => [v, [5, 10, 5][i]!])]) expect(Math.abs(got! - want!)).toBeLessThan(1e-6);
});
