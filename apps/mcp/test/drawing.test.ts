import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from '@3db/model';
import { page } from '@3db/model';
import { readAnyDocumentFile } from '@3db/io';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import { drawingOf } from '../src/drawingTools';
import { parseTolerance } from '../src/drawingSession';
import { PLATE_WITH_HOLE } from '../src/examples';

let s: CadSession;
const root = mkdtempSync(join(tmpdir(), 'drawing-tools-'));
const SHOTS = process.env.DRAWING_SHOTS; // a folder to keep the pictures in, to look at them
beforeAll(async () => {
  s = await CadSession.create({ root, locale: 'zh-TW' });
});
afterAll(() => {
  s?.dispose();
  rmSync(root, { recursive: true, force: true });
});

const text = (r: Awaited<ReturnType<typeof callTool>>) => JSON.parse((r.content.find((c) => c.type === 'text') as { text: string }).text);
const keep = (r: Awaited<ReturnType<typeof callTool>>, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const img = r.content.filter((c) => c.type === 'image') as { data: string }[];
  img.forEach((c, i) => writeFileSync(join(SHOTS, `${name}${i ? `-${i}` : ''}.png`), Buffer.from(c.data, 'base64')));
};
const ok = (r: Awaited<ReturnType<typeof callTool>>) => {
  expect(r.isError, JSON.stringify(r.content[0]).slice(0, 2000)).toBeFalsy();
  return r;
};

/** Two more holes beside the example's: Ø6 at (±20, 10), so that equal holes share a dimension and a pattern has places to tie. */
const SIDE_HOLES: Command[] = [
  { type: 'insertFeature', index: 4, feature: { id: 's3', type: 'sketch', name: 'Side holes', suppressed: false, plane: { kind: 'datum', name: 'plane:top' }, entities: [{ id: 'a', type: 'point', x: -20, y: 10 }, { id: 'ca', type: 'circle', center: 'a', radius: 3 }, { id: 'b', type: 'point', x: 20, y: 10 }, { id: 'cb', type: 'circle', center: 'b', radius: 3 }], constraints: [{ id: 'fa', type: 'fix', point: 'a' }, { id: 'fb', type: 'fix', point: 'b' }, { id: 'ra', type: 'radius', circle: 'ca', value: '3' }, { id: 'rb', type: 'radius', circle: 'cb', value: '3' }] } },
  { type: 'insertFeature', index: 5, feature: { id: 'c2', type: 'extrude', name: 'Side hole cut', suppressed: false, sketch: 's3', op: 'cut', dir1: { type: 'throughAll', reverse: true } } },
];

