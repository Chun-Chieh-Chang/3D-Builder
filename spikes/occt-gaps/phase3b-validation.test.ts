// Phase 3b-0 items 2–4 (ADR 0046): mirrored components, interference-check cost, the structure of an assembly STEP.
// Run: npx vitest run --config spikes/occt-gaps/vitest.config.ts spikes/occt-gaps/phase3b-validation.test.ts
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { PlaneGcsSolver } from '@3db/sketch';
import { readPartFile } from '@3db/io';
import type { PartDoc } from '@3db/model';
import { build, extrude, front, rectangle, sketch } from '../../tests/phase1/builders';
import { readAssemblyStep, rotationMatrix } from '../../tests/support/readAssemblyStep';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => {
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  const r = regen.rebuild(doc);
  return r.body!;
};
const golden = async (file: string) => (await readPartFile(new Uint8Array(readFileSync(new URL(`../../tests/golden/${file}`, import.meta.url))))).doc;
const raw = (id: ShapeId) => (kernel as unknown as { get(id: ShapeId): never }).get(id);
const box = (w: number, h: number, d: number) => rebuild(build(sketch('s', front, rectangle('r', 0, 0, w, h)), extrude('e', 's', 'boss', { type: 'blind', depth: String(d) }))).shape;
const rows = (m: number[][]) => m.flat().slice(0, 12);
const MIRROR_X = rows([[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]);

// ------------------------------------------------------------------------------------------------ 2: mirrored component
describe('mirrored component (3b-0 item 2)', () => {
  it('a mirrored copy of a real part is a valid solid with the same volume, and keeps its face order', async () => {
    const plate = rebuild(await golden('locating-plate.3dbx'));
    const before = kernel.massProps(plate.shape);
    const mirrored = kernel.transformed(plate.shape, MIRROR_X);
    const after = kernel.massProps(mirrored);
    expect(kernel.isValid(mirrored)).toBe(true);
    expect(after.volume).toBeCloseTo(before.volume, 6);
    expect(after.center[0]).toBeCloseTo(-before.center[0], 6);
    expect(after.area).toBeCloseTo(before.area, 6);
    const a = kernel.topology(plate.shape);
    const b = kernel.topology(mirrored);
    console.log(`鏡射零件：面 ${a.faces.length} → ${b.faces.length}，體積 ${before.volume.toFixed(4)} → ${after.volume.toFixed(4)}`);
    expect(b.faces.length).toBe(a.faces.length);
    // face i of the mirror is face i of the original: that is what lets the original's persistent names map onto the mirror
    a.faces.forEach((f, i) => {
      expect(b.faces[i]!.area).toBeCloseTo(f.area, 6);
      expect(b.faces[i]!.surface).toBe(f.surface);
      expect(b.faces[i]!.center[0]).toBeCloseTo(-f.center[0], 6);
      // a planar face's outward normal is mirrored too, and still points out of the solid
      if (f.normal) expect(b.faces[i]!.normal![0]).toBeCloseTo(-f.normal[0], 6);
    });
  });

  it('the mirror is written as a shape with a rigid pose: a component with a determinant −1 pose is not possible in STEP', async () => {
    const pin = rebuild(await golden('diamond-pin.3dbx'));
    const mirrored = kernel.transformed(pin.shape, MIRROR_X);
    // rigid poses only: the mirror lives in the part, the instance carries a rotation
    const step = kernel.exportAssemblyStep(
      'Mirror',
      [{ shape: pin.shape, name: 'pin' }, { shape: mirrored, name: 'pin-mirror' }],
      [
        { part: 0, name: 'pin<1>', position: [10, 0, 0], rotation: [0, 0, 0, 1] },
        { part: 1, name: 'pin-mirror<1>', position: [-10, 0, 0], rotation: [0, 0, 0, 1] },
      ],
    );
    const back = readAssemblyStep(kernel.oc, step);
    expect(back.items.map((i) => i.product)).toEqual(['pin', 'pin-mirror']);
    expect(back.volumes.get('pin-mirror')).toBeCloseTo(back.volumes.get('pin')!, 6);
    console.log('鏡射零組件：鏡射零件檔（形狀本身鏡射）加剛體位姿 → STEP 往返成立');
  });

  it('what OCCT does with a mirror placed as a component location (why the mirror is kept in the part, not in the pose)', async () => {
    const oc = kernel.oc;
    const pin = rebuild(await golden('diamond-pin.3dbx'));
    const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('XmlXCAF', false));
    const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const top = tool.NewShape();
    const proto = tool.AddShape(raw(pin.shape), false, true);
    const flip = new oc.gp_Trsf();
    flip.SetMirror(new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(1, 0, 0)));
    let outcome: string;
    try {
      const location = new oc.TopLoc_Location(flip);
      tool.AddComponent(top, proto, location);
      tool.UpdateAssemblies();
      const writer = new oc.STEPCAFControl_Writer();
      const ok = writer.Perform(doc, '/flip.step', new oc.Message_ProgressRange());
      const text = ok ? (oc.FS.readFile('/flip.step', { encoding: 'utf8' }) as string) : '';
      // the placements STEP writes are AXIS2_PLACEMENT_3D: three unit directions; the file says whether the third one was kept right-handed
      const back = ok ? readAssemblyStep(oc, text) : null;
      const m = back?.items[0]?.matrix;
      const det = m ? m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!) : NaN;
      const entities = [...new Set([...text.matchAll(/=\s*(CARTESIAN_TRANSFORMATION_OPERATOR\w*|ITEM_DEFINED_TRANSFORMATION|REPRESENTATION_RELATIONSHIP\w*|MAPPED_ITEM|AXIS2_PLACEMENT_3D)\(/g)].map((x) => x[1]))];
      outcome = ok ? `寫出了；讀回的位姿行列式 ${det.toFixed(3)}（原本是 −1）；用到的實體：${entities.join('、')}` : 'Perform 回傳 false';
    } catch (e) {
      outcome = `例外：${(() => { try { return oc.getExceptionMessage(e).join(' / '); } catch { return String(e); } })()}`;
    }
    console.log(`鏡射位姿放進零組件：${outcome}`);
  });

  it('the mirror follows the original: rebuilding the original with another size changes the mirror the same way', () => {
    const volume = (w: number) => kernel.massProps(kernel.transformed(box(w, 20, 10), MIRROR_X)).volume;
    expect(volume(30)).toBeCloseTo(30 * 20 * 10, 6);
    expect(volume(45)).toBeCloseTo(45 * 20 * 10, 6);
  });
});

