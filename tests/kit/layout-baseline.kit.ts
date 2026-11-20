/**
 * ADR 0261 baseline (temporary, not committed): each part drawn by drawing_create as an agent would, then measured with `layoutMetrics` page by page. The numbers go
 * to scratch/layout-baseline.json (or LAYOUT_BASELINE_OUT) and a table is printed. Run:
 *   npx vitest run --config tests/kit/vitest.kit.config.ts layout-baseline
 * LAYOUT_BASELINE_EXTRA names more .3dbx files (a path each, separated by ;) to measure beside the golden parts.
 */
import { expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { page } from '@3db/model';
import { layoutMetrics, sheetItems, sheetMetrics } from '@3db/drawing';
import { CadSession } from '../../apps/mcp/src/session';
import { callTool } from '../../apps/mcp/src/server';
import { drawingOf } from '../../apps/mcp/src/drawingTools';

const OUT = process.env.LAYOUT_BASELINE_OUT ?? 'scratch/layout-baseline.json';
const extra = (process.env.LAYOUT_BASELINE_EXTRA ?? '').split(';').filter(Boolean);
const only = process.env.LAYOUT_BASELINE_ONLY ? new RegExp(process.env.LAYOUT_BASELINE_ONLY) : null;

it('measures the layout of every part', async () => {
  const root = mkdtempSync(join(tmpdir(), 'layout-baseline-'));
  const files = readdirSync('tests/golden').filter((f) => f.endsWith('.3dbx')).map((f) => ['tests/golden/' + f, f] as const);
  for (const e of extra) files.push([e, basename(e)] as const);
  if (only) files.splice(0, files.length, ...files.filter(([, f]) => only.test(f)));
  const rows: Record<string, unknown>[] = [];
  const s = await CadSession.create({ root, locale: 'zh-TW' });
  try {
    for (const [src, f] of files) {
      copyFileSync(src, join(root, f));
      await s.open(f);
      if (!s.drawingSource()) continue;
      const t0 = Date.now();
      const r = await callTool(s, 'drawing_create', {});
      if (r.isError) {
        rows.push({ part: f, error: (r.content[0] as { text: string }).text.slice(0, 200) });
        continue;
      }
      const d = drawingOf(s);
      const doc = d.doc!;
      for (let pi = 0; pi < doc.pages.length; pi++) {
        const pg = page(doc, pi);
        const single = pi === 0 && doc.pages.length === 1 ? doc : { ...doc, pages: [pg] };
        const b = d.build(doc, pi);
        const items = b.scene.items.slice(sheetItems(single).length);
        const area = sheetMetrics(pg.sheet).area;
        const m = layoutMetrics({ items, views: pg.views, placed: b.placed, dimensionView: new Map(pg.dimensions.map((x) => [x.id, x.view])), area });
        rows.push({
          part: f,
          page: pi + 1,
          sheet: `${pg.sheet.size} ${pg.sheet.scale[0]}:${pg.sheet.scale[1]}`,
          views: pg.views.map((v) => `${v.id}:${v.kind ?? 'model'}`).join(' '),
          fillW: m.fillW,
          fillH: m.fillH,
          viewAreaFill: m.viewAreaFill,
          minClearance: m.minClearance,
          clearances: m.clearances.slice(0, 4).map((c) => `${c.a}-${c.b} ${c.axis} ${c.gap}`),
          details: m.details.map((x) => `${x.id}<-${x.parent} dist ${x.distance}/${x.parentDiagonal} blocked ${x.blocked} ink ${x.inkRatio}`),
          nonStandardScales: m.nonStandardScales.map((x) => `${x.id} ${x.scale}`),
          reach: m.views.map((v) => `${v.id} L${Math.round(v.reach.left)} R${Math.round(v.reach.right)} B${Math.round(v.reach.below)} T${Math.round(v.reach.above)}`),
          seconds: Math.round((Date.now() - t0) / 100) / 10,
        });
      }
    }
  } finally {
    s.dispose();
    rmSync(root, { recursive: true, force: true });
  }
  mkdirSync('scratch', { recursive: true });
  writeFileSync(OUT, JSON.stringify(rows, null, 1));
  console.table(rows.map(({ part, page: p, sheet, fillW, fillH, viewAreaFill, minClearance, nonStandardScales }) => ({ part, page: p, sheet, fillW, fillH, viewAreaFill, minClearance, nonStandardScales: String(nonStandardScales) })));
  expect(rows.length).toBeGreaterThan(0);
}, 3_600_000);
