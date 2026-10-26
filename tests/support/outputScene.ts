/** The scenes the output tests (DXF, PDF) are written from: the golden locating plate drawn, dimensioned and tabled; and a font to match. */
import { readFileSync } from 'node:fs';
import {
  applyDrawingCommand,
  axesOf,
  createEmptyDrawing,
  viewVectors,
  type Dimension,
  type DrawingDoc,
  dimensionRefs, page } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, elementFacts, projectDrawingView, viewFeatures } from '@3db/regen';
import { autoDimensions, buildScene, type ElementsResult, type Scene, type ViewLines } from '@3db/drawing';

/**
 * The plate in its top and front views on an A3 sheet in first angle, the overall size, the holes with their callouts and the positions as dimensions (one with
 * a fit), the centre marks and lines, a hole table, and a title block with Chinese in it.
 */
export async function plateScene(): Promise<{ scene: Scene; doc: DrawingDoc; values: Map<string, number> }> {
  const kernel = await Kernel.load();
  const solver = await PlaneGcsSolver.create();
  const regen = new Regenerator(kernel, solver);
  try {
    const plate = (await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))))).doc;
    const body = regen.rebuild(plate).body!;
    let doc = applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [
        { id: 'view1', name: '上視', source: '定位板.3dbx', direction: 'top' },
        { id: 'view2', name: '前視', source: '定位板.3dbx', direction: 'front' },
      ],
    });
    doc = applyDrawingCommand(doc, { type: 'setTitle', field: 'drawingName', value: '定位板' });
    doc = applyDrawingCommand(doc, { type: 'setTitle', field: 'material', value: 'S45C' });
    doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { scale: [1, 1] } });
    const lines = new Map<string, ViewLines>();
    const features = new Map();
    for (const v of page(doc).views) {
      const axes = axesOf(page(doc).views, page(doc).sheet.projection, v)!;
      lines.set(v.id, projectDrawingView(kernel, [{ shape: body.shape, pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, mirrored: false }], axes));
      features.set(v.id, viewFeatures(body.topology, body.names, axes));
    }
    const drafts = autoDimensions(features.get('view1'), { overall: true, holes: true, positions: true, callouts: true });
    let fitted = false;
    const dimensions = drafts.map((d, i) => {
      const fit = d.kind === 'diameter' && !fitted ? { tolerance: { type: 'fit', fit: 'H11' } } : {};
      if (d.kind === 'diameter') fitted = true;
      return { ...d, id: `dim${i + 1}`, view: 'view1', ...fit } as Dimension;
    });
    doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions });
    doc = applyDrawingCommand(doc, { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1', fits: { '8': 'H7' } }] });
    const elements = new Map<string, ElementsResult>(
      page(doc).dimensions.map((d) => {
        const refs = dimensionRefs(d);
        return [d.id, { elements: refs.map((r) => elementFacts(body.topology, body.names, r)) as never }];
      }),
    );
    const { scene, dimensions: outcomes } = buildScene(doc, lines, elements, features);
    void viewVectors;
    // what each dimension came to, in the order of the document
    const values = new Map(page(doc).dimensions.flatMap((d) => { const o = outcomes.get(d.id); return o && 'value' in o ? [[d.id, o.value] as const] : []; }));
    return { scene, doc, values };
  } finally {
    regen.dispose();
  }
}

export { testFont, type TestFontOptions } from './testFont';