// ------------------------------------------------------------------------------------------------ 3: interference check
describe('interference check (3b-0 item 3)', () => {
  const common = (a: ShapeId, b: ShapeId) => {
    const oc = kernel.oc;
    const progress = () => new oc.Message_ProgressRange();
    const op = new oc.BRepAlgoAPI_Common(raw(a), raw(b), progress());
    op.Build(progress());
    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(op.Shape(), props, false, false, false);
    const v = props.Mass();
    props.delete();
    op.delete();
    return v;
  };
  const place = (id: ShapeId, [x, y, z]: [number, number, number]) => kernel.transformed(id, [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]);

  it('two 10×10×5 blocks overlapping by 2 give a common volume of 200, touching blocks give 0', () => {
    const a = box(10, 10, 5);
    expect(common(a, place(box(10, 10, 5), [0, 0, 3]))).toBeCloseTo(200, 6); // z overlap 2
    expect(common(a, place(box(10, 10, 5), [0, 0, 5]))).toBeCloseTo(0, 6); // face contact is not interference
    expect(common(a, place(box(10, 10, 5), [0, 0, 6]))).toBeCloseTo(0, 6); // apart
    expect(common(a, place(box(10, 10, 5), [4, 3, 1]))).toBeCloseTo(6 * 7 * 4, 6);
  });

  it('a pin in a hole: resting on the plate it overlaps by the ring around the shank, lifted off it does not touch', async () => {
    const plate = rebuild(await golden('locating-plate.3dbx')).shape;
    const pin = rebuild(await golden('diamond-pin.3dbx')).shape;
    // the plate is 15 thick with an R4 hole at x = −40; the pin has an R5 shank 15 long: a 0.5 chamfer at the tip (R4.5 → R5),
    // R5 up to y = 6, a groove R4.5 from 6 to 7, R5 again to 15, then an R8 flange
    const ring = Math.PI * ((25 - 16) * 13.5 + (20.25 - 16) * 1 + ((125 - 4.5 ** 3) / 3 - 8));
    expect(common(plate, place(pin, [-40, 0, 0]))).toBeCloseTo(ring, 3);
    expect(common(plate, place(pin, [-40, 15, 0]))).toBeCloseTo(0, 6); // lifted until the shank stands on the plate: touching only
    expect(common(plate, place(pin, [-40, 40, 0]))).toBeCloseTo(0, 6);
  });

  /** 20 components: the three golden parts, repeated, on a grid whose pitch makes neighbours overlap a little. */
  it('20 components, 190 pairs: time with and without a bounding-box filter', async () => {
    const parts = [rebuild(await golden('locating-plate.3dbx')).shape, rebuild(await golden('diamond-pin.3dbx')).shape, rebuild(await golden('v-block.3dbx')).shape];
    const size = parts.map((p) => {
      const b = kernel.bounds(p);
      return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] as const;
    });
    const items = Array.from({ length: 20 }, (_, i) => {
      const k = i % 3;
      const [w, h] = size[k]!;
      const col = i % 5, row = Math.floor(i / 5);
      // pitch 85% of the size, so every part overlaps its neighbours
      return { id: place(parts[k]!, [col * w * 0.85, row * h * 0.85, 0]), name: `c${i}` };
    });
    const boxes = items.map((it) => kernel.bounds(it.id));
    const meets = (i: number, j: number) => [0, 1, 2].every((a) => boxes[i]!.min[a]! < boxes[j]!.max[a]! && boxes[j]!.min[a]! < boxes[i]!.max[a]!);
    const pairs: [number, number][] = [];
    for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) pairs.push([i, j]);
    const all = pairs.length;
    const near = pairs.filter(([i, j]) => meets(i, j));
    const timed = (list: [number, number][]) => {
      const t = performance.now();
      let hits = 0;
      for (const [i, j] of list) if (common(items[i]!.id, items[j]!.id) > 1e-6) hits++;
      return { ms: performance.now() - t, hits };
    };
    const full = timed(pairs);
    const filtered = timed(near);
    console.log(`干涉檢查 20 個零組件：${all} 對全算 ${full.ms.toFixed(0)} ms（${full.hits} 對有重疊）；包圍盒先濾掉後剩 ${near.length} 對，${filtered.ms.toFixed(0)} ms（${filtered.hits} 對）`);
    expect(filtered.hits).toBe(full.hits);
  });
});

