// Phase 5-1: a drawing of a part in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-drawing.js?' + Date.now());
//   await __drawing.run();
//
// The project folder is OPFS, as in phase2-assembly.js, whose helpers come with it. The part is the golden locating plate (120 × 80 × 15): 「新工程圖」 makes
// its front, top and right views on an A3 sheet, the first-angle arrangement, a scale is chosen, a view is moved, the title block written, the drawing saved
// and opened again, and exported as SVG.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const d = (window.__drawing = {});

const drw = () => store.getState().drw;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

d.run = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });

  // the part, opened from the project folder
  await H.open('定位板.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');

  // 「新工程圖」
  await H.newDrawing();
  await H.waitFor(() => drw() && drw().doc.views.length === 3, 10000, 'the drawing');
  await H.waitFor(() => [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the lines of the three views');
  H.check(drw().doc.title.drawingName === '定位板', `the title is the part's name: ${JSON.stringify(drw().doc.title)}`);
  H.check(JSON.stringify(drw().doc.views.map((v) => [v.direction, v.source])) === JSON.stringify([['front', '定位板.3dbx'], ['top', '定位板.3dbx'], ['right', '定位板.3dbx']]), 'front, top and right views of the part');
  // the scale: 120 + 80 + 25 wide and 80 + 15 + 25 high fits an A3 at 1:1 (374 × 213 mm) and not at 2:1
  H.check(JSON.stringify(drw().doc.sheet.scale) === JSON.stringify([1, 1]), `the scale: ${JSON.stringify(drw().doc.sheet.scale)}`);
  const boxes = Object.fromEntries(drw().doc.views.map((v) => [v.direction, drw().lines.get(v.id).box]));
  H.check(near(boxes.front.max[0] - boxes.front.min[0], 120, 1e-4) && near(boxes.front.max[1] - boxes.front.min[1], 15, 1e-4), 'the front view is 120 × 15');
  H.check(near(boxes.top.max[1] - boxes.top.min[1], 80, 1e-4), 'the top view is 80 deep');
  H.check(near(boxes.right.max[0] - boxes.right.min[0], 80, 1e-4), 'the right view is 80 wide');

  // the canvas shows the sheet
  await H.waitFor(() => document.querySelector('[data-svg] svg'), 5000, 'the SVG');
  const svg = document.querySelector('[data-svg] svg');
  H.check(svg.getAttribute('width') === '420mm' && svg.getAttribute('height') === '297mm', 'an A3 sheet in landscape');
  H.check(svg.querySelectorAll('polyline').length > 20, `lines are drawn: ${svg.querySelectorAll('polyline').length}`);
  H.check(!!svg.querySelector('[stroke-dasharray="3 1"]'), 'hidden lines are dashed');
  H.check([...svg.querySelectorAll('text')].some((t) => t.textContent === '定位板'), 'the title block says the part');

  // first angle: the top view is below the front view, the right view to its left (the middle of each, from the lines and the layout)
  const placed = store.drawingStore.scene().placed;
  const at = (dir) => placed.get(drw().doc.views.find((v) => v.direction === dir).id).at;
  H.check(at('top')[1] < at('front')[1] && near(at('top')[0], at('front')[0], 1e-6), 'the top view is below the front view');
  H.check(at('right')[0] < at('front')[0] && near(at('right')[1], at('front')[1], 1e-6), 'the right view is to the left of the front view');
  H.check(near(at('front')[1] - at('top')[1], 7.5 + 25 + 40, 1e-4), `the gap between front and top is 25: ${at('front')[1] - at('top')[1]}`);

  // a view moved: it keeps its place; the auto layout takes it back
  const top = drw().doc.views.find((v) => v.direction === 'top');
  store.drawingStore.setView(top.id, { at: [300, 120] });
  await H.waitFor(() => drw().doc.views.find((v) => v.id === top.id).at, 3000, 'the view to move');
  H.check(JSON.stringify(store.drawingStore.scene().placed.get(top.id).at) === '[300,120]', 'the top view is where it was put');
  store.drawingStore.setView(top.id, { at: null });
  await H.wait(200);
  H.check(!drw().doc.views.find((v) => v.id === top.id).at, 'laid out again');

  // the sheet and the title block, through the panel
  const select = (field) => document.querySelector(`[data-drawing-panel] [data-field="${field}"]`);
  const choose = async (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await H.wait(200);
  };
  await choose(select('size'), 'A4');
  H.check(document.querySelector('[data-svg] svg').getAttribute('width') === '297mm', 'A4 now');
  await choose(select('size'), 'A3');
  await choose(select('projection'), 'third');
  const p3 = store.drawingStore.scene().placed;
  H.check(p3.get(top.id).at[1] > p3.get(drw().doc.views.find((v) => v.direction === 'front').id).at[1], 'third angle: the top view above the front view');
  await choose(select('projection'), 'first');
  const input = [...document.querySelectorAll('[data-drawing-panel] label.pm-row')].find((l) => l.querySelector('span')?.textContent === '材質').querySelector('input');
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'S45C');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.waitFor(() => drw().doc.title.material === 'S45C', 3000, 'the material');

  // undo and redo
  store.undo();
  await H.wait(150);
  H.check(!drw().doc.title.material, 'undone');
  store.redo();
  await H.wait(150);
  H.check(drw().doc.title.material === 'S45C', 'redone');

  // saved and opened again
  H.next.save = '定位板.3dbd';
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => !drw().dirty, 10000, 'the save');
  const saved = await H.readAt('定位板.3dbd');
  H.check(saved.length > 100, 'the drawing file is in the project folder');
  await H.open('定位板.3dbd');
  await H.waitFor(() => drw() && drw().fileName === '定位板.3dbd' && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the drawing to open');
  H.check(drw().doc.title.material === 'S45C' && drw().doc.views.length === 3, 'the same drawing');

  // exported as SVG
  let blob = null;
  const create = URL.createObjectURL;
  URL.createObjectURL = (b) => ((blob = b), create.call(URL, b));
  document.querySelector('[data-drawing-panel] [data-action="exportSvg"]').click();
  await H.wait(300);
  URL.createObjectURL = create;
  H.check(blob && blob.type === 'image/svg+xml', 'an SVG was handed to the browser');
  const text = await blob.text();
  H.check(text.startsWith('<svg') && text.includes('S45C'), 'the SVG has the sheet');
  console.log('phase5-drawing: all checks passed');
  return true;
};
