// The silhouettes of curved faces (the outline a hole's wall shows in 線架構) in an assembly follow a component that moves while the camera stays.
// The viewer keeps the silhouettes as long as the view direction is the same; a component moved by undo, a mate or a drag changed them too, and
// before the fix they stayed where the component had been until the view was turned. Replayed in the app's page (http://127.0.0.1:5391, 1280×720;
// `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-asm-silhouettes.js?' + Date.now());   // in a freshly loaded page
//   await __manualAsmSilhouettes.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualAsmSilhouettes = {});

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
const setSelect = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(200);
};
/** What the screen shows now: the silhouette segments as drawn (empty when hidden). */
const shown = () => {
  const s = store.viewer.silhouetteEdges;
  return s?.visible ? Array.from(s.geometry.getAttribute('position').array) : [];
};
/** What they should be for this camera: worked out again from nothing. */
const fresh = () => {
  store.viewer.lastSilViewDir = null;
  store.viewer.render();
  return shown();
};
const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
const viewDir = () => store.viewer.camera.getWorldDirection(new store.viewer.camera.position.constructor()).toArray();

M.run = async () => {
  let plate;
  await step('1 an assembly of two locating plates (their holes are curved faces), seen 等角', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.insert('定位板.3dbx');
    plate = await H.insert('定位板.3dbx', [0.7, 0.3]);
    await H.loaded();
    await H.solved();
    await H.hud('等角');
    await H.hud('全部顯示');
    return { pass: H.asm().doc.components.length === 2 && !!plate };
  });
  let q0;
  let q1;
  await step('2 the second plate is dragged (it is free); then 線架構 draws the silhouettes of its holes where it is now', async () => {
    q0 = H.pose(plate.id);
    const from = H.onComponent(plate.id);
    await H.drag(H.line(from, { x: from.x + 80, y: from.y + 40 }));
    q1 = H.pose(plate.id);
    await setSelect(bar().querySelector('select'), 'wireframe');
    const now = shown();
    return { pass: !H.near(q0.position, q1.position, 1e-3) && now.length > 0 && same(now, fresh()), moved: [q0.position, q1.position], count: now.length / 6 };
  });
  await step('3 undo puts the plate back without turning the view: the silhouettes change, and are the ones this camera sees now (not the ones before)', async () => {
    const before = shown();
    const dir0 = viewDir();
    await H.ctrl('z');
    await H.solved();
    await H.wait(250);
    const back = H.near(H.pose(plate.id).position, q0.position, 1e-6);
    const sameView = H.near(viewDir(), dir0, 1e-9);
    const after = shown();
    const changed = !same(after, before);
    const right = same(after, fresh());
    return { pass: back && sameView && changed && right, back, sameView, changed, right, before: before.length / 6, after: after.length / 6 };
  });
  await step('4 a component inserted while in 線架構 adds its silhouettes at once', async () => {
    const before = shown();
    await H.action('組合件', '插入零組件');
    await H.insert('定位板.3dbx', [0.25, 0.75]);
    await H.loaded();
    await H.wait(250);
    const after = shown();
    return { pass: H.asm().doc.components.length === 3 && after.length > before.length && same(after, fresh()), before: before.length / 6, after: after.length / 6 };
  });
  return { name: 'asm-silhouettes', steps, pass: steps.every((s) => s.pass) };
};
