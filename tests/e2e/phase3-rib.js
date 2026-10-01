// Phase 3a-6d (C4.7): the rib through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-rib.js?' + Date.now());   // after a fresh load of the page; then wait a moment for the viewer
//   await __r.run();   // -> { name, steps: [{ name, volume, expected, pass }], message, failed, pass }
//
// A 40 × 30 plate, 10 thick, on the top plane (it stands on y from 0 to 10); a sketch on the right plane with one line, 16 long, at y = 25; 「肋材」
// from the Features tab with the sketch selected: a wall 4 thick that grows down to the plate, 15 × 16 × 4 = 960. Then 6 thick (1440), then turned the
// other way round (away from the plate: it says so), then back.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const R = (window.__r = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

R.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 6);
  await H.tool('邊角矩形');
  await H.sk(-20, -15);
  await H.sk(20, 15);
  await H.solved();
  const first = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(first);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '10');
  await H.pmOk();
  await H.treeClick('右基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 20, 8);
  await H.tool('直線');
  await H.sk(-8, 25);
  await H.sk(8, 25);
  await H.key('Escape');
  await H.solved();
  const line = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(line);
  await H.action('特徵', '肋材');
  await H.settle();
  const steps = [];
  const step = (title, expected) => {
    const volume = state().result.mass.volume;
    steps.push({ name: title, volume, expected, pass: near(volume, expected) && failed().length === 0 });
  };
  step('a wall of 4 grown from the line down to the plate: 12000 + 15 × 16 × 4', 12000 + 960);
  await H.pmInput('肋材厚度', '6');
  step('6 thick: 12000 + 15 × 16 × 6', 12000 + 1440);
  await H.pmCheck('反轉方向', true);
  const message = document.querySelector('.property-manager .pm-message')?.textContent ?? '';
  const turned = failed().length > 0 || message !== '';
  await H.pmCheck('反轉方向', false);
  step('turned back', 12000 + 1440);
  await H.pmOk();
  const names = state().result.faceNames.filter((n) => n.startsWith('rib'));
  return {
    name: 'rib from the one line of a sketch, grown down to a plate',
    message,
    names,
    steps,
    failed: failed(),
    pass: turned && message.includes('碰不到本體') && names.includes('rib1:cap:start') && steps.every((s) => s.pass) && failed().length === 0,
  };
};
