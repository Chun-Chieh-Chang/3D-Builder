// Phase 3a-5c (C5.5): the draft feature through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-draft.js?' + Date.now());   // then wait a moment for the viewer
//   await __d.run();   // -> { name, steps: [{ name, volume, expected, pass }], pass }
//
// A 20 × 10 block, 10 thick. 「拔模」 is pressed, the top face clicked in the graphics area (it becomes the neutral face), and the four walls are put
// in the list (with `store.execute`: three of them are hidden behind the block from any one view). The walls then lean 3° and narrow away from
// the neutral face: the integral of (20 − 2zt)(10 − 2zt) over 10. Reversed they widen.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const D = (window.__d = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

D.run = async () => {
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
  await H.pmOk();
  const r = state().result;
  const t = Math.tan((3 * Math.PI) / 180);
  const steps = [];
  const step = (title, expected) => {
    const volume = state().result.mass.volume;
    steps.push({ name: title, volume, expected, pass: near(volume, expected) && failed().length === 0 });
  };
  step('the block', 2000);

  const top = r.faceFingerprints.findIndex((fp) => fp.type === 'plane' && Math.abs(Math.abs(fp.center[1]) - 10) < 1e-6);
  store.viewer.setView('iso');
  await H.wait(400);
  await H.at(r.faceFingerprints[top].center); // select the top face
  await H.action('特徵', '拔模');
  const neutral = state().doc.features.find((f) => f.type === 'draft').neutral.name;
  const sides = r.faceNames.filter((n) => n.includes(':side:'));
  const draft = state().doc.features.find((f) => f.type === 'draft');
  store.execute({ type: 'setDraftFeature', featureId: draft.id, neutral: draft.neutral, faces: sides.map((n) => ({ kind: 'face', name: n })), angle: '3deg' });
  await H.settle();
  const listed = [...document.querySelector('.property-manager').querySelectorAll('.selection-box li')].map((li) => li.textContent);
  await H.pmOk();
  step('four walls leaning 3° about the top face', 2000 - 30 * t * 100 + (4 / 3) * t * t * 1000);
  const id = state().doc.features.find((f) => f.type === 'draft').id;
  const f = state().doc.features.find((x) => x.id === id);
  store.execute({ type: 'setDraftFeature', featureId: id, neutral: f.neutral, faces: f.faces, angle: '3deg', reverse: true });
  await H.settle();
  step('reversed: they widen away from it', 2000 + 30 * t * 100 + (4 / 3) * t * t * 1000);
  return { name: 'draft from the top face: four walls, then reversed', neutral, sides: sides.length, listed, steps, failed: failed(), pass: !!neutral && sides.length === 4 && listed.length === 5 && steps.every((s) => s.pass) && failed().length === 0 };
};