it('plans, makes a fully determined drawing of a plate with holes, and takes tolerances and notes in words', async () => {
  const built = await s.apply([...PLATE_WITH_HOLE, ...SIDE_HOLES]);
  expect(built.committed, JSON.stringify(built.error)).toBe(true);
  await s.save('plate.3dbx');

  const plan = ok(await callTool(s, 'drawing_plan', {}));
  keep(plan, 'plate-plan');
  const p = text(plan);
  expect(p.main.length).toBe(6);
  // the plate is 60 × 40 × 10 with its holes along y: the top view (looking down the holes) shows them true and is the best main view
  expect(p.main[0].direction).toBe('top');
  expect(p.main[0].metrics.trueShapes).toBe(3);
  expect(plan.content.filter((c) => c.type === 'image').length).toBe(3);

  const made = ok(await callTool(s, 'drawing_create', { title: { material: 'S45C' } }));
  console.log("CREATE CHECKS", JSON.stringify(text(made).drawing.checks.clutter));
  keep(made, 'plate-sheet');
  const r = text(made);
  const cov = r.drawing.checks.coverage;
  expect(cov.complete, JSON.stringify(cov)).toBe(true);
  expect(r.drawing.checks.failed).toEqual([]);
  expect(r.drawing.checks.overlaps).toBe(0);
  const createClutter = r.drawing.checks.clutter;
  if (r.drawing.checks.glyphs.font) expect(r.drawing.checks.glyphs.missing, r.drawing.checks.glyphs.font).toEqual([]);
  expect(r.drawing.checks.outside).toBe(0);
  expect(existsSync(join(root, 'plate.3dbd'))).toBe(true);

  // what the dimensions write: the plate's three sizes once each, Ø10 and 2×Ø6
  const inspect = text(ok(await callTool(s, 'drawing_inspect', {})));
  const texts: string[] = inspect.dimensions.map((d: { text: string }) => d.text);
  console.log('DIMS', JSON.stringify(inspect.dimensions.map((d: { id: string; view: string; kind: string; text: string }) => [d.id, d.view, d.kind, d.text])));
  expect(texts.some((x) => /Ø10/.test(x)), texts.join(' ')).toBe(true);
  expect(texts.some((x) => /2\s*[×x]\s*Ø6/.test(x)), texts.join(' ')).toBe(true);
  expect(createClutter.count, JSON.stringify(createClutter)).toBe(0);
  // the overall sizes once each (a hole 10 from an edge also writes 「10」, so the thickness is only asked to be there)
  for (const size of ['60', '40']) expect(texts.filter((x) => x === size).length, `${size} in ${texts.join(' ')}`).toBe(1);
  expect(texts).toContain('10');

  // the user's words: Ø10 H7, the 60 ±0.1, Ra 1.6 on the top face, flatness 0.02 on it, a general note
  const tol = ok(await callTool(s, 'drawing_tolerance', { dimension: 'Ø10', tolerance: 'H7', picture: false }));
  expect(text(tol).changed).toBeTruthy();
  ok(await callTool(s, 'drawing_tolerance', { dimension: '60', tolerance: '±0.1', picture: false }));
  const big = inspect.views[0].elements.filter((e: { type: string }) => e.type === 'plane').sort((a: { area: number }, b: { area: number }) => b.area - a.area);
  expect(big.length).toBeGreaterThan(0);
  const side = inspect.views.find((v: { elements: { type: string; end?: string; seen?: string }[] }) => v.elements.some((e) => e.type === 'plane' && e.end === 'top' && e.seen === 'horizontal line'));
  const topFace = side.elements.find((e: { type: string; end?: string; seen?: string }) => e.type === 'plane' && e.end === 'top' && e.seen === 'horizontal line').ref;
  ok(await callTool(s, 'drawing_annotate', { kind: 'finish', target: topFace, view: side.id, ra: 1.6, picture: false }));
  ok(await callTool(s, 'drawing_annotate', { kind: 'fcf', target: topFace, view: side.id, characteristic: 'flatness', tolerance: 0.02, picture: false }));
  const last = ok(await callTool(s, 'drawing_annotate', { kind: 'note', text: '未註倒角 C0.5', picture: true }));
  keep(last, 'plate-annotated');
  const after = text(last).drawing;
  console.log('AFTER CHECKS', JSON.stringify(after.checks.clutter));
  expect(after.annotations).toBe(2);
  expect(after.surfaceFinishes).toBe(1);
  expect(after.checks.coverage.complete).toBe(true);
  expect(after.checks.clutter.count, JSON.stringify(after.checks.clutter)).toBe(0);
  if (after.checks.glyphs.font) expect(after.checks.glyphs.missing).toEqual([]);

  // what is on disk is what the agent made, and opens as a drawing
  const file = await readAnyDocumentFile(new Uint8Array(readFileSync(join(root, 'plate.3dbd'))));
  expect(file.kind).toBe('drawing');
  const pg = page((file as { doc: Parameters<typeof page>[0] }).doc);
  expect(pg.dimensions.some((d) => d.tolerance?.type === 'fit')).toBe(true);
  expect(pg.dimensions.some((d) => d.tolerance?.type === 'bilateral')).toBe(true);

  const pdf = ok(await callTool(s, 'drawing_export', { path: 'plate.pdf', format: 'pdf' }));
  expect(text(pdf).bytes).toBeGreaterThan(1000);
  expect(text(pdf).warnings).toEqual([]);
  const dxf = ok(await callTool(s, 'drawing_export', { path: 'plate.dxf', format: 'dxf' }));
  expect(text(dxf).bytes).toBeGreaterThan(1000);

  // text sizes: every text within what reads well; one size for all, one item on its own, extremes refused
  expect(after.checks.text.outOfRange).toEqual([]);
  const large = text(ok(await callTool(s, 'drawing_text_size', { all: 5, picture: true })));
  keep(await callTool(s, 'drawing_picture', {}), 'plate-text5');
  expect(large.drawing.checks.text.min).toBeGreaterThanOrEqual(2.5);
  expect(large.drawing.checks.text.max).toBe(7); // the captions at 10/7 of 5, at most 7
  expect(large.drawing.checks.text.outOfRange).toEqual([]);
  expect(large.drawing.checks.clutter.count, JSON.stringify(large.drawing.checks.clutter)).toBe(0);
  const one = text(ok(await callTool(s, 'drawing_text_size', { item: 'Ø10', size: 3.5, picture: false })));
  expect(one.changed[0]).toMatch(/3.5 mm/);
  expect((await callTool(s, 'drawing_text_size', { all: 1 })).isError).toBe(true);
  expect((await callTool(s, 'drawing_text_size', { all: 12 })).isError).toBe(true);
  const back = text(ok(await callTool(s, 'drawing_text_size', { all: 3.5, reset: true, picture: false })));
  expect(back.drawing.checks.text.max).toBe(5);
  expect(back.drawing.checks.clutter.count).toBe(0);

  // a deleted dimension is found missing by the self-check and put back by drawing_complete
  const someLinear = pg.dimensions.find((d) => d.kind === 'linear')!;
  const del = text(ok(await callTool(s, 'drawing_apply', { commands: [{ type: 'deleteDimensions', dimensionIds: [someLinear.id] }], picture: false })));
  expect(del.drawing.checks.coverage.complete).toBe(false);
  const again = text(ok(await callTool(s, 'drawing_complete', { picture: false })));
  expect(again.added).toBeGreaterThan(0);
  expect(again.drawing.checks.coverage.complete).toBe(true);
}, 240_000);

