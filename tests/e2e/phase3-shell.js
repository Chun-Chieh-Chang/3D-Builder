// Phase 3a-5b (C5.4): the shell feature through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-shell.js?' + Date.now());
//   await __s.run();   // -> { name, steps: [{ name, volume, expected, pass }], pass }
//
// A 40 × 30 block, 10 thick, its top face clicked and 「薄殼」 pressed: a wall of 2 inward (40 × 30 × 10 less 36 × 26 × 8), then outward
// (44 × 34 × 12 less the block), then two faces taken away (a tube).

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const S = (window.__s = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const pm = () => document.querySelector('.property-manager');

S.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(20, 15, 6);
  await H.tool('邊角矩形');
  await H.sk(0, 0);
  await H.sk(40, 30);
  await H.solved();
  const name = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(name);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '10');
  await H.pmOk();
  const r = state().result;
  const cap = r.faceFingerprints.findIndex((fp) => fp.type === 'plane' && Math.abs(Math.abs(fp.center[1]) - 10) < 1e-6);
  const centre = r.faceFingerprints[cap].center;
  const steps = [];
  const step = (title, expected) => {
    const volume = state().result.mass.volume;
    steps.push({ name: title, volume, expected, pass: near(volume, expected) && failed().length === 0 });
  };
  step('the block', 12000);
  await H.at(centre);
  await H.action('特徵', '薄殼');
  const listed = [...pm().querySelectorAll('.selection-box li')].map((li) => li.textContent);
  const thickness = [...pm().querySelectorAll('.pm-row')].find((x) => x.querySelector('span')?.textContent === '壁厚').querySelector('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(thickness, '2');
  thickness.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(30);
  thickness.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.settle();
  // like a fillet, a shell being edited shows the model before it: the result is there once the feature is accepted
  const faces0 = state().result.faceNames.length;
  await H.pmOk();
  step('shell of 2 inward', 12000 - 36 * 26 * 8);
  const shell = state().doc.features.find((f) => f.type === 'shell');
  // the same feature outward and back, changed in the document (a PropertyManager session shows the model before it)
  store.execute({ type: 'setShell', featureId: shell.id, faces: shell.faces, thickness: '2', outward: true });
  await H.settle();
  step('shell of 2 outward', 44 * 34 * 12 - 12000);
  store.execute({ type: 'setShell', featureId: shell.id, faces: shell.faces, thickness: '2' });
  await H.settle();
  step('inward again', 12000 - 36 * 26 * 8);
  const faces = state().result.faceNames.length;
  return { name: 'shell from the top face: inward, outward and back', listed, faces0, faces, steps, failed: failed(), pass: listed.filter((x) => !x.startsWith('（')).length === 1 && faces === 11 && steps.every((s) => s.pass) && failed().length === 0 };
};
