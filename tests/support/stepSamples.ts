/**
 * STEP files with defects, made on purpose (F2.2, A1.7): there is no broken file from a real CAD system to hand, so
 * the defects are built here on a block whose volume is known. Used by the kernel's import tests and by the part
 * tests that carry such a file into a document.
 */
import type { Kernel } from '@3db/kernel';

type Shape = { delete(): void };

export interface StepSamples {
  /** A W × D × H block as a solid. */
  block(w?: number, d?: number, h?: number): Uint8Array;
  /** The six faces of the block as separate surfaces, no solid. */
  facesOnly(): Uint8Array;
  /** The faces with the top one lifted by `gap` mm, so that it no longer meets the sides. */
  gapped(gap: number): Uint8Array;
  /** Five faces of the block: a box without its lid. */
  openBox(): Uint8Array;
  /** A single edge: no faces at all. */
  lineOnly(): Uint8Array;
  /** A 5 × 5 × 5 block and, far from it, a single face. */
  blockWithStrayFace(): Uint8Array;
  /** Volume of `block()`. */
  readonly volume: number;
}

export function stepSamples(k: Kernel): StepSamples {
  const oc = k.oc;
  const T = oc.TopAbs_ShapeEnum;
  const progress = () => new oc.Message_ProgressRange();

  const box = (w: number, d: number, h: number) => new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0, 0, 0), w, d, h).Shape();
  const facesOf = (shape: ReturnType<typeof box>) => {
    const faces: ReturnType<typeof box>[] = [];
    for (const ex = new oc.TopExp_Explorer(shape, T.TopAbs_FACE, T.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(ex.Current());
    return faces;
  };
  const compoundOf = (shapes: Shape[]) => {
    const compound = new oc.TopoDS_Compound();
    const builder = new oc.BRep_Builder();
    builder.MakeCompound(compound);
    for (const s of shapes) builder.Add(compound, s as never);
    return compound;
  };
  const stepOf = (shape: never): Uint8Array => {
    const w = new oc.STEPControl_Writer();
    w.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress());
    const path = `/sample-${Math.random().toString(36).slice(2)}.step`;
    w.Write(path);
    const bytes = oc.FS.readFile(path) as Uint8Array;
    oc.FS.unlink(path);
    return bytes;
  };
  const lifted = (face: Shape, dz: number) => {
    const trsf = new oc.gp_Trsf();
    trsf.SetTranslation(new oc.gp_Vec(0, 0, dz));
    return new oc.BRepBuilderAPI_Transform(face as never, trsf, true, false).Shape();
  };
  /** The face at the top (z = 5) of the 20 × 10 × 5 block. */
  const topOf = (faces: ReturnType<typeof facesOf>) => {
    const f = faces.find((x) => {
      const p = new oc.GProp_GProps();
      oc.BRepGProp.SurfaceProperties(x, p, false, false);
      return Math.abs(p.CentreOfMass().Z() - 5) < 1e-9 && Math.abs(p.CentreOfMass().X() - 10) < 1e-9;
    });
    if (!f) throw new Error('top face not found');
    return f;
  };

  return {
    volume: 20 * 10 * 5,
    block: (w = 20, d = 10, h = 5) => stepOf(box(w, d, h) as never),
    facesOnly: () => stepOf(compoundOf(facesOf(box(20, 10, 5))) as never),
    gapped: (gap) => {
      const faces = facesOf(box(20, 10, 5));
      const top = topOf(faces);
      return stepOf(compoundOf(faces.map((f) => (f === top ? lifted(f, gap) : f))) as never);
    },
    openBox: () => {
      const faces = facesOf(box(20, 10, 5));
      const top = topOf(faces);
      return stepOf(compoundOf(faces.filter((f) => f !== top)) as never);
    },
    lineOnly: () => stepOf(new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Pnt(0, 0, 0), new oc.gp_Pnt(10, 0, 0)).Edge() as never),
    blockWithStrayFace: () => {
      const b = box(5, 5, 5);
      return stepOf(compoundOf([b, lifted(facesOf(b)[0]!, 100)]) as never);
    },
  };
}