/** A closed rectangle sketch on the Top plane (x from x0 to x1, the sketch's y from y0 to y1), fixed where it is. */
function rect(id: string, x0: number, y0: number, x1: number, y1: number): Record<string, unknown> {
  const p = (n: number, x: number, y: number) => ({ id: `${id}p${n}`, type: 'point', x, y });
  return {
    id, type: 'sketch', name: id, suppressed: false, plane: { kind: 'datum', name: 'plane:top' },
    entities: [p(0, x0, y0), p(1, x1, y0), p(2, x1, y1), p(3, x0, y1), ...[0, 1, 2, 3].map((k) => ({ id: `${id}l${k}`, type: 'line', p1: `${id}p${k}`, p2: `${id}p${(k + 1) % 4}` }))],
    constraints: [0, 1, 2, 3].map((k) => ({ id: `${id}f${k}`, type: 'fix', point: `${id}p${k}` })),
  };
}

it('a stepped block with a blind bore gets a section along the bore, and every step tied to its datum', async () => {
  await s.newPart();
  // an 80 × 40 block 20 high, a 40 × 40 step on its right half up to 35, and a Ø16 bore 30 deep from the bottom under the step
  const cmds = [
    { type: 'insertFeature', index: 0, feature: rect('k1', -40, -20, 40, 20) },
    { type: 'insertFeature', index: 1, feature: { id: 'x1', type: 'extrude', name: 'base boss', suppressed: false, sketch: 'k1', op: 'boss', dir1: { type: 'blind', depth: '20' } } },
    { type: 'insertFeature', index: 2, feature: rect('k2', 0, -20, 40, 20) },
    { type: 'insertFeature', index: 3, feature: { id: 'x2', type: 'extrude', name: 'step boss', suppressed: false, sketch: 'k2', op: 'boss', dir1: { type: 'blind', depth: '35' } } },
    { type: 'insertFeature', index: 4, feature: { id: 'k3', type: 'sketch', name: 'bore', suppressed: false, plane: { kind: 'datum', name: 'plane:top' }, entities: [{ id: 'bc', type: 'point', x: 20, y: 0 }, { id: 'bo', type: 'circle', center: 'bc', radius: 8 }], constraints: [{ id: 'bf', type: 'fix', point: 'bc' }, { id: 'br', type: 'radius', circle: 'bo', value: '8' }] } },
    { type: 'insertFeature', index: 5, feature: { id: 'x3', type: 'extrude', name: 'bore cut', suppressed: false, sketch: 'k3', op: 'cut', dir1: { type: 'blind', depth: '30', reverse: true } } },
  ] as unknown as Command[];
  const built = await s.apply(cmds);
  expect(built.committed, JSON.stringify(built.error)).toBe(true);
  expect(s.summary().mass!.volume).toBeCloseTo(80 * 40 * 20 + 40 * 40 * 15 - Math.PI * 64 * 30, 3);
  await s.save('block.3dbx');
  const plan = text(ok(await callTool(s, 'drawing_plan', { thumbnails: false })));
  expect(plan.main.map((c: { direction: string }) => c.direction)).toContain('front');
  // the user picks the front as the main view: the bore is hidden there, so a section is cut along its axis and takes a side view's place
  const made = ok(await callTool(s, 'drawing_create', { main: 'front' }));
  keep(made, 'block-sheet');
  const out = text(made);
  const rep = out.drawing;
  expect(out.plan.section?.orientation, JSON.stringify(out.plan)).toBe('vertical');
  expect(out.plan.section.at).toBeCloseTo(20, 6);
  expect(rep.views.some((v: { kind: string }) => v.kind === 'section'), JSON.stringify(rep.views)).toBe(true);
  expect(rep.checks.coverage.complete, JSON.stringify(rep.checks.coverage)).toBe(true);
  expect(rep.checks.failed).toEqual([]);
  expect(rep.checks.overlaps).toBe(0);
  expect(rep.checks.clutter.count, JSON.stringify(rep.checks.clutter)).toBe(0);
  expect(rep.checks.outside).toBe(0);
  if (rep.checks.glyphs.font) expect(rep.checks.glyphs.missing, rep.checks.glyphs.font).toEqual([]);
}, 240_000);

