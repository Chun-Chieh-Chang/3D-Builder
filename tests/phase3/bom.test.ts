/**
 * 3b-4a: the parts list (C15.16). Counted from what the assembly is made of: sub-assemblies expanded, the instances of patterns and mirrors counted, suppressed
 * components left out and hidden ones in; vendor and part number read from the part files' properties; as CSV it reads back unchanged.
 */
import { describe, expect, it } from 'vitest';
import { applyAssemblyCommand, buildBom, createEmptyAssembly, type AssemblyDoc, type ComponentPattern, type Pose, type SourceTree } from '@3db/model';
import { bomCsv, bomFileName } from '@3db/io';

const at: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const comp = (id: string, file: string, instance: number) => ({ id, file, instance, fixed: false, placement: at });

/** 定位組: 定位板 and two 削邊銷. */
function pinsDoc(): AssemblyDoc {
  let d = createEmptyAssembly();
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file1', path: '../定位板.3dbx' }, component: comp('p1', 'file1', 1) });
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file2', path: '../零件/削邊銷.3dbx' }, component: comp('pa', 'file2', 1) });
  d = applyAssemblyCommand(d, { type: 'insertComponent', component: comp('pb', 'file2', 2) });
  return { ...d, properties: { 說明: '定位組' } };
}

/** 夾具: 定位組 three times, a free 削邊銷, an 螺絲 that is suppressed and a 墊片 that is hidden. */
function jig(extra: ComponentPattern[] = []): AssemblyDoc {
  let d = createEmptyAssembly();
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file1', path: '組件/定位組.3dba' }, component: comp('s0', 'file1', 1) });
  d = applyAssemblyCommand(d, { type: 'insertComponent', component: comp('s1', 'file1', 2) });
  d = applyAssemblyCommand(d, { type: 'insertComponent', component: comp('s2', 'file1', 3) });
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file2', path: '零件/削邊銷.3dbx' }, component: comp('x1', 'file2', 1) });
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file3', path: '零件/螺絲.3dbx' }, component: comp('v1', 'file3', 1) });
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file4', path: '零件/墊片.3dbx' }, component: comp('w1', 'file4', 1) });
  d = applyAssemblyCommand(d, { type: 'setComponentState', componentIds: ['v1'], state: 'suppressed', value: true });
  d = applyAssemblyCommand(d, { type: 'setComponentState', componentIds: ['w1'], state: 'hidden', value: true });
  for (const p of extra) d = applyAssemblyCommand(d, { type: 'insertPattern', pattern: p });
  return d;
}

const part = (key: string, path: string): SourceTree => ({ kind: 'part', key, path });
const trees = (): Record<string, SourceTree> => {
  const sub: SourceTree = { kind: 'assembly', doc: pinsDoc(), path: '組件/定位組.3dba', children: { p1: part('plate', '定位板.3dbx'), pa: part('pin', '零件/削邊銷.3dbx'), pb: part('pin', '零件/削邊銷.3dbx') } };
  return { s0: sub, s1: sub, s2: sub, x1: part('pin', '零件/削邊銷.3dbx'), v1: part('screw', '零件/螺絲.3dbx'), w1: part('washer', '零件/墊片.3dbx') };
};
const props: Record<string, Record<string, string>> = {
  pin: { 廠商: 'MISUMI', 料號: 'DP-8-31' },
  plate: { Vendor: '自製', 'Part Number': 'LP-001' },
  washer: {},
};
const propsOf = (key: string) => props[key];
const bom = (d: AssemblyDoc, problems?: Map<string, string>) => buildBom({ doc: d, trees: trees(), propsOf, ...(problems ? { problems } : {}) });
const linear = (extra: Partial<ComponentPattern> = {}): ComponentPattern => ({ id: 'pattern1', name: '線性複製排列1', kind: 'linear', seed: 'x1', axis1: { kind: 'axis', axis: 'x' }, count1: 4, spacing1: '20', ...extra });
const mirror: ComponentPattern = { id: 'pattern2', name: '鏡射零組件1', kind: 'mirror', seed: 's0', plane: 'plane:right' };

