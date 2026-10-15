// 「正視於」 (Ctrl+8) and the selection filter (F5 bar, F6) in an assembly (ADR 0148): both were a part's only. The plane looked straight at is the one picked last — a planar
// face of a component while a mate is defined (placed where the component is), or a plane of the assembly picked in the FeatureManager; nothing flat picked answers with the
// isometric view. The filter bar sits with 顯示類型 and 剖面, and what it leaves out cannot be hovered or picked for a mate. Replayed in the app's page (http://127.0.0.1:5391,
// 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-asm-view-normal.js?' + Date.now());   // in a freshly loaded page
//   await __manualAsmViewNormal.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualAsmViewNormal = {});

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
const asm = () => store.assembly;
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const key = (k, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
const filterRadios = () => [...document.querySelectorAll('.pick-filter input[type=radio]')];
const viewHud = (label) => [...document.querySelectorAll('.heads-up button')].find((b) => b.textContent === label);

M.run = async () => {
  let plate;
  await step('1 a new assembly (plate and V-block): the 正視於 button is on; with nothing picked, from the top view, it goes to the bottom view (the other side of the standard view it is already straight along)', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    plate = await H.insert('定位板.3dbx');
    await H.insert('V型塊.3dbx', [0.5, 0.2]);
    await H.loaded();
    await H.hud('上視');
    const top = store.viewer.viewDirection();
    const button = viewHud('正視於');
    if (!button || button.disabled) return { pass: false, button: !!button, disabled: button?.disabled };
    button.click();
    await H.wait(200);
    const d = store.viewer.viewDirection();
    // from the top the camera looks along -y; straight along a standard view already, the press goes to the other side: looking along +y
    return { pass: top[1] < -0.99 && d[1] > 0.99, top, d };
  });
  await step('2 a plane of the assembly picked in the FeatureManager: Ctrl+8 looks straight at it', async () => {
    asm().pickDatum({ component: null, ref: { kind: 'datum', name: 'plane:right' } }, false);
    await H.wait(100);
    key('8', { ctrlKey: true });
    await H.wait(200);
    const d = store.viewer.viewDirection();
    // the right plane's normal is +x: the camera sits on +x looking along −x
    return { pass: dot(d, [-1, 0, 0]) > 0.999, d };
  });
  await step('3 pressed again at the plane it flips to the far side', async () => {
    key('8', { ctrlKey: true });
    await H.wait(200);
    const d = store.viewer.viewDirection();
    return { pass: dot(d, [1, 0, 0]) > 0.999, d };
  });
  let face;
  await step('4 a planar face of a component picked for a mate (placed by the component’s pose): Ctrl+8 looks straight at it, the way the face is oriented in the assembly', async () => {
    asm().select(null);
    asm().startMate();
    await H.wait(100);
    const leaf = asm().leaves().find((l) => l.top === plate.id);
    const build = asm().buildOfLeaf(leaf);
    const at = build.faceNames.findIndex((_, i) => build.faceGeometry[i]?.kind === 'plane' && build.faceFingerprints[i]);
    if (at < 0) return { pass: false, why: 'no planar face on the plate' };
    face = { component: plate.id, ref: { kind: 'face', name: build.faceNames[at], fingerprint: build.faceFingerprints[at] } };
    asm().pickElement(face);
    await H.wait(100);
    const g = asm().elementGeometry(face);
    if (g?.kind !== 'plane') return { pass: false, why: 'the face has no plane where it is now', g };
    key('8', { ctrlKey: true });
    await H.wait(200);
    const d = store.viewer.viewDirection();
    return { pass: dot(d, g.normal) < -0.999, d, normal: g.normal };
  });
  await step('5 the filter keys: F5 shows the bar at the top left with 顯示類型 and 剖面, the same four kinds, none picked out; F6 is on too', async () => {
    const bar = document.querySelector('.view-options');
    const was = !!bar.querySelector('.pick-filter');
    key('F5');
    await H.wait(150);
    const shown = !!document.querySelector('.view-options .pick-filter');
    const kinds = filterRadios().map((r) => r.parentElement.textContent.trim());
    return { pass: !was && shown && kinds.length === 4 && filterRadios().every((r) => !r.checked), was, shown, kinds };
  });
  // A real corner of the plate seen from above, on the screen: with the cursor on it the viewer finds a vertex, an edge or a face, whichever the filter leaves in.
  let corner;
  const found = () => store.viewer.pickElement(corner[0], corner[1])?.kind ?? null;
  await step('6 the corner of the plate on the screen: nothing left out finds the vertex; 「邊線」 alone finds the edge, 「面」 alone the face, 「頂點」 alone the vertex; 「基準面」 alone finds no element', async () => {
    asm().cancelMate();
    await H.hud('上視');
    await H.hud('全部顯示');
    await H.wait(300);
    const v = store.viewer;
    const leaf = asm().leaves().find((l) => l.top === plate.id);
    const inst = v.instances.get(leaf.id);
    const pts = v.partGeometry.get(inst.part).vertices;
    // the plate's highest corner in the view (top view: the camera looks down −y; the nearest to it is the largest y), the plate's middle of it moved in a little so a face is under the cursor
    let top = -Infinity;
    const world = [];
    for (let i = 0; i < pts.length / 3; i++) {
      const p = new v.camera.position.constructor(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]).applyMatrix4(inst.group.matrixWorld);
      world.push(p);
      top = Math.max(top, p.y);
    }
    const at = world.find((p) => Math.abs(p.y - top) < 1e-6);
    const s = at.clone().project(v.camera);
    const rect = v.renderer.domElement.getBoundingClientRect();
    corner = [rect.left + ((s.x + 1) / 2) * rect.width, rect.top + ((1 - s.y) / 2) * rect.height];
    asm().startMate(); // elements are picked while a mate is defined
    await H.wait(100);
    const kinds = {};
    for (const [name, i] of [['all', -1], ['faces', 0], ['edges', 1], ['vertices', 2], ['planes', 3]]) {
      if (i < 0) key('F6');
      else filterRadios()[i].click();
      await H.wait(120);
      kinds[name] = found();
    }
    return { pass: kinds.all === 'vertex' && kinds.faces === 'face' && kinds.edges === 'edge' && kinds.vertices === 'vertex' && kinds.planes === null, kinds, corner };
  });
  await step('7 the element hovered is dropped when the filter changes: edges alone hovers the edge, then 「面」 alone leaves nothing hovered until the cursor moves', async () => {
    filterRadios()[1].click(); // edges alone
    await H.wait(120);
    store.viewer.setHoveredElement(store.viewer.pickElement(corner[0], corner[1]));
    const hovered = store.viewer.hoveredElement?.kind ?? null;
    filterRadios()[0].click(); // faces alone
    await H.wait(120);
    return { pass: hovered === 'edge' && store.viewer.hoveredElement === null && found() === 'face', hovered, after: store.viewer.hoveredElement };
  });
  await step('8 F6 puts every kind back; a component is picked as a whole whatever the filter (the filter is for elements)', async () => {
    key('F6');
    await H.wait(150);
    const all = Object.values(store.getState().pickFilter).every(Boolean);
    asm().cancelMate();
    await H.wait(150);
    filterRadios()[2].click(); // 頂點 alone
    await H.wait(100);
    const r = H.rect();
    const picked = store.viewer.pickInstance(corner[0] + Math.sign(r.left + r.width / 2 - corner[0]) * 6, corner[1] + Math.sign(r.top + r.height / 2 - corner[1]) * 6);
    key('F6');
    await H.wait(100);
    return { pass: all && !!picked, all, picked };
  });
  await step('9 F5 again hides the bar; the choice outlives the assembly (kept in the options, as in a part)', async () => {
    key('F5');
    await H.wait(150);
    const hidden = !document.querySelector('.view-options .pick-filter');
    return { pass: hidden && store.getState().pickFilterBarVisible === false, hidden };
  });
  const pass = steps.every((s) => s.pass);
  return { name: 'manual-asm-view-normal', steps, pass };
};
