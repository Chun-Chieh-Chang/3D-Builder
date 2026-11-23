import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import { PLATE_WITH_HOLE } from '../src/examples';
import { loadControlledAttachment } from '../src/controlledAttachment';

let s: CadSession;
const root = mkdtempSync(join(tmpdir(), 'drawing-quality-gate-'));

beforeAll(async () => {
  s = await CadSession.create({ root, locale: 'zh-TW' });
});
afterAll(() => {
  s?.dispose();
  rmSync(root, { recursive: true, force: true });
});

const text = (r: Awaited<ReturnType<typeof callTool>>) =>
  JSON.parse((r.content.find((c) => c.type === 'text') as { text: string }).text);

it('reports draft & stamps PRELIMINARY when generalTolerance is blank, refuses release export, and allows release once generalTolerance is set (ADR 0263, rules Q1/C5/C7)', async () => {
  const built = await s.apply(PLATE_WITH_HOLE);
  expect(built.committed, JSON.stringify(built.error)).toBe(true);
  await callTool(s, 'part_save', { path: 'plate.3dbx' });

  // 1. Created without generalTolerance -> draft (C5 fails even though coverage.complete is true: Q2)
  const created = text(await callTool(s, 'drawing_create', { title: { material: 'S45C' }, picture: false }));
  expect(created.drawing.checks.coverage.complete).toBe(true);
  expect(created.drawing.checks.quality.status).toBe('draft');
  expect(created.drawing.checks.quality.pass).toBe(false);
  expect(created.drawing.checks.quality.failed.map((f: { rule: string }) => f.rule)).toContain('C5');

  // 2. drawing_inspect exposes the same quality gate
  const inspDraft = text(await callTool(s, 'drawing_inspect', {}));
  expect(inspDraft.quality.status).toBe('draft');
  expect(inspDraft.quality.failed.map((f: { rule: string }) => f.rule)).toContain('C5');

  // 3. Release export is refused and writes NO file
  const refused = await callTool(s, 'drawing_export', { path: 'refused.svg', format: 'svg', release: true });
  expect(refused.isError).toBe(true);
  expect((refused.content[0] as { text: string }).text).toContain('C5');
  expect(existsSync(join(root, 'refused.svg'))).toBe(false);

  // 4. Draft export succeeds, reports draft/preliminary, and stamps PRELIMINARY into SVG and DXF
  const draftSvg = text(await callTool(s, 'drawing_export', { path: 'draft.svg', format: 'svg' }));
  expect(draftSvg.status).toBe('draft');
  expect(draftSvg.preliminary).toBe(true);
  expect(draftSvg.failed.map((f: { rule: string }) => f.rule)).toContain('C5');
  expect(readFileSync(join(root, 'draft.svg'), 'utf8')).toContain('PRELIMINARY');

  const draftDxf = text(await callTool(s, 'drawing_export', { path: 'draft.dxf', format: 'dxf' }));
  expect(draftDxf.status).toBe('draft');
  expect(draftDxf.preliminary).toBe(true);
  expect(readFileSync(join(root, 'draft.dxf'), 'utf8')).toContain('PRELIMINARY');

  // 5. Fill generalTolerance in title block -> all rules pass -> release export succeeds with NO PRELIMINARY stamp
  const applied = text(
    await callTool(s, 'drawing_apply', {
      commands: [{ type: 'setTitle', field: 'generalTolerance', value: 'ISO 2768-mK' }],
      picture: false,
    }),
  );
  expect(applied.drawing.checks.quality.status, JSON.stringify(applied.drawing.checks.quality.failed)).toBe('release');
  expect(applied.drawing.checks.quality.pass).toBe(true);
  expect(applied.drawing.checks.quality.failed).toEqual([]);

  const relSvg = text(await callTool(s, 'drawing_export', { path: 'release.svg', format: 'svg', release: true }));
  expect(relSvg.status).toBe('release');
  expect(relSvg.preliminary).toBe(false);
  expect(relSvg.failed).toEqual([]);
  expect(readFileSync(join(root, 'release.svg'), 'utf8')).not.toContain('PRELIMINARY');
});

it('loadControlledAttachment verifies manifest, member SHA-256, STEP blob SHA-256, and rejects tampering or traversal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'controlled-att-'));
  try {
    const drawingPath = join(dir, 'part-review.3dbd');
    const attDir = join(dir, 'DOC-GEO-01');
    mkdirSync(attDir, { recursive: true });
    const stepSha = '1'.repeat(64);
    const faceIndexBody = JSON.stringify([{ drawing_face_ref: 'import1:f203', step_face: 27739, surface: 1557, family: 'plane' }]);
    const faceIndexSha = createHash('sha256').update(faceIndexBody).digest('hex');
    writeFileSync(join(attDir, 'drawing-face-index.json'), faceIndexBody);
    const manifest = {
      document: 'DOC-GEO-01',
      revision: '01',
      source: 'part.3dbx',
      original_step_sha256: stepSha,
      regenerated_step_sha256: stepSha,
      members_sha256: { 'drawing-face-index.json': faceIndexSha },
    };
    writeFileSync(join(attDir, 'manifest.json'), JSON.stringify(manifest));

    // 1. Valid attachment + matching part STEP blob -> integrityOk: true
    const ok = loadControlledAttachment(drawingPath, { document: 'DOC-GEO-01', revision: '01' }, [stepSha]);
    expect(ok).not.toBeNull();
    expect(ok!.integrityOk, JSON.stringify(ok!.integrityErrors)).toBe(true);
    expect((ok!.faceIndex as Map<string, number>).get('import1:f203')).toBe(27739);

    // 2. Mismatched part STEP blob SHA-256 -> integrityOk: false
    const wrongPart = loadControlledAttachment(drawingPath, { document: 'DOC-GEO-01', revision: '01' }, ['2'.repeat(64)]);
    expect(wrongPart!.integrityOk).toBe(false);
    expect(wrongPart!.integrityErrors!.join(' ')).toContain('does not match loaded part STEP blob');

    // 3. Path traversal document name -> integrityOk: false
    const traversal = loadControlledAttachment(drawingPath, { document: '../escape', revision: '01' }, [stepSha]);
    expect(traversal!.integrityOk).toBe(false);
    expect(traversal!.integrityErrors!.join(' ')).toContain('unsafe');

    // 4. Tampered drawing-face-index.json (1 byte changed) -> integrityOk: false
    writeFileSync(join(attDir, 'drawing-face-index.json'), faceIndexBody + ' ');
    const tampered = loadControlledAttachment(drawingPath, { document: 'DOC-GEO-01', revision: '01' }, [stepSha]);
    expect(tampered!.integrityOk).toBe(false);
    expect(tampered!.integrityErrors!.join(' ')).toContain('SHA-256 mismatch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
