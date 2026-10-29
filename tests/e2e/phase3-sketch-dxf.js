// 「匯入 DXF」 into a sketch (F2.6, ADR 0219). Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-sketch-dxf.js?' + Date.now());
//   await __sketchDxf.run();
//
// A part with an empty sketch on the front plane is opened and the sketch edited. A binary DXF is refused in words. A DXF in inches with three layers is read:
// OUT (a closed polyline of 40 × 30 mm whose right side is a half circle, and a hole), CENTER (a centre line) and DIM (a dimension, not geometry). The dialog
// lists OUT and CENTER with their counts, the unit and the size, and the dimension as left out. CENTER is ticked as construction and the file imported: the
// sketch has the lines, the arc and the circle in millimetres, the outline's ends shared, the centre line construction; one undo takes it all back, redo
// brings it again. Accepted and extruded 10 mm, the part rebuilds.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__sketchDxf = {});

const sketchFeature = () => store.getState().doc.features.find((f) => f.id === 'sk');
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-9, `${what}: ${a} (expected ${b})`);
const ent = (type, ...pairs) => ['0', type, ...pairs.map(String)].join('\n');
// in inches: 40 × 30 mm is 1.5748… × 1.1811… in
const inch = (mm) => mm / 25.4;
const file = [
  '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  ent('LWPOLYLINE', 8, 'OUT', 90, 4, 70, 1, 10, 0, 20, 0, 10, inch(40), 20, 0, 42, 1, 10, inch(40), 20, inch(30), 10, 0, 20, inch(30)),
  ent('CIRCLE', 8, 'OUT', 10, inch(10), 20, inch(15), 40, inch(5)),
  ent('LINE', 8, 'CENTER', 10, inch(-5), 20, inch(15), 11, inch(60), 21, inch(15)),
  ent('DIMENSION', 8, 'DIM', 2, '*D1', 10, 0, 20, 0),
  '0', 'ENDSEC', '0', 'EOF',
].join('\n');

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('匯入.3dbx', await io.writePartFile(build(sketch('sk', front))));
  await H.open('匯入.3dbx');
  await H.waitFor(() => store.getState().result?.features?.every((f) => f.status === 'ok'), 20000, 'the part');
  store.beginEdit('sk');
  await H.waitFor(() => store.getState().editing?.kind === 'sketch', 5000, 'the sketch session');
  await H.settle();

  // a binary DXF is refused, in words, and no dialog opens
  const binary = new Uint8Array([...new TextEncoder().encode('AutoCAD Binary DXF\r\n\u001a\u0000'), 0, 0]);
  H.check(store.readDxfData('bin.dxf', binary) === false && store.getState().dxfImport === null, 'a binary DXF is refused');
  H.check(/ASCII/.test(store.getState().notice?.text ?? ''), `and the notice says to save it as ASCII: ${store.getState().notice?.text}`);

  // the dialog: the layers with geometry, their counts, the unit, the size, what is left out
  H.check(store.readDxfData('plate.dxf', new TextEncoder().encode(file)), 'the DXF is read');
  await H.settle();
  const dialog = await H.waitFor(() => document.querySelector('[data-dialog="dxf-import"]'), 5000, 'the dialog');
  const rows = [...dialog.querySelectorAll('[data-dxf-layer]')].map((r) => [r.dataset.dxfLayer, r.children[1].textContent]);
  // what each gives: OUT the polyline's four segments (three lines and the half circle) and the hole
  H.check(JSON.stringify(rows) === JSON.stringify([['CENTER', '1'], ['OUT', '5']]), `the layers and what they give: ${JSON.stringify(rows)}`);
  H.check(dialog.textContent.includes('in') && dialog.textContent.includes('25.4'), 'the unit is inches, 25.4 mm');
  H.check(dialog.textContent.includes('55.000 × 30.000') || dialog.textContent.includes('65.000 × 30.000'), `the size in mm: ${dialog.textContent}`);
  H.check(dialog.textContent.includes('DIMENSION ×1'), 'the dimension is said to be left out');
  const before = sketchFeature().entities.length;

  // CENTER as construction, then import
  dialog.querySelector('[data-dxf-layer="CENTER"] [data-field="construction"]').click();
  await H.settle();
  dialog.querySelector('[data-action="dxf-import"]').click();
  await H.waitFor(() => store.getState().dxfImport === null, 5000, 'the dialog closes');
  await H.settle();
  const f = sketchFeature();
  const of = (type) => f.entities.filter((e) => e.type === type);
  const at = (id) => f.entities.find((e) => e.id === id);
  H.check(of('line').length === 4 && of('arc').length === 1 && of('circle').length === 1, `3 + 1 lines, an arc and a circle: ${f.entities.map((e) => e.type).join(' ')}`);
  const centre = of('line').find((l) => Math.abs(at(l.p1).y - 15) < 1e-9 && Math.abs(at(l.p2).y - 15) < 1e-9);
  H.check(centre?.construction === true, 'the centre line is construction');
  H.check(of('line').filter((l) => l !== centre).every((l) => !l.construction), 'the outline is not');
  near(of('circle')[0].radius, 5, 'the hole is 5 mm in radius');
  const arc = of('arc')[0];
  near(Math.hypot(at(arc.start).x - at(arc.center).x, at(arc.start).y - at(arc.center).y), 15, 'the half circle is 15 mm in radius');
  near(at(arc.center).x, 40, 'its centre at x = 40');
  // the outline is closed: each of its four points is the end of two curves
  const ends = [...of('line').filter((l) => l !== centre).flatMap((l) => [l.p1, l.p2]), arc.start, arc.end];
  H.check(new Set(ends).size === 4 && [...new Set(ends)].every((id) => ends.filter((x) => x === id).length === 2), 'the outline\'s ends are shared');
  await H.waitFor(() => store.getState().sketchSolve?.status && store.getState().sketchSolve.status !== 'failed', 10000, 'the sketch solves');
  H.check(/plate\.dxf/.test(store.getState().notice?.text ?? ''), `the notice says what came in: ${store.getState().notice?.text}`);

  // one undo takes it all back
  store.undo();
  await H.settle();
  H.check(sketchFeature().entities.length === before, 'one undo takes the import back');
  store.redo();
  await H.settle();
  H.check(sketchFeature().entities.length === f.entities.length, 'and redo brings it again');

  // accepted and extruded, the part rebuilds
  store.commitEdit();
  await H.settle();
  store.execute({ type: 'insertFeature', feature: extrude('e1', 'sk', 'boss', { type: 'blind', depth: '10' }), index: 1 });
  await H.waitFor(() => store.getState().result?.features?.find((x) => x.id === 'e1')?.status === 'ok', 20000, 'the extrusion');
  H.check(store.getState().result.features.every((x) => x.status === 'ok'), `the part rebuilds: ${store.getState().result.features.map((x) => `${x.id}=${x.status}`).join(' ')}`);
  await H.tidy();
  console.log('phase3-sketch-dxf: all checks passed');
  return true;
};
