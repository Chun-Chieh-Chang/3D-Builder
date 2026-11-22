import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { page } from '@3db/model';
import { readDxf, readPdf, type DxfPolyline, type DxfText } from '@3db/drawing';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import { drawingOf } from '../src/drawingTools';

describe('revision triangle end-to-end acceptance (place, edit, undo, reopen, PDF/DXF)', () => {
  it('places, edits, undoes, saves, reopens, and exports revision triangles to PDF and DXF', async () => {
    const dir = mkdtempSync(join(tmpdir(), '3db-rev-tri-'));
    try {
      const sampleBytes = readFileSync(resolve(process.cwd(), 'tests/golden/locating-plate.3dbx'));
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(dir, 'plate.3dbx'), sampleBytes);

      const s1 = await CadSession.create({ root: dir, locale: 'zh-TW' });
      let placedId = '';
      try {
        expect((await callTool(s1, 'part_open', { path: 'plate.3dbx' })).isError).toBeFalsy();
        expect((await callTool(s1, 'drawing_create', { path: 'plate-rev.3dbd', picture: false })).isError).toBeFalsy();

        // Record revision B in drawing revision history
        const revRes = await callTool(s1, 'drawing_apply', {
          commands: [
            { type: 'saveRevision', entry: { revision: 'B', date: '2026-11-22', description: '孔位公差修訂', author: 'QA' } },
          ],
          picture: false,
        });
        expect(revRes.isError, JSON.stringify(revRes.content)).toBeFalsy();

        // 1. Place revision triangle (defaults to current revision 'B')
        const annRes = await callTool(s1, 'drawing_annotate', { kind: 'revision', picture: false });
        expect(annRes.isError, JSON.stringify(annRes.content)).toBeFalsy();
        placedId = JSON.parse((annRes.content[0] as { text: string }).text).added;
        const d1 = drawingOf(s1);
        const initial = page(d1.doc!).annotations.find((a) => a.id === placedId);
        expect(initial).toMatchObject({ kind: 'revision', revision: 'B' });

        // 2. Edit revision label and position
        const editRes = await callTool(s1, 'drawing_apply', {
          commands: [{ type: 'setAnnotation', annotationId: placedId, patch: { revision: 'C', at: [25, 18] } }],
          picture: false,
        });
        expect(editRes.isError, JSON.stringify(editRes.content)).toBeFalsy();
        expect(page(d1.doc!).annotations.find((a) => a.id === placedId)).toMatchObject({ revision: 'C', at: [25, 18] });

        // 3. Undo restores revision 'B' and original position
        const undoRes = await callTool(s1, 'drawing_undo', { picture: false });
        expect(undoRes.isError, JSON.stringify(undoRes.content)).toBeFalsy();
        expect(page(d1.doc!).annotations.find((a) => a.id === placedId)).toMatchObject({
          revision: 'B',
          at: (initial as { at: [number, number] }).at,
        });

        // 4. Re-apply final position + revision 'B' and save
        const finalRes = await callTool(s1, 'drawing_apply', {
          commands: [{ type: 'setAnnotation', annotationId: placedId, patch: { revision: 'B', at: [22, 16] } }],
          picture: false,
        });
        expect(finalRes.isError, JSON.stringify(finalRes.content)).toBeFalsy();
        expect((await callTool(s1, 'drawing_save', { path: 'plate-rev.3dbd' })).isError).toBeFalsy();
      } finally {
        s1.dispose();
      }

      // 5. Reopen in a fresh session and verify exact position, revision, PDF and DXF exports
      const s2 = await CadSession.create({ root: dir, locale: 'zh-TW' });
      try {
        expect((await callTool(s2, 'drawing_open', { path: 'plate-rev.3dbd' })).isError).toBeFalsy();
        const d2 = drawingOf(s2);
        const reopened = page(d2.doc!).annotations.find((a) => a.id === placedId);
        expect(reopened).toMatchObject({ id: placedId, kind: 'revision', revision: 'B', at: [22, 16] });

        expect((await callTool(s2, 'drawing_export', { format: 'pdf', path: 'plate-rev.pdf' })).isError).toBeFalsy();
        expect((await callTool(s2, 'drawing_export', { format: 'dxf', path: 'plate-rev.dxf' })).isError).toBeFalsy();

        const pdf = readPdf(new Uint8Array(readFileSync(join(dir, 'plate-rev.pdf'))));
        expect(pdf.problems).toEqual([]);
        expect(pdf.pages[0]!.texts.some((t) => t.text === 'B')).toBe(true);

        const dxf = readDxf(readFileSync(join(dir, 'plate-rev.dxf'), 'utf8'));
        expect(dxf.entities.some((e): e is DxfPolyline => e.type === 'LWPOLYLINE' && (e as DxfPolyline).closed && (e as DxfPolyline).points.length === 6)).toBe(true);
        expect(dxf.entities.some((e): e is DxfText => e.type === 'TEXT' && (e as DxfText).text === 'B')).toBe(true);
      } finally {
        s2.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
