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
  // the view from the keyboard (SolidWorks): keys as a hand presses them, on the page (not in a field)
  const press = async (key, mods = {}, target = window) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ctrlKey: false, shiftKey: false, altKey: false, ...mods }));
    await H.wait(150);
  };
  const toViewer = () => viewer().camera.position.clone().sub(viewer().controls.target).normalize();
  const up = () => viewer().camera.up.clone();
  const deg = (a, b) => (a.angleTo(b) * 180) / Math.PI;
  const right = () => up().cross(toViewer()).normalize();
  await step('6 from the front (Ctrl+1): → turns the model 15° to the right, ↑ 15° up; Shift+← a quarter turn, once', async () => {
    await press('1', { ctrlKey: true });
    const front = toViewer();
    await press('ArrowRight');
    const r = { angle: deg(front, toViewer()), toRight: right().dot(front) > 0 };
    await press('ArrowLeft');
    await press('ArrowUp');
    const u = { angle: deg(front, toViewer()), up: up().dot(front) > 0 };
    await press('ArrowDown');
    const back = deg(front, toViewer());
    await press('ArrowLeft', { shiftKey: true });
    const quarter = deg(front, toViewer());
    await shot('6-turned-a-quarter-by-shift-left');
    return { r, u, back, quarter, pass: near(r.angle, 15, 1e-6) && r.toRight && near(u.angle, 15, 1e-6) && u.up && back < 1e-6 && near(quarter, 90, 1e-6) };
  });
  await step('7 Alt+→ rolls it 15° clockwise (the direction stays); Ctrl+→ pans it right; Shift+Z zooms in and Z out by 1.25', async () => {
    await press('1', { ctrlKey: true });
    const dir = toViewer();
    const up0 = up();
    await press('ArrowRight', { altKey: true });
    const roll = { angle: deg(up0, up()), same: deg(dir, toViewer()), clockwise: right().dot(up0) > 0 };
    await press('ArrowLeft', { altKey: true });
    const t0 = viewer().controls.target.clone();
    await press('ArrowRight', { ctrlKey: true });
    const moved = t0.clone().sub(viewer().controls.target).dot(right()); // the old middle is now to the right of the new one
    const z0 = viewer().camera.zoom;
    await press('Z', { shiftKey: true });
    const zin = viewer().camera.zoom / z0;
    await press('z');
    const zout = viewer().camera.zoom / z0;
    return { roll, moved, zin, zout, pass: near(roll.angle, 15, 1e-6) && roll.same < 1e-6 && roll.clockwise && moved > 0 && near(zin, 1.25, 1e-9) && near(zout, 1, 1e-9) };
  });
  await step('8 Ctrl+Shift+Z goes back through the views, and is not an undo', async () => {
    await press('1', { ctrlKey: true });
    const front = toViewer();
    await press('ArrowRight');
    await press('ArrowRight');
    const features = store.getState().doc.features.length;
    const canUndo = store.getState().canUndo;
    await press('Z', { ctrlKey: true, shiftKey: true });
    const one = deg(front, toViewer());
    await press('Z', { ctrlKey: true, shiftKey: true });
    const two = deg(front, toViewer());
    return { one, two, features, canUndo, pass: near(one, 15, 1e-6) && two < 1e-6 && store.getState().doc.features.length === features && store.getState().canUndo === canUndo };
  });
  await step('9 the space bar opens 視角方位; 後視 there turns to the back; Ctrl+3 and Ctrl+6 are the left and the bottom', async () => {
    await press(' ');
    const dialog = document.querySelector('.view-orientation');
    const labels = dialog ? [...dialog.querySelectorAll('button')].map((b) => b.firstChild.textContent) : [];
    await shot('9-view-orientation');
    dialog?.querySelector('[data-view="view-back"]').click();
    await H.wait(350);
    const back = direction();
    const closed = !document.querySelector('.view-orientation');
    await press('3', { ctrlKey: true });
    const left = direction();
    await press('6', { ctrlKey: true });
    const bottom = direction();
    const is = (d, w) => w.every((x, i) => Math.abs(d[i] - x) < 0.01);
    return { labels, back, left, bottom, closed, pass: labels.join() === '前視,後視,左視,右視,上視,下視,等角,正視於' && closed && is(back, [0, 0, -1]) && is(left, [-1, 0, 0]) && is(bottom, [0, -1, 0]) };
  });
  await step('10 the angle of the arrow keys is an option: 30° turns 30°', async () => {
    store.setOptions({ viewArrowStep: 30 });
    await press('1', { ctrlKey: true });
    const front = toViewer();
    await press('ArrowRight');
    const angle = deg(front, toViewer());
    store.setOptions({ viewArrowStep: 15 });
    return { angle, pass: near(angle, 30, 1e-6) };
  });
  await step('11 typing in a field the arrows move the caret, not the view', async () => {
    await press('1', { ctrlKey: true });
    const front = toViewer();
    const field = document.querySelector('.feature-tree input');
    field.focus();
    await press('ArrowRight', {}, field);
    await press(' ', {}, field);
    field.blur();
    return { field: !!field, moved: deg(front, toViewer()), dialog: !!document.querySelector('.view-orientation'), pass: !!field && deg(front, toViewer()) < 1e-6 && !document.querySelector('.view-orientation') };
  });
  return S.result('C20');
};
