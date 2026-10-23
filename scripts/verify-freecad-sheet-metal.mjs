/**
 * Uses a separately installed FreeCAD command line to read the public sheet-metal
 * STEP fixtures. This is an external-application compatibility probe, not a claim
 * that FreeCAD uses an independent geometry kernel.
 *
 * Required: FREECAD_CMD = absolute path to FreeCADCmd.exe.
 * Optional: FREECAD_ACCEPTANCE_REPORT = absolute path for the JSON result.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const freecad = process.env.FREECAD_CMD;
if (!freecad || !isAbsolute(freecad) || !existsSync(freecad)) {
  throw new Error('Set FREECAD_CMD to the absolute path of a FreeCADCmd executable.');
}

const output = process.env.FREECAD_ACCEPTANCE_REPORT ?? join(root, 'out', 'freecad-sheet-metal-acceptance.json');
if (!isAbsolute(output)) throw new Error('FREECAD_ACCEPTANCE_REPORT must be an absolute path.');

const fixtures = [
  'upper-sheet-metal-enclosure.step',
  'upper-sheet-metal-enclosure-flat-pattern.step',
].map((name) => join(root, 'tests', 'fixtures', 'public-cad', 'osf-sheet-press', name));
const runner = join(root, 'scripts', 'freecad-step-report.py');
const temp = mkdtempSync(join(tmpdir(), '3db-freecad-'));

try {
  const samples = fixtures.map((source) => {
    const temporaryReport = join(temp, `${basename(source)}.json`);
    execFileSync(freecad, [runner], {
      cwd: root,
      env: { ...process.env, FREECAD_STEP_INPUT: source, FREECAD_STEP_REPORT: temporaryReport },
      stdio: 'pipe',
    });
    const facts = JSON.parse(readFileSync(temporaryReport, 'utf8'));
    if (!(facts.solids > 0 && facts.volumeMm3 > 0 && facts.faces > 0)) {
      throw new Error(`FreeCAD did not produce a valid solid for ${basename(source)}.`);
    }
    return {
      file: basename(source),
      sha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
      ...facts,
    };
  });
  const [folded, flat] = samples;
  const relativeVolumeDifference = Math.abs(folded.volumeMm3 - flat.volumeMm3) / folded.volumeMm3;
  if (!(relativeVolumeDifference < 1e-9)) {
    throw new Error(`FreeCAD reports different folded/flat material volumes: ${relativeVolumeDifference}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    scope: 'FreeCAD command-line STEP import facts; FreeCAD also uses OCCT and is not an independent-kernel proof.',
    freecad: folded.reader,
    foldedFlatVolumeRelativeDifference: relativeVolumeDifference,
    samples,
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`FreeCAD acceptance report: ${output}\n`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
