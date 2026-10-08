// Display type (A4.3) and section view (D4.4) in an assembly: the controls at the top left of the graphics area, as in a part; the cut goes through every component, what it cuts away cannot be picked,
// and the display types draw the components too. Asked for by the user while doing H9 (a lip in its groove is seen in a section). Replayed in the app's page (http://127.0.0.1:5391, 1280×720;
// `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-asm-section.js?' + Date.now());   // in a freshly loaded page
//   await __manualAsmSection.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualAsmSection = {});

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
const instances = () => [...store.viewer.instances.values()];
const clipCounts = () => instances().map((i) => i.body.material.clippingPlanes?.length ?? 0);
const setSelect = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(150);
};
const setRange = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(150);
};

M.run = async () => {
  await step('1 a new assembly (plate and V-block): 顯示類型 and 剖面 are at the top left; no selection filter, no dashed hidden-line mode', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.insert('定位板.3dbx');
    await H.insert('V型塊.3dbx', [0.5, 0.2]);
    await H.loaded();
    await H.hud('上視');
    await H.hud('全部顯示');
    const modes = [...bar().querySelectorAll('select option')].map((o) => o.textContent);
    return { pass: !!button('剖面') && modes.join() === '帶邊線塗彩,塗彩,移除隱藏線,線架構' && !bar().querySelector('.pick-filter'), modes };
  });
  let before;
  await step('2 before cutting, a click in the middle of the plate picks a component', async () => {
    const r = H.rect();
    before = store.viewer.pickInstance(r.left + r.width / 2, r.top + r.height / 2);
    return { pass: !!before, before };
  });
  await step('3 剖面: the range of the slider is the box round both components, and every component is cut', async () => {
    button('剖面').click();
    await H.wait(250);
    const range = bar().querySelector('input[type=range]');
    const box = store.viewer.contentBounds();
    return {
      pass:
        !!range &&
        Math.abs(Number(range.min) - box.min[0]) < 1e-3 &&
        Math.abs(Number(range.max) - box.max[0]) < 1e-3 &&
        clipCounts().length === 2 &&
        clipCounts().every((n) => n === 1) &&
        // the cut is filled (a solid, not an empty shell): two stencil passes and a cap for each component
        store.viewer.cap?.objects.length === 6 &&
        store.viewer.cap.planes.length === 2,
      min: range?.min,
      max: range?.max,
      box,
      clips: clipCounts(),
    };
  });
  await step('3b the filled cut follows the slider: after each move the stencil passes cut where the body is cut, and the cap lies in that plane', async () => {
    const range = bar().querySelector('input[type=range]');
    const lo = Number(range.min);
    const hi = Number(range.max);
    const seen = [];
    for (const f of [0.25, 0.7, 0.4]) {
      const at = lo + (hi - lo) * f;
      await setRange(range, at);
      const v = store.viewer;
      const stencils = v.cap.materials.filter((m) => m.clippingPlanes !== undefined && m.clippingPlanes !== null && m.type === 'MeshBasicMaterial');
      const same = stencils.length === 2 && stencils.every((m) => m.clippingPlanes === v.clip) && instances().every((i) => i.body.material.clippingPlanes === v.clip);
      const capAt = v.cap.planes.every((p) => Math.abs(p.position.x - at) < 1e-3);
      seen.push({ at, same, capAt });
    }
    return { pass: seen.every((x) => x.same && x.capAt), seen };
  });
  await step('3c the number beside the slider can be typed: Enter sets the position (slider and cut follow), Esc and text that is not a number put the old one back', async () => {
    const input = () => bar().querySelector('.section-value');
    const range = () => bar().querySelector('input[type=range]');
    const type = async (text, key) => {
      input().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input(), text);
      input().dispatchEvent(new Event('input', { bubbles: true }));
      await H.wait(60);
      input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await H.wait(200);
    };
    await type('7.5', 'Enter');
    const step = (Number(range().max) - Number(range().min)) / 200; // the slider's own value is snapped to its steps
    const typed = Math.abs(Number(range().value) - 7.5) <= step && input().value === '7.50' && store.viewer.cap.planes.every((p) => Math.abs(p.position.x - 7.5) < 1e-3);
    await type('99', 'Escape');
    const escaped = input().value === '7.50' && store.viewer.cap.planes.every((p) => Math.abs(p.position.x - 7.5) < 1e-3);
    await type('abc', 'Enter');
    const junk = input().value === '7.50' && store.viewer.cap.planes.every((p) => Math.abs(p.position.x - 7.5) < 1e-3);
    await type('-3.25', 'Enter');
    const negative = input().value === '-3.25' && store.viewer.cap.planes.every((p) => Math.abs(p.position.x + 3.25) < 1e-3);
    return { pass: typed && escaped && junk && negative, typed, escaped, junk, negative, shown: input().value };
  });
  await step('4 a cut that leaves almost nothing (Z at its lowest) cannot be clicked through: the click in the middle picks nothing; at its highest it picks again', async () => {
    const [axis, range] = [bar().querySelector('.section-panel select'), () => bar().querySelector('input[type=range]')];
    await setSelect(axis, '2');
    await setRange(range(), Number(range().min));
    const r = H.rect();
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    const low = store.viewer.pickInstance(x, y);
    await setRange(range(), Number(range().max));
    const high = store.viewer.pickInstance(x, y);
    return { pass: low === null && !!high, low, high };
  });
  await step('5 反向 keeps the other side (Z at its highest: nothing is left, so nothing is picked); 剖面 off takes the cut away from every component', async () => {
    const flip = bar().querySelector('.section-panel input[type=checkbox]');
    const r = H.rect();
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    flip.click();
    await H.wait(200);
    const flipped = store.viewer.pickInstance(x, y);
    button('剖面').click();
    await H.wait(250);
    const off = store.viewer.pickInstance(x, y);
    return { pass: flipped === null && !!off && clipCounts().every((n) => n === 0) && !bar().querySelector('.section-panel') && store.viewer.cap === null, flipped, off, clips: clipCounts() };
  });
  await step('6 顯示類型: 線架構 draws the components as lines only, 塗彩 without dark edges, 帶邊線塗彩 back', async () => {
    const select = bar().querySelector('select');
    await setSelect(select, 'wireframe');
    const wire = instances().every((i) => i.body.material.colorWrite === false);
    await setSelect(select, 'shaded');
    const shadedEdges = store.viewer.instanceEdges.color.getHex();
    const shadedBodies = instances().every((i) => i.body.material.colorWrite === true);
    await setSelect(select, 'hiddenRemoved');
    const removed = instances().every((i) => i.body.material.emissiveIntensity < 1 && i.body.material.colorWrite === true);
    await setSelect(select, 'shadedEdges');
    const dark = store.viewer.instanceEdges.color.getHex();
    const back = instances().every((i) => i.body.material.colorWrite === true && i.body.material.emissive.getHex() === 0);
    return { pass: wire && shadedBodies && removed && back && shadedEdges !== dark, wire, shadedBodies, removed, back, shadedEdges, dark };
  });
  await step('7 a component placed while the cut is on is cut too', async () => {
    button('剖面').click();
    await H.wait(250);
    await H.action('組合件', '插入零組件');
    await H.insert('V型塊.3dbx', [0.2, 0.8]);
    await H.loaded();
    return { pass: instances().length === 3 && clipCounts().every((n) => n === 1) && store.viewer.cap?.planes.length === 3, clips: clipCounts() };
  });
  return { name: 'asm-section', steps, pass: steps.every((s) => s.pass) };
};
