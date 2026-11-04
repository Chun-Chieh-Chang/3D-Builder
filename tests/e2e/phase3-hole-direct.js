// Phase 3a-6a (C4.8): the hole wizard through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-hole.js?' + Date.now());   // then wait a moment for the viewer
//   await __h.run();   // -> { name, steps: [{ name, volume, expected, pass }], pass }
//
// A 40 × 30 plate centred on the origin, 10 thick; a sketch on its top face with one point; 「異型孔」 from the Features tab: a straight Ø6 hole of 10
// (through all), then an M6 counterbore (Ø6.6 through, Ø11 × 6.5), then a countersink.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const X = (window.__h = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const pm = () => document.querySelector('.property-manager');
const field = (label) => [...pm().querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent === label);
const choose = async (label, value) => {
  const sel = field(label).querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
};

X.run = async () => {
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
  const r = state().result;
  const steps = [];
  const step = (title, expected) => {
    const volume = state().result.mass.volume;
    steps.push({ name: title, volume, expected, pass: near(volume, expected) && failed().length === 0 });
  };
  step('the plate', 12000);
  // the sketch on the top face, with one point
  const top = r.faceFingerprints.findIndex((fp) => fp.type === 'plane' && Math.abs(Math.abs(fp.center[1]) - 10) < 1e-6);
  store.viewer.setView('iso');
  await H.wait(400);
  await H.at(r.faceFingerprints[top].center);
  await H.action('特徵', '異型孔');
  await H.frameSketch(0, 0, 6);
  await H.tool('點');
  await H.sk(5, 5);
  await H.key('Escape');
  await H.solved();
  const sketchName = H.sketch().name;
  await H.exitSketch();
  if (state().editing?.kind !== 'feature') throw new Error('hole panel did not open');
  const beforeCancel = state().doc.features.length;
  store.cancelEdit();
  await H.settle();
  if (state().doc.features.length !== beforeCancel - 2) throw new Error('cancel left sketch or hole');
  store.viewer.setView('iso');
  await H.wait(400);
  await H.at(r.faceFingerprints[top].center);
  await H.action('特徵', '異型孔');
  await H.frameSketch(0, 0, 6);
  await H.tool('點');
  await H.sk(5, 5);
  await H.key('Escape');
  await H.solved();
  await H.exitSketch();
  const kind = pm().querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(kind, 'tapped');
  kind.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  await choose('標準規格', 'M6');
  await H.pmCheck('裝飾螺紋線', true);
  await H.pmOk();
  if (state().result.cosmeticThreads.length !== 1) throw new Error('integrated annotation missing');
  if (state().result.cosmeticThreads[0].standardDesignation !== 'M6') throw new Error('thread spec mismatch');
  const count = state().doc.features.length;
  store.undo();
  await H.settle();
  if (state().doc.features.length !== count - 2) throw new Error('undo did not remove both features');
  store.redo();
  await H.settle();
  if (state().doc.features.length !== count || state().result.cosmeticThreads.length !== 1) throw new Error('redo lost hole or annotation');
  step('M6 integrated hole', 12000 - Math.PI * 6.25 * 10);
  return { name: 'direct hole positions, integrated annotation and atomic cancel/undo/redo', steps, failed: failed(), pass: steps.every(s => s.pass) && failed().length === 0 };
};
