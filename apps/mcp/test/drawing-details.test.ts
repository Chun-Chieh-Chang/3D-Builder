import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from '@3db/model';
import { applyDrawingCommand, page } from '@3db/model';
import { MIN_DETAIL_INK } from '@3db/drawing';
import { CadSession } from '../src/session';
import { drawingOf } from '../src/drawingTools';
import { callTool } from '../src/server';

/**
 * ADR 0261, drawing rules V4, V6 and P4: the detail views of a drawing. A plate with four micro radii makes drawing_create add page 2 with detail views; each one
 * is drawn at a standard scale (ISO 5455), has something in it, is beside the view it enlarges with no other view between them, and keeps clear of the others.
 */
let s: CadSession;
const root = mkdtempSync(join(tmpdir(), 'drawing-details-'));
beforeAll(async () => {
  s = await CadSession.create({ root, locale: 'en' });
});
afterAll(() => {
  s?.dispose();
  rmSync(root, { recursive: true, force: true });
});

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


it('every detail view is at a standard scale, has something in it, is beside its parent and clear of the other views', async () => {
  const built = await s.apply(PLATE);
  expect(built.committed, JSON.stringify(built.error)).toBe(true);
  await s.save('micro.3dbx');
  const r = await callTool(s, 'drawing_create', {});
  expect(r.isError, JSON.stringify(r.content[0]).slice(0, 500)).toBeFalsy();
  const d = drawingOf(s);
  const doc = d.doc!;
  expect(doc.pages.length).toBe(2);
  const m = d.layout(doc, 1);
  expect(m.details.length, 'the plate has details on page 2').toBeGreaterThan(0);
  expect(m.nonStandardScales, 'standard scales only (ISO 5455)').toEqual([]);
  for (const x of m.details) {
    expect(x.inkRatio, `${x.id} has something in it`).toBeGreaterThanOrEqual(MIN_DETAIL_INK);
    expect(x.blocked, `${x.id} has a view between it and ${x.parent}`).toBe(false);
    expect(x.distance, `${x.id} is ${x.distance} mm from ${x.parent}`).toBeLessThanOrEqual(x.parentDiagonal);
  }
  const need = 2 * (page(doc, 1).sheet.dimStyle?.text ?? 3.5);
  expect(m.minClearance === null || m.minClearance >= need, `page 2: the nearest two views are ${m.minClearance} mm apart, need ${need}`).toBe(true);
  // every dimension is still on a page: detail views that were not made gave theirs back
  const keys = doc.pages.flatMap((p) => p.dimensions.map((x) => x.id));
  expect(new Set(keys).size).toBe(keys.length);
  expect(d.checks(doc).coverage.complete).toBe(true);
}, 300_000);

it('a detail with nothing in it is not kept, and the details left are lettered with no gap', async () => {
  const d = drawingOf(s);
  const doc = d.doc!;
  const pg = page(doc, 1);
  const details = pg.views.filter((v) => v.kind === 'detail');
  expect(details.length).toBeGreaterThan(1); // the plate has two: the first is emptied, so the second has to move up a letter
  const first = details[0]!;
  // the first detail looks at a place 500 mm from the part: its circle holds no line
  const moved = applyDrawingCommand({ ...doc, pages: [pg] }, { type: 'setView', viewId: first.id, patch: { centre: [-500, -500] } });
  const withEmpty = { ...doc, pages: doc.pages.map((p, i) => (i === 1 ? moved.pages[0]! : p)) };
  expect(d.layout(withEmpty, 1).details.find((x) => x.id === first.id)!.inkRatio, 'the detail over nothing is empty').toBe(0);
  const kept = (d as unknown as { dropEmptyDetails(doc: typeof withEmpty, pageIndex: number): typeof withEmpty }).dropEmptyDetails(withEmpty, 1);
  const left = page(kept, 1).views.filter((v) => v.kind === 'detail');
  expect(left.map((v) => v.id)).not.toContain(first.id);
  expect(left.length).toBe(details.length - 1);
  expect(left.map((v) => (v.kind === 'detail' ? v.label : ''))).toEqual(['C', 'D', 'E', 'F', 'G', 'H'].slice(0, left.length));
  expect(left.map((v) => v.name)).toEqual(left.map((v) => `Detail ${v.kind === 'detail' ? v.label : ''}`));
}, 300_000);
