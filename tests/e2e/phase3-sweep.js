// Phase 3a-6b (C4.4): the sweep through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-sweep.js?' + Date.now());   // after a fresh load of the page; then wait a moment for the viewer
//   await __w.run();   // -> { name, steps: [{ name, volume, expected, pass }], names, failed, pass }
//
// Two path sketches on the front plane (a line of 40 and a line of 60 from the origin) and a 6 × 4 rectangle on the right plane. 「掃出填料/基材」
// from the Features tab with the rectangle selected: the path is the latest sketch with a line (the 60), then the PropertyManager's list is changed to the 40.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const W = (window.__w = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const pm = () => document.querySelector('.property-manager');

async function line(length) {
  await H.treeClick('前基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(length / 2, 0, 10);
  await H.tool('直線');
  await H.sk(0, 0);
  await H.sk(length, 0);
  await H.key('Escape');
  await H.solved();
  const name = H.sketch().name;
  await H.exitSketch();
  return name;
}

W.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  const short = await line(40);
  const long = await line(60);
  await H.treeClick('右基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 20);
  await H.tool('邊角矩形');
  await H.sk(-3, -2);
  await H.sk(3, 2);
  await H.solved();
  const profile = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(profile);
  await H.action('特徵', '掃出填料/基材');
  const steps = [];
  const step = (title, expected) => {
    const volume = state().result.mass.volume;
    steps.push({ name: title, volume, expected, pass: near(volume, expected) && failed().length === 0 });
  };
  const select = pm().querySelector('select');
  const offered = [...select.options].map((o) => o.textContent);
  const startedOn = select.selectedOptions[0]?.textContent;
  await H.settle();
  step('the path is the latest sketch with a line (60): 6 × 4 × 60', 24 * 60);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, state().doc.features.find((f) => f.name === short).id);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  step('the list changed to the path of 40: 6 × 4 × 40', 24 * 40);
  await H.pmOk();
  step('committed', 24 * 40);
  const names = state().result.faceNames.filter((n) => n.startsWith('sweep'));
  const label = [...document.querySelectorAll('.feature-tree *')].some((e) => e.textContent === '掃出1' && e.children.length === 0);
  return {
    name: 'sweep of a rectangle along a line, the path chosen in the PropertyManager',
    offered,
    startedOn,
    names,
    inTree: label,
    steps,
    failed: failed(),
    pass: startedOn === long && offered.includes(short) && !offered.includes(profile) && names.length === 6 && steps.every((s) => s.pass) && failed().length === 0,
  };
};
