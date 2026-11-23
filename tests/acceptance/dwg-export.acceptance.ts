import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildScene, dxfUnescape, importCadDxf, readDxf, toDxf } from '@3db/drawing';
import { applyDrawingCommand, parseDrawing, serializeDrawing } from '@3db/model';
import { plateScene } from '../support/outputScene';
import { dwgConverter, dxfToDwg, dwgToDxf } from '../../apps/mcp/src/dwg';

it('converts the real dimensioned plate to binary DWG and reads its geometry, layers and Chinese back with LibreDWG', async () => {
  const out = resolve('out/dwg-acceptance');
  mkdirSync(out, { recursive: true });
  const scene = (await plateScene()).scene;
  scene.items = scene.items.map((item, i) => ({ ...item, color: i % 2 ? '#DC2626' : '#2563EB' }));
  const input = toDxf(scene);
  writeFileSync(join(out, 'plate.dxf'), input);
  const dwg = await dxfToDwg(input);
  writeFileSync(join(out, 'plate.dwg'), dwg);
  expect(Buffer.from(dwg.subarray(0, 6)).toString()).toBe('AC1032');
  const engine = await dwgConverter();
  const reader = join(dirname(engine), process.platform === 'win32' ? 'dwg2dxf.exe' : 'dwg2dxf');
  execFileSync(reader, ['-y', '-o', join(out, 'plate-roundtrip.dxf'), join(out, 'plate.dwg')], { windowsHide: true, stdio: 'pipe' });
  const backText = readFileSync(join(out, 'plate-roundtrip.dxf'), 'utf8');
  const original = readDxf(input), back = readDxf(backText);
  expect(back.entities.length).toBe(original.entities.length);
  expect(back.entities.filter((e) => e.type === 'DIMENSION').length).toBeGreaterThan(0);
  expect(back.entities.filter((e) => e.type === 'DIMENSION').length).toBe(original.entities.filter((e) => e.type === 'DIMENSION').length);
  expect(dxfUnescape(backText)).toContain('定位板');
  const all = [...back.entities, ...[...back.blockEntities.values()].flat()];
  for (const rgb of [0xDC2626, 0x2563EB]) expect(all.some((e) => e.pairs.some(([c, v]) => c === 420 && Number(v) === rgb))).toBe(true);
  for (const layer of ['VISIBLE', 'HIDDEN', 'CENTER', 'FRAME', 'DIMENSION', 'TEXT']) {
    expect(back.tables.get('LAYER')!.entries.some((e) => e.name === layer), layer).toBe(true);
  }
  const imported = importCadDxf(await dwgToDxf(dwg), 'plate.dwg');
  const cad = imported.doc.pages[0]!.cad!;
  expect(cad.entities.filter((e) => e.kind === 'dimension').length).toBe(scene.dimensions!.length);
  expect(cad.entities.some((e) => e.kind === 'text' && e.text === '定位板')).toBe(true);
  const label = cad.entities.find((e) => e.kind === 'text' && e.text === '定位板')!;
  if (label.kind !== 'text') throw new Error('missing editable text');
  const edited = applyDrawingCommand(imported.doc, { type: 'setCadEntity', entity: { ...label, text: '修改後的定位板', color: '#12AB34' } });
  const reopened = parseDrawing(serializeDrawing(edited));
  const output = toDxf(buildScene(reopened, new Map(), new Map()).scene);
  const editedDwg = await dxfToDwg(output);
  const editedBack = await dwgToDxf(editedDwg);
  expect(dxfUnescape(editedBack)).toContain('修改後的定位板');
  expect(readDxf(editedBack).entities.some((e) => e.pairs.some(([c, v]) => c === 420 && Number(v) === 0x12AB34))).toBe(true);
  writeFileSync(join(out, 'plate-edited.dwg'), editedDwg);
  writeFileSync(join(out, 'plate-edited.3dbd'), serializeDrawing(reopened));
});
