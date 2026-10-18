// Phase 5, the angle dimension (2026-10-07): in the browser, through the drawing panel. Run it in a freshly loaded app page (http://127.0.0.1:5391, 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-angle.js?' + Date.now());
//   await __angle.run();
//
// The part is tests/fixtures/parts/bracket.3dbx, the sheet metal bracket of the verification kit (the same document as 3DB實機確認/鈑金/支架.3dbx, which `make:kit`
// writes outside the repository and so is not on every computer: two 45° faces and a 90° corner seen from the right). In a new drawing the
// right view offers the slanted faces beside the planes square to x and y; an angle between two of them is made, written 45° and then 135° with the other angle, its arc
// radius changed, and one that is 90°.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const a = (window.__angle = {});

const drw = () => store.getState().drw;
const page = () => H.page(drw()?.doc);
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const choose = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, String(value));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(150);
};
const texts = () => [...store.drawingStore.scene().dimensions.values()].map((o) => ('error' in o ? 'ERROR ' + o.error : o.text));

a.run = async () => {
  H.ready();
  await H.project({ '支架.3dbx': `${root}tests/fixtures/parts/bracket.3dbx` });
  await H.open('支架.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.newDrawing();
  await H.waitFor(() => drw() && page()?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
  const right = page()?.views.find((v) => v.direction === 'right');
  panel(`[data-view="${right.id}"]`).click();
  await H.waitFor(() => drw().features.get(right.id), 30000, 'the features of the right view');
  const features = drw().features.get(right.id);
  const slants = features.filter((f) => f.type === 'slant');
  H.check(slants.length === 3, `three slanted faces: ${slants.length}`);
  H.check(slants.every((s) => Math.abs(Math.abs(s.dir[0]) - Math.SQRT1_2) < 1e-6 && Math.abs(Math.abs(s.dir[1]) - Math.SQRT1_2) < 1e-6), 'all at 45°');

  const A = panel('[data-field="angA"]');
  const B = panel('[data-field="angB"]');
  const slantAt = [...A.options].map((o, i) => (o.text.includes('斜面') ? i : -1)).filter((i) => i >= 0);
  H.check(slantAt.length === 3, `the list offers the slanted faces: ${[...A.options].map((o) => o.text).join(' | ')}`);
  // a plane square to x and a slanted face
  await choose(A, 0);
  await choose(B, slantAt[0]);
  panel('[data-action="addAngle"]').click();
  await H.waitFor(() => page()?.dimensions.length === 1 && texts().length === 1 && !texts()[0].includes('…'), 10000, 'the first angle');
  H.check(texts()[0] === '45°', `a plane and a slanted face: ${texts()[0]}`);
  // two slanted faces: square to each other
  await choose(A, slantAt[0]);
  await choose(B, slantAt[1]);
  panel('[data-action="addAngle"]').click();
  await H.waitFor(() => page()?.dimensions.length === 2 && texts().length === 2 && !texts().some((t) => t.includes('…')), 10000, 'the second angle');
  H.check(texts().includes('90°'), `two faces square to each other: ${texts().join(' ')}`);

  // the first one: the other angle, and a bigger arc
  panel('[data-field="dimensions"] li:first-child').click();
  await H.wait(300);
  panel('[data-field="dimSupplementary"]').click();
  await H.waitFor(() => texts().includes('135°'), 10000, 'the other angle');
  H.check(page()?.dimensions[0].supplementary === true, 'kept in the dimension');
  const arc = panel('[data-field="dimArc"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(arc, '30');
  arc.dispatchEvent(new Event('input', { bubbles: true }));
  arc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.waitFor(() => page()?.dimensions[0].arc === 30, 5000, 'the arc radius');
  panel('[data-field="dimSupplementary"]').click();
  await H.waitFor(() => texts().includes('45°') && !texts().includes('135°'), 10000, 'back to the first angle');
  H.check(!('supplementary' in page()?.dimensions[0]), 'and taken out of the dimension');
  return { texts: texts() };
};
