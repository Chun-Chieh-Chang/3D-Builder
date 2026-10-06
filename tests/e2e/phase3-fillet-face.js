// Fillet and chamfer by face (docs/fillet-by-face-plan.md, F-1 to F-3) through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the
// store is only read (and, for the one face the view cannot show, a command is sent). Run one test per page load:
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-fillet-face.js?' + Date.now());
//   await __ff.constant();   // a fillet given the top face of a 40 × 30 × 12 block
//   await __ff.face();       // a face fillet between the top and a side
//   await __ff.full();       // a full round fillet of the top of a 40 × 30 × 20 block
//   await __ff.chamfer();    // a chamfer given the top face, 2 × 2

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const FF = (window.__ff = {});

const state = () => store.getState();
const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const volume = () => state().result.mass.volume;

/** A block 40 × 30 × `height` on the top plane, seen from the isometric view. */
async function block(height) {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(20, 15, 8);
  await H.tool('邊角矩形');
  await H.sk(0, 0);
  await H.sk(40, 30);
  await H.solved();
  const name = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(name);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', String(height));
  await H.pmOk();
  await H.action('檢視', '等角');
}

/** The planar faces of the model on screen, with where their centers are. */
const faces = () => state().result.faceFingerprints.map((f, i) => ({ i, type: f.type, c: f.center, name: state().result.faceNames[i] })).filter((f) => f.type === 'plane');
const at = (pred) => faces().find((f) => pred(f.c));
const panelSelect = async (value) => {
  const sel = document.querySelector('.property-manager select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
};
const group = async (g, c) => {
  document.querySelector(`[data-group="${g}"] input[type=radio]`).click();
  await H.settle();
  await H.at(c);
  await H.wait(200);
};

FF.constant = async () => {
  await block(12);
  await H.action('特徵', '圓角');
  const top = at((c) => Math.abs(c[1] - 12) < 1e-6);
  await H.at(top.c);
  await H.wait(200);
  const f = state().doc.features.at(-1);
  const listed = f.faces?.map((x) => x.name);
  await H.pmInput('半徑', '2');
  await H.pmOk();
  await H.wait(500);
  const expected = 14400 - ((1 - Math.PI / 4) * 4 * 140 - 8 * 8 * (5 / 6 - Math.PI / 4));
  return { name: 'the top face clicked is listed, and rounds its four edges', listed, volume: volume(), expected, failed: failed(), pass: listed?.length === 1 && near(volume(), expected) && failed().length === 0 };
};

FF.chamfer = async () => {
  await block(12);
  await H.action('特徵', '導角');
  const top = at((c) => Math.abs(c[1] - 12) < 1e-6);
  await H.at(top.c);
  await H.wait(200);
  const sel = document.querySelector('.property-manager select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'distanceDistance');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  await H.pmInput('距離 1', '2');
  await H.pmInput('距離 2', '2');
  await H.pmOk();
  await H.wait(500);
  const expected = 14400 - (2 * 140 - (8 * 8) / 6);
  return { name: 'the top face chamfered 2 × 2', volume: volume(), expected, failed: failed(), pass: near(volume(), expected) && failed().length === 0 };
};

FF.face = async () => {
  await block(12);
  await H.action('特徵', '圓角');
  await panelSelect('face');
  const top = at((c) => Math.abs(c[1] - 12) < 1e-6);
  const side = at((c) => Math.abs(c[0] - 40) < 1e-6 && Math.abs(c[1] - 6) < 1e-6);
  await group('faces', top.c);
  await group('faces2', side.c);
  const f = state().doc.features.at(-1);
  const sets = [f.kind, f.faces?.map((x) => x.name), f.faces2?.map((x) => x.name)];
  await H.pmInput('半徑', '2');
  await H.pmOk();
  await H.wait(500);
  const expected = 14400 - (1 - Math.PI / 4) * 4 * 30;
  return { name: 'a face fillet between the top and the side at x = 40 rounds that one edge', sets, volume: volume(), expected, failed: failed(), pass: sets[0] === 'face' && near(volume(), expected) && failed().length === 0 };
};

FF.full = async () => {
  await block(20);
  await H.action('特徵', '圓角');
  await panelSelect('full');
  const radiusBox = [...document.querySelectorAll('.property-manager .pm-row span')].some((s) => s.textContent === '半徑');
  const top = at((c) => Math.abs(c[1] - 20) < 1e-6);
  const front = at((c) => Math.abs(c[2]) < 1e-6 && Math.abs(c[1] - 10) < 1e-6);
  const back = at((c) => Math.abs(c[2] + 30) < 1e-6 && Math.abs(c[1] - 10) < 1e-6); // behind the block in this view: put in by a command
  await group('center', top.c);
  await group('faces', front.c);
  const f = state().doc.features.at(-1);
  store.execute({ type: 'setFilletSets', featureId: f.id, kind: 'full', faces: f.faces, center: f.center, faces2: [{ kind: 'face', name: back.name }] });
  await H.settle();
  await H.pmOk();
  await H.wait(600);
  const expected = 24000 - 40 * (30 * 15 - (Math.PI * 225) / 2);
  return { name: 'a full round fillet makes the top half a cylinder of radius 15, with no radius box', radiusBox, volume: volume(), expected, failed: failed(), pass: !radiusBox && near(volume(), expected) && failed().length === 0 };
};
