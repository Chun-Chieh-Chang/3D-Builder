import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, DrawingDoc } from '@3db/model';
import { dimensionRefs } from '@3db/model';
import { readAnyDocumentFile } from '@3db/io';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';

/**
 * A drawing that drawing_create spreads over two pages (micro radii moved into detail views on page 2): the editing tools, drawing_complete and the
 * exports must see every page, not only the first.
 */
let s: CadSession;
const root = mkdtempSync(join(tmpdir(), 'drawing-pages-'));
beforeAll(async () => {
  s = await CadSession.create({ root, locale: 'en' });
});
afterAll(() => {
  s?.dispose();
  rmSync(root, { recursive: true, force: true });
});

type Result = Awaited<ReturnType<typeof callTool>>;
const text = (r: Result) => JSON.parse((r.content.find((c) => c.type === 'text') as { text: string }).text);
const ok = (r: Result) => {
  expect(r.isError, JSON.stringify(r.content[0]).slice(0, 2000)).toBeFalsy();
  return r;
};
const saved = async (name = 'micro.3dbd'): Promise<DrawingDoc> => (await readAnyDocumentFile(new Uint8Array(readFileSync(join(root, name))))).doc as DrawingDoc;
/** What each dimension measures, as one key: the same key on two dimensions is the same size written twice. */
const keyOf = (d: DrawingDoc['pages'][number]['dimensions'][number]) => `${d.kind}:${dimensionRefs(d).map((r) => r.name).sort().join('&')}`;
const allKeys = (doc: DrawingDoc) => doc.pages.flatMap((p) => p.dimensions.map(keyOf));

// a 40 × 30 × 8 plate with its four upright edges rounded R0.3 … R0.6: four micro radii, so drawing_create adds page 2 with detail views
const W = 40, H = 30;
const PLATE: Command[] = [
  {
    type: 'insertFeature', index: 0,
    feature: {
      id: 's1', type: 'sketch', name: 's1', suppressed: false, plane: { kind: 'datum', name: 'plane:top' },
      entities: [
        { id: 'p0', type: 'point', x: 0, y: 0 }, { id: 'p1', type: 'point', x: W, y: 0 }, { id: 'p2', type: 'point', x: W, y: H }, { id: 'p3', type: 'point', x: 0, y: H },
        { id: 'l0', type: 'line', p1: 'p0', p2: 'p1' }, { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'l3', type: 'line', p1: 'p3', p2: 'p0' },
      ],
      constraints: [
        { id: 'h0', type: 'horizontal', a: 'l0' }, { id: 'v1', type: 'vertical', a: 'l1' }, { id: 'h2', type: 'horizontal', a: 'l2' }, { id: 'v3', type: 'vertical', a: 'l3' },
        { id: 'w', type: 'distance', a: 'l0', value: String(W) }, { id: 'd', type: 'distance', a: 'l1', value: String(H) }, { id: 'o', type: 'coincident', a: 'p0', b: '@origin' },
      ],
    },
  } as Command,
  { type: 'insertFeature', index: 1, feature: { id: 'e1', type: 'extrude', name: 'e1', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth: '8' } } } as Command,
  ...['{e1:side:s1.l0|e1:side:s1.l1}', '{e1:side:s1.l1|e1:side:s1.l2}', '{e1:side:s1.l2|e1:side:s1.l3}', '{e1:side:s1.l0|e1:side:s1.l3}'].map(
    (name, i) => ({ type: 'insertFeature', index: 2 + i, feature: { id: `f${i}`, type: 'fillet', name: `f${i}`, suppressed: false, edges: [{ kind: 'edge', name }], radius: ['0.3', '0.4', '0.5', '0.6'][i]! } }) as Command,
  ),
];

