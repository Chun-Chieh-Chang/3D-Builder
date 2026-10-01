// Phase 1 acceptance ① (blueprint §3): the three demo parts of tests/golden, modelled using only the UI.
//
// Run it in the app's page (http://127.0.0.1:5391, viewport 1280×720), e.g. through the built-in
// browser's JavaScript tool; it is not a Vitest test. Every modelling step is a DOM, pointer, wheel or
// keyboard event — what a mouse and keyboard produce — and every click lands inside the canvas. The
// store is only read, to know where things are on screen and to report results. The system file
// dialogs (which only open on a real click) are replaced by stand-ins that keep the saved bytes.
//
//   const r = await __demo.all();   // { plate, vblock, pin }: volume, features, file (base64)

const storeUrl = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/state/store.ts'));
const { store } = await import(storeUrl);
const H = (window.__ui = { store });

// ---------------------------------------------------------------- waiting
H.wait = (ms) => new Promise((r) => setTimeout(r, ms));
H.waitFor = async (fn, ms = 5000, what = 'condition') => {
  for (let t = 0; t < ms; t += 40) {
    const v = fn();
    if (v) return v;
    await H.wait(40);
  }
  throw new Error(`timeout waiting for ${what}`);
};
H.solved = async () => {
  await H.wait(120);
  await H.waitFor(() => {
    const s = store.editedSketch();
    const g = store.getState().sketchSolve?.geometry;
    return !s || (g && s.entities.every((e) => g.has(e.id)));
  }, 5000, 'sketch solve');
  await H.wait(60);
};
H.settle = async () => {
  await H.wait(250);
  await H.waitFor(() => !store.getState().rebuilding, 30000, 'rebuild');
  await H.wait(100);
};

// ---------------------------------------------------------------- command bar, tree, PropertyManager
H.tab = (name) => [...document.querySelectorAll('.tabs button')].find((b) => b.textContent === name).click();
H.btn = (label) => {
  const b = [...document.querySelectorAll('.tools button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  if (b.disabled) throw new Error(`button disabled: ${label}`);
  b.click();
};
H.action = async (tab, label) => {
  H.tab(tab);
  await H.wait(80);
  H.btn(label);
  await H.settle();
};
H.hud = async (label) => {
  [...document.querySelectorAll('.heads-up button')].find((b) => b.textContent === label).click();
  await H.wait(200);
};
H.treeClick = async (name) => {
  const r = [...document.querySelectorAll('.tree-row')].find((x) => x.textContent.replace(/^\([-+?]\) /, '') === name);
  if (!r) throw new Error(`no tree row ${name}`);
  r.click();
  await H.wait(120);
};
H.pmInput = async (label, value) => {
  const row = [...document.querySelectorAll('.property-manager .pm-row')].find((r) => r.querySelector('span')?.textContent === label);
  if (!row) throw new Error(`no PM field ${label}`);
  const input = row.querySelector('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(30);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.settle();
  if (input.className.includes('invalid')) throw new Error(`PM refused ${label}=${value}`);
};
H.pmSelect = async (value, index = 0) => {
  const sel = document.querySelectorAll('.property-manager select')[index];
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
};
H.pmCheck = async (label, on) => {
  const row = [...document.querySelectorAll('.property-manager .pm-row.checkbox')].find((r) => r.textContent.includes(label));
  const box = row.querySelector('input');
  if (box.checked !== on) box.click();
  await H.settle();
};
H.pmOk = async () => {
  document.querySelector('.property-manager .pm-ok').click();
  await H.settle();
};
H.exitSketch = async () => {
  document.querySelector('.confirm-corner .pm-ok').click();
  await H.settle();
};
H.key = async (key) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await H.wait(80);
};

// ---------------------------------------------------------------- the canvas
H.canvas = () => document.querySelector('.viewport-canvas canvas');
H.rect = () => H.canvas().getBoundingClientRect();
H.frame = () => store.frameOf(store.editedSketch());
H.toClient = (u, v) => {
  const r = H.rect();
  const p = store.viewer.screenOf(H.frame(), [u, v]);
  return { x: r.left + p.x, y: r.top + p.y };
};
H.worldToClient = (P) => {
  const r = H.rect();
  const p = store.viewer.screenOf({ origin: P, xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }, [0, 0]);
  return { x: r.left + p.x, y: r.top + p.y };
};
H.ptr = (type, x, y, extra = {}) =>
  H.canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: type === 'pointerdown' ? 1 : 0, ...extra }));
