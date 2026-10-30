import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeId } from '../src';
import type { Frame, Region } from '../src/kernel';

let k: Kernel;
const live: ShapeId[] = [];
const keep = (id: ShapeId) => (live.push(id), id);
beforeAll(async () => {
  k = await Kernel.load();
});
afterAll(() => live.forEach((id) => k.release(id)));

const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const rect = (x: number, y: number, w: number, h: number): Region => ({
  outer: [
    { kind: 'line', a: [x, y], b: [x + w, y], source: 'l1' },
    { kind: 'line', a: [x + w, y], b: [x + w, y + h], source: 'l2' },
    { kind: 'line', a: [x + w, y + h], b: [x, y + h], source: 'l3' },
    { kind: 'line', a: [x, y + h], b: [x, y], source: 'l4' },
  ],
  holes: [],
});
const box = () => keep(k.extrude(front, [rect(0, 0, 20, 10)], [0, 0, 5]).shape);
const volume = (id: ShapeId) => k.massProps(id).volume;

/** The file's lines without their line ends. */
const linesOf = (text: string) => text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
/** The entity types of the directory section (the first of each pair of D lines). */
const entityTypes = (text: string) => new Set(linesOf(text).filter((l) => l[72] === 'D').filter((_, i) => i % 2 === 0).map((l) => Number(l.slice(0, 8))));
/** The global section as one string. */
const globalOf = (text: string) => linesOf(text).filter((l) => l[72] === 'G').map((l) => l.slice(0, 72)).join('');

/**
 * What an IGES file is made of, checked against IGES 5.3 §2.2: 80 ASCII columns, the sections in order (Start, Global, Directory, Parameter,
 * Terminate) each numbered from 1, the directory entries in pairs, and a Terminate line that counts the lines of each section.
 */
function checkStructure(text: string): void {
  expect(/^[\x00-\x7f]*$/.test(text)).toBe(true);
  const lines = linesOf(text);
  const order = 'SGDPT';
  let last = 0;
  const count: Record<string, number> = { S: 0, G: 0, D: 0, P: 0, T: 0 };
  for (const l of lines) {
    expect(l).toHaveLength(80);
    const section = l[72]!;
    const at = order.indexOf(section);
    expect(at).toBeGreaterThanOrEqual(last);
    last = at;
    count[section]!++;
    expect(Number(l.slice(73))).toBe(count[section]);
  }
  expect(count.T).toBe(1);
  expect(count.D! % 2).toBe(0);
  const t = lines.at(-1)!;
  // each count right-justified in 7 columns after its letter (§2.2.6)
  const counted = [0, 1, 2, 3].map((i) => ({ letter: t[i * 8], n: Number(t.slice(i * 8 + 1, i * 8 + 8)) }));
  expect(counted).toEqual(['S', 'G', 'D', 'P'].map((letter) => ({ letter, n: count[letter] })));
}

/** The free shape of an IGES file as the XCAF reader sees it: its name, and the "#rrggbb" of each face (null when it has none). Independent of `importIges`. */
function readXcaf(text: string): { name: string | null; colors: (string | null)[]; solids: number } {
  const oc = k.oc;
  const path = '/iges-test-read.igs';
  oc.FS.writeFile(path, text);
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('MDTV-XCAF', false));
  const reader = new oc.IGESCAFControl_Reader();
  try {
    expect(String(reader.ReadFile(path))).toBe('IFSelect_RetDone');
    expect(reader.Transfer(doc, new oc.Message_ProgressRange())).toBe(true);
    const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(doc.Main());
    const roots = new oc.NCollection_Sequence_TDF_Label();
    tool.GetFreeShapes(roots);
    expect(roots.Length()).toBe(1);
    const found = roots.Value(1).FindAttribute(oc.TDataStd_Name.GetID());
    const name = found.returnValue ? new oc.TCollection_AsciiString((found.anAttribute as unknown as { Get(): never }).Get(), '\0').ToCString() : null;
    const shape = oc.XCAFDoc_ShapeTool.GetShape(roots.Value(1));
    const srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    const colors: (string | null)[] = [];
    let solids = 0;
    for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const c = new oc.Quantity_Color();
      const has = colorTool.GetColor(ex.Current(), oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf, c) || colorTool.GetColor(ex.Current(), oc.XCAFDoc_ColorType.XCAFDoc_ColorGen, c);
      colors.push(has ? '#' + [c.Red(), c.Green(), c.Blue()].map((v) => Math.round(srgb(v) * 255).toString(16).padStart(2, '0')).join('') : null);
    }
    for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) solids++;
    return { name, colors, solids };
  } finally {
    reader.delete();
    doc.delete();
    oc.FS.unlink(path);
  }
}

