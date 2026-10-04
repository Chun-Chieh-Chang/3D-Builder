// Phase 6-1: the draft analysis window. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase6-draft-ui.js?' + Date.now());
//   await __draftUi.run();
//
// A block 40 × 30 × 20 drawn with 3° on its walls is opened. 「工具」→「拔模分析」: the window opens, five faces are positive and one negative (the colors are on the model),
// asking for 5° makes the four walls draft required, reversing the direction turns the walls negative, a planar face picked in the view gives its normal as the direction,
// and closing the window takes the colors off.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__draftUi = {});

const doc = () => build(sketch('s', front, rectangle('r', -20, -15, 40, 30)), { ...extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), draft1: { angle: '3deg', inward: true } });
const draft = () => store.getState().draft;
const cell = (cls, field) => Number(document.querySelector(`[data-draft] tr[data-class="${cls}"] [data-field="${field}"]`)?.textContent ?? NaN);
/** The colors on the model as the viewer paints them: a map of "r,g,b" (0–255) to the number of vertices. */
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
/** The key `painted` gives for a color of the page: the viewer keeps vertex colors linear (three.js color management), 0–255. */
const linear = (rgb) => rgb.map((c) => Math.round(((((c / 255 + 0.055) / 1.055) ** 2.4)) * 255)).join(',');
const GREEN = linear([76, 175, 80]);
const RED = linear([224, 72, 72]);
const YELLOW = linear([242, 194, 48]);

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('塊.3dbx', await io.writePartFile(doc()));
  await H.open('塊.3dbx');
  await H.waitFor(() => store.getState().result?.features?.every((f) => f.status === 'ok') && store.getState().result.mesh, 20000, 'the block');

  await H.action('工具', '拔模分析');
  await H.waitFor(() => draft()?.report, 20000, 'the analysis');
  H.check(!!document.querySelector('[data-draft]'), 'the window is open');
  H.check(cell('positive', 'faces') === 5 && cell('negative', 'faces') === 1, `five positive faces and one negative: ${cell('positive', 'faces')}, ${cell('negative', 'faces')}`);
  const area = store.getState().result.mass?.volume;
  void area;
  let colors = painted();
  H.check((colors[GREEN] ?? 0) > 0 && (colors[RED] ?? 0) > 0, `green and red are on the model: ${JSON.stringify(colors)}`);
  H.check(!(colors[YELLOW] > 0), 'no yellow yet');

  // 5° asked: the 3° walls are draft required (yellow)
  const input = document.querySelector('[data-draft] [data-field="required"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '5');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.waitFor(() => draft().report?.required > 0.08 && draft().report.totals.required.faces === 4, 20000, 'the walls draft required');
  await H.wait(150);
  colors = painted();
  H.check((colors[YELLOW] ?? 0) > 0, `yellow is on the model: ${JSON.stringify(colors)}`);
  // an angle that is not a number is said, and the last answer stays
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'x');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(150);
  H.check(input.className.includes('invalid') && /不小於 0/.test(text('[data-draft]')), 'a bad angle is said');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '1');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.waitFor(() => draft().report?.totals.positive.faces === 5, 20000, 'back to 1°');

  // reversed: the walls lean the wrong way (negative), the top and bottom change places
  [...document.querySelectorAll('[data-draft] button')].find((b) => b.textContent === '反轉方向').click();
  await H.waitFor(() => draft().report?.totals.negative.faces === 5, 20000, 'reversed');
  H.check(cell('positive', 'faces') === 1, 'one face positive the other way');

  // the normal of a planar face as the direction: the +x wall of the drafted block, 87° from the pull along +z… its own normal as the pull sees that wall at 90°
  const res = store.getState().result;
  const wall = res.faceFingerprints.findIndex((f) => f.type === 'plane' && f.dir && f.dir[0] > 0.9);
  H.check(wall >= 0, 'the +x wall is there');
  store.selectFace({ kind: 'face', name: res.faceNames[wall], fingerprint: res.faceFingerprints[wall] });
  await H.wait(100);
  [...document.querySelectorAll('[data-draft] button')].find((b) => b.textContent === '用選取的平面的法向').click();
  await H.waitFor(() => Math.abs(draft().pull[0] - res.faceFingerprints[wall].dir[0]) < 1e-9 && draft().report, 20000, 'pull along the wall normal');
  await H.wait(200);
  H.check(Math.abs(draft().report.faces[wall].min - Math.PI / 2) < 1e-6, `that wall is square to the new pull: ${draft().report.faces[wall].min}`);

  // closing takes the colors off
  [...document.querySelectorAll('[data-draft] button')].find((b) => b.textContent === '關閉').click();
  await H.wait(200);
  H.check(!document.querySelector('[data-draft]') && Object.keys(painted()).length === 0, 'closed, the colors are gone');
  await H.tidy();
  console.log('phase6-draft-ui: all checks passed');
  return true;
};
function text(sel) {
  return document.querySelector(sel)?.textContent ?? '';
}