it('edits, completes and exports every page of a two-page drawing', async () => {
  const built = await s.apply(PLATE);
  expect(built.committed, JSON.stringify(built.error)).toBe(true);
  await s.save('micro.3dbx');

  const made = text(ok(await callTool(s, 'drawing_create', {}))).drawing;
  expect(made.pages).toBe(2);
  expect(made.checks.coverage.complete, JSON.stringify(made.checks.coverage)).toBe(true);
  const doc0 = await saved();
  const second = doc0.pages[1]!.dimensions;
  expect(second.length).toBeGreaterThan(0); // the test needs dimensions on page 2, or it proves nothing
  expect(new Set(allKeys(doc0)).size).toBe(allKeys(doc0).length);

  // the report says what is on each page
  expect(made.pageSummaries.map((p: { dimensions: number }) => p.dimensions)).toEqual(doc0.pages.map((p) => p.dimensions.length));

  // inspect lists the dimensions and views of page 2 too, with their page
  const inspect = text(ok(await callTool(s, 'drawing_inspect', {})));
  const listed = new Map<string, { page: number; text: string }>(inspect.dimensions.map((d: { id: string; page: number; text: string }) => [d.id, d]));
  for (const d of second) expect(listed.get(d.id)?.page, d.id).toBe(1);
  expect(inspect.views.some((v: { page: number; kind: string }) => v.page === 1 && v.kind === 'detail')).toBe(true);
  const target = second[0]!;
  const targetText = listed.get(target.id)!.text;

  // the exports: DXF and SVG write one file per page; page 2's numbers are in page 2's file
  for (const format of ['dxf', 'svg'] as const) {
    const ex = text(ok(await callTool(s, 'drawing_export', { path: `micro.${format}`, format })));
    expect(ex.files.length, format).toBe(2);
    const [first, last] = ex.files.map((f: { path: string }) => readFileSync(f.path, 'utf8'));
    expect(last.includes(targetText), `${format} page 2 has ${targetText}`).toBe(true);
    expect(first.includes(targetText), `${format} page 1 has no ${targetText}`).toBe(false);
    expect(existsSync(join(root, `micro-2.${format}`))).toBe(true);
  }
  // PDF stays one file of two pages
  expect(text(ok(await callTool(s, 'drawing_export', { path: 'micro.pdf', format: 'pdf' }))).files.length).toBe(1);

  // drawing_complete on a complete drawing adds nothing, and writes no size twice
  const comp = text(ok(await callTool(s, 'drawing_complete', {})));
  expect(comp.added).toBe(0);
  const doc1 = await saved();
  expect(doc1.pages.map((p) => p.dimensions.length)).toEqual(doc0.pages.map((p) => p.dimensions.length));

  // a tolerance on a page-2 dimension, by its id and by its text
  ok(await callTool(s, 'drawing_tolerance', { dimension: target.id, tolerance: '±0.05' }));
  expect((await saved()).pages[1]!.dimensions.find((d) => d.id === target.id)?.tolerance).toBeDefined();
  ok(await callTool(s, 'drawing_tolerance', { dimension: targetText, tolerance: null }));
  expect((await saved()).pages[1]!.dimensions.find((d) => d.id === target.id)?.tolerance).toBeUndefined();

  // a note on a page-2 dimension goes on page 2
  const note = text(ok(await callTool(s, 'drawing_annotate', { kind: 'note', target: target.id, text: 'BREAK EDGE' }))).added;
  const doc2 = await saved();
  expect((doc2.pages[1]!.annotations ?? []).some((a) => a.id === note)).toBe(true);
  expect((doc2.pages[0]!.annotations ?? []).some((a) => a.id === note)).toBe(false);

  // a text size of its own on a page-2 dimension
  ok(await callTool(s, 'drawing_text_size', { item: target.id, size: 4 }));
  expect((await saved()).pages[1]!.dimensions.find((d) => d.id === target.id)?.style?.text).toBe(4);

  // a page-2 dimension deleted (drawing_apply on page 2) comes back once with drawing_complete
  ok(await callTool(s, 'drawing_apply', { pageIndex: 1, commands: [{ type: 'deleteDimensions', dimensionIds: [target.id] }] }));
  expect((await saved()).pages[1]!.dimensions.some((d) => d.id === target.id)).toBe(false);
  expect(text(ok(await callTool(s, 'drawing_complete', {}))).added).toBe(1);
  const doc3 = await saved();
  expect(new Set(allKeys(doc3)).size, allKeys(doc3).join(' ')).toBe(allKeys(doc3).length);
  expect(allKeys(doc3)).toContain(keyOf(target));
  expect(text(ok(await callTool(s, 'drawing_inspect', {}))).report.checks.coverage.complete).toBe(true);
}, 600_000);
