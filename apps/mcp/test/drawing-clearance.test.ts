import { afterAll, beforeAll, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { page } from '@3db/model';
import { clutterOf, minViewClearance, sheetItems } from '@3db/drawing';
import { CadSession } from '../src/session';
import { drawingOf } from '../src/drawingTools';
import { callTool } from '../src/server';

/**
 * ADR 0261, drawing rule V1: views drawn by drawing_create are far enough apart for the dimensions between them. The clear space between two views is measured
 * between the box round each view and everything drawn for it (its dimensions, its caption), so a row of numbers that runs into the next view is seen. It must
 * be at least twice the height of the dimension text, on every page of every golden part. Before this ADR the layout slid views only to lower a clutter score, and
 * diamond-pin came out 0.06 mm short of touching and page 2 of sds-plus-bit 19 mm overlapped.
 */
const root = mkdtempSync(join(tmpdir(), 'drawing-clearance-'));
let s: CadSession;
beforeAll(async () => {
  s = await CadSession.create({ root, locale: 'en' });
});
afterAll(() => {
  s?.dispose();
  rmSync(root, { recursive: true, force: true });
});

// sds-plus-bit takes about 200 s to draw: it is measured by the acceptance kit (tests/kit/layout-baseline.kit.ts), not here
const parts = readdirSync('tests/golden').filter((f) => f.endsWith('.3dbx') && !f.startsWith('sds-plus-bit'));

it('there are golden parts to draw', () => {
  expect(parts.length).toBeGreaterThanOrEqual(3);
});

it.each(parts)('%s: every page keeps its views apart by at least twice the dimension text', async (part) => {
  copyFileSync(join('tests/golden', part), join(root, part));
  await s.open(part);
  if (!s.drawingSource()) return;
  const r = await callTool(s, 'drawing_create', {});
  expect(r.isError, JSON.stringify(r.content[0]).slice(0, 500)).toBeFalsy();
  const d = drawingOf(s);
  const doc = d.doc!;
  for (let pi = 0; pi < doc.pages.length; pi++) {
    const pg = page(doc, pi);
    const need = minViewClearance(pg.sheet.dimStyle?.text ?? 3.5);
    const m = d.layout(doc, pi);
    const worst = m.clearances[0];
    expect(m.minClearance === null || m.minClearance >= need, `page ${pi + 1}: ${worst ? `${worst.a} and ${worst.b} are ${worst.gap} mm apart (${worst.axis})` : ''}, need ${need}`).toBe(true);
    // rule 2-7: no view caption is over another text or crossed by a line that is not its own
    const single = pi === 0 && doc.pages.length === 1 ? doc : { ...doc, pages: [pg] };
    const built = d.build(doc, pi);
    const captions = new Set(built.scene.items.flatMap((i) => (i.kind === 'text' && i.viewCaption ? [i.text] : [])));
    const items = built.scene.items.slice(sheetItems(single).length);
    const hit = clutterOf(items, -0.6, new Map(pg.dimensions.map((x) => [x.id, x.view]))).texts.filter((t) => captions.has(t));
    expect(hit, `page ${pi + 1}: captions in the way of something`).toEqual([]);
  }
  const inspect = d.inspect() as { layout: { pass: boolean; mainView: { pass: boolean }; multiPage: { pass: boolean } } };
  expect(inspect.layout.mainView.pass, `${part}: rule 2-8 main view`).toBe(true);
  expect(inspect.layout.multiPage.pass, `${part}: rule 2-6 multiPage`).toBe(true);
  expect(inspect.layout.pass, `${part}: layout pass`).toBe(true);
}, 600_000);
