// Phase 6-2: the undercut analysis window. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase6-undercut-ui.js?' + Date.now());
//   await __undercutUi.run();
//
// A block 40 × 30 × 20 with a Ø6 hole across it (along x, at z = 10) is opened. 「工具」→「底切分析」: the wall of the hole (753.98 mm²) is the one undercut, red on the model,
// the top is seen from above only (blue), the bottom from below only (teal), the four sides from both (light green); turned to the direction of the hole (+X) there is no
// undercut; opening the draft analysis closes this one (they color the same faces); closing takes the colors off.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, circle, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__undercutUi = {});

const doc = () =>
  build(sketch('s', front, rectangle('r', -20, -15, 40, 30)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), sketch('h', { kind: 'datum', name: 'plane:right' }, circle('c', -10, 0, 3)), {
    ...extrude('x', 'h', 'cut', { type: 'throughAll' }),
    dir2: { type: 'throughAll' },
  });
const state = () => store.getState().undercut;
const cell = (cls, field) => Number(document.querySelector(`[data-undercut] tr[data-class="${cls}"] [data-field="${field}"]`)?.textContent ?? NaN);
/** The colors on the model as the viewer paints them: "r,g,b" (0–255, linear) → number of vertices. */
const painted = () => {
  const attr = store.viewer.body?.geometry.getAttribute('color');
  const counts = {};
  if (!attr) return counts;
  for (let i = 0; i < attr.count; i++) {
    const k = [attr.getX(i), attr.getY(i), attr.getZ(i)].map((v) => Math.round(v * 255)).join(',');
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
};
const linear = (rgb) => rgb.map((c) => Math.round(((c / 255 + 0.055) / 1.055) ** 2.4 * 255)).join(',');
const RED = linear([224, 72, 72]);
const BLUE = linear([74, 144, 217]);
const TEAL = linear([47, 165, 154]);
const LIGHT = linear([165, 208, 106]);

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('孔.3dbx', await io.writePartFile(doc()));
  await H.open('孔.3dbx');
  await H.waitFor(() => store.getState().result?.features?.every((f) => f.status === 'ok') && store.getState().result.mesh, 20000, 'the block');

  await H.action('工具', '底切分析');
  await H.waitFor(() => state()?.report, 20000, 'the analysis');
  H.check(!!document.querySelector('[data-undercut]'), 'the window is open');
  H.check(cell('undercut', 'faces') === 1 && Math.abs(cell('undercut', 'area') - 753.98) < 0.01, `one undercut of 753.98 mm²: ${cell('undercut', 'faces')}, ${cell('undercut', 'area')}`);
  H.check(cell('up', 'faces') === 1 && cell('down', 'faces') === 1 && cell('both', 'faces') === 4, `top, bottom, four sides: ${cell('up', 'faces')}, ${cell('down', 'faces')}, ${cell('both', 'faces')}`);
  H.check(/三角形/.test(document.querySelector('[data-undercut] [data-field="stats"]')?.textContent ?? ''), 'it says how many triangles and how long');
  const colors = painted();
  H.check([RED, BLUE, TEAL, LIGHT].every((k) => (colors[k] ?? 0) > 0), `red, blue, teal and light green are on the model: ${JSON.stringify(colors)}`);
  await window.__shot?.('undercut-colours');

  // opened along the hole: no undercut
  const select = document.querySelector('[data-undercut] select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '+x');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await H.waitFor(() => state()?.report && state().pull[0] === 1 && state().report.totals.undercut.faces === 0, 20000, 'along the hole');
  await H.wait(150);
  H.check(!((painted()[RED] ?? 0) > 0), 'no red along the hole');

  // the draft analysis closes this one
  await H.action('工具', '拔模分析');
  await H.waitFor(() => store.getState().draft, 5000, 'the draft analysis');
  H.check(state() === null && !document.querySelector('[data-undercut]'), 'opening the draft analysis closes the undercut analysis');
  // and back: the undercut analysis takes the direction the draft analysis had
  await H.action('工具', '底切分析');
  await H.waitFor(() => state()?.report, 20000, 'again');
  H.check(store.getState().draft === null && state().pull[2] === 1, 'back again, along z, the draft analysis closed');

  [...document.querySelectorAll('[data-undercut] button')].find((b) => b.textContent === '關閉').click();
  await H.wait(200);
  H.check(!document.querySelector('[data-undercut]') && Object.keys(painted()).length === 0, 'closed, the colors are gone');
  await H.tidy();
  console.log('phase6-undercut-ui: all checks passed');
  return true;
};