describe('the parts list (3b-4a)', () => {
  it('counts the parts through the sub-assemblies: a sub-assembly used three times with two pins has six', () => {
    const { flat } = bom(jig());
    expect(flat.map((r) => [r.name, r.qty])).toEqual([['定位板', 3], ['削邊銷', 7], ['墊片', 1]]);
    expect(flat.map((r) => r.item)).toEqual(['1', '2', '3']);
  });

  it('leaves out what is suppressed and lists what is hidden', () => {
    const { flat, indented } = bom(jig());
    expect(flat.some((r) => r.name === '螺絲')).toBe(false);
    expect(flat.some((r) => r.name === '墊片')).toBe(true);
    expect(indented.some((r) => r.name === '螺絲')).toBe(false);
  });

  it('counts the instances of a pattern, and lists a mirror as a part of its own', () => {
    const { flat } = bom(jig([linear({ skip: ['3'] }), mirror]));
    // 削邊銷: 6 in the sub-assemblies, the free one and 4 − 1 (skipped) more; and the mirror of 定位組 has 2 mirrored
    expect(flat.map((r) => [r.name, r.qty, r.mirrored])).toEqual([
      ['定位板', 3, false],
      ['削邊銷', 9, false],
      ['定位板（鏡射）', 1, true],
      ['削邊銷（鏡射）', 2, true],
      ['墊片', 1, false],
    ]);
  });

  it('does not count a pattern that has no instances because of a problem', () => {
    const { flat } = bom(jig([linear()]), new Map([['pattern1', 'axis gone']]));
    expect(flat.find((r) => r.name === '削邊銷')!.qty).toBe(7);
    expect(buildBom({ doc: { ...jig(), patterns: [linear({ count1: 1 })] }, trees: trees(), propsOf }).flat.find((r) => r.name === '削邊銷')!.qty).toBe(7); // a definition that does not read adds nothing
  });

  it('reads the vendor and the part number from the properties, in either language, and leaves them empty where there are none', () => {
    const { flat } = bom(jig());
    const by = (n: string) => flat.find((r) => r.name === n)!;
    expect([by('削邊銷').vendor, by('削邊銷').partNo]).toEqual(['MISUMI', 'DP-8-31']);
    expect([by('定位板').vendor, by('定位板').partNo]).toEqual(['自製', 'LP-001']);
    expect([by('墊片').vendor, by('墊片').partNo]).toEqual(['', '']);
    // a file whose properties are not known at all
    expect(buildBom({ doc: jig(), trees: trees(), propsOf: () => undefined }).flat.every((r) => r.vendor === '' && r.partNo === '')).toBe(true);
  });

  it('indents: each sub-assembly once, what is in it per use, numbered under it', () => {
    const { indented } = bom(jig());
    expect(indented.map((r) => [r.item, r.level, r.kind, r.name, r.qty])).toEqual([
      ['1', 0, 'assembly', '定位組', 3],
      ['1.1', 1, 'part', '定位板', 1],
      ['1.2', 1, 'part', '削邊銷', 2],
      ['2', 0, 'part', '削邊銷', 1],
      ['3', 0, 'part', '墊片', 1],
    ]);
  });

  it('a mirrored sub-assembly is made of mirrored parts', () => {
    const { indented } = bom(jig([mirror]));
    const rows = indented.filter((r) => r.mirrored).map((r) => [r.item, r.name, r.qty]);
    expect(rows).toEqual([['2', '定位組（鏡射）', 1], ['2.1', '定位板（鏡射）', 1], ['2.2', '削邊銷（鏡射）', 2]]);
  });

  it('is empty for an assembly with nothing in it, and does not count what has not been read', () => {
    expect(buildBom({ doc: createEmptyAssembly(), trees: {}, propsOf })).toEqual({ flat: [], indented: [] });
    const some = trees();
    delete some.x1;
    expect(buildBom({ doc: jig(), trees: some, propsOf }).flat.find((r) => r.name === '削邊銷')!.qty).toBe(6);
  });
});

/** A small reader for what `bomCsv` writes (quotes, doubled quotes, line breaks inside quotes). */
function readCsv(bytes: Uint8Array): string[][] {
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return rows;
}

describe('the parts list as CSV (3b-4a)', () => {
  it('starts with a byte order mark and has the headings and a line for each row', () => {
    const bytes = bomCsv(bom(jig()).flat);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = readCsv(bytes);
    expect(rows[0]).toEqual(['項次', '名稱', '數量', '廠商', '料號', '檔案']);
    expect(rows.slice(1)).toEqual([['1', '定位板', '3', '自製', 'LP-001', '定位板.3dbx'], ['2', '削邊銷', '7', 'MISUMI', 'DP-8-31', '零件/削邊銷.3dbx'], ['3', '墊片', '1', '', '', '零件/墊片.3dbx']]);
  });

  it('reads back unchanged whatever the fields hold: commas, quotes, line breaks, spaces, non-ASCII', () => {
    const awkward = ['a,b', 'say "hi"', 'two\nlines', 'cr\r\nlf', '  padded  ', '中文，全形逗號', '"', ',', ''];
    const rows = awkward.map((v, i) => ({ item: String(i + 1), level: 0, kind: 'part' as const, name: v, path: v, qty: i + 1, mirrored: false, vendor: v, partNo: v, properties: {} }));
    const back = readCsv(bomCsv(rows));
    expect(back.slice(1).map((r) => [r[1], r[3], r[4], r[5]])).toEqual(awkward.map((v) => [v, v, v, v]));
    expect(back.slice(1).map((r) => r[2])).toEqual(awkward.map((_, i) => String(i + 1)));
  });

  it('names its file after the assembly, without what a file name cannot hold', () => {
    expect(bomFileName('夾具/1:2')).toBe('夾具_1_2-零件表.csv');
  });
});
