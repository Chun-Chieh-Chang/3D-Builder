// Phase 5-4a: annotations and tables in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-annotations.js?' + Date.now());
//   await __annot.run();
//
// The part is the golden locating plate (120 × 80 × 15). In a new drawing: the centre marks of the top view and the centre lines of the front view, switched off
// and on through the panel; the diameters with their hole callouts; a hole table with a tolerance class for the Ø9 holes; the drawing saved and opened again.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const a = (window.__annot = {});

const drw = () => store.getState().drw;
const page = () => H.page(drw()?.doc);
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const click = async (el) => {
  el.click();
  await H.wait(150);
};
const check = async (el, on) => {
  if (el.checked !== on) await click(el);
};
const scene = () => store.drawingStore.scene();
const centreLines = () => scene().scene.items.filter((i) => i.kind === 'polyline' && i.style === 'center').length;
const texts = () => scene().scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));

a.run = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
  await H.open('定位板.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.newDrawing();
  await H.waitFor(() => drw() && page()?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
  const view = (dir) => page()?.views.find((v) => v.direction === dir);
  await H.waitFor(() => drw().features.get(view('top').id) && drw().features.get(view('front').id), 30000, 'the features');

  // the centre marks: a cross on each of the six holes of the top view (four halves each), the axes of the four distinct holes of the front view and of the three
  // of the right view (two halves each)
  H.check(centreLines() === 24 + 8 + 6, `centre marks and lines: ${centreLines()}`);
  await click(panel(`[data-view="${view('top').id}"]`));
  await check(panel('[data-field="centreMarks"]'), false);
  await H.waitFor(() => centreLines() === 14, 3000, 'the top view without centre marks');
  await check(panel('[data-field="centreMarks"]'), true);
  await H.waitFor(() => centreLines() === 38, 3000, 'the centre marks back');

  // the diameters with their hole callouts
  await check(panel('[data-field="auto-overall"]'), false);
  await check(panel('[data-field="auto-positions"]'), false);
  await check(panel('[data-field="auto-callouts"]'), true);
  await click(panel('[data-action="autoDimension"]'));
  await H.waitFor(() => page()?.dimensions.length === 3 && drw().elements.size === 3, 30000, 'three dimensions');
  H.check(JSON.stringify([...scene().dimensions.values()].map((o) => o.text).sort()) === JSON.stringify(['2×Ø8 貫穿', '4×R10', '4×Ø9 貫穿']), `callouts: ${[...scene().dimensions.values()].map((o) => o.text)}`);
  // holes far enough apart: no warning of texts over each other
  H.check(!document.querySelector('[data-field="overlap"]'), 'no warning of overlapping texts on the plate');
  // the callout can be switched off for one of them
  const nine = page()?.dimensions.find((d) => d.kind === 'diameter' && d.count === 4);
  await click(panel(`[data-dimension="${nine.id}"]`));
  await click(panel('[data-field="dimCallout"]'));
  await H.waitFor(() => [...scene().dimensions.values()].some((o) => o.text === '4×Ø9'), 3000, 'no callout');
  await click(panel('[data-field="dimCallout"]'));
  await H.waitFor(() => [...scene().dimensions.values()].some((o) => o.text === '4×Ø9 貫穿'), 3000, 'the callout back');

  // the hole table
  await click(panel('[data-action="addHoleTable"]'));
  await H.waitFor(() => page()?.tables.length === 1, 3000, 'the table');
  const table = page()?.tables[0];
  const rows = scene().tables.get(table.id);
  H.check(rows.map((r) => r.tag).join() === 'A1,A2,A3,A4,B1,B2', `tags: ${rows.map((r) => r.tag)}`);
  H.check(JSON.stringify(rows.slice(0, 4).map((r) => [Math.round(r.x * 1e4) / 1e4, Math.round(r.y * 1e4) / 1e4])) === '[[10,70],[110,70],[10,10],[110,10]]', 'the Ø9 holes from the left and bottom');
  H.check(texts().filter((t) => t === 'A1').length === 2 && texts().includes('Ø8 貫穿'), 'the table and the tags are drawn');
  // a class for the Ø9 holes
  const fit = panel('[data-field="tableFit-9"]');
  fit.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(fit, 'H11');
  fit.dispatchEvent(new Event('input', { bubbles: true }));
  fit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.waitFor(() => texts().includes('Ø9 H11 (+0.09/0) 貫穿'), 3000, 'the class in the table');
  await H.waitFor(() => document.querySelector('[data-svg] svg'), 5000, 'the SVG');
  H.check([...document.querySelectorAll('[data-svg] svg text')].some((t) => t.textContent === 'Ø9 H11 (+0.09/0) 貫穿'), 'on the sheet');
  // a class that is not supported is refused
  fit.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(fit, 'X9');
  fit.dispatchEvent(new Event('input', { bubbles: true }));
  fit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.wait(300);
  H.check(page()?.tables[0].fits['9'] === 'H11', 'an unsupported class is refused');

  // undo and redo
  store.undo();
  await H.wait(200);
  store.redo();
  await H.wait(200);
  H.check(page()?.tables[0].fits['9'] === 'H11', 'undone and redone');

  // saved and opened again
  H.next.save = '定位板.3dbd';
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => !drw().dirty, 10000, 'the save');
  await H.open('定位板.3dbd');
  await H.waitFor(() => drw() && drw().fileName === '定位板.3dbd' && page()?.tables.length === 1 && drw().features.get(page()?.views[0].id) && scene().tables.get(page()?.tables[0].id)?.length === 6, 40000, 'the drawing to open');
  H.check(texts().includes('Ø9 H11 (+0.09/0) 貫穿') && centreLines() === 38, 'the same drawing');

  // deleting the table
  await click(panel(`[data-view="${page()?.tables[0].view}"]`));
  await click(panel('[data-action="deleteTable"]'));
  await H.waitFor(() => (page()?.tables ?? []).length === 0, 3000, 'the table deleted');
  console.log('phase5-annotations: all checks passed');
  return true;
};
