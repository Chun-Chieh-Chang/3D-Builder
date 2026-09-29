import { describe, expect, it } from 'vitest';
import { applyAssemblyCommand, createDemoPart, createEmptyAssembly, FormatError, IDENTITY_ROTATION, serializeAssembly, serializePart, type AssemblyDoc } from '@3db/model';
import { assemblyFileName, assemblyName, componentName, readDocumentFile, readPartFile, readZip, writeAssemblyFile, writePartFile } from '../src';

function jig(): AssemblyDoc {
  const placement = { position: [0, 0, 0] as [number, number, number], rotation: [...IDENTITY_ROTATION] as [number, number, number, number] };
  let doc = applyAssemblyCommand(createEmptyAssembly(), {
    type: 'insertComponent',
    file: { id: 'file1', path: '定位板.3dbx' },
    component: { id: 'comp1', file: 'file1', instance: 1, fixed: true, placement },
  });
  doc = applyAssemblyCommand(doc, {
    type: 'insertComponent',
    file: { id: 'file2', path: '零件/削邊銷.3dbx' },
    component: { id: 'comp2', file: 'file2', instance: 1, fixed: false, placement: { ...placement, position: [30, 20, 15] } },
  });
  return doc;
}

describe('assembly file .3dba', () => {
  it('holds only the document, and writes the same bytes for the same document', async () => {
    const doc = jig();
    const bytes = await writeAssemblyFile(doc);
    expect(bytes).toEqual(await writeAssemblyFile(jig()));
    const entries = await readZip(bytes);
    expect(entries.map((e) => e.name)).toEqual(['document.json']);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe(serializeAssembly(doc));
  });

  it('opens parts and assemblies alike, told apart by content', async () => {
    const asm = await readDocumentFile(await writeAssemblyFile(jig()));
    expect(asm.kind).toBe('assembly');
    expect(asm.doc).toEqual(jig());
    const part = await readDocumentFile(await writePartFile(createDemoPart()));
    expect(part).toMatchObject({ kind: 'part', format: '3dbx', warnings: [] });
    expect(part.doc).toEqual(createDemoPart());
    const old = await readDocumentFile(new TextEncoder().encode(serializePart(createDemoPart())));
    expect(old).toMatchObject({ kind: 'part', format: 'json' });
  });

  it('is not a part', async () => {
    await expect(readPartFile(await writeAssemblyFile(jig()))).rejects.toThrow(/不是零件文件/);
    await expect(readDocumentFile(Uint8Array.from([0xff, 0xfe, 0x00, 0x81]))).rejects.toThrow(FormatError);
  });
});

describe('assembly and component names', () => {
  it('names an assembly after its file, or 組合件N', () => {
    expect(assemblyName('夾具.3dba')).toBe('夾具');
    expect(assemblyName('夾具.3DBA')).toBe('夾具');
    expect(assemblyName(null)).toBe('組合件1');
    expect(assemblyName(null, '組合件2')).toBe('組合件2');
    expect(assemblyFileName('夾具/A')).toBe('夾具_A.3dba');
  });

  it('names a component after its part file and instance, as SolidWorks does', () => {
    expect(componentName('零件/削邊銷.3dbx', 2)).toBe('削邊銷<2>');
    expect(componentName('../定位板.3dbx', 1)).toBe('定位板<1>');
    expect(componentName(undefined, 1)).toBe('?<1>');
  });
});
