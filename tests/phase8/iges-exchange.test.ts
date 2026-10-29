/**
 * IGES export and import (F1.4, F2.2) on real parts: the golden parts, a cylinder rounded all the way round its top (a whole torus) and a box with a
 * ball on it (a whole sphere), each written as trimmed surfaces and as a B-rep solid. What is written is read back by a reader of the test's own
 * (OCCT's IGES reader and its own sewing, not `importIges`), and by `importIges` through a part: the same volume, size and faces.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, CommandError, createEmptyPart, SCHEMA_VERSION, type BlobRef, type Feature, type PartDoc } from '@3db/model';
import { exportPartIges, isIgesData, isStepData, readPartFile, sha256Hex, writePartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const made: ShapeId[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => made.forEach((id) => kernel.release(id)));

type Oc = Kernel['oc'];
const put = (shape: unknown): ShapeId => {
  const id = (kernel as unknown as { put(s: unknown): ShapeId }).put(shape);
  made.push(id);
  return id;
};

/** The shape of each golden part, copied out of its rebuild. */
async function golden(name: string): Promise<ShapeId> {
  const file = await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${name}`, import.meta.url))));
  const regen = new Regenerator(kernel, solver);
  const id = kernel.copy(regen.rebuild(file.doc).body!.shape);
  regen.dispose();
  made.push(id);
  return id;
}

/** A Ø30 × 30 cylinder whose top edge is rounded R4 all the way round: the fillet is a whole torus. */
function roundedCylinder(oc: Oc): ShapeId {
  const cyl = new oc.BRepPrimAPI_MakeCylinder(15, 30).Shape();
  const fillet = new oc.BRepFilletAPI_MakeFillet(cyl, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  for (const ex = new oc.TopExp_Explorer(cyl, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const e = oc.TopoDS.Edge(ex.Current());
    const c = new oc.BRepAdaptor_Curve(e);
    if (String(c.GetType()).includes('Circle') && c.Value(0).Z() > 29) fillet.Add(4, e);
  }
  fillet.Build(new oc.Message_ProgressRange());
  return put(fillet.Shape());
}

/** A 40 × 30 × 20 box with a Ø20 ball centred on its top face: the ball is a whole sphere face. */
function boxAndBall(oc: Oc): ShapeId {
  const box = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0, 0, 0), 40, 30, 20).Shape();
  const ball = new oc.BRepPrimAPI_MakeSphere(new oc.gp_Pnt(20, 15, 20), 10).Shape();
  return put(new oc.BRepAlgoAPI_Fuse(box, ball, new oc.Message_ProgressRange()).Shape());
}

/**
 * An IGES file read by the test's own reader: OCCT's IGES reader, then (for trimmed surfaces) its sewing and a solid made of each closed shell.
 * The volume, the bounding box, and the number of solids and faces.
 */
function readIndependently(oc: Oc, text: string): { solids: number; faces: number; volume: number; min: number[]; max: number[] } {
  const path = '/iges-independent.igs';
  oc.FS.writeFile(path, text);
  const reader = new oc.IGESControl_Reader();
  try {
    expect(String(reader.ReadFile(path))).toBe('IFSelect_RetDone');
    reader.TransferRoots(new oc.Message_ProgressRange());
    let shape = reader.OneShape();
    const count = (s: typeof shape, type: unknown) => {
      let n = 0;
      for (const ex = new oc.TopExp_Explorer(s, type as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) n++;
      return n;
    };
    if (count(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID) === 0) {
      // 1e-4 mm: the trimming curves of a file of surfaces are written to 1e-7 of the part's size, and the edges of two faces may be that far apart
      const sewing = new oc.BRepBuilderAPI_Sewing(1e-4, true, true, true, false);
      sewing.Add(shape);
      sewing.Perform(new oc.Message_ProgressRange());
      const sewn = sewing.SewedShape();
      const builder = new oc.BRepBuilderAPI_MakeSolid();
      for (const ex = new oc.TopExp_Explorer(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) builder.Add(oc.TopoDS.Shell(ex.Current()));
      const solid = builder.Solid();
      const fix = new oc.ShapeFix_Solid(solid); // orients the shell outwards, nothing else
      fix.Perform(new oc.Message_ProgressRange());
      shape = fix.Solid();
    }
    return { solids: count(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID), faces: count(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE), ...measure(oc, shape) };
  } finally {
    reader.delete();
    oc.FS.unlink(path);
  }
}

/** Volume and exact bounding box, measured the same way for the shape written and the shape read. */
function measure(oc: Oc, shape: unknown): { volume: number; min: number[]; max: number[] } {
  const props = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape as never, props, false, false, false);
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape as never, box, false, false);
  const lo = box.CornerMin();
  const hi = box.CornerMax();
  return { volume: props.Mass(), min: [lo.X(), lo.Y(), lo.Z()], max: [hi.X(), hi.Y(), hi.Z()] };
}
const shapeOfId = (id: ShapeId) => (kernel as unknown as { get(id: ShapeId): unknown }).get(id);

/** How many faces the writer writes: STEP and IGES cut the same closed faces in two, so the STEP of the shape read back has that many. */
function writtenFaces(shape: ShapeId): number {
  const back = kernel.importStep(kernel.exportStep(shape, 'count'));
  try {
    return kernel.topology(back.shape).faces.length;
  } finally {
    kernel.release(back.shape);
  }
}

const parts: [string, () => Promise<ShapeId>][] = [
  ['定位板 golden', () => golden('locating-plate.3dbx')],
  ['V 型塊 golden', () => golden('v-block.3dbx')],
  ['削邊銷 golden', () => golden('diamond-pin.3dbx')],
  ['whole-torus fillet', async () => roundedCylinder(kernel.oc)],
  ['whole sphere', async () => boxAndBall(kernel.oc)],
];

describe('IGES round trip of real parts (E1, I1)', () => {
  for (const [label, shapeOf] of parts) {
    for (const mode of ['faces', 'brep'] as const) {
      it(`${label}, ${mode}: one solid, volume within 1e-6, box within 1e-5 mm, the faces written`, async () => {
        const shape = await shapeOf();
        const { volume, ...bounds } = measure(kernel.oc, shapeOfId(shape));
        const text = exportPartIges(kernel, shape, 'P', { mode });
        const own = readIndependently(kernel.oc, text);
        expect(own.solids).toBe(1);
        expect(Math.abs(own.volume / volume - 1)).toBeLessThanOrEqual(1e-6);
        for (let i = 0; i < 3; i++) {
          expect(Math.abs(own.min[i]! - bounds.min[i]!)).toBeLessThanOrEqual(1e-5);
          expect(Math.abs(own.max[i]! - bounds.max[i]!)).toBeLessThanOrEqual(1e-5);
        }
        expect(own.faces).toBe(writtenFaces(shape));

        const r = kernel.importIges(text);
        try {
          expect(kernel.solidCount(r.shape)).toBe(1);
          expect(Math.abs(kernel.massProps(r.shape).volume / volume - 1)).toBeLessThanOrEqual(1e-6);
          expect(r.diagnostics.validAfter).toBe(true);
          expect(r.diagnostics.sewn).toBe(mode === 'faces');
          if (mode === 'faces') expect(r.diagnostics.freeEdges).toBe(0);
        } finally {
          kernel.release(r.shape);
        }
      });
    }
  }
});

describe('an IGES file in a part (F2.2: I4, I5, I6)', () => {
  let igs: Uint8Array;
  let sha: string;
  let volume: number;
  beforeAll(async () => {
    const plate = await golden('locating-plate.3dbx');
    volume = kernel.massProps(plate).volume;
    igs = new TextEncoder().encode(exportPartIges(kernel, plate, 'Plate'));
    sha = await sha256Hex(igs);
  });
  const blob = (kind: BlobRef['kind'] = 'iges'): BlobRef => ({ id: 'blob1', sha256: sha, kind, fileName: 'plate.igs' });
  const feature: Extract<Feature, { type: 'importedBody' }> = { id: 'imp1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' };
  const doc = (): PartDoc => applyCommand(createEmptyPart(), { type: 'importBody', blob: blob(), feature, index: 0 });

  it('rebuilds the solid from the data, and names its faces the same way on every rebuild', () => {
    const regen = new Regenerator(kernel, solver, new Map([[sha, igs]]));
    const first = regen.rebuild(doc());
    expect(first.features.map((f) => f.status)).toEqual(['ok']);
    expect(Math.abs(kernel.massProps(first.body!.shape).volume / volume - 1)).toBeLessThanOrEqual(1e-6);
    const names = first.body!.names.faces;
    const centers = first.body!.topology.faces.map((f) => f.center.map((c) => c.toFixed(9)).join());
    const live = kernel.liveShapes;
    for (let n = 0; n < 10; n++) {
      const again = regen.rebuild(doc());
      expect(again.body!.names.faces).toEqual(names);
      expect(again.body!.topology.faces.map((f) => f.center.map((c) => c.toFixed(9)).join())).toEqual(centers);
    }
    expect(kernel.liveShapes).toBe(live);
    regen.dispose();
  });

  it('keeps the data in the part file, written at this version: a fresh program rebuilds the same volume and names', async () => {
    const before = new Regenerator(kernel, solver, new Map([[sha, igs]]));
    const r = before.rebuild(doc());
    const names = r.body!.names.faces;
    const v = kernel.massProps(r.body!.shape).volume;
    before.dispose();
    const bytes = await writePartFile(doc(), new Map([[sha, igs]]));
    const file = await readPartFile(bytes);
    expect(file.warnings).toEqual([]);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.schemaVersion).toBeGreaterThanOrEqual(85); // the version that brought IGES data
    expect(file.doc.blobs).toEqual([blob()]);
    expect(file.blobs.get(sha)).toEqual(igs);
    const after = new Regenerator(kernel, solver, file.blobs);
    const back = after.rebuild(file.doc);
    expect(back.body!.names.faces).toEqual(names);
    expect(kernel.massProps(back.body!.shape).volume).toBe(v);
    after.dispose();
  });

  it('refuses imported data that is not STEP or IGES', () => {
    expect(() => applyCommand(createEmptyPart(), { type: 'importBody', blob: blob('png'), feature, index: 0 })).toThrow(CommandError);
  });

  it('tells IGES from STEP by the first bytes, and refuses neither by mistake', () => {
    expect(isIgesData(igs)).toBe(true);
    expect(isStepData(igs)).toBe(false);
    const step = new TextEncoder().encode(kernel.exportStep(made[0]!, 'P'));
    expect(isIgesData(step)).toBe(false);
    // with CR LF line ends, as a file saved on Windows may have
    expect(isIgesData(new TextEncoder().encode(new TextDecoder().decode(igs).replace(/\n/g, '\r\n')))).toBe(true);
    expect(isIgesData(new TextEncoder().encode('hello'))).toBe(false);
    expect(isIgesData(new Uint8Array())).toBe(false);
  });
});
