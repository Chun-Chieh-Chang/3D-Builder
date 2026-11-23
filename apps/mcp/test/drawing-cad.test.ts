import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readDxf, toDxf } from '@3db/drawing';
import { readAnyDocumentFile } from '@3db/io';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';

it('imports detached CAD, edits through MCP, saves/reopens .3dbd and exports editable DXF without requiring a 3D part', async () => {
  const root = await mkdtemp(join(tmpdir(), '3db-cad-mcp-'));
  const session = await CadSession.create({ root, locale: 'en' });
  const call = async (name: string, args: object) => {
    const result = await callTool(session, name, args);
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    return JSON.parse((result.content.find((c) => c.type === 'text') as { text: string }).text);
  };
  try {
    await writeFile(join(root, 'input.dxf'), toDxf({ width: 100, height: 100, items: [
      { kind: 'text', at: [10, 20], height: 4, text: '原圖', color: '#DC2626' },
      { kind: 'polyline', style: 'visible', points: [0, 0, 50, 30] },
    ] }));
    const opened = await call('drawing_open', { path: 'input.dxf' });
    expect(opened.drawing.imported2D).toBe(true);
    const entity = opened.drawing.pages[0].cad.entities.find((e: { kind: string }) => e.kind === 'text');
    await call('drawing_apply', { commands: [{ type: 'setCadEntity', entity: { ...entity, text: '已修改', color: '#12AB34' } }], picture: false });
    await call('drawing_save', { path: 'edited.3dbd' });
    const saved = await readAnyDocumentFile(new Uint8Array(await readFile(join(root, 'edited.3dbd'))));
    expect(saved.kind).toBe('drawing');
    await call('drawing_open', { path: 'edited.3dbd' });
    const inspected = await call('drawing_inspect', {});
    expect(JSON.stringify(inspected)).toContain('已修改');
    await call('drawing_export', { path: 'edited.dxf', format: 'dxf' });
    const output = readDxf(await readFile(join(root, 'edited.dxf'), 'utf8'));
    expect(output.entities.some((e) => e.type === 'TEXT' && 'text' in e && e.text === '已修改' && e.pairs.some(([c, v]) => c === 420 && Number(v) === 0x12AB34))).toBe(true);
    const refused = await callTool(session, 'drawing_export', { path: 'release.dwg', format: 'dwg', release: true });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('certification');
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});
