// Phase 3a-5a (C4.1–C4.3): the extrude PropertyManager with a draft, a second direction and a thin wall, through the UI, in the app's page
// (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-extrude-p1.js?' + Date.now());
//   await __x.run();   // -> { name, steps: [{ name, volume, expected, pass }], pass }
//
// A 20 × 10 block, 10 deep, in one PropertyManager session: first drafted outward by 3°, then without a draft but with a second direction of 4,
// then a thin wall of 2 inward, then half each way. Every volume is the hand-calculated area times the depth.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const X = (window.__x = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const pm = () => document.querySelector('.property-manager');
const row = (label, nth = 0) => [...pm().querySelectorAll('.pm-row')].filter((r) => r.querySelector('span')?.textContent === label)[nth];
const check = async (label, on, nth = 0) => {
  const input = row(label, nth).querySelector('input');
  if (input.checked !== on) input.click();
  await H.settle();
};
const input = async (label, value, nth = 0) => {
  const el = row(label, nth).querySelector('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(30);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.settle();
};
const select = async (label, value) => {
  const sel = row(label).querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
};

X.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(10, 5, 8);
  await H.tool('邊角矩形');
  await H.sk(0, 0);
  await H.sk(20, 10);
  await H.solved();
  const name = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(name);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '10');
  const steps = [];
  const step = (title, expected) => {
    const volume = state().result.mass.volume;
    steps.push({ name: title, volume, expected, pass: near(volume, expected) && failed().length === 0 });
  };
  step('plain block', 2000);

  const t = Math.tan((3 * Math.PI) / 180);
  await check('拔模', true);
  await input('拔模角度', '3');
  step('drafted outward by 3°', 20 * 10 * 10 + 30 * t * 100 + (4 / 3) * t * t * 1000);
  await check('拔模', false);

  await check('方向 2', true);
  await input('深度', '4', 1);
  step('a second direction of 4', 2800);
  await check('方向 2', false);

  await check('薄件', true);
  await input('厚度', '2');
  step('thin wall of 2 inward', 1040);
  await select('類型', 'mid');
  step('thin wall of 2, half each way', 1200);
  await select('類型', 'two');
  await input('另一側厚度', '1');
  step('thin wall of 2 in and 1 out', 1680);
  await check('薄件', false);
  step('solid again', 2000);
  const features = state().doc.features.filter((f) => f.type === 'extrude').length;
  await H.pmOk();
  return { name: 'draft, second direction and thin wall from the extrude PropertyManager', steps, features, failed: failed(), pass: steps.every((s) => s.pass) && failed().length === 0 };
};
