// Phase 3a-7b (C6.1, C6.2): the linear and circular pattern through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-pattern.js?' + Date.now());   // after a fresh load of the page; then wait a moment for the viewer
//   await __p.run();   // -> { name, steps: [{ name, volume, expected, pass }], names, failed, pass }
//
// A plate 60 × 20 × 5 on the top plane (x from −30 to 30, z from −10 to 10, y from 0 to 5); a sketch on its top face with a circle of radius 2 at (−25, 0),
// 「伸長填料/基材」 5 up: a post. 「線性複製排列」 of the post: 5 along x, 10 apart (four more posts), then the second instance skipped (three more).
// Then 「基準軸」 where the front and the right planes meet (the y axis) and 「環狀複製排列」 of the post about it, 2 in all round: a post at x = 25.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const P = (window.__p = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const POST = Math.PI * 4 * 5;
const PLATE = 6000;
const chip = async (label) => {
  const b = [...document.querySelectorAll('.property-manager .datum-picker button')].find((x) => x.title === label || x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  b.click();
  await H.settle();
};

P.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 8);
  await H.tool('邊角矩形');
  await H.sk(-30, -10);
  await H.sk(30, 10);
  await H.solved();
  const first = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(first);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '5');
  await H.pmOk();
  const steps = [];
  const step = (title, expected) => {
    const volume = state().result.mass.volume;
    steps.push({ name: title, volume, expected, bodies: state().result.bodies.length, pass: near(volume, expected, 1e-6) && failed().length === 0 });
  };
  step('the plate', PLATE);
  // the post: a circle on the top face
  const r = state().result;
  const topFace = r.faceFingerprints.findIndex((fp) => fp.type === 'plane' && Math.abs(fp.center[1] - 5) < 1e-6 && fp.dir && Math.abs(fp.dir[1]) > 0.99);
  store.viewer.setView('iso');
  await H.wait(400);
  await H.at(r.faceFingerprints[topFace].center);
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 8);
  await H.tool('圓');
  await H.sk(-25, 0);
  await H.sk(-23, 0);
  await H.key('Escape');
  await H.solved();
  const circleSketch = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(circleSketch);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '5');
  await H.pmOk();
  step('a post of radius 2 and height 5 at x = −25', PLATE + POST);
  const post = state().doc.features.filter((f) => f.type === 'extrude').at(-1);

  // five posts along x, 10 apart
  await H.treeClick(post.name);
  await H.action('特徵', '線性複製排列');
  await H.pmInput('實例數', '5');
  step('five posts, 10 apart along the right plane normal (x)', PLATE + 5 * POST);
  const linear = state().doc.features.find((f) => f.type === 'pattern');
  const names = state().result.faceNames.filter((n) => n.startsWith(`${linear.id}:inst`));
  // the second instance left out
  const skip = [...document.querySelectorAll('.property-manager .datum-picker button')].find((b) => b.textContent === '2');
  skip.click();
  await H.settle();
  step('the second instance skipped: four posts', PLATE + 4 * POST);
  skip.click();
  await H.settle();
  // a count and a spacing that put an instance off the plate say so
  await H.pmInput('實例數', '9');
  const offPlate = document.querySelector('.property-manager .pm-message')?.textContent ?? '';
  await H.pmInput('實例數', '5');
  await H.pmInput('間距', '2');
  const overlap = document.querySelector('.property-manager .pm-message')?.textContent ?? '';
  await H.pmInput('間距', '10');
  await H.pmOk();
  step('back to five posts', PLATE + 5 * POST);

  // a reference axis where the front and the right planes meet, and the post about it
  await H.action('特徵', '基準軸');
  await H.pmSelect('planes');
  await chip('前基準面');
  await chip('右基準面');
  await H.pmOk();
  await H.treeClick(post.name);
  await H.action('特徵', '環狀複製排列');
  await chip('基準軸1');
  await H.pmInput('實例數', '2');
  step('two posts all the way round the y axis: one more at x = 25', PLATE + 6 * POST);
  await H.pmOk();
  const circular = state().doc.features.filter((f) => f.type === 'pattern').at(-1);
  const round = state().result.faceFingerprints[state().result.faceNames.indexOf(`${circular.id}:inst1:${post.id}:cap:end`)];
  const tree = [...document.querySelectorAll('.tree-row')].map((x) => x.textContent);
  return {
    name: 'linear and circular pattern of a post on a plate',
    names,
    offPlate,
    overlap,
    roundCentre: round?.center,
    tree,
    steps,
    failed: failed(),
    pass:
      steps.every((s) => s.pass) &&
      names.includes(`${linear.id}:inst4:${post.id}:cap:end`) &&
      offPlate.includes('第 ') &&
      overlap.includes('重疊') &&
      !!round &&
      near(round.center[0], 25, 1e-6) &&
      failed().length === 0,
  };
};
