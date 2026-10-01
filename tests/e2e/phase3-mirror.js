// Phase 3a-7c (C6.3): the mirror through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-mirror.js?' + Date.now());   // after a fresh load of the page; then wait a moment for the viewer
//   await __m.run();   // -> { name, steps: [{ name, volume, expected, pass }], names, failed, pass }
//
// A plate 60 × 20 × 5 on the top plane (x from −30 to 30, z from −10 to 10, y from 0 to 5) with a post of radius 2 and height 5 at x = −25. 「鏡射」 of the
// post across the right plane (x = 0, the middle of the plate): a second post at x = 25. Then the same as a mirror of the body: joined (the plate is its
// own image, so the posts are what is new), then as a body of its own (two bodies, the volume of each counted).

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const M = (window.__m = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const POST = Math.PI * 4 * 5;
const PLATE = 6000;
const tick = async (label, on) => {
  const row = [...document.querySelectorAll('.property-manager .selection-box li')].find((li) => li.textContent.includes(label));
  const box = row.querySelector('input');
  if (box.checked !== on) box.click();
  await H.settle();
};

M.run = async () => {
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
  const post = state().doc.features.filter((f) => f.type === 'extrude').at(-1);
  const steps = [];
  const step = (title, expected, bodies) => {
    const volume = state().result.bodies.reduce((v, b) => v + b.volume, 0);
    steps.push({ name: title, volume, expected, bodies: state().result.bodies.length, pass: near(volume, expected) && (bodies === undefined || state().result.bodies.length === bodies) && failed().length === 0 });
  };
  step('the plate and the post', PLATE + POST, 1);

  // the post mirrored across the right plane
  await H.treeClick(post.name);
  await H.action('特徵', '鏡射');
  step('the post mirrored across the right plane: a second one at x = 25', PLATE + 2 * POST, 1);
  const mirror = state().doc.features.find((f) => f.type === 'mirror');
  const image = state().result.faceFingerprints[state().result.faceNames.indexOf(`${mirror.id}:mirror:${post.id}:cap:end`)];

  // the body mirrored instead: nothing chosen yet, then the body, joined, then on its own
  await H.pmSelect('bodies');
  const none = document.querySelector('.property-manager .pm-message')?.textContent ?? '';
  await tick(state().result.bodies[0].name, true);
  step('the body mirrored and joined: the plate is its own image, the post is what is new', PLATE + 2 * POST, 1);
  await H.pmCheck('合併結果', false);
  step('the body mirrored into a body of its own: two bodies', 2 * (PLATE + POST), 2);
  await H.pmOk();
  const names = state().result.faceNames.filter((n) => n.startsWith(`${mirror.id}:mirror:`));
  return {
    name: 'mirror of a post and of the body across the right plane',
    none,
    imageCentre: image?.center,
    steps,
    names: names.slice(0, 4),
    failed: failed(),
    pass: steps.every((s) => s.pass) && none.includes('請選擇要鏡射的本體') && !!image && near(image.center[0], 25) && names.length > 0 && failed().length === 0,
  };
};