/** A left click; it must land inside the visible canvas, like a real mouse. */
H.clickXY = async ({ x, y }, extra = {}) => {
  const r = H.rect();
  if (x < r.left + 2 || x > r.right - 2 || y < r.top + 2 || y > r.bottom - 2) throw new Error(`click outside the canvas at (${x.toFixed(0)}, ${y.toFixed(0)})`);
  H.ptr('pointermove', x, y, extra);
  H.ptr('pointerdown', x, y, extra);
  H.ptr('pointerup', x, y, extra);
  H.canvas().dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, ctrlKey: !!extra.ctrlKey }));
  await H.wait(60);
};
H.sk = (u, v, extra) => H.clickXY(H.toClient(u, v), extra); // in the sketch
H.at = async (P, extra) => {
  await H.clickXY(H.worldToClient(P), extra); // on the model
  await H.settle();
};
H.pxPerMm = () => {
  const a = H.toClient(0, 0);
  const b = H.toClient(10, 0);
  return Math.hypot(b.x - a.x, b.y - a.y) / 10;
};
H.zoomAt = async (u, v, steps) => {
  const { x, y } = H.toClient(u, v);
  for (let i = 0; i < Math.abs(steps); i++) {
    H.canvas().dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: steps < 0 ? -100 : 100, bubbles: true, cancelable: true }));
    await H.wait(30);
  }
  await H.wait(100);
};
/** Middle-drag: rotates, or pans with Ctrl (SolidWorks mouse). */
H.dragView = async (dx, dy, mods = {}) => {
  const r = H.rect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  H.canvas().dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 2, button: 1, buttons: 4, ...mods }));
  for (let i = 1; i <= 10; i++) window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + (dx * i) / 10, clientY: y + (dy * i) / 10, bubbles: true, pointerId: 2, buttons: 4, ...mods }));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + dx, clientY: y + dy, bubbles: true, pointerId: 2, button: 1, buttons: 0, ...mods }));
  await H.wait(150);
};
H.centerOn = async (u, v) => {
  const r = H.rect();
  const p = H.toClient(u, v);
  await H.dragView(r.left + r.width / 2 - p.x, r.top + r.height / 2 - p.y, { ctrlKey: true });
};
/** Wheel-zooms to about `pxmm` pixels per millimetre and pans sketch point (u, v) to the centre. */
H.frameSketch = async (u, v, pxmm) => {
  const steps = Math.round(Math.log(H.pxPerMm() / pxmm) / Math.log(1.1618));
  if (steps) await H.zoomAt(u, v, steps);
  await H.centerOn(u, v);
};

