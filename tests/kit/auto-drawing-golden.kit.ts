/**
 * ADR 0256 acceptance on real parts: every golden part of the repository drawn by `drawing_create` as an agent would, with its self-check and a picture of
 * the sheet written to `scratch/auto-drawing/` (or AUTO_DRAWING_OUT). Not part of `npm test` (it writes files). Run:
 *   npx vitest run --config tests/kit/vitest.kit.config.ts auto-drawing-golden
 */
import { afterAll, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CadSession } from '../../apps/mcp/src/session';
import { callTool } from '../../apps/mcp/src/server';

const OUT = process.env.AUTO_DRAWING_OUT ?? 'scratch/auto-drawing';
const GOLDEN = 'tests/golden';
const root = mkdtempSync(join(tmpdir(), 'auto-drawing-'));
const rows: Record<string, unknown>[] = [];
afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(rows, null, 1));
  console.table(rows);
  rmSync(root, { recursive: true, force: true });
});

it('draws every golden part and reports what is determined and how clean the sheet is', async () => {
  const files = readdirSync(GOLDEN).filter((f) => f.endsWith('.3dbx'));
  expect(files.length).toBeGreaterThan(0);
  const s = await CadSession.create({ root, locale: 'zh-TW' });
  try {
    for (const f of files) {
      copyFileSync(join(GOLDEN, f), join(root, f));
      const t0 = Date.now();
      const row: Record<string, unknown> = { part: f };
      try {
        await s.open(f);
        if (!s.drawingSource()) {
          row.result = 'no body';
          rows.push(row);
          continue;
        }
        const r = await callTool(s, 'drawing_create', {});
        const textPart = r.content.find((c) => c.type === 'text') as { text: string };
        if (r.isError) {
          row.result = `refused: ${textPart.text.slice(0, 160)}`;
        } else {
          const d = JSON.parse(textPart.text).drawing;
          const c = d.checks;
          Object.assign(row, {
            result: 'made',
            sheet: `${d.sheet.size} ${d.sheet.scale}`,
            views: d.views.map((v: { kind: string; direction?: string }) => (v.kind === 'model' ? v.direction : v.kind)).join(','),
            dims: d.dimensions,
            complete: c.coverage.complete,
            placesMissing: c.coverage.ways.reduce((n: number, w: { missing: unknown[] }) => n + w.missing.length, 0),
            roundsMissing: c.coverage.rounds.missing.length,
            slantsMissing: c.coverage.slants.missing.length,
            clutter: c.clutter.count,
            glyphsMissing: c.glyphs.missing.length,
            textOut: c.text.outOfRange.length,
            failed: c.failed.length,
            outside: c.outside,
          });
          const img = r.content.find((x) => x.type === 'image') as { data: string } | undefined;
          if (img) {
            mkdirSync(OUT, { recursive: true });
            writeFileSync(join(OUT, f.replace(/\.3dbx$/, '.png')), Buffer.from(img.data, 'base64'));
          }
        }
      } catch (e) {
        row.result = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
      }
      row.seconds = Math.round((Date.now() - t0) / 100) / 10;
      rows.push(row);
    }
  } finally {
    s.dispose();
  }
}, 3_600_000);
