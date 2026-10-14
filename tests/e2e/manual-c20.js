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
  // a face of the view cube (only those toward the viewer are drawn), and a click where a hand puts it: the middle of its corners on the screen, on
  // whatever the page finds there; `hit` is whether that is the face itself
  const cubeFace = (dir) => document.querySelector(`.view-cube [data-cube-dir="${dir}"]`);
  const faceMiddle = (f) => {
    const m = f.ownerSVGElement.getScreenCTM();
    const pts = Array.from({ length: f.points.numberOfItems }, (_, i) => f.points.getItem(i));
    const [x, y] = [pts.reduce((s, p) => s + p.x, 0) / pts.length, pts.reduce((s, p) => s + p.y, 0) / pts.length];
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  };
  const clickFace = async (dir) => {
    const f = cubeFace(dir);
    if (!f) return { drawn: false, hit: false };
    const { x, y } = faceMiddle(f);
    const at = document.elementFromPoint(x, y);
    at?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    await H.wait(350);
    return { drawn: true, hit: at === f };
  };
  await step('4 the six sides of the view cube: a click on each turns the model to that direction', async () => {
    const want = { '0,0,1': [0, 0, 1], '0,0,-1': [0, 0, -1], '1,0,0': [1, 0, 0], '-1,0,0': [-1, 0, 0], '0,1,0': [0, 1, 0], '0,-1,0': [0, -1, 0] };
    const got = {};
    for (const [dir, v] of Object.entries(want)) {
      // from a corner where the side shows: front, top and right from the isometric one, the others from the opposite corner
      if (v.some((x) => x > 0)) await S.iso();
      else viewer().lookFrom(-1, -1, -1);
      await H.wait(200);
      const label = [...document.querySelectorAll('.view-cube .cube-label')].map((l) => l.textContent);
      const click = await clickFace(dir);
      got[dir] = { ...click, labels: label.join(''), direction: direction() };
    }
    const ok = Object.entries(want).every(([k, v]) => got[k].hit && v.every((x, i) => Math.abs(got[k].direction[i] - x) < 0.01));
    return { got, pass: ok && got['0,0,1'].labels.length === 3 && got['0,0,-1'].labels.length === 3 };
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
  const right_ = right; // the screen's right, by another name where 'right' is a result
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
  await step('12 the view cube as FreeCAD\'s: from the isometric view 3 octagon sides, 3 edge rectangles at 45° and 4 corner hexagons; each of the 26 faces, clicked at its middle, looks from its direction', async () => {
    await S.iso();
    await H.wait(200);
    const drawn = [...document.querySelectorAll('.view-cube [data-cube-dir]')];
    const shapes = drawn.map((f) => `${f.dataset.cubeKind}:${f.points.numberOfItems}`).sort();
    // every face drawn is the one found at its own middle: none is covered or covers another
    const covered = drawn.filter((f) => {
      const { x, y } = faceMiddle(f);
      return document.elementFromPoint(x, y) !== f;
    }).map((f) => f.dataset.cubeDir);
    await shot('12-the-cube-from-the-isometric-view');
    const unit = (x, y, z) => new (toViewer().constructor)(x, y, z).normalize();
    const seen = {};
    for (const x of [-1, 0, 1])
      for (const y of [-1, 0, 1])
        for (const z of [-1, 0, 1]) {
          if (!x && !y && !z) continue;
          // from a view near the face's own but not it (turned 20° and 10°), so the click has to move the camera
          viewer().lookFrom(x, y, z);
          viewer().orbit('horizontal', 20);
          viewer().orbit('vertical', 10);
          await H.wait(120);
          const before = deg(toViewer(), unit(x, y, z));
          const click = await clickFace(`${x},${y},${z}`);
          seen[`${x},${y},${z}`] = { ...click, before: Math.round(before), after: deg(toViewer(), unit(x, y, z)) };
        }
    const all = Object.values(seen);
    return {
      shapes,
      covered,
      seen,
      pass:
        shapes.join() === ['corner:6', 'corner:6', 'corner:6', 'corner:6', 'edge:4', 'edge:4', 'edge:4', 'face:8', 'face:8', 'face:8'].join() &&
        covered.length === 0 &&
        all.length === 26 &&
        all.every((s) => s.drawn && s.hit && s.before > 10 && s.after < 1e-6),
    };
  });
  await step('13 the arrows around the cube turn the model 45° (▶ right, ▲ up) and roll it 45° (↻ clockwise); with the option at 30, 30°', async () => {
    const click = async (k) => {
      document.querySelector(`.view-cube [data-cube-arrow="${k}"]`).click();
      await H.wait(150);
    };
    await press('1', { ctrlKey: true });
    const front = toViewer();
    await click('right');
    const right = { angle: deg(front, toViewer()), toRight: right_().dot(front) > 0 };
    await click('left');
    await click('up');
    const upTurn = { angle: deg(front, toViewer()), up: up().dot(front) > 0 };
    await click('down');
    const up0 = up();
    await click('rollRight');
    const roll = { angle: deg(up0, up()), clockwise: right_().dot(up0) > 0, same: deg(front, toViewer()) };
    await click('rollLeft');
    store.setOptions({ viewCubeStep: 30 });
    await H.wait(100);
    await press('1', { ctrlKey: true });
    await click('right');
    const thirty = deg(front, toViewer());
    store.setOptions({ viewCubeStep: 45 });
    await shot('13-turned-by-the-arrows');
    return { right, upTurn, roll, thirty, pass: near(right.angle, 45, 1e-6) && right.toRight && near(upTurn.angle, 45, 1e-6) && upTurn.up && near(roll.angle, 45, 1e-6) && roll.clockwise && roll.same < 1e-6 && near(thirty, 30, 1e-6) };
  });
  await step('14 a narrow 3D view: the cube goes below the heads-up bar instead of under it; wide, it stays at the top', async () => {
    const vp = document.querySelector('.viewport');
    const parts = () => [...document.querySelectorAll('.view-cube .cube-arrow, .view-cube .cube')].map((e) => e.getBoundingClientRect());
    const covered = () => {
      const bar = document.querySelector('.heads-up').getBoundingClientRect();
      return parts().filter((p) => p.left < bar.right && p.right > bar.left && p.top < bar.bottom && p.bottom > bar.top).length;
    };
    const top = () => Math.round(document.querySelector('.view-cube').getBoundingClientRect().top - vp.getBoundingClientRect().top);
    const wide = { width: Math.round(vp.getBoundingClientRect().width), top: top(), covered: covered() };
    const before = vp.style.width;
    vp.style.width = '500px';
    await H.wait(300);
    const narrow = { width: Math.round(vp.getBoundingClientRect().width), top: top(), covered: covered() };
    await shot('14-a-narrow-view');
    vp.style.width = before;
    await H.wait(300);
    return { wide, narrow, pass: wide.width > 620 && wide.top === 44 && wide.covered === 0 && narrow.width === 500 && narrow.top === 100 && narrow.covered === 0 };
  });
  return S.result('C20');
};
