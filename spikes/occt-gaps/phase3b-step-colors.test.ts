// Phase 3b-3 spike: can the face colors of a STEP file be read back through XCAF with this binding?
// Run: npx vitest run --config spikes/occt-gaps/vitest.config.ts spikes/occt-gaps/phase3b-step-colors.test.ts --reporter=verbose
import { readFileSync } from 'node:fs';
import { beforeAll, describe, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { PlaneGcsSolver } from '@3db/sketch';
import { readPartFile } from '@3db/io';

let kernel: Kernel;
let shape: ReturnType<Kernel['clone']>;
beforeAll(async () => {
  kernel = await Kernel.load();
  const doc = (await readPartFile(new Uint8Array(readFileSync(new URL('../../tests/golden/diamond-pin.3dbx', import.meta.url))))).doc;
  shape = new Regenerator(kernel, await PlaneGcsSolver.create()).rebuild(doc).body!.shape;
});

describe('step colors', () => {
  it('reads colors back', () => {
    const n = kernel.topology(shape).faces.length;
    const colors = Array.from({ length: n }, (_, i) => (i === 2 ? '#ff0000' : i === 5 ? '#00aa33' : null));
    const text = kernel.exportStep(shape, 'pin', 'MM', { faceColors: colors });
    const oc = kernel.oc as any;
    oc.FS.writeFile('/c.step', text);
    const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('MDTV-XCAF', false));
    const reader = new oc.STEPCAFControl_Reader();
    reader.SetNameMode(true);
    reader.SetColorMode(true);
    reader.ReadFile('/c.step');
    reader.Transfer(doc, new oc.Message_ProgressRange());
    const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(doc.Main());
    const roots = new oc.NCollection_Sequence_TDF_Label();
    tool.GetFreeShapes(roots);
    const root = roots.Value(1);
    const subs = new oc.NCollection_Sequence_TDF_Label();
    console.log('GetSubShapes:', typeof oc.XCAFDoc_ShapeTool.GetSubShapes, 'colorTool methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(colorTool)).filter((m) => /Color|Get|Is/.test(m)).join(','));
    try {
      oc.XCAFDoc_ShapeTool.GetSubShapes(root, subs);
      console.log('subshape labels', subs.Length());
    } catch (e) {
      console.log('GetSubShapes failed', String(e));
    }
    for (let i = 1; i <= Math.min(subs.Length(), 40); i++) {
      const l = subs.Value(i);
      for (const type of ['XCAFDoc_ColorSurf', 'XCAFDoc_ColorGen']) {
        try {
          const c = new oc.Quantity_Color();
          const sub = oc.XCAFDoc_ShapeTool.GetShape(l);
          const got = colorTool.GetColor(sub, oc.XCAFDoc_ColorType[type], c);
          const idx = kernel.topology(shape).faces.length;
          let index = -1;
          // which face of the original is it: by the shape map of the root
          const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
          oc.TopExp.MapShapes(oc.XCAFDoc_ShapeTool.GetShape(root), oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
          index = map.FindIndex(sub);
          if (got) console.log(i, type, 'faceIndex(1-based)', index, 'of', idx, c.Red().toFixed(3), c.Green().toFixed(3), c.Blue().toFixed(3));
        } catch (e) {
          console.log(i, type, 'threw', (() => { try { return oc.getExceptionMessage(e).join(' / '); } catch { return String(e); } })());
          break;
        }
      }
    }
  });
});