describe('IGES export (F1.4)', () => {
  it('writes trimmed surfaces by default and a B-rep solid when asked, each a well-formed IGES file', () => {
    const faces = k.exportIges(box(), 'P');
    checkStructure(faces);
    expect(entityTypes(faces).has(144)).toBe(true); // trimmed surface
    expect(entityTypes(faces).has(186)).toBe(false);
    expect(readXcaf(faces).solids).toBe(0);
    const brep = k.exportIges(box(), 'P', 'MM', { mode: 'brep' });
    checkStructure(brep);
    expect(entityTypes(brep).has(186)).toBe(true); // manifold solid B-rep object
    expect(entityTypes(brep).has(144)).toBe(false);
    expect(readXcaf(brep).solids).toBe(1);
  });

  it('writes the unit in the global section, and puts the library settings back after a file in inches and B-rep', () => {
    expect(globalOf(k.exportIges(box(), 'P'))).toMatch(/,2,2HMM,/);
    expect(globalOf(k.exportIges(box(), 'P', 'INCH', { mode: 'brep' }))).toMatch(/,1,4HINCH,/);
    // the next files are what they say, whatever the one before was
    const next = k.exportIges(box(), 'P');
    expect(globalOf(next)).toMatch(/,2,2HMM,/);
    expect(entityTypes(next).has(144)).toBe(true);
    const step = k.exportStep(box(), 'P');
    expect(step).toContain('AUTOMOTIVE_DESIGN'); // AP214
    expect(step).not.toMatch(/INCH/i);
  });

  it('carries the part name, and the colors of the faces in both modes', () => {
    const id = box();
    const n = k.topology(id).faces.length;
    const colors = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? '#c03020' : null));
    for (const mode of ['faces', 'brep'] as const) {
      const back = readXcaf(k.exportIges(id, 'Plate', 'MM', { mode, faceColors: colors }));
      expect(back.name).toBe('Plate');
      expect(back.colors).toHaveLength(n);
      expect(back.colors.filter(Boolean)).toHaveLength(colors.filter(Boolean).length);
      for (const c of back.colors) expect([null, '#c03020']).toContain(c);
    }
  });

  it('writes a name that is not ASCII with _ for each other character, and says so', () => {
    const warnings: string[] = [];
    const text = k.exportIges(box(), '定位板A', 'MM', { warnings });
    expect(readXcaf(text).name).toBe('___A');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('定位板A');
    const plain: string[] = [];
    k.exportIges(box(), 'Plate-1', 'MM', { warnings: plain });
    expect(plain).toEqual([]);
  });

  it('refuses a unit or a mode it does not know, instead of writing something else', () => {
    expect(() => k.exportIges(box(), 'P', 'CM' as never)).toThrow(KernelError);
    expect(() => k.exportIges(box(), 'P', 'MM', { mode: 'wire' as never })).toThrow(KernelError);
  });
});

describe('IGES import (F2.2)', () => {
  it('reads trimmed surfaces back as one solid, sewn, with the same volume', () => {
    const r = k.importIges(k.exportIges(box(), 'P'));
    keep(r.shape);
    expect(volume(r.shape) / 1000 - 1).toBeLessThan(1e-6);
    expect(1 - volume(r.shape) / 1000).toBeLessThan(1e-6);
    expect(k.topology(r.shape).faces).toHaveLength(6);
    expect(k.isValid(r.shape)).toBe(true);
    expect(r.diagnostics.sewn).toBe(true);
    expect(r.diagnostics.freeEdges).toBe(0);
    expect(r.diagnostics.validAfter).toBe(true);
  });

  it('reads a B-rep file as the solid it is, without sewing', () => {
    const r = k.importIges(k.exportIges(box(), 'P', 'MM', { mode: 'brep' }));
    keep(r.shape);
    expect(Math.abs(volume(r.shape) / 1000 - 1)).toBeLessThan(1e-6);
    expect(r.diagnostics.solids).toBe(1);
    expect(r.diagnostics.sewn).toBe(false);
  });

  it('converts a file in inches to millimetres', () => {
    const r = k.importIges(new TextEncoder().encode(k.exportIges(box(), 'P', 'INCH')));
    keep(r.shape);
    expect(Math.abs(volume(r.shape) / 1000 - 1)).toBeLessThan(1e-6);
    expect(k.bounds(r.shape).max[0]).toBeCloseTo(20, 6);
  });

  it('gives the faces the same order every time the same file is read', () => {
    const text = k.exportIges(box(), 'P');
    const centers = () => {
      const r = k.importIges(text);
      keep(r.shape);
      return k.topology(r.shape).faces.map((f) => f.center.map((c) => c.toFixed(6)).join());
    };
    expect(centers()).toEqual(centers());
  });

  it('refuses what is not an IGES file, an empty file, and a file cut short, each with an error', () => {
    expect(() => k.importIges('hello')).toThrow(KernelError);
    expect(() => k.importIges('')).toThrow(KernelError);
    expect(() => k.importIges(k.exportStep(box(), 'P'))).toThrow(KernelError);
    const text = k.exportIges(box(), 'P');
    expect(() => k.importIges(text.slice(0, Math.floor(text.length / 3)))).toThrow(KernelError);
  });
});
