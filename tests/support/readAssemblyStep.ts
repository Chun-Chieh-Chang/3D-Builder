import { expect } from 'vitest';
import type { Kernel } from '../../packages/kernel/src';

/** What another CAD system would find in an assembly STEP file. */
export interface AssemblyStepContents {
  /** The name of the top-level product, and whether it is an assembly. */
  root: string | null;
  isAssembly: boolean;
  /** One entry per component, in file order: the product it refers to, its own name, its origin and rotation (row-major 3×3). */
  items: { product: string | null; name: string | null; origin: number[]; matrix: number[] }[];
  /** Product name → volume of its shape. */
  volumes: Map<string, number>;
}

/** Reads a STEP text back through XCAF (STEPCAFControl_Reader), the way it is read to check what a writer wrote. */
export function readAssemblyStep(oc: Kernel['oc'], text: string): AssemblyStepContents {
  const path = '/assembly-read-back.step';
  oc.FS.writeFile(path, text);
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('MDTV-XCAF', false));
  try {
    const reader = new oc.STEPCAFControl_Reader();
    reader.SetNameMode(true);
    expect(String(reader.ReadFile(path))).toBe('IFSelect_RetDone');
    expect(reader.Transfer(doc, new oc.Message_ProgressRange())).toBe(true);
    const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const nameOf = (label: InstanceType<typeof oc.TDF_Label>): string | null => {
      const found = label.FindAttribute(oc.TDataStd_Name.GetID());
      // the attribute is a TDataStd_Name: Get() is not on the base class the binding declares
      const attribute = found.anAttribute as unknown as { Get(): never };
      return found.returnValue ? new oc.TCollection_AsciiString(attribute.Get(), '\0').ToCString() : null;
    };
    const roots = new oc.NCollection_Sequence_TDF_Label();
    tool.GetFreeShapes(roots);
    expect(roots.Length()).toBe(1);
    const root = roots.Value(1);
    const components = new oc.NCollection_Sequence_TDF_Label();
    oc.XCAFDoc_ShapeTool.GetComponents(root, components, false);
    const items: AssemblyStepContents['items'] = [];
    const volumes = new Map<string, number>();
    for (let i = 1; i <= components.Length(); i++) {
      const component = components.Value(i);
      const referred = new oc.TDF_Label();
      oc.XCAFDoc_ShapeTool.GetReferredShape(component, referred);
      const trsf = oc.XCAFDoc_ShapeTool.GetLocation(component).Transformation();
      const t = trsf.TranslationPart();
      const matrix: number[] = [];
      for (let row = 1; row <= 3; row++) for (let col = 1; col <= 3; col++) matrix.push(trsf.Value(row, col));
      const product = nameOf(referred);
      items.push({ product, name: nameOf(component), origin: [t.X(), t.Y(), t.Z()], matrix });
      if (product && !volumes.has(product)) {
        const props = new oc.GProp_GProps();
        oc.BRepGProp.VolumeProperties(oc.XCAFDoc_ShapeTool.GetShape(referred), props, false, false, false);
        volumes.set(product, props.Mass());
      }
    }
    return { root: nameOf(root), isAssembly: oc.XCAFDoc_ShapeTool.IsAssembly(root), items, volumes };
  } finally {
    doc.delete();
    oc.FS.unlink(path);
  }
}

/** The rotation matrix (row-major 3×3) of a unit quaternion x y z w. */
export function rotationMatrix([x, y, z, w]: readonly [number, number, number, number]): number[] {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
