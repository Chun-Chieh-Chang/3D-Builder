// Phase 6-3: the thickness analysis window. Run it in a freshly loaded app page (http://127.0.0.1:5391 or the one this checkout's dev server is on, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase6-thickness-ui.js?' + Date.now());
//   await __thicknessUi.run();
//
// A box 60 × 40 × 30 shelled open at the top, 2 thick, is opened. 「工具」→「厚度分析」 (at least 1, at most 4): ten faces are within the limits (green on the model), the rim
// is thick (blue: measured down the whole wall), the thinnest place is 2 mm; asking for at least 3 turns the ten faces thin (red); a limit that is not a number, or a least
// above the greatest, is said; opening the draft or undercut analysis closes this one; closing takes the colors off.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__thicknessUi = {});

const doc = () =>
  build(sketch('s', front, rectangle('r', -30, -20, 60, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' }), {
    id: 'sh1',
    type: 'shell',
    name: 'sh1',
    suppressed: false,
    faces: [{ kind: 'face', name: 'e:cap:end' }],
    thickness: '2',
  });
const state = () => store.getState().thickness;
const cell = (cls, field) => Number(document.querySelector(`[data-thickness] tr[data-class="${cls}"] [data-field="${field}"]`)?.textContent ?? NaN);
const field = (name) => document.querySelector(`[data-thickness] [data-field="${name}"]`);
const type = async (name, value) => {
  const input = field(name);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(80);
};
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
const GREEN = linear([76, 175, 80]);
const BLUE = linear([74, 144, 217]);
const RED = linear([224, 72, 72]);

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('殼.3dbx', await io.writePartFile(doc()));
  await H.open('殼.3dbx');
  await H.waitFor(() => store.getState().result?.features?.every((f) => f.status === 'ok') && store.getState().result.mesh, 20000, 'the shell');

  await H.action('工具', '厚度分析');
  await H.waitFor(() => state()?.report, 20000, 'the analysis');
  H.check(!!document.querySelector('[data-thickness]'), 'the window is open');
  H.check(cell('ok', 'faces') === 10 && cell('thick', 'faces') === 1 && cell('thin', 'faces') === 0, `ten within, the rim thick: ${cell('ok', 'faces')}, ${cell('thick', 'faces')}, ${cell('thin', 'faces')}`);
  H.check(/^最薄的地方: 2 mm/.test(field('thinnest')?.textContent ?? ''), `the thinnest place is 2 mm: ${field('thinnest')?.textContent}`);
  H.check(/三角形/.test(field('stats')?.textContent ?? ''), 'it says how many triangles and how long');
  let colors = painted();
  H.check((colors[GREEN] ?? 0) > 0 && (colors[BLUE] ?? 0) > 0 && !(colors[RED] > 0), `green and blue on the model, no red: ${JSON.stringify(colors)}`);

  // at least 3: every wall is thin
  await type('least', '3');
  await H.waitFor(() => state().report?.least === 3 && state().report.totals.thin.faces === 10, 20000, 'at least 3');
  await H.wait(150);
  colors = painted();
  H.check((colors[RED] ?? 0) > 0 && cell('thin', 'faces') === 10, `ten faces too thin, red on the model: ${cell('thin', 'faces')}`);

  // a limit that is not a number, and a least above the greatest, are said
  await type('least', 'x');
  H.check(field('least').className.includes('invalid') && /大於 0/.test(document.querySelector('[data-thickness]').textContent), 'a limit that is not a number is said');
  await type('least', '5');
  await type('greatest', '2');
  H.check(field('greatest').className.includes('invalid'), 'a least above the greatest is said');
  await type('greatest', '4');
  await type('least', '1');
  await H.waitFor(() => state().report?.least === 1 && state().report.totals.ok.faces === 10, 20000, 'back to 1');

  // one analysis at a time
  await H.action('工具', '拔模分析');
  await H.waitFor(() => store.getState().draft, 5000, 'the draft analysis');
  H.check(state() === null && !document.querySelector('[data-thickness]'), 'opening the draft analysis closes the thickness analysis');
  await H.action('工具', '厚度分析');
  await H.waitFor(() => state()?.report, 20000, 'again');
  H.check(store.getState().draft === null, 'back again, the draft analysis closed');
  await H.action('工具', '底切分析');
  await H.waitFor(() => store.getState().undercut, 5000, 'the undercut analysis');
  H.check(state() === null, 'opening the undercut analysis closes it too');
  await H.action('工具', '厚度分析');
  await H.waitFor(() => state()?.report, 20000, 'once more');

  [...document.querySelectorAll('[data-thickness] button')].find((b) => b.textContent === '關閉').click();
  await H.wait(200);
  H.check(!document.querySelector('[data-thickness]') && Object.keys(painted()).length === 0, 'closed, the colors are gone');
  await H.tidy();
  console.log('phase6-thickness-ui: all checks passed');
  return true;
};
