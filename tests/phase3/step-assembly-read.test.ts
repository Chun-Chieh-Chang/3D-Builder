/**
 * 3b-3a: the structure of an assembly STEP read through XCAF (F2.8): every product once, components with their names and rigid
 * motions, the shapes of the parts, the colors of their faces; what cannot be a component's pose or is not a STEP file is refused in words.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { axisAngle, rotationRows, type Quat } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

let kernel: Kernel;
const built = {} as Record<'plate' | 'pin', ShapeId>;
const kept: Regenerator[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
  const solver = await PlaneGcsSolver.create();
  for (const [k, file] of [['plate', 'locating-plate.3dbx'], ['pin', 'diamond-pin.3dbx']] as const) {
    const doc = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${file}`, import.meta.url))))).doc;
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    built[k] = regen.rebuild(doc).body!.shape;
  }
});

const turned: Quat = axisAngle([0.6, 0.8, 0], 0.7);
const close = (a: readonly number[], b: readonly number[], d = 9) => a.forEach((v, i) => expect(v, `[${i}] ${a} vs ${b}`).toBeCloseTo(b[i]!, d));

/** 夾具 → 定位組 twice (once turned) and a 削邊銷 of its own; 定位組 → 定位板 and 削邊銷. */
function nested(): string {
  return kernel.exportAssemblyStep(
    '夾具',
    [{ shape: built.plate, name: '定位板' }, { shape: built.pin, name: '削邊銷' }],
    [
      { sub: 0, name: '定位組<1>', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      { sub: 0, name: '定位組<2>', position: [120, 5, -3], rotation: turned },
      { part: 1, name: '削邊銷<3>', position: [0, 40, 0], rotation: [0, 0, 0, 1] },
    ],
    'MM',
    [{ name: '定位組', instances: [{ part: 0, name: '定位板<1>', position: [0, 0, 0], rotation: [0, 0, 0, 1] }, { part: 1, name: '削邊銷<1>', position: [-40, 0, 0], rotation: [0, 0.7071067811865476, 0, 0.7071067811865476] }] }],
  );
}

describe('an assembly STEP read through XCAF (3b-3a)', () => {
  it('finds every product once, with the components, their names and rigid motions', () => {
    const c = kernel.readAssemblyStep(nested());
    const byName = (n: string) => c.prototypes.findIndex((p) => p.name === n);
    expect(c.prototypes.map((p) => p.name).sort()).toEqual(['夾具', '定位板', '定位組', '削邊銷'].sort());
    const root = c.prototypes[c.root]!;
    expect(root.name).toBe('夾具');
    expect(root.shape).toBeUndefined();
    expect(root.children!.map((n) => [n.name, c.prototypes[n.prototype]!.name])).toEqual([['定位組<1>', '定位組'], ['定位組<2>', '定位組'], ['削邊銷<3>', '削邊銷']]);
    // both uses of 定位組 are one product
    expect(root.children![0]!.prototype).toBe(root.children![1]!.prototype);
    close(root.children![1]!.translation, [120, 5, -3]);
    close(root.children![1]!.rotation, rotationRows(turned));
    const group = c.prototypes[byName('定位組')]!;
    expect(group.children!.map((n) => [n.name, c.prototypes[n.prototype]!.name])).toEqual([['定位板<1>', '定位板'], ['削邊銷<1>', '削邊銷']]);
    close(group.children![1]!.translation, [-40, 0, 0]);
    // the pin product is shared by 定位組 and the free pin
    expect(group.children![1]!.prototype).toBe(root.children![2]!.prototype);
  });

  it('gives the shape of each part as it was: the volume and the number of faces', () => {
    const c = kernel.readAssemblyStep(nested());
    for (const [name, original] of [['定位板', built.plate], ['削邊銷', built.pin]] as const) {
      const p = c.prototypes.find((x) => x.name === name)!;
      expect(kernel.massProps(p.shape!).volume).toBeCloseTo(kernel.massProps(original).volume, 6);
      expect(kernel.topology(p.shape!).faces.length).toBe(kernel.topology(original).faces.length);
    }
    for (const p of c.prototypes) if (p.shape) kernel.release(p.shape);
  });

  it('reads the colors of faces as the file says them (sRGB), by the order of the faces of the shape', () => {
    const n = kernel.topology(built.pin).faces.length;
    const colors = Array.from({ length: n }, (_, i) => (i === 2 ? '#ff0000' : i === 5 ? '#00aa33' : null));
    const c = kernel.readAssemblyStep(kernel.exportStep(built.pin, 'pin', 'MM', { faceColors: colors }));
    expect(c.prototypes).toHaveLength(1);
    const p = c.prototypes[c.root]!;
    expect(p.name).toBe('pin');
    expect(p.faceColors).toHaveLength(n);
    p.faceColors!.forEach((hex, i) => {
      if (colors[i] === null) return expect(hex).toBeNull();
      const want = colors[i]!;
      [1, 3, 5].forEach((at) => expect(Math.abs(parseInt(hex!.slice(at, at + 2), 16) - parseInt(want.slice(at, at + 2), 16))).toBeLessThanOrEqual(1));
    });
    kernel.release(p.shape!);
  });

  it('a file without colors has none', () => {
    const c = kernel.readAssemblyStep(kernel.exportStep(built.pin, 'pin'));
    expect(c.prototypes[c.root]!.faceColors).toBeUndefined();
    kernel.release(c.prototypes[c.root]!.shape!);
  });

  it('refuses a position that is a mirror, and says which component', () => {
    // OCCT writes a mirrored location (ADR 0046): the file is made with the writer and read back
    const text = (() => {
      const o = kernel.oc;
      const doc = new o.TDocStd_Document(new o.TCollection_ExtendedString('XmlXCAF', false));
      const tool = o.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
      const top = tool.NewShape();
      o.TDataStd_Name.Set(top, new o.TCollection_ExtendedString('Top', true));
      const proto = tool.AddShape((kernel as unknown as { get(id: ShapeId): never }).get(built.pin), false, true);
      const flip = new o.gp_Trsf();
      flip.SetMirror(new o.gp_Ax2(new o.gp_Pnt(0, 0, 0), new o.gp_Dir(1, 0, 0)));
      const component = tool.AddComponent(top, proto, new o.TopLoc_Location(flip));
      o.TDataStd_Name.Set(component, new o.TCollection_ExtendedString('flipped<1>', true));
      tool.UpdateAssemblies();
      const w = new o.STEPCAFControl_Writer();
      w.SetNameMode(true);
      w.Perform(doc, '/m.step', new o.Message_ProgressRange());
      return o.FS.readFile('/m.step', { encoding: 'utf8' }) as string;
    })();
    expect(() => kernel.readAssemblyStep(text)).toThrow(/flipped<1>.*鏡射或縮放/);
  });

  it('refuses what is not a STEP file or holds no shape, in words', () => {
    expect(() => kernel.readAssemblyStep('hello')).toThrow(KernelError);
    expect(() => kernel.readAssemblyStep('hello')).toThrow(/STEP/);
    expect(() => kernel.readAssemblyStep('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n')).toThrow(KernelError);
  });
});
