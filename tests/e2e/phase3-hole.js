// Phase 3a-6a (C4.8): the hole wizard through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-hole.js?' + Date.now());   // then wait a moment for the viewer
//   await __h.run();   // -> { name, steps: [{ name, volume, expected, pass }], pass }
//
// A 40 × 30 × 10 plate with one point on its top face. Create a blind drill point, edit its angle, save and reopen it, then switch the hole
// to through all and check an M6 counterbore (Ø6.6 through, Ø11 × 6.5).

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const { H, treeEdit } = window.__man;
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
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 6);
  await H.tool('點');
  await H.sk(5, 5);
  await H.key('Escape');
  await H.solved();
  const sketchName = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(sketchName);
  await H.action('特徵', '異型孔');
  await H.pmInput('深度', '5');
  field('鑽尖').querySelector('input').click();
  await H.settle();
  await window.__shot?.('drill-point-settings');
  const pointedVolume = (degrees) => 12000 - Math.PI * 9 * (5 + 1 / Math.tan(degrees * Math.PI / 360));
  step('a blind hole with the default 118 degree drill point', pointedVolume(118));
  await H.pmInput('鑽尖角度', '135');
  await H.pmOk();
  step('the included drill point angle edited to 135 degrees', pointedVolume(135));
  const pointed = state().doc.features.find((f) => f.type === 'hole');
  const fileName = 'drill-point.3dbx';
  const bytes = Uint8Array.from(atob(await H.saveAs(fileName)), (c) => c.charCodeAt(0));
  await H.action('檔案', '新零件');
  await H.waitFor(() => !state().doc.features.some((f) => f.type === 'hole'), 5000, 'a fresh part before reopening');
  const openPicker = window.showOpenFilePicker;
  try {
    window.showOpenFilePicker = async () => [{ name: fileName, kind: 'file', getFile: async () => new File([bytes], fileName) }];
    await H.action('檔案', '開啟舊檔');
    await H.waitFor(() => state().fileName === fileName, 20000, 'the drill-point part to open');
    await H.settle();
  } finally {
    window.showOpenFilePicker = openPicker;
  }
  step('the saved drill point rebuilds after opening', pointedVolume(135));
  steps.at(-1).pass &&= state().result.faceNames.some((n) => n.startsWith(pointed.id) && n.endsWith('.tip'));
  await treeEdit(pointed.name);
  await choose('終止型態', 'throughAll');
  if (field('鑽尖') || field('鑽尖角度')) throw new Error('Through holes should hide drill point settings');
  await H.pmOk();
  step('a straight hole of Ø6 through the plate', 12000 - Math.PI * 9 * 10);
  const hole = state().doc.features.find((f) => f.type === 'hole');
  steps.at(-1).pass &&= hole.drillPointAngle === undefined;
  // the same hole as an M6 counterbore, from the PropertyManager of the feature
  store.execute({ type: 'setHole', featureId: hole.id, hole: { kind: 'counterbore', size: 'M6', diameter: '6.6', end: { type: 'blind', depth: '10' }, cbDiameter: '11', cbDepth: '6.5' } });
  await H.settle();
  step('an M6 counterbore: Ø11 × 6.5 over Ø6.6 to a depth of 10', 12000 - Math.PI * (5.5 * 5.5 * 6.5 + 3.3 * 3.3 * 3.5));
  const names = state().result.faceNames.filter((n) => n.startsWith(hole.id));
  return { name: 'hole wizard from a sketch point on the top face', names, steps, failed: failed(), pass: names.length === 3 && // wall, counterbore wall and floor; the depth of 10 is the plate's, so there is no bottom
       steps.every((s) => s.pass) && failed().length === 0 };
};
