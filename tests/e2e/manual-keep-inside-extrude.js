// ADR 0232: the extrude cut that keeps the material inside the contour, through the UI, in the app's page
// (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-keep-inside-extrude.js?' + Date.now());
//   await __x.run();   // -> { name, steps: [{ name, volume, expected, pass }], pass }
//
// A 20 × 10 block 10 thick, mid-plane so the sketch plane runs through it (2000 mm³). Then a cut whose profile
// is a 16 × 7 rectangle inside that cross-section, through all upwards: an ordinary cut takes the 560 mm³ the
// profile covers away (1440 left). 「保留輪廓內」 keeps the 560 mm³ the profile covers and takes the rest of the
// reach away, so 1560 is left: the 1000 mm³ below the sketch plane (beyond the reach) and the 560 mm³ inside the
// profile. A depth is allowed with the option on: the reach is then the depth, and 1736 is left.

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
const pmSelect = async (label, value) => {
  const sel = row(label).querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
};
const pmInput = async (label, value) => {
  const el = row(label).querySelector('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(30);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.settle();
};
/** The cut feature in the document. */
const cut = () => state().doc.features.find((f) => f.type === 'extrude' && f.op === 'cut');

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
  const boss = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(boss);
  await H.action('特徵', '伸長填料/基材');
  await pmSelect('終止型態', 'midPlane');
  await pmInput('深度', '10');
  await H.pmOk();

  const steps = [];
  const step = (name, expected) => {
    const volume = state().result.mass.volume;
    steps.push({ name, volume, expected, pass: near(volume, expected) && failed().length === 0 });
  };
  step('the block', 2000);

  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(10, 4.5, 8);
  await H.tool('邊角矩形');
  await H.sk(2, 1);
  await H.sk(18, 8);
  await H.solved();
  const cutSketch = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(cutSketch);
  await H.action('特徵', '伸長除料');
  await pmSelect('終止型態', 'throughAll');
  await H.pmCheck('反轉方向', true);

  step('an ordinary through-all cut', 1440);

  await H.pmCheck('保留輪廓內', true);
  step('the same cut, keeping what is inside the contour', 1560);
  const hints = [...pm().querySelectorAll('.hint')].map((h) => h.textContent ?? '');
  steps.push({ name: 'the hint says the reach decides', pass: hints.some((h) => h.includes('範圍')) && !hints.some((h) => h.includes('全部貫穿')) });

  // a depth is allowed with the option on: the reach is the depth
  await pmSelect('終止型態', 'blind');
  await pmInput('深度', '3');
  step('the same cut, keeping what is inside the contour, 3 deep', 1736);
  steps.push({ name: 'the document keeps the depth and the option', pass: cut()?.keepInside === true && cut()?.dir1.type === 'blind' });

  // and the option is refused on a boss, not with a depth: a cut with a depth and the option off is an ordinary cut
  await H.pmCheck('保留輪廓內', false);
  step('an ordinary cut 3 deep', 1664);

  await H.pmOk();
  return { name: 'the extrude cut that keeps the material inside the contour', steps, failed: failed(), pass: steps.every((s) => s.pass) && failed().length === 0 };
};
