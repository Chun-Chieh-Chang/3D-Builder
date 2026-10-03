// Phase 5-3: dimensions in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-dimensions.js?' + Date.now());
//   await __dims.run();
//
// The part is the golden locating plate (120 × 80 × 15). In a new drawing the top view is dimensioned through the panel: the overall size and the holes at once,
// then where the holes are, a tolerance class and a reference dimension on the ones that are written, one dimension between two elements; the front view; the
// drawing saved and opened again with every dimension still worked out from the model.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const x = (window.__dims = {});

const drw = () => store.getState().drw;
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const click = async (el) => {
  el.click();
  await H.wait(150);
};
const choose = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(200);
};
const check = async (el, on) => {
  if (el.checked !== on) await click(el);
};
const texts = () => [...store.drawingStore.scene().dimensions.values()].map((o) => ('error' in o ? 'ERROR ' + o.error : o.text));

x.run = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
  await H.open('定位板.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.action('檔案', '新工程圖');
  await H.waitFor(() => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
  const view = (dir) => drw().doc.views.find((v) => v.direction === dir);

  // nothing selected: nothing to dimension
  H.check(!!panel('[data-group="dimensions"] .muted'), 'select a view first');

  // the top view: what it can be dimensioned from is worked out in the worker
  await click(panel(`[data-view="${view('top').id}"]`));
  await H.waitFor(() => drw().features.get(view('top').id), 30000, 'the features of the top view');
  const features = drw().features.get(view('top').id);
  H.check(features.filter((f) => f.type === 'circle' && f.full).length === 6 && features.filter((f) => f.type === 'circle' && !f.full).length === 4, 'six holes and four arcs seen as circles');
  H.check(features.filter((f) => f.type === 'plane').length >= 4, 'planes at the ends of x and y');

  // the overall size and the holes, at once
  await check(panel('[data-field="auto-positions"]'), false);
  await click(panel('[data-action="autoDimension"]'));
  await H.waitFor(() => drw().doc.dimensions.length === 5 && drw().elements.size === 5, 30000, 'five dimensions worked out');
  H.check(JSON.stringify(texts().sort()) === JSON.stringify(['120', '2×Ø8', '4×R10', '4×Ø9', '80']), `overall size and holes: ${texts().join(' | ')}`);
  // asked again: nothing new
  await click(panel('[data-action="autoDimension"]'));
  H.check(drw().doc.dimensions.length === 5, 'no dimension is made twice');

  // where the holes are, from the left and the bottom
  await check(panel('[data-field="auto-overall"]'), false);
  await check(panel('[data-field="auto-holes"]'), false);
  await check(panel('[data-field="auto-positions"]'), true);
  await click(panel('[data-action="autoDimension"]'));
  await H.waitFor(() => drw().doc.dimensions.length === 12 && drw().elements.size === 12, 30000, 'twelve dimensions');
  const linear = drw().doc.dimensions.filter((d) => d.kind === 'linear');
  const values = (o) =>
    linear
      .filter((d) => d.orientation === o)
      .map((d) => store.drawingStore.scene().dimensions.get(d.id).value)
      .map((v) => Math.round(v * 1e6) / 1e6)
      .sort((a, b) => a - b);
  H.check(JSON.stringify(values('horizontal')) === JSON.stringify([10, 20, 100, 110, 120]), `horizontal: ${values('horizontal')}`);
  H.check(JSON.stringify(values('vertical')) === JSON.stringify([10, 40, 70, 80]), `vertical: ${values('vertical')}`);
  H.check(new Set(linear.filter((d) => d.orientation === 'horizontal').map((d) => d.offset)).size === 5, 'the horizontal ones are stacked at different distances');

  // a tolerance class on the diameter of the Ø9 holes
  const nine = drw().doc.dimensions.find((d) => d.kind === 'diameter' && d.count === 4);
  await click(panel(`[data-dimension="${nine.id}"]`));
  await choose(panel('[data-field="dimToleranceType"]'), 'fit');
  await H.waitFor(() => texts().includes('4×Ø9 H7 (+0.015/0)'), 3000, 'H7');
  const fit = panel('[data-field="dimFit"]');
  fit.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(fit, 'H11');
  fit.dispatchEvent(new Event('input', { bubbles: true }));
  fit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.waitFor(() => texts().includes('4×Ø9 H11 (+0.09/0)'), 3000, 'H11');
  // a class that is not supported is refused with the reason, and the dimension is left as it was
  fit.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(fit, 'X9');
  fit.dispatchEvent(new Event('input', { bubbles: true }));
  fit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.wait(300);
  H.check(drw().doc.dimensions.find((d) => d.id === nine.id).tolerance.fit === 'H11', 'an unsupported class is refused');

  // a reference dimension, and limits on a linear one
  const overall = drw().doc.dimensions.find((d) => d.kind === 'linear' && d.orientation === 'horizontal' && store.drawingStore.scene().dimensions.get(d.id).text === '120');
  await click(panel(`[data-dimension="${overall.id}"]`));
  await click(panel('[data-field="dimReference"]'));
  await H.waitFor(() => texts().includes('(120)'), 3000, 'a reference dimension');
  await choose(panel('[data-field="dimToleranceType"]'), 'bilateral');
  await H.waitFor(() => texts().includes('(120 ±0.05)'), 3000, 'limits');

  // one between two elements, through the lists
  const before = drw().doc.dimensions.length;
  // a plane square to x and the first circle (the lists hold the planes and then the circles), measured horizontally
  const planes = features.filter((f) => f.type === 'plane');
  await choose(panel('[data-field="dimA"]'), String(planes.findIndex((f) => f.axis === 'x')));
  await choose(panel('[data-field="dimB"]'), String(planes.length));
  await choose(panel('[data-field="dimOrientation"]'), 'horizontal');
  await click(panel('[data-action="addLinear"]'));
  await H.waitFor(() => drw().doc.dimensions.length === before + 1, 3000, 'a dimension between two elements');

  // the canvas: the dimensions are drawn (filled arrowheads, text)
  await H.waitFor(() => document.querySelector('[data-svg] svg'), 5000, 'the SVG');
  const svg = document.querySelector('[data-svg] svg');
  H.check([...svg.querySelectorAll('text')].some((t) => t.textContent === '4×Ø9 H11 (+0.09/0)'), 'the tolerance is on the sheet');
  H.check(svg.querySelectorAll('polygon[fill="#000000"]').length >= 20, `arrowheads are drawn: ${svg.querySelectorAll('polygon[fill="#000000"]').length}`);

  // undo and redo: one step for each command
  const n = drw().doc.dimensions.length;
  store.undo();
  await H.wait(200);
  H.check(drw().doc.dimensions.length === n - 1, 'undone');
  store.redo();
  await H.wait(200);
  H.check(drw().doc.dimensions.length === n, 'redone');

  // the front view: the overall width and height; no holes are seen as circles there
  await click(panel(`[data-view="${view('front').id}"]`));
  await H.waitFor(() => drw().features.get(view('front').id), 30000, 'the features of the front view');
  await check(panel('[data-field="auto-overall"]'), true);
  await check(panel('[data-field="auto-holes"]'), true);
  await check(panel('[data-field="auto-positions"]'), false);
  await click(panel('[data-action="autoDimension"]'));
  await H.waitFor(() => drw().doc.dimensions.filter((d) => d.view === view('front').id).length === 2, 30000, 'the front view dimensions');
  await H.waitFor(() => drw().doc.dimensions.every((d) => drw().elements.has(d.id)), 30000, 'every dimension worked out');
  const front = drw().doc.dimensions.filter((d) => d.view === view('front').id).map((d) => store.drawingStore.scene().dimensions.get(d.id).text);
  H.check(JSON.stringify(front.sort()) === JSON.stringify(['120', '15']), `the front view is 120 × 15: ${front}`);
  H.check(!texts().some((t) => t.startsWith('ERROR')), `no dimension is in error: ${texts().filter((t) => t.startsWith('ERROR'))}`);

  // saved and opened again: the same dimensions, worked out again from the part
  const count = drw().doc.dimensions.length;
  H.next.save = '定位板.3dbd';
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => !drw().dirty, 10000, 'the save');
  await H.open('定位板.3dbd');
  await H.waitFor(() => drw() && drw().fileName === '定位板.3dbd' && drw().doc.dimensions.length === count && drw().elements.size === count, 40000, 'the drawing to open');
  H.check(texts().includes('4×Ø9 H11 (+0.09/0)') && texts().includes('(120 ±0.05)'), `the same dimensions: ${texts().length}`);

  // deleting a view takes its dimensions with it
  store.drawingStore.deleteViews([view('front').id]);
  await H.waitFor(() => drw().doc.dimensions.length === count - 2, 3000, 'the dimensions of the deleted view');
  console.log('phase5-dimensions: all checks passed');
  return true;
};
