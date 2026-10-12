import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { parsePart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

it('diagnoses OCCT fillet failure on edge 22', async () => {
  const k = await Kernel.load();
  const s = await PlaneGcsSolver.create();
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));

  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  sk4.plane = { kind: 'datum', name: 'plane:front' };

  const r = new Regenerator(k, s, new Map()).rebuild(doc);
  const b = r.body!;

  const oc = (k as any).oc;
  const shape = (k as any).get(b.shape);

  // 用 ShapeIndex 取 edge 22
  const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, map);
  const e22 = map.FindKey(23); // 1-based index 23 = 0-based 22

  const mk = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  mk.Add(0.1, oc.TopoDS.Edge(e22));
  try {
    mk.Build(new oc.Message_ProgressRange());
  } catch (err: any) {
    console.log('Build threw:', err);
  }
  const resShape = mk.Shape();
  const chk = k.check((k as any).put(resShape));
  console.log('chk valid:', chk.valid, 'badFaces:', chk.badFaces);
  chk.badFaces?.forEach((fi) => {
    const f = k.topology((k as any).put(resShape)).faces[fi];
    console.log(`Bad Face ${fi}: surface=${f?.surface}, center=[${f?.center?.map(v=>v.toFixed(3))}], area=${f?.area}`);
  });
});
