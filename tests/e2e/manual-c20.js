// Manual checklist C20 (docs/manual-verification.html): the five display types, the section (the three directions, the slider, 反向, off), the six faces of the view cube and a drag with the
// middle button, on the demo part, replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. What a
// person sees is in the pictures `verify:ui --shots` saves, one per display type and per section; here the state of the viewer is checked.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c20.js?' + Date.now());   // in a freshly loaded page
//   await __manualC20.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC20 = {});

const viewer = () => store.viewer;
const options = () => document.querySelector('.view-options');
const direction = () => {
  const v = viewer();
  return v.camera.position.clone().sub(v.controls.target).normalize().toArray().map((x) => Math.round(x * 1000) / 1000);
};
const sectionPanel = () => document.querySelector('.section-panel');

M.run = async () => {
  await step('1 新示範件: the block with a fillet, 991.416 mm³', async () => {
    await S.fresh();
    await H.action('檔案', '新示範件');
    await S.iso();
    return { volume: S.volume(), pass: near(S.volume(), 991.416, 1e-5) };
  });
  await step('2 顯示類型: the five choices one after the other, each takes at once', async () => {
    const select = options().querySelector('select[aria-label="顯示類型"]');
    const seen = [];
    for (const o of [...select.options]) {
      await S.select(select, o.value);
      await H.wait(300);
      seen.push([o.value, o.textContent, viewer().displayMode ?? null]);
      await shot(`2-display-${o.value}`);
    }
    await S.select(select, 'shadedEdges');
    return { seen, pass: seen.length === 5 && seen.map((x) => x[0]).join() === 'shadedEdges,shaded,hiddenRemoved,hiddenVisible,wireframe' && S.failed().length === 0 };
  });
  await step('3 剖面: 垂直於 X, Y, Z with the slider moved; 反向; off again', async () => {
    const button = [...options().querySelectorAll('button')].find((b) => b.textContent === '剖面');
    button.click();
    await H.wait(300);
    const seen = {};
    for (const axis of ['0', '1', '2']) {
      await S.select(sectionPanel().querySelector('select'), axis);
      const range = sectionPanel().querySelector('input[type=range]');
      const mid = Number(range.value);
      await S.type(range, String(Number(range.min) + (Number(range.max) - Number(range.min)) * 0.3), { enter: false });
      await H.wait(300);
      seen[axis] = { mid, moved: Number(sectionPanel().querySelector('input[type=range]').value), plane: viewer().section ?? null };
      await shot(`3-section-axis-${axis}`);
    }
    const flip = sectionPanel().querySelector('input[type=checkbox]');
    flip.click();
    await H.wait(300);
    await shot('3-section-flipped');
    const flipped = sectionPanel().querySelector('input[type=checkbox]').checked;
    button.click();
    await H.wait(300);
    return { seen, flipped, gone: !sectionPanel(), pass: flipped && !sectionPanel() && Object.values(seen).every((s) => s.moved !== s.mid) };
  });
  await step('4 the six faces of the view cube: each turns the model to that direction', async () => {
    const faces = [...document.querySelectorAll('.cube-face')];
    const want = { 前: [0, 0, 1], 後: [0, 0, -1], 右: [1, 0, 0], 左: [-1, 0, 0], 上: [0, 1, 0], 下: [0, -1, 0] };
    const got = {};
    for (const f of faces) {
      f.click();
      await H.wait(350);
      got[f.textContent] = direction();
    }
    const ok = Object.entries(want).every(([k, v]) => got[k] && v.every((x, i) => Math.abs(got[k][i] - x) < 0.01));
    return { got, pass: faces.length === 6 && ok };
  });
  await step('5 a drag with the middle button turns the model and the cube follows', async () => {
    await S.iso();
    const before = viewer().cubeMatrix().join();
    const dirBefore = direction();
    await H.dragView(120, 40);
    const after = viewer().cubeMatrix().join();
    await shot('5-turned-by-the-middle-button');
    return { dirBefore, dirAfter: direction(), pass: before !== after && direction().join() !== dirBefore.join() };
  });
  return S.result('C20');
};
