// Phase 5-2: projected, section and detail views in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-views.js?' + Date.now());
//   await __views.run();
//
// The part is the golden locating plate (120 × 80 × 15). From the front view of a new drawing: a section along x = 40 (through the two Ø8 holes), a view
// projected above it and a detail of a hole, each made through the panel; the cut hatched, the cutting line and the letters drawn on the front view; then
// the drawing saved and opened again with all of it.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const v = (window.__views = {});

const drw = () => store.getState().drw;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const type = async (el, text) => {
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(100);
};
const choose = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(200);
};
const click = async (el) => {
  el.click();
  await H.wait(150);
};

v.run = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
  await H.open('定位板.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.action('檔案', '新工程圖');
  await H.waitFor(() => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
  const front = drw().doc.views.find((x) => x.direction === 'front');

  // nothing selected: the derived views cannot be made
  H.check(panel('[data-action="addSection"]').disabled, 'no section without a parent');

  // a section of the front view along x = 40, through the panel
  await click(panel(`[data-view="${front.id}"]`));
  H.check(drw().selected === front.id, 'the front view is selected');
  await type(panel('[data-field="sectionAt"]'), '40');
  await click(panel('[data-action="addSection"]'));
  await H.waitFor(() => drw().doc.views.length === 4, 3000, 'the section');
  const section = drw().doc.views[3];
  H.check(section.kind === 'section' && section.parent === front.id && section.label === 'A' && JSON.stringify(section.line) === '[[40,-5],[40,20]]', `the section: ${JSON.stringify(section)}`);
  await H.waitFor(() => drw().lines.get(section.id), 30000, 'the lines of the section');
  const lines = drw().lines.get(section.id);
  H.check(lines.cut && lines.cut.length > 4, `the cut faces were found: ${lines.cut?.length} outlines`);
  // looking along +x with y up: the sheet's x is the model's z, so it is 80 wide (less nothing: the plate is cut at x = 40, to its end at 60) and 15 high
  H.check(near(lines.box.max[1] - lines.box.min[1], 15, 1e-4) && near(lines.box.max[0] - lines.box.min[0], 80, 1e-4), `the section is 80 × 15: ${JSON.stringify(lines.box)}`);

  // drawn: the hatching, the cutting line and the letters on the front view, the title under the section
  await H.waitFor(() => document.querySelector('[data-svg] svg'), 5000, 'the SVG');
  const svg = document.querySelector('[data-svg] svg');
  const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
  H.check(texts.filter((t) => t === 'A').length === 2 && texts.includes('A-A'), `A, A and A-A are written: ${texts.join(' | ')}`);
  H.check(svg.querySelectorAll('polyline').length > 60, `the hatching makes many lines: ${svg.querySelectorAll('polyline').length}`);
  // first angle: the arrows point right, so the section is on the right of the front view
  const placed = () => store.drawingStore.scene().placed;
  H.check(placed().get(section.id).at[0] > placed().get(front.id).at[0], 'first angle: the section is placed on the side the arrows point to');
  // the section is in line with the front view: the model's origin at the same height
  const pf = placed().get(front.id);
  const ps = placed().get(section.id);
  H.check(near(pf.at[1] - pf.centre[1] * pf.scale, ps.at[1] - ps.centre[1] * ps.scale, 1e-6), 'the section is level with the front view');

  // flipped: the arrows point the other way, the material taken away is the other half, and the section moves to the other side
  await click(panel(`[data-view="${section.id}"]`));
  await click(panel('[data-field="flip"]'));
  await H.waitFor(() => drw().doc.views[3].flip === true, 3000, 'the flip');
  await H.waitFor(() => drw().lines.get(section.id)?.cut?.length > 4, 30000, 'the other half');
  // the side its arrows look to is taken by the right view (first angle: left of the front view), so the section goes to the next free side:
  // the rule is that no two views overlap
  const rect = (id) => {
    const p = placed().get(id);
    const b = drw().lines.get(id).box;
    return [p.at[0] + (b.min[0] - p.centre[0]) * p.scale, p.at[1] + (b.min[1] - p.centre[1]) * p.scale, p.at[0] + (b.max[0] - p.centre[0]) * p.scale, p.at[1] + (b.max[1] - p.centre[1]) * p.scale];
  };
  const overlap = (a, b) => a[0] < b[2] - 1e-6 && b[0] < a[2] - 1e-6 && a[1] < b[3] - 1e-6 && b[1] < a[3] - 1e-6;
  const others = drw().doc.views.filter((x) => x.id !== section.id && drw().lines.get(x.id));
  H.check(others.length === 3 && others.every((x) => !overlap(rect(section.id), rect(x.id))), 'flipped: the section overlaps no other view');
  await click(panel('[data-field="flip"]'));
  await H.waitFor(() => !drw().doc.views[3].flip, 3000, 'the flip back');

  // a view projected above the front view (first angle: it is the bottom view)
  await click(panel(`[data-view="${front.id}"]`));
  await choose(panel('[data-field="newSide"]'), 'up');
  await click(panel('[data-action="addProjected"]'));
  await H.waitFor(() => drw().doc.views.length === 5, 3000, 'the projected view');
  const projected = drw().doc.views[4];
  H.check(projected.kind === 'projected' && projected.parent === front.id && projected.side === 'up', 'projected from the front view, above');
  await H.waitFor(() => drw().lines.get(projected.id), 30000, 'the lines of the projected view');
  const pb = drw().lines.get(projected.id).box;
  H.check(near(pb.max[0] - pb.min[0], 120, 1e-4) && near(pb.max[1] - pb.min[1], 80, 1e-4), `seen from below it is 120 × 80: ${JSON.stringify(pb)}`);
  H.check(placed().get(projected.id).at[1] > placed().get(front.id).at[1], 'it is above the front view');

  // a detail of the front view round the hole at x = 54.5: centre (50, 7.5), radius 8
  await click(panel(`[data-view="${front.id}"]`));
  await type(panel('[data-field="detailX"]'), '50');
  await type(panel('[data-field="detailY"]'), '7.5');
  await type(panel('[data-field="detailRadius"]'), '8');
  await click(panel('[data-action="addDetail"]'));
  await H.waitFor(() => drw().doc.views.length === 6, 3000, 'the detail');
  const detail = drw().doc.views[5];
  H.check(detail.kind === 'detail' && detail.label === 'B' && JSON.stringify(detail.centre) === '[50,7.5]' && detail.radius === 8 && JSON.stringify(detail.scale) === '[2,1]', `the detail: ${JSON.stringify(detail)}`);
  const pd = placed().get(detail.id);
  H.check(near(pd.w, 32) && near(pd.h, 32), `a detail has the size of its circle at its scale: ${pd.w} × ${pd.h}`);
  const texts2 = [...document.querySelectorAll('[data-svg] svg text')].map((t) => t.textContent);
  H.check(texts2.includes('B') && texts2.includes('B (2:1)'), 'the detail has its letter and scale');

  // deleting the front view takes everything that comes from it
  const count = drw().doc.views.length;
  store.drawingStore.deleteViews([projected.id]);
  await H.waitFor(() => drw().doc.views.length === count - 1, 3000, 'delete');
  store.undo();
  await H.waitFor(() => drw().doc.views.length === count, 3000, 'undo');

  // saved, opened again: the same views and the same lines
  H.next.save = '定位板.3dbd';
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => !drw().dirty, 10000, 'the save');
  await H.open('定位板.3dbd');
  await H.waitFor(() => drw() && drw().fileName === '定位板.3dbd' && drw().doc.views.length === 6 && drw().lines.get(drw().doc.views[3].id)?.cut?.length > 4, 40000, 'the drawing to open');
  H.check(JSON.stringify(drw().doc.views.map((x) => x.kind ?? 'model')) === JSON.stringify(['model', 'model', 'model', 'section', 'projected', 'detail']), 'the same views');
  console.log('phase5-views: all checks passed');
  return true;
};
