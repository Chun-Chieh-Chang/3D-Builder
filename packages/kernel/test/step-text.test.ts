import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '../src';
import type { Frame, Region } from '../src/kernel';
import { escapeStepText } from '../src/stepText';
import { readAssemblyStep } from '../../../tests/support/readAssemblyStep';

describe('STEP text is ASCII (ISO 10303-21): other characters are escapes', () => {
  it('leaves ASCII alone, byte for byte', () => {
    const text = "ISO-10303-21;\nPRODUCT('ISO 8734 6m6x20<1>','a''b \\\\ c','',(#8));\n";
    expect(escapeStepText(text)).toBe(text);
  });

  it('writes a run of characters as one \\X2\\ escape of four hex digits each, the rest of the string as it was', () => {
    expect(escapeStepText("PRODUCT('基板','基板',$);")).toBe("PRODUCT('\\X2\\57FA677F\\X0\\','\\X2\\57FA677F\\X0\\',$);");
    expect(escapeStepText("'定位板<1>'")).toBe("'\\X2\\5B9A4F4D677F\\X0\\<1>'");
    // 2×Ø6: the multiplication sign and the O with a stroke are one run
    expect(escapeStepText("'2×Ø6'")).toBe("'2\\X2\\00D700D8\\X0\\6'");
  });

  it('writes a character beyond the Basic Multilingual Plane as \\X4\\ of eight digits', () => {
    expect(escapeStepText("'a𠀀b'")).toBe("'a\\X4\\00020000\\X0\\b'");
    expect(escapeStepText("'基𠀀板'")).toBe("'\\X2\\57FA\\X0\\\\X4\\00020000\\X0\\\\X2\\677F\\X0\\'");
  });
});

let k: Kernel;
const live: ShapeId[] = [];
beforeAll(async () => {
  k = await Kernel.load();
});
afterAll(() => live.forEach((id) => k.release(id)));

const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const rect = (w: number, h: number): Region => ({
  outer: [
    { kind: 'line', a: [0, 0], b: [w, 0], source: 'l1' },
    { kind: 'line', a: [w, 0], b: [w, h], source: 'l2' },
    { kind: 'line', a: [w, h], b: [0, h], source: 'l3' },
    { kind: 'line', a: [0, h], b: [0, 0], source: 'l4' },
  ],
  holes: [],
});
const block = () => {
  const id = k.extrude(front, [rect(10, 6)], [0, 0, 4]).shape;
  live.push(id);
  return id;
};
const noHighByte = (text: string) => !/[^\x00-\x7f]/u.test(text);

describe('what the kernel writes', () => {
  it('a part with a Chinese name: nothing outside ASCII in the file, the name escaped, and the library reads the same name and volume back', () => {
    const text = k.exportStep(block(), '行走骨架示範件');
    expect(noHighByte(text)).toBe(true);
    expect(text).toContain("PRODUCT('\\X2\\884C8D70");
    expect(readAssemblyStep(k.oc, text).root).toBe('行走骨架示範件');
    const again = k.importStep(text).shape;
    live.push(again);
    expect(k.massProps(again).volume).toBeCloseTo(240, 6);
  });

  it('an assembly whose assembly, parts, components and sub-assembly have Chinese names: the same, and every name comes back as it went', () => {
    const text = k.exportAssemblyStep(
      '夾具',
      [{ shape: block(), name: '定位板' }],
      [{ part: 0, name: '定位板<1>', position: [0, 0, 0], rotation: [0, 0, 0, 1] }, { sub: 0, name: '工位<1>', position: [20, 0, 0], rotation: [0, 0, 0, 1] }],
      'MM',
      [{ name: '工位', instances: [{ part: 0, name: '定位板<2>', position: [0, 0, 0], rotation: [0, 0, 0, 1] }] }],
    );
    expect(noHighByte(text)).toBe(true);
    const back = readAssemblyStep(k.oc, text);
    expect(back.root).toBe('夾具');
    // the top level: a part and the sub-assembly 工位 (its own member 定位板<2> is one level down)
    expect(back.items.map((i) => i.name)).toEqual(['定位板<1>', '工位<1>']);
    expect(back.items.map((i) => i.product)).toEqual(['定位板', '工位']);
  });

  it('a name with ASCII only is written as before', () => {
    const text = k.exportStep(block(), 'Plate 1');
    expect(text).toContain("PRODUCT('Plate 1','Plate 1'");
    expect(noHighByte(text)).toBe(true);
  });
});
