// The position of a section can be dragged with the left mouse button: with a section on, the orange cut takes hold (the cursor becomes a hand over it), a press on it and a drag
// along the axis moves the cut by what the axis covers on the screen, the slider and the number follow, it stops at the ends of the model, and nothing else happens (no component
// is moved or chosen, the model is not turned). Without a section the left button does what it did. In an assembly and in a part. Asked for by the user. Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-section-drag.js?' + Date.now());   // in a freshly loaded page
//   await __manualSectionDrag.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualSectionDrag = {});

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await window.__shot?.(name);
  steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r });
  return r;
};
const bar = () => document.querySelector('.view-options');
const button = (label) => [...bar().querySelectorAll('button')].find((b) => b.textContent === label);
const value = () => Number(bar().querySelector('.section-value').value);
const range = () => bar().querySelector('input[type=range]');
const canvas = () => H.canvas();
const setSelect = async (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(150);
};
const setRange = async (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(150);
};
const fire = (type, x, y, buttons = 0, extra = {}) =>
  canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 21, button: 0, buttons, ...extra }));
/** A point of the canvas where the cut can be taken hold of: [x, y, the point of the model there]. */
const onCut = () => {
  const r = H.rect();
  for (let fy = 0.15; fy < 0.9; fy += 0.04) {
    for (let fx = 0.1; fx < 0.9; fx += 0.04) {
      const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
      const p = store.viewer.sectionHit(x, y);
      if (p) return [x, y, p];
    }
  }
  return null;
};
const offCut = () => {
  const r = H.rect();
  for (let fy = 0.05; fy < 0.95; fy += 0.05) {
    for (let fx = 0.05; fx < 0.97; fx += 0.05) {
      const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
      if (!store.viewer.sectionHit(x, y)) return [x, y];
    }
  }
  return null;
};
/** Screen pixels one unit of +axis covers at a point (the camera is straight, the same everywhere). */
const pixelsPerUnit = (p, axis) => {
  const a = H.worldToClient([p.x, p.y, p.z]);
  const q = [p.x + (axis === 0 ? 1 : 0), p.y + (axis === 1 ? 1 : 0), p.z + (axis === 2 ? 1 : 0)];
  const b = H.worldToClient(q);
  return [b.x - a.x, b.y - a.y];
};
/** A left drag from a point by a number of pixels, in a few moves. */
const drag = async (from, [dx, dy]) => {
  fire('pointerdown', from[0], from[1], 1);
  for (let i = 1; i <= 6; i++) {
    fire('pointermove', from[0] + (dx * i) / 6, from[1] + (dy * i) / 6, 1);
    await H.wait(30);
  }
  fire('pointerup', from[0] + dx, from[1] + dy, 0);
  await H.wait(250);
};