it('reads tolerances as people write them and refuses what it cannot read', () => {
  expect(parseTolerance('±0.05')).toEqual({ type: 'bilateral', upper: 0.05, lower: -0.05 });
  expect(parseTolerance('+0.1/-0.05')).toEqual({ type: 'bilateral', upper: 0.1, lower: -0.05 });
  expect(parseTolerance('+0.02/0')).toEqual({ type: 'bilateral', upper: 0.02, lower: 0 });
  expect(parseTolerance('H7')).toEqual({ type: 'fit', fit: 'H7' });
  expect(parseTolerance('最大')).toEqual({ type: 'max' });
  expect(() => parseTolerance('about 0.1')).toThrow();
  expect(() => parseTolerance('±0')).toThrow();
  expect(() => parseTolerance('0.1/0.1')).toThrow();
});

it('refuses a drawing of a part that is not saved, and tools before a drawing exists', async () => {
  const fresh = await CadSession.create({ root, locale: 'en' });
  try {
    const none = await callTool(fresh, 'drawing_inspect', {});
    expect(none.isError).toBe(true);
    ok(await callTool(fresh, 'cad_execute_feature', { feature: { operation: 'create_primitive', shape: 'box', id: 'b', width: 10, depth: 10, height: 10 } }));
    const unsaved = await callTool(fresh, 'drawing_create', {});
    expect(unsaved.isError).toBe(true);
    expect(JSON.stringify(unsaved.content)).toMatch(/save the part/);
    expect(drawingOf(fresh).doc).toBeNull();
    const bad = await callTool(fresh, 'drawing_create', { main: 'isometric' });
    expect(bad.isError).toBe(true);
  } finally {
    fresh.dispose();
  }
});
