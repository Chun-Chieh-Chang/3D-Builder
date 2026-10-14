// Phase 5, the dimensions as DIMENSION entities of the DXF (D-2, docs/drawing-callouts-plan.md): in the browser, through the drawing panel. Run it in a freshly loaded
// app page (http://127.0.0.1:5391, 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-dxf-dimensions.js?' + Date.now());
//   await __dxfDims.run();
//
// The part is the golden locating plate (120 × 80 × 15). The front view is dimensioned (overall size, holes with callouts, positions) and the scene the page holds is
// written as a DXF with the writer of the app and read back: one DIMENSION for each dimension, its block, its text, and the number its definition points measure.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const x = (window.__dxfDims = {});

const drw = () => store.getState().drw;
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const click = async (el) => {
  el.click();
  await H.wait(150);
};
const check = async (el, on) => {
  if (el.checked !== on) await click(el);
};

x.run = async () => {
  H.ready();
  const drawing = await import(`${root}packages/drawing/src/index.ts`);
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
  await H.open('定位板.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.newDrawing();
  await H.waitFor(() => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
  const top = drw().doc.views.find((v) => v.direction === 'top');
  await click(panel(`[data-view="${top.id}"]`));
  await H.waitFor(() => drw().features.get(top.id), 30000, 'the features of the top view');
  await check(panel('[data-field="auto-overall"]'), true);
  await check(panel('[data-field="auto-holes"]'), true);
  await check(panel('[data-field="auto-positions"]'), true);
  await click(panel('[data-action="autoDimension"]'));
  await H.waitFor(() => drw().doc.dimensions.length >= 10 && drw().elements.size === drw().doc.dimensions.length, 30000, 'the dimensions');
  const built = store.drawingStore.scene();
  H.check([...built.dimensions.values()].every((o) => 'value' in o), 'every dimension is worked out');
  const dxfText = drawing.toDxf(built.scene);
  const doc = drawing.readDxf(dxfText);
  const problems = drawing.checkDxf(doc);
  H.check(problems.length === 0, `the DXF is sound: ${problems.join(' | ')}`);
  const dims = doc.entities.filter((e) => e.type === 'DIMENSION');
  H.check(dims.length === drw().doc.dimensions.length, `one DIMENSION for each dimension: ${dims.length} of ${drw().doc.dimensions.length}`);
  const values = drw().doc.dimensions.map((d) => built.dimensions.get(d.id).value);
  // on the sheet a length is drawn at the scale of its view; an angle is not
  const off = dims.map((e, i) => Math.abs(drawing.dimensionMeasure(e) / (e.kind === 2 ? 1 : built.placed.get(drw().doc.dimensions[i].view).scale) - values[i])).filter((v) => v > 1e-4);
  H.check(off.length === 0, `the definition points measure the model's numbers (off: ${off.join(', ')})`);
  H.check(dims.every((e) => doc.blockEntities.get(e.block)?.length > 1), 'every DIMENSION has its block');
  const kinds = [...new Set(dims.map((e) => e.kind))].sort();
  return { dimensions: dims.length, kinds, texts: dims.map((e) => e.text).sort() };
};