M.run = async () => {
  let plate;
  let block;
  let cut0;
  await step('1 an assembly (the plate fixed, the V-block floating), a section across X at the middle: the cut is there to take hold of', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    plate = (await H.insert('定位板.3dbx')).id;
    block = (await H.insert('V型塊.3dbx', [0.5, 0.2])).id;
    await H.loaded();
    await H.hud('等角');
    await H.hud('全部顯示');
    button('剖面').click();
    await H.wait(250);
    await setSelect(bar().querySelector('.section-panel select'), '0');
    cut0 = value();
    const spot = onCut();
    return { pass: !!spot && !!offCut(), cut0, spot: spot && spot.slice(0, 2) };
  });
  await step('2 the cursor over the cut is a hand; elsewhere it is not; with no section there is no hand', async () => {
    const spot = onCut();
    const off = offCut();
    fire('pointermove', spot[0], spot[1], 0);
    await H.wait(80);
    const over = canvas().style.cursor;
    fire('pointermove', off[0], off[1], 0);
    await H.wait(80);
    const away = canvas().style.cursor;
    return { pass: over === 'grab' && away === '', over, away };
  });
  let poses;
  await step('3 dragging the cut along +X by 40 pixels moves it by what 40 pixels are along X (the slider and the number follow), the view is not turned and nothing is moved or chosen', async () => {
    poses = JSON.stringify([...H.asm().solution.poses.entries()]);
    const selected = H.asm().selected;
    const cam = store.viewer.camera.position.toArray();
    const [x, y, p] = onCut();
    const s = pixelsPerUnit(p, 0);
    const len = Math.hypot(s[0], s[1]);
    const before = value();
    await drag([x, y], [(s[0] / len) * 40, (s[1] / len) * 40]);
    const expected = before + 40 / len;
    const got = value();
    return {
      pass: Math.abs(got - expected) < 0.06 && JSON.stringify([...H.asm().solution.poses.entries()]) === poses && H.asm().selected === selected && JSON.stringify(store.viewer.camera.position.toArray()) === JSON.stringify(cam),
      before,
      got,
      expected,
    };
  });
  await step('4 the other way it goes back; the slider shows it; the cut fill follows (the model still has a cap)', async () => {
    const [x, y, p] = onCut();
    const s = pixelsPerUnit(p, 0);
    const len = Math.hypot(s[0], s[1]);
    const before = value();
    await drag([x, y], [(-s[0] / len) * 25, (-s[1] / len) * 25]);
    const got = value();
    return { pass: Math.abs(got - (before - 25 / len)) < 0.06 && Math.abs(Number(range().value) - got) <= (Number(range().max) - Number(range().min)) / 200 + 1e-6 && store.viewer.cap?.planes.length > 0, before, got };
  });
  await step('5 it stops at the ends of the model: a long drag outward leaves it at the end of the slider', async () => {
    const [x, y, p] = onCut();
    const s = pixelsPerUnit(p, 0);
    const len = Math.hypot(s[0], s[1]);
    await drag([x, y], [(s[0] / len) * 2000, (s[1] / len) * 2000]);
    const hi = Number(range().max);
    return { pass: Math.abs(value() - hi) < 0.01, value: value(), hi };
  });
  await step('6 a press where the cut is not (the fixed plate seen from the outside is not the cut) does what it did: clicking a component chooses it', async () => {
    const off = offCut();
    const kept = value();
    fire('pointerdown', off[0], off[1], 1);
    for (let i = 1; i <= 4; i++) fire('pointermove', off[0] + i * 6, off[1] + i * 3, 1);
    fire('pointerup', off[0] + 24, off[1] + 12, 0);
    canvas().dispatchEvent(new MouseEvent('click', { clientX: off[0] + 24, clientY: off[1] + 12, bubbles: true }));
    await H.wait(150);
    return { pass: value() === kept && canvas().style.cursor !== 'grabbing', kept, now: value() };
  });
  await step('7 with the section off the left button moves a floating component as before', async () => {
    button('剖面').click();
    await H.wait(250);
    const r = H.rect();
    let spot = null;
    for (let fy = 0.1; fy < 0.95 && !spot; fy += 0.04) {
      for (let fx = 0.05; fx < 0.97 && !spot; fx += 0.04) {
        const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
        if (store.viewer.pickInstance(x, y) === block) spot = [x, y];
      }
    }
    const before = JSON.stringify(H.asm().solution.poses.get(block));
    await drag(spot, [40, -20]);
    return { pass: !!spot && JSON.stringify(H.asm().solution.poses.get(block)) !== before, spot };
  });
  await step('8 in a part: a section, the cut is taken hold of and dragged, and the model is the same', async () => {
    await H.action('檔案', '新示範件');
    if (store.getState().unsaved) await H.modalButton('不儲存'); // the assembly has changes
    await H.waitFor(() => store.getState().result?.mesh && !store.getState().asm, 20000, 'the demo part');
    await H.wait(300);
    await H.hud('等角');
    await H.hud('全部顯示');
    button('剖面').click();
    await H.wait(250);
    await setSelect(bar().querySelector('.section-panel select'), '0');
    const volume = store.getState().result.mass?.volume;
    const spot = onCut();
    if (!spot) return { pass: false, why: 'no cut to take hold of' };
    const s = pixelsPerUnit(spot[2], 0);
    const len = Math.hypot(s[0], s[1]);
    const before = value();
    await drag([spot[0], spot[1]], [(s[0] / len) * 30, (s[1] / len) * 30]);
    return { pass: Math.abs(value() - (before + 30 / len)) < 0.06 && store.getState().result.mass?.volume === volume, before, after: value() };
  });
  return { name: 'section-drag', steps, pass: steps.every((s) => s.pass) };
};