// ------------------------------------------------------------------------------------------------ 4: STEP assembly structure
describe('STEP assembly import structure (3b-0 item 4)', () => {
  it('a two-level assembly written through XCAF is read back with its tree, names, shared prototypes and accumulated poses', async () => {
    const oc = kernel.oc;
    const pin = rebuild(await golden('diamond-pin.3dbx'));
    const plate = rebuild(await golden('locating-plate.3dbx'));
    const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('XmlXCAF', false));
    const name = (l: never, text: string) => oc.TDataStd_Name.Set(l, new oc.TCollection_ExtendedString(text, true));
    const move = (x: number, y: number, z: number) => {
      const t = new oc.gp_Trsf();
      t.SetTranslationPart(new oc.gp_Vec(x, y, z));
      return new oc.TopLoc_Location(t);
    };
    const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const top = tool.NewShape();
    name(top as never, 'Fixture');
    const sub = tool.NewShape(); // an assembly used as a component of the top one
    name(sub as never, 'PinPair');
    const pinProto = tool.AddShape(raw(pin.shape), false, true);
    name(pinProto as never, 'pin');
    const plateProto = tool.AddShape(raw(plate.shape), false, true);
    name(plateProto as never, 'plate');
    name(tool.AddComponent(sub, pinProto, move(-40, 0, 0)) as never, 'pin<1>');
    name(tool.AddComponent(sub, pinProto, move(40, 0, 0)) as never, 'pin<2>');
    name(tool.AddComponent(top, plateProto, move(0, 0, 0)) as never, 'plate<1>');
    name(tool.AddComponent(top, sub, move(0, 0, 5)) as never, 'PinPair<1>');
    name(tool.AddComponent(top, sub, move(0, 100, 5)) as never, 'PinPair<2>');
    tool.UpdateAssemblies();
    const writer = new oc.STEPCAFControl_Writer();
    writer.SetNameMode(true);
    expect(writer.Perform(doc, '/nested.step', new oc.Message_ProgressRange())).toBe(true);
    const text = oc.FS.readFile('/nested.step', { encoding: 'utf8' }) as string;

    const usages = (text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g) ?? []).length;
    const products = new Set([...text.matchAll(/PRODUCT\('([^']*)'/g)].map((m) => m[1]));
    console.log(`巢狀 STEP：NEXT_ASSEMBLY_USAGE_OCCURRENCE ${usages} 個；PRODUCT ${[...products].join('、')}；檔案 ${text.length} 位元組`);
    expect(usages).toBe(5);

    // read it back and walk it recursively, accumulating poses, the way an importer would
    const back = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('MDTV-XCAF', false));
    const reader = new oc.STEPCAFControl_Reader();
    reader.SetNameMode(true);
    expect(String(reader.ReadFile('/nested.step'))).toBe('IFSelect_RetDone');
    expect(reader.Transfer(back, new oc.Message_ProgressRange())).toBe(true);
    const bt = oc.XCAFDoc_DocumentTool.ShapeTool(back.Main());
    const nameOf = (l: InstanceType<typeof oc.TDF_Label>): string | null => {
      const f = l.FindAttribute(oc.TDataStd_Name.GetID());
      return f.returnValue ? new oc.TCollection_AsciiString((f.anAttribute as unknown as { Get(): never }).Get(), '\0').ToCString() : null;
    };
    interface Visit { path: string; product: string | null; origin: number[]; leaf: boolean }
    const visits: Visit[] = [];
    const walk = (label: InstanceType<typeof oc.TDF_Label>, parent: string, at: number[]) => {
      const kids = new oc.NCollection_Sequence_TDF_Label();
      oc.XCAFDoc_ShapeTool.GetComponents(label, kids, false);
      for (let i = 1; i <= kids.Length(); i++) {
        const comp = kids.Value(i);
        const referred = new oc.TDF_Label();
        oc.XCAFDoc_ShapeTool.GetReferredShape(comp, referred);
        const t = oc.XCAFDoc_ShapeTool.GetLocation(comp).Transformation().TranslationPart();
        const origin = [at[0]! + t.X(), at[1]! + t.Y(), at[2]! + t.Z()];
        const path = `${parent}/${nameOf(comp)}`;
        const leaf = !oc.XCAFDoc_ShapeTool.IsAssembly(referred);
        visits.push({ path, product: nameOf(referred), origin, leaf });
        if (!leaf) walk(referred, path, origin);
      }
    };
    const roots = new oc.NCollection_Sequence_TDF_Label();
    bt.GetFreeShapes(roots);
    expect(roots.Length()).toBe(1);
    walk(roots.Value(1), nameOf(roots.Value(1)) ?? '', [0, 0, 0]);
    for (const v of visits) console.log(`  ${v.path}  → ${v.product}  (${v.origin.map((x) => x.toFixed(1)).join(', ')})${v.leaf ? '' : '  [次組合件]'}`);
    const leaves = visits.filter((v) => v.leaf);
    expect(leaves.length).toBe(5); // 1 plate + 2 × 2 pins
    const origins = leaves.filter((v) => v.product === 'pin').map((v) => v.origin.join(','));
    expect(origins.sort()).toEqual(['-40,0,5', '-40,100,5', '40,0,5', '40,100,5'].sort());
    expect(new Set(leaves.map((v) => v.product)).size).toBe(2); // two prototypes: one part file each
    expect(visits.filter((v) => !v.leaf).map((v) => v.product)).toEqual(['PinPair', 'PinPair']);
    void rotationMatrix;
  });
});
