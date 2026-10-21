// 「干涉檢查」 made visible (ADR 0180), as the user reported it: an overlap far too small to see in the whole view (0.083 mm³). Two V-blocks whose corners
// overlap by 0.3 mm each way, the first standing in a locating plate (a big overlap). The steps are what the person does: a pointer on the row and on the ring in the view,
// ↑／↓ in the list, 縮放, 忽略, the 「非干涉零組件」 choice, the section, the display types, Esc. What is checked is what is on the screen: where the ring is, how much
// of the view the overlap fills, the pixels the canvas drew there, the materials of the components. Replayed in the app's page (http://127.0.0.1:5391, 1280×720;
// `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-interference-view.js?' + Date.now());   // in a freshly loaded page
//   await __manualInterferenceView.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualInterferenceView = {});

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

const panel = () => document.querySelector('[data-interference]');
const field = (name) => panel()?.querySelector(`[data-field="${name}"]`);
const state = () => store.getState().interference;
const v = () => store.viewer;
const instances = () => [...v().instances.values()];
const byOwner = (id) => instances().filter((i) => i.owner === id);
const markers = () => [...document.querySelectorAll('.view-marker')];
const button = (label) => [...panel().querySelectorAll('button')].find((b) => b.textContent === label);
const open = async () => {
  await H.action('組合件', '干涉檢查');
  await H.waitFor(() => panel(), 5000, 'the interference window');
  return done();
};
const done = async () => {
  await H.waitFor(() => state()?.status === 'done' || state()?.status === 'error', 30000, 'the interference result');
  await H.wait(200);
  return state();
};
/** A press of the left button where an element is on the screen, through whatever is there: what is under the pointer gets the events, as with a mouse. */
const press = async (el) => {
  const r = el.getBoundingClientRect();
  const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
  const at = document.elementFromPoint(x, y);
  if (!at || (at !== el && !el.contains(at))) return { hit: false, at: `${at?.tagName}.${at?.className}` };
  const init = { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 41, button: 0, isPrimary: true };
  at.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
  at.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
  at.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
  at.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
  at.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
  await H.wait(300);
  return { hit: true };
};
const setSelect = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(250);
};
/** How much of the view a box takes on the screen: the larger of its part of the height and of the width, its size in pixels, and its middle against the view's. */
const filled = (min, max) => {
  const r = H.rect();
  const pts = [];
  for (let i = 0; i < 8; i++) pts.push(v().screenPoint([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    fraction: Math.max((Math.max(...xs) - Math.min(...xs)) / r.width, (Math.max(...ys) - Math.min(...ys)) / r.height),
    pixels: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
    off: Math.hypot((Math.max(...xs) + Math.min(...xs)) / 2 - (r.left + r.width / 2), (Math.max(...ys) + Math.min(...ys)) / 2 - (r.top + r.height / 2)),
  };
};
/** The colour the canvas drew at a point of the scene: the picture as 「另存影像」 takes it (drawn again and read back), so it is what the screen shows. */
const pixelAt = async (p) => {
  const [x, y] = v().screenPoint(p);
  const r = H.rect();
  const blob = await v().snapshot();
  const img = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  [c.width, c.height] = [img.width, img.height];
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const sx = Math.round(((x - r.left) / r.width) * img.width);
  const sy = Math.round(((y - r.top) / r.height) * img.height);
  return [...ctx.getImageData(sx, sy, 1, 1).data.slice(0, 3)];
};
const red = ([r, g, b]) => r > 180 && g < 90 && b < 90;
/** Where a ring is against where its point is on the screen, pixels. */
const ringOff = (el, at) => {
  const r = el.getBoundingClientRect();
  const [x, y] = v().screenPoint(at);
  return Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
};
const row = (i, what = 'td') => field('pairs')?.querySelector(`tbody tr[data-pair="${i}"] ${what}`);

let plate; // at the origin, the V-block standing in it: the big pair, and the component not in the small one
let blockA; // the V-block at the origin
let blockB; // the V-block whose corner is 0.3 mm into blockA's
let tiny; // the place in the list of the small pair
let big;

M.run = async () => {
  await step('1 two V-blocks whose corners overlap by 0.3 mm each way (0.027 mm³), the first standing in a plate: 干涉檢查 finds the small pair and the big one; in the whole view the small one is a few pixels', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    plate = await H.insert('定位板.3dbx');
    blockA = await H.insert('V型塊.3dbx');
    blockB = await H.insert('V型塊.3dbx');
    await H.loaded();
    // the V-block's own box, and a corner of it the block has (a vertex there: not one a chamfer took off) on its top side (above the plate)
    const p = H.asm().builds.get(H.asm().files.get('V型塊.3dbx').key).mesh.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k], p[i + k]), Math.max(hi[k], p[i + k])];
    const corners = Array.from({ length: 8 }, (_, i) => [0, 1, 2].map((k) => ((i >> k) & 1 ? 1 : -1))).filter((c) => c[1] === 1);
    const sharp = (c) => {
      const want = c.map((s, k) => (s > 0 ? hi[k] : lo[k]));
      for (let i = 0; i < p.length; i += 3) if ([0, 1, 2].every((k) => Math.abs(p[i + k] - want[k]) < 1e-6)) return true;
      return false;
    };
    // that corner and the second block's opposite one: the second goes along the diagonal till they are 0.3 mm into each other
    const sign = corners.find((c) => sharp(c) && sharp(c.map((s) => -s)));
    if (!sign) throw new Error('the V-block has no two opposite sharp corners of its box');
    const at = sign.map((s, k) => +(s * (hi[k] - lo[k] - 0.3)).toFixed(6));
    store.assembly.execute({ type: 'setPlacements', placements: [{ componentId: blockB.id, placement: { position: at, rotation: [0, 0, 0, 1] } }] });
    await H.wait(500);
    await H.hud('等角');
    await H.hud('全部顯示');
    const s = await open();
    tiny = s.pairs.findIndex((x) => x.volume < 1);
    big = s.pairs.findIndex((x) => x.volume >= 1);
    const t = s.pairs[tiny];
    const size = t ? t.max.map((m, k) => m - t.min[k]) : null;
    const seen = t ? filled(t.min, t.max) : null;
    return {
      pass: s.status === 'done' && s.pairs.length === 2 && tiny >= 0 && big >= 0 && size.every((d) => d > 0.29 && d < 0.31) && Math.abs(t.volume - 0.027) < 1e-4 && seen.pixels < 4,
      pairs: s.pairs.map((x) => [x.aName, x.bName, x.volume, x.min, x.max]),
      at,
      size,
      pixels: seen?.pixels,
    };
  });

  await step('2 the list says where each pair is (its centre and the size of its box, to two places); a ring of a constant size is round each overlap, on its centre', async () => {
    const s = state();
    const f = (x) => (Math.round(x * 100) / 100 + 0).toFixed(2);
    const rows = [...field('pairs').querySelectorAll('tbody tr')];
    const t = s.pairs[tiny];
    const centre = row(tiny, '[data-field="center"]')?.textContent;
    const size = row(tiny, '[data-field="size"]')?.textContent;
    const ring = markers().find((m) => m.dataset.marker === String(tiny));
    const off = ring ? ringOff(ring, t.center) : null;
    return {
      pass: rows.length === 2 && centre === `中心 (${t.center.map(f).join(', ')}) mm` && size === `範圍 ${t.max.map((m, k) => f(m - t.min[k])).join(' × ')} mm` && markers().length === 2 && ring?.getBoundingClientRect().width === 24 && off <= 2 && ring.dataset.label === String(tiny + 1),
      centre,
      size,
      markers: markers().length,
      off,
    };
  });

  await step('3 a pointer on the small pair\'s row: the view goes to it (in the middle, 20–40 % of the view), its two V-blocks turn see-through (0.45), the plate fades (0.12); 「上一個視角」 brings the whole view back', async () => {
    const before = { position: v().camera.position.clone(), target: v().controls.target.clone(), frustum: [v().camera.left, v().camera.right, v().camera.top, v().camera.bottom] };
    const hit = await press(row(tiny));
    const s = state();
    const t = s.pairs[tiny];
    const seen = filled(t.min, t.max);
    const middle = t.min.map((m, k) => (m + t.max[k]) / 2);
    const target = v().controls.target.toArray();
    const diag = Math.hypot(...t.max.map((m, k) => m - t.min[k]));
    const looked = [...byOwner(blockA.id), ...byOwner(blockB.id)];
    const lookedOk = looked.length === 2 && looked.every((i) => i.body.material.transparent && i.body.material.opacity === 0.45 && i.group.visible);
    const faded = byOwner(plate.id).length === 1 && byOwner(plate.id).every((i) => i.body.material.transparent && i.body.material.opacity === 0.12 && i.edges.material === v().fadedEdges);
    const zoomed = { fraction: seen.fraction, off: seen.off, targetOff: Math.hypot(...target.map((x, k) => x - middle[k])) };
    v().previousView();
    const back = v().camera.position.distanceTo(before.position) < 1e-9 && v().controls.target.distanceTo(before.target) < 1e-9 && [v().camera.left, v().camera.right, v().camera.top, v().camera.bottom].every((x, k) => Math.abs(x - before.frustum[k]) < 1e-9);
    return {
      pass: hit.hit && s.selected === tiny && seen.fraction >= 0.2 && seen.fraction <= 0.4 && seen.off <= 2 && zoomed.targetOff <= 0.01 * diag && lookedOk && faded && back,
      hit,
      zoomed,
      lookedOk,
      faded,
      back,
    };
  });

  await step('4 「縮放」 of the chosen row takes the view to it again; the ring stays the same size in pixels and on its centre at three zooms; a pointer on the other ring chooses that pair', async () => {
    const hit = await press(row(tiny, '[data-field="zoom"]'));
    const t = state().pairs[tiny];
    const fraction = filled(t.min, t.max).fraction;
    const sizes = [];
    for (const factor of [1, 3, 1 / 9]) {
      if (factor !== 1) v().zoom(factor);
      await H.wait(150);
      const ring = markers().find((m) => m.dataset.marker === String(tiny));
      sizes.push({ width: ring.getBoundingClientRect().width, off: ringOff(ring, t.center) });
    }
    // the chosen pair alone has its ring: the panel's 全部顯示 shows the other one again, and the view's 全部顯示 brings it on the screen
    await press(button('全部顯示'));
    await H.hud('全部顯示');
    const other = markers().find((m) => m.dataset.marker === String(big));
    const ringHit = other ? await press(other) : { hit: false };
    return {
      pass: hit.hit && fraction >= 0.2 && fraction <= 0.4 && sizes.every((s) => s.width === 32 && s.off <= 2) && ringHit.hit && state().selected === big,
      fraction,
      sizes,
      ringHit,
      selected: state().selected,
    };
  });

  await step('5 ↓ and ↑ in the list go from pair to pair, round from the end to the start', async () => {
    const table = field('pairs');
    table.focus();
    const seen = [state().selected];
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp']) {
      table.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await H.wait(200);
      seen.push(state().selected);
    }
    // two pairs: from the one chosen down is the other, down again back, up the other
    const other = seen[0] === 0 ? 1 : 0;
    return { pass: seen.join() === [seen[0], other, seen[0], other].join(), seen };
  });

  await step('6 any display type, with the section on or off: the chosen overlap is red on the screen, drawn whole over what is in front of it; with the section on, choosing the pair moves the cut through its centre', async () => {
    if (state().selected !== tiny) await press(row(tiny));
    const t = state().pairs[tiny];
    const bar = document.querySelector('.view-options');
    const sectionButton = [...bar.querySelectorAll('button')].find((b) => b.textContent === '剖面');
    const modes = [...bar.querySelector('select').options].map((o) => o.value);
    const seen = [];
    for (const cut of [false, true]) {
      if (cut) {
        await press(sectionButton);
        await press(row(tiny, '[data-field="zoom"]')); // choosing it again: the cut goes through it
      }
      for (const mode of modes) {
        await setSelect(bar.querySelector('select'), mode);
        const px = await pixelAt(t.center);
        seen.push({ cut, mode, px, red: red(px) });
      }
    }
    const at = Number(bar.querySelector('.section-value')?.value);
    const through = Math.abs(at - t.center[0]) <= 0.005; // the cut is along X at the start, shown to two places
    await press(sectionButton);
    await setSelect(bar.querySelector('select'), 'shadedEdges');
    return { pass: modes.length === 4 && seen.length === 8 && seen.every((x) => x.red) && through, seen, at, centre: t.center[0] };
  });

  await step('7 「非干涉零組件」: 線架構 draws the plate as edges, 隱藏 leaves it out (and it cannot be picked), 保持目前顯示 leaves it as it was', async () => {
    const select = field('others');
    await setSelect(select, 'wireframe');
    const wire = byOwner(plate.id).every((i) => i.body.material.colorWrite === false && i.group.visible && i.body.material.opacity === 1);
    await setSelect(select, 'hidden');
    const hidden = byOwner(plate.id).every((i) => !i.group.visible);
    await H.hud('全部顯示');
    const r = H.rect();
    let picked = false;
    for (let fx = 0.05; fx < 1 && !picked; fx += 0.05) for (let fy = 0.05; fy < 1 && !picked; fy += 0.05) picked = v().pickInstance(r.left + r.width * fx, r.top + r.height * fy) === plate.id;
    await setSelect(select, 'current');
    const current = byOwner(plate.id).every((i) => i.group.visible && i.body.material.opacity === 1 && !i.body.material.transparent && i.body.material.colorWrite);
    await setSelect(select, 'transparent');
    return { pass: wire && hidden && !picked && current, wire, hidden, picked, current };
  });

  await step('8 「忽略」 the big pair: it leaves the list and the view; 「顯示已忽略的干涉」 lists it greyed; it stays set aside through 重新檢查 and the window closed and opened; 「取消忽略」 brings it back', async () => {
    if (state().selected !== null) await press(button('全部顯示'));
    const bigKey = `${state().pairs[big].a}|${state().pairs[big].b}`;
    await press(row(big, '[data-field="ignore"]'));
    const gone = field('pairs').querySelectorAll('tbody tr').length === 1 && markers().length === 1 && v().highlights.length === state().pairs[tiny].overlaps.length;
    await press(field('showIgnored'));
    const greyed = field('pairs').querySelector(`tbody tr[data-pair="${big}"]`)?.classList.contains('ignored') === true;
    await press(field('showIgnored'));
    await press(panel().querySelector('.measure-head button'));
    let s = await done();
    const kept = s.ignored.includes(bigKey) && field('pairs').querySelectorAll('tbody tr').length === 1;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await H.wait(200);
    s = await open();
    const reopened = s.ignored.includes(bigKey) && field('pairs').querySelectorAll('tbody tr').length === 1;
    await press(field('showIgnored'));
    const index = state().pairs.findIndex((x) => `${x.a}|${x.b}` === bigKey);
    await press(row(index, '[data-field="ignore"]'));
    await press(field('showIgnored'));
    const back = field('pairs').querySelectorAll('tbody tr').length === 2 && markers().length === 2 && state().ignored.length === 0;
    return { pass: gone && greyed && kept && reopened && back, gone, greyed, kept, reopened, back };
  });

  await step('9 Esc with a pair chosen: every component is as it was (the plate the user made see-through stays so), nothing red, no ring', async () => {
    store.assembly.setComponentState([plate.id], 'transparent', true);
    await H.wait(300);
    await press(panel().querySelector('.measure-head button')); // 重新檢查: the model changed
    await done();
    await press(row(tiny));
    const chosen = state().selected === tiny;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await H.wait(300);
    const blocks = [...byOwner(blockA.id), ...byOwner(blockB.id)].every((i) => !i.body.material.transparent && i.body.material.opacity === 1 && i.group.visible && i.body.material.colorWrite && i.edges.material === v().instanceEdges);
    const user = byOwner(plate.id).every((i) => i.body.material.transparent && i.body.material.opacity === 0.4 && i.group.visible && i.edges.material === v().instanceEdges);
    return { pass: chosen && state() === null && blocks && user && v().highlights.length === 0 && v().highlightEdges.length === 0 && markers().length === 0, chosen, blocks, user };
  });

  return { name: 'interference-view', steps, pass: steps.every((s) => s.pass) };
};
