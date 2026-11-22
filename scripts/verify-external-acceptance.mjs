import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.EXTERNAL_ACCEPTANCE_REPORT ?? join(root, 'out', 'external-acceptance.json');
if (!isAbsolute(output)) throw new Error('EXTERNAL_ACCEPTANCE_REPORT must be an absolute path.');

const temp = mkdtempSync(join(tmpdir(), '3db-external-acceptance-'));
const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');

function collect(args, reportVariable, options = {}) {
  const report = join(temp, `${reportVariable}.json`);
  execFileSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...options, [reportVariable]: report },
    stdio: 'inherit',
  });
  return JSON.parse(readFileSync(report, 'utf8'));
}

try {
  const sheetMetal = collect(['scripts/verify-freecad-sheet-metal.mjs'], 'FREECAD_ACCEPTANCE_REPORT');
  const step = collect([vitest, 'run', 'tests/phase7/public-sheet-metal-acceptance.test.ts'], 'SHEET_METAL_ACCEPTANCE_REPORT');
  const drawing = collect(['scripts/verify-drawing-export.mjs'], 'DRAWING_ACCEPTANCE_REPORT', { PARTS_OUT: join(temp, 'parts') });
  if (!drawing.chromiumPdf?.results.length) throw new Error('Set CHROME_PATH to a Chromium executable to collect PDF rendering evidence.');

  mkdirSync(dirname(output), { recursive: true });
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), step, sheetMetal, drawing };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`External acceptance report: ${output}\n`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
