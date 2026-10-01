// Phase 3a-6c (C4.5): the loft through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-loft.js?' + Date.now());   // after a fresh load of the page; then wait a moment for the viewer
//   await __l.run();   // -> { name, steps: [{ name, volume, expected, pass }], names, failed, pass }
//
// A 10 × 6 rectangle on the front plane and a 5 × 3 rectangle on a plane 10 above it; 「疊層拉伸填料/基材」 from the Features tab with the second sketch
// selected: the sections are that one and the latest other sketch (the one on the plane 20 above), the volume that of a pyramid frustum over 10, h/3·(A1 + √(A1·A2)
// + A2) = 350. The first section is moved down the list (the volume is the same), then the sketch on the front plane is added from the list as a third section.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const L = (window.__l = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const pm = () => document.querySelector('.property-manager');
const button = (title) => [...pm().querySelectorAll('button')].filter((b) => b.title === title);

async function rectangle(plane, w, h) {
  await H.treeClick(plane);
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 20);
  await H.tool('邊角矩形');
  await H.sk(-w / 2, -h / 2);
  await H.sk(w / 2, h / 2);
  await H.solved();
  const name = H.sketch().name;
  await H.exitSketch();
  return name;
}

async function offsetPlane(from, distance) {
  await H.treeClick(from);
  await H.action('特徵', '基準面');
  await H.pmInput('偏移距離', String(distance));
  await H.pmOk();
}

L.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  const first = await rectangle('前基準面', 10, 6);
  await offsetPlane('前基準面', 10);
  const second = await rectangle('基準面1', 5, 3);
  await offsetPlane('前基準面', 20);
  const third = await rectangle('基準面2', 10, 6);
  await H.treeClick(second);
  await H.action('特徵', '疊層拉伸填料/基材');
  await H.settle();
  const steps = [];
  const step = (title, expected) => {
    const volume = state().result.mass.volume;
    steps.push({ name: title, volume, expected, pass: near(volume, expected) && failed().length === 0 });
  };
  const rows = () => [...pm().querySelectorAll('.pm-row')].filter((r) => /^\d+\. /.test(r.querySelector('span')?.textContent ?? '')).map((r) => r.querySelector('span').textContent);
  const started = rows();
  step('the two sketches as sections: 10 × 6 to 5 × 3 over 10', 350);
  button('下移')[0].click();
  await H.settle();
  const moved = rows();
  step('the first section moved down: the same body the other way up', 350);
  const select = pm().querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, state().doc.features.find((f) => f.name === first).id);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  const three = rows();
  // 10 × 6, 5 × 3 and 10 × 6 at 0, 10 and 20: more than the frustum, less than the prism of the big section
  const volume = state().result.mass.volume;
  steps.push({ name: 'a third section added: more than the frustum, less than the prism', volume, expected: '350 < v < 1200', pass: volume > 350 && volume < 1200 && failed().length === 0 });
  await H.pmOk();
  const names = state().result.faceNames.filter((n) => n.startsWith('loft'));
  return {
    name: 'loft of two and three rectangles on parallel planes, the sections ordered in the PropertyManager',
    started,
    moved,
    three,
    names,
    steps,
    failed: failed(),
    pass: started.length === 2 && moved[0].includes(second) && three.length === 3 && names.some((n) => n === 'loft1:cap:start') && names.some((n) => n === 'loft1:cap:end') && steps.every((s) => s.pass) && failed().length === 0,
  };
};