// ---------------------------------------------------------------- sketching
H.view = () => store.sketcher?.getView();
H.selectTool = async () => {
  for (let i = 0; i < 4 && H.view()?.tool !== 'select'; i++) await H.key('Escape');
  if (H.view()?.tool !== 'select') throw new Error('could not return to the select tool');
};
H.tool = async (label) => {
  H.tab('草圖');
  await H.wait(50);
  if (H.view()?.tool !== 'select') await H.selectTool();
  H.btn(label);
  await H.wait(60);
};
H.chain = async (points) => {
  for (const [u, v] of points) {
    await H.sk(u, v);
    await H.solved();
  }
};
H.geom = () => store.getState().sketchSolve?.geometry ?? new Map();
H.sketch = () => store.editedSketch();
H.construction = (id) => H.sketch().entities.find((e) => e.id === id)?.construction === true;
H.lineWhere = (pred) => {
  for (const [id, g] of H.geom()) if (g.type === 'line' && pred(g, id)) return id;
  throw new Error('no such line');
};
H.pointAt = (u, v) => {
  let best = null;
  for (const [id, g] of H.geom()) if (g.type === 'point') {
    const d = Math.hypot(g.p[0] - u, g.p[1] - v);
    if (!best || d < best.d) best = { id, d };
  }
  return best?.id;
};
/** Where to click to pick an entity: lines at 30 % (the midpoint when short), circles on the rim. */
H.onEntity = (id, t = 0.3, angle = 0.6) => {
  const g = H.geom().get(id);
  if (!g) throw new Error(`no geometry ${id}`);
  if (g.type === 'point') return g.p;
  if (g.type === 'line') {
    const len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) * H.pxPerMm();
    const tt = len * t < 12 ? 0.5 : t; // a point within 7 px of an end would pick the end point
    return [g.a[0] + (g.b[0] - g.a[0]) * tt, g.a[1] + (g.b[1] - g.a[1]) * tt];
  }
  if (g.type === 'circle' || g.type === 'arc') return [g.c[0] + g.r * Math.cos(angle), g.c[1] + g.r * Math.sin(angle)];
  throw new Error(`cannot pick ${g.type}`);
};
/** Smart dimension: pick one or two entities, place it, type the value into the Modify box. */
H.dim = async (ids, place, value) => {
  if (H.view()?.tool !== 'dimension') await H.tool('智慧型尺寸');
  for (const id of ids) {
    const [u, v] = id === '@origin' ? [0, 0] : H.onEntity(id);
    await H.sk(u, v);
  }
  await H.sk(place[0], place[1]);
  const input = await H.waitFor(() => document.querySelector('.modify-box input'), 5000, `Modify box for ${ids.join('+')}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(40);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.waitFor(() => !document.querySelector('.modify-box'), 5000, `Modify box to close (${value})`);
  await H.solved();
};
/** Select entities (Ctrl for the rest) and press a relation in the PropertyManager. */
H.rel = async (ids, label) => {
  await H.selectTool();
  for (let i = 0; i < ids.length; i++) {
    const [u, v] = ids[i] === '@origin' ? [0, 0] : H.onEntity(ids[i]);
    await H.sk(u, v, i > 0 ? { ctrlKey: true } : {});
  }
  await H.wait(80);
  const b = [...document.querySelectorAll('.relation-buttons button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`relation ${label} not offered for ${H.view().selection.join(',')}`);
  const before = H.sketch().constraints.length;
  b.click();
  await H.waitFor(() => H.sketch().constraints.length > before, 5000, `relation ${label}`);
  await H.solved();
  await H.key('Escape');
};
H.expectFullyDefined = () => {
  const s = store.getState().sketchSolve;
  if (s?.status !== 'fully') throw new Error(`sketch is ${s?.status} (dof ${s?.dof})`);
};

// ---------------------------------------------------------------- files (dialog stand-ins)
H.saveAs = async (name) => {
  let saved = null;
  window.showSaveFilePicker = async () => ({
    name,
    kind: 'file',
    createWritable: async () => {
      const parts = [];
      return { write: async (b) => parts.push(new Uint8Array(b)), close: async () => (saved = parts[0]) };
    },
  });
  await H.action('檔案', '另存新檔');
  const bytes = await H.waitFor(() => saved, 5000, 'save');
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
};
/** 「輸出 STEP」, with the download caught: the file name and the product name it carries. */
H.exportStep = async () => {
  let caught = null;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    caught = { href: this.href, name: this.download };
  };
  try {
    await H.action('檔案', '輸出 STEP');
    // a part asks how first (3a-8c): the dialog's own 「輸出」 button, with what it offers as it is
    const go = document.querySelector('.modal-actions button');
    if (go && document.querySelector('[aria-label="輸出 STEP"]')) go.click();
    await H.waitFor(() => caught, 30000, 'STEP');
  } finally {
    HTMLAnchorElement.prototype.click = click;
  }
  const text = await (await fetch(caught.href)).text();
  return { file: caught.name, product: /PRODUCT\('([^']*)'/.exec(text)?.[1] };
};
H.result = async (name, file) => {
  const s = store.getState();
  return {
    name,
    volume: s.result.mass.volume,
    features: s.result.features.map((f) => `${f.id}=${f.status}`),
    faces: s.result.faceNames.length,
    tree: document.querySelector('.tree-part span')?.textContent,
    title: document.querySelector('.doc-title')?.textContent,
    step: await H.exportStep(),
    file,
  };
};

// ---------------------------------------------------------------- the parts
const demo = (window.__demo = {});

/**
 * A page in a hidden browser pane does not render, so the viewport's ResizeObserver never gives the
 * canvas its size (it stays 300 × 150); size it the way the observer would.
 */
H.ready = () => store.viewer.resize();

/** 定位板: 120 × 80 × 15, 4 × Ø9 and 2 × Ø8 through, R10 corners, C1 around the top. */
demo.plate = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 5.5);
  await H.tool('中心矩形');
  await H.sk(0, 0);
  await H.sk(60, 40);
  await H.solved();
  const top = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[1] - 40) < 1 && Math.abs(g.b[1] - 40) < 1);
  const right = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[0] - 60) < 1 && Math.abs(g.b[0] - 60) < 1);
  await H.dim([top], [0, 50], 120);
  await H.dim([right], [70, 0], 80);
  H.expectFullyDefined();
  await H.exitSketch();
  await H.treeClick('草圖1');
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '15');
  await H.pmOk();

  await H.at([20, 15, -10]); // the top face
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 4);
  await H.tool('圓');
  const holes = [[50, 30, 4.5], [-50, 30, 4.5], [-50, -30, 4.5], [50, -30, 4.5], [40, 0, 4], [-40, 0, 4]];
  for (const [u, v, r] of holes) {
    await H.sk(u, v);
    await H.sk(u + r, v + 0.01);
    await H.solved();
  }
  await H.selectTool();
  const circle = (u, v) => H.sketch().entities.find((e) => e.type === 'circle' && Math.hypot(H.geom().get(e.id).c[0] - u, H.geom().get(e.id).c[1] - v) < 1);
  const [b1, b2, b3, b4, p1, p2] = holes.map(([u, v]) => circle(u, v));
  await H.dim([b1.id], [62, 42], 9);
  await H.dim([p1.id], [40, 11], 8);
  for (const c of [b2, b3, b4]) await H.rel([b1.id, c.id], '相等');
  await H.rel([p1.id, p2.id], '相等');
  const places = [[[25, -6], [58, 15]], [[-25, -6], [-58, 15]], [[-25, 6], [-58, -15]], [[25, 6], [58, -15]]];
  for (const [i, c] of [b1, b2, b3, b4].entries()) {
    await H.dim(['@origin', c.center], places[i][0], 50);
    await H.dim(['@origin', c.center], places[i][1], 30);
  }
  await H.rel([p1.center, '@origin'], '水平');
  await H.rel([p2.center, '@origin'], '水平');
  await H.dim(['@origin', p1.center], [20, -5], 40);
  await H.dim(['@origin', p2.center], [-20, -5], 40);
  H.expectFullyDefined();
  await H.exitSketch();
  await H.treeClick('草圖2');
  await H.action('特徵', '伸長除料');
  await H.pmSelect('throughAll');
  await H.pmOk();

  await H.hud('等角');
  await H.hud('全部顯示');
  await H.action('特徵', '圓角');
  await H.pmInput('半徑', '10');
  for (const P of [[60, 7.5, 40], [-60, 7.5, 40], [60, 7.5, -40]]) await H.at(P);
  await H.dragView(420, 0); // the fourth corner is behind the plate: turn it into view
  await H.at([-60, 7.5, -40]);
  await H.pmOk();
  await H.hud('等角');
  await H.hud('全部顯示');
  await H.action('特徵', '導角'); // 1 mm × 45° by default
  const d = Math.SQRT1_2 * 10;
  for (const P of [[0, 15, 40], [0, 15, -40], [60, 15, 0], [-60, 15, 0], [50 + d, 15, 30 + d], [-50 - d, 15, 30 + d], [-50 - d, 15, -30 - d], [50 + d, 15, -30 - d]]) await H.at(P);
  await H.pmOk();
  return H.result('定位板', await H.saveAs('定位板.3dbx'));
};

/** V 型塊: 60 × 40 section with a 90° V (30 open), 50 long both ways, R2 in the V, 2 × Ø6 × 12 on the side. */
demo.vblock = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('前基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 20, 8);
  await H.tool('直線');
  // G is drawn 2 mm low so no horizontal relation is inferred there: symmetry sets it
  await H.chain([[-30, 0], [30, 0], [30, 40], [15, 40], [0, 25], [-15, 40], [-30, 38], [-30, 0]]);
  await H.selectTool();
  await H.tool('中心線');
  await H.chain([[0, 0], [0, 25]]);
  await H.selectTool();
  const line = (a, b) => H.lineWhere((g) => Math.hypot(g.a[0] - a[0], g.a[1] - a[1]) < 1 && Math.hypot(g.b[0] - b[0], g.b[1] - b[1]) < 1);
  const AB = line([-30, 0], [30, 0]);
  const BC = line([30, 0], [30, 40]);
  const DE = line([15, 40], [0, 25]);
  const EF = line([0, 25], [-15, 40]);
  const CL = line([0, 0], [0, 25]);
  const [S, C, G, D, F] = [[0, 0], [30, 40], [-30, 38], [15, 40], [-15, 40]].map(([u, v]) => H.pointAt(u, v));
  await H.rel([S, AB], '中點');
  await H.rel([CL], '垂直');
  await H.rel([C, G, CL], '對稱');
  await H.rel([D, F, CL], '對稱');
  await H.dim([AB], [0, -8], 60);
  await H.dim([BC], [38, 20], 40);
  await H.dim([D, F], [0, 47], 30);
  await H.dim([DE, EF], [0, 35], 90);
  H.expectFullyDefined();
  await H.exitSketch();
  await H.treeClick('草圖1');
  await H.action('特徵', '伸長填料/基材');
  await H.pmSelect('midPlane');
  await H.pmInput('深度', '50');
  await H.pmOk();

  await H.action('特徵', '圓角');
  await H.pmInput('半徑', '2');
  await H.hud('上視'); // the bottom of the V is only visible from above
  await H.hud('全部顯示');
  await H.at([0, 25, 5]);
  await H.pmOk();

  await H.hud('等角');
  await H.hud('全部顯示');
  await H.at([30, 20, 0]); // the right side face
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 20, 8);
  await H.tool('圓');
  for (const [u, v] of [[12, 20], [-12, 20]]) {
    await H.sk(u, v);
    await H.sk(u + 3, v + 0.01);
    await H.solved();
  }
  await H.selectTool();
  const [c1, c2] = H.sketch().entities.filter((e) => e.type === 'circle').sort((a, b) => H.geom().get(b.id).c[0] - H.geom().get(a.id).c[0]);
  await H.dim([c1.id], [12, 30], 6);
  await H.rel([c1.id, c2.id], '相等');
  await H.dim(['@origin', c1.center], [6, -5], 12);
  await H.dim(['@origin', c1.center], [20, 10], 20);
  await H.rel([c2.center, c1.center], '水平');
  await H.dim(['@origin', c2.center], [-6, -5], 12);
  H.expectFullyDefined();
  await H.exitSketch();
  await H.treeClick('草圖2');
  await H.action('特徵', '伸長除料');
  await H.pmInput('深度', '12');
  await H.pmOk();
  return H.result('V型塊', await H.saveAs('V型塊.3dbx'));
};

/** 削邊銷: revolved pin (shank Ø10 × 15, collar Ø16 × 4, pin Ø8 × 12), ring groove, C0.5, two flats. */
demo.pin = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('前基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(4, 13, 15);
  await H.tool('中心線');
  await H.chain([[0, 0], [0, -5]]);
  await H.selectTool();
  await H.tool('直線');
  await H.chain([[0, 0], [5, 0], [5, 15], [8, 15], [8, 19], [4, 19], [4, 31], [0, 31], [0, 0]]);
  await H.selectTool();
  const line = (a, b) => H.lineWhere((g, id) => !H.construction(id) && Math.hypot(g.a[0] - a[0], g.a[1] - a[1]) < 0.5 && Math.hypot(g.b[0] - b[0], g.b[1] - b[1]) < 0.5);
  const CL = H.sketch().entities.find((e) => e.type === 'line' && e.construction).id;
  await H.rel([line([0, 31], [0, 0])], '垂直');
  await H.dim([CL], [3, -3], 5);
  const steps = [[[0, 0], [5, 0], [2.5, -2], 5], [[5, 0], [5, 15], [10, 7], 15], [[5, 15], [8, 15], [6.5, 12], 3], [[8, 15], [8, 19], [11, 17], 4], [[8, 19], [4, 19], [6, 22], 4], [[4, 19], [4, 31], [7, 26], 12]];
  for (const [a, b, place, value] of steps) await H.dim([line(a, b)], place, value);
  H.expectFullyDefined();
  await H.exitSketch();
  await H.treeClick('草圖1');
  await H.action('特徵', '旋轉填料/基材');
  await H.pmOk();

  await H.treeClick('前基準面'); // the ring groove
  await H.action('草圖', '草圖');
  await H.frameSketch(4, 3, 16);
  await H.tool('中心線');
  await H.chain([[0, 0], [0, -5]]);
  await H.selectTool();
  await H.tool('邊角矩形');
  await H.sk(4.5, 6);
  await H.sk(6.5, 7);
  await H.solved();
  await H.selectTool();
  const cl2 = H.sketch().entities.find((e) => e.type === 'line' && e.construction).id;
  const c0 = H.pointAt(4.5, 6);
  const bottom = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[1] - 6) < 0.2 && Math.abs(g.b[1] - 6) < 0.2);
  const side = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[0] - 6.5) < 0.2 && Math.abs(g.b[0] - 6.5) < 0.2);
  await H.dim([cl2], [-3, -3], 5);
  await H.dim(['@origin', c0], [2.2, -3], 4.5);
  await H.dim(['@origin', c0], [8.5, 3], 6);
  await H.dim([bottom], [5.5, 4.5], 2);
  await H.dim([side], [8.5, 6.5], 1);
  H.expectFullyDefined();
  await H.exitSketch();
  await H.treeClick('草圖2');
  await H.action('特徵', '旋轉除料');
  await H.pmOk();

  await H.hud('等角');
  await H.hud('全部顯示');
  await H.action('特徵', '導角');
  await H.pmInput('距離', '0.5');
  await H.at([5 * Math.SQRT1_2, 0, 5 * Math.SQRT1_2]); // the bottom edge of the shank
  await H.pmOk();

  for (const [plane, reverse, sketch] of [['基準面1', false, '草圖3'], ['基準面2', true, '草圖4']]) {
    await H.treeClick('右基準面');
    await H.action('特徵', '基準面');
    await H.pmInput('偏移距離', '3');
    if (reverse) await H.pmCheck('反轉方向', true);
    await H.pmOk();
    await H.treeClick(plane);
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 22, 10);
    await H.tool('邊角矩形');
    await H.sk(-6, 20);
    await H.sk(6, 32);
    await H.solved();
    await H.selectTool();
    const corner = H.pointAt(-6, 20);
    const low = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[1] - 20) < 0.3 && Math.abs(g.b[1] - 20) < 0.3);
    const right = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[0] - 6) < 0.3 && Math.abs(g.b[0] - 6) < 0.3);
    await H.dim(['@origin', corner], [-3, 36], 6);
    await H.dim(['@origin', corner], [4, 10], 20);
    await H.dim([low], [0, 17], 12);
    await H.dim([right], [9, 26], 12);
    H.expectFullyDefined();
    await H.exitSketch();
    await H.treeClick(sketch);
    await H.action('特徵', '伸長除料');
    await H.pmSelect('throughAll');
    if (!reverse) await H.pmCheck('反轉方向', true); // on the +x side the material is behind the plane
    await H.pmOk();
  }
  return H.result('削邊銷', await H.saveAs('削邊銷.3dbx'));
};

demo.all = async () => ({ plate: await demo.plate(), vblock: await demo.vblock(), pin: await demo.pin() });
'phase 1 demo parts ready: await __demo.all()';
