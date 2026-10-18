// S-1: the flat pattern of a sheet metal part as a view of a drawing, in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, 1280×720, the tab in front):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-flat-view.js?' + Date.now());
//   await __flatView.run();
//
// The part is tests/fixtures/parts/bracket.3dbx (the sheet metal bracket of the verification kit: a plate with a 90° flange, a 135° flange and a hem: three bends). In a
// new drawing a view of direction 「展平圖」 is added through the panel; a part that is not sheet metal gives the reason in place of lines.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const x = (window.__flatView = {});

const drw = () => store.getState().drw;
const page = () => H.page(drw()?.doc);
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const choose = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(200);
};

x.run = async () => {
  H.ready();
  await H.project({ '支架.3dbx': `${root}tests/fixtures/parts/bracket.3dbx`, '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
  await H.open('支架.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.newDrawing();
  await H.waitFor(() => drw() && page()?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
  await choose(panel('[data-field="newDirection"]'), 'flat');
  panel('[data-action="addView"]').click();
  await H.waitFor(() => page()?.views.length === 4 && drw().lines.get(page()?.views[3].id), 30000, 'the flat view');
  const flat = page()?.views[3];
  H.check(flat.direction === 'flat', `a view of direction flat: ${flat.direction}`);
  const lines = drw().lines.get(flat.id);
  H.check(lines.center?.length === 3, `three bend lines (chain): ${lines.center?.length}`);
  H.check(lines.visible.length >= 4, `an outline: ${lines.visible.length} lines`);
  const box = lines.box;
  H.check(box.min[0] === 0 && box.min[1] === 0 && box.max[0] > 100 && box.max[1] > 40, `a box about the size of the sheet: ${JSON.stringify(box)}`);
  const { scene } = store.drawingStore.scene();
  H.check(scene.items.filter((i) => i.kind === 'polyline' && i.style === 'center').length >= 3, 'the bend lines are drawn as chain lines');
  // views projected or cut from it are refused
  const before = page()?.views.length;
  store.drawingStore.addProjected(flat.id, 'right');
  H.check(page()?.views.length === before, 'a projected view of it is refused');
  return { views: page()?.views.map((v) => [v.name, v.direction]), box };
};

/** A part that is not sheet metal says so in place of lines. */
x.notSheet = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
  await H.open('定位板.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.newDrawing();
  await H.waitFor(() => drw() && page()?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
  await choose(panel('[data-field="newDirection"]'), 'flat');
  panel('[data-action="addView"]').click();
  await H.waitFor(() => page()?.views.length === 4 && drw().problems.get(page()?.views[3].id), 30000, 'the reason');
  const why = drw().problems.get(page()?.views[3].id);
  H.check(/鈑金/.test(why), `the reason: ${why}`);
  return why;
};
