// Phase 3b-5e: the geometry check in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280x720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-check.js?' + Date.now());
//   await __check.assembly();   // every part file of the fixture, once
//   await __check.part();       // the open part
//
// It builds on phase3-subassembly.js. A part that fails the check is covered in tests/phase3/evaluate-kernel.test.ts (an open box); the browser has
// no way to make one, so here the parts of the golden files have to come out good, with the numbers of their shapes.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const check = (window.__check = {});

const dialog = async () => {
  await H.waitFor(() => store.getState().check?.status === 'done' || store.getState().check?.status === 'error', 15000, 'the check');
  await H.wait(100);
  return store.getState().check;
};
const rows = () => [...document.querySelectorAll('[data-check] [data-field="rows"] tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));

check.assembly = async () => {
  await __sub.open();
  await H.action('組合件', '檢查幾何…');
  const c = await dialog();
  H.check(c.status === 'done' && !c.error, `done: ${c.error}`);
  const shown = rows();
  H.check(shown.length === 2 && shown.map((r) => r[0]).join() === '定位板,削邊銷', `each part file once: ${JSON.stringify(shown)}`);
  H.check(c.rows.every((r) => r.report && r.report.valid && r.report.solids === 1 && r.report.freeEdges === 0 && r.report.badFaces.length === 0 && r.report.volume > 0), `all good: ${JSON.stringify(c.rows)}`);
  H.check(shown.every((r) => r[1].startsWith('正常')), 'the table says 正常');
  const plate = c.rows.find((r) => r.name === '定位板').report;
  H.check(Math.abs(plate.volume - 137197.0207) < 1e-3, `the plate's volume is the mass properties': ${plate.volume}`);
  H.check(document.querySelector('[data-check] [data-field="summary"]').textContent.includes('全部正常'), 'the summary');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await H.wait(200);
  H.check(store.getState().check === null, 'Esc closes it');
  return c.rows.map((r) => [r.name, r.report.faces, r.report.volume]);
};

check.part = async () => {
  store.newDemo();
  await H.waitFor(() => store.getState().result?.mesh, 15000, 'the demo part');
  await H.action('工具', '檢查幾何…');
  const c = await dialog();
  H.check(c.rows.length === 1 && c.rows[0].report.valid && c.rows[0].report.freeEdges === 0, `the part is good: ${JSON.stringify(c.rows)}`);
  H.check(Math.abs(c.rows[0].report.volume - store.getState().result.mass.volume) < 1e-6, 'and its volume is the part\'s');
  H.check(c.rows[0].report.faces === store.getState().result.faceNames.length, 'with the faces the part has');
  document.querySelector('[data-check] .primary').click();
  await H.wait(200);
  H.check(store.getState().check === null, 'closed');
  return c.rows;
};
