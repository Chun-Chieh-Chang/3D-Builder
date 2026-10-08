// What the replays of the manual checklist (tests/e2e/manual-*.js) share: the recipes of docs/manual-verification.html (做法 A: a block) done with the UI the way a person
// does them, the checks, and the screenshots (`window.__shot`, which `npm run verify:ui` provides; without it the calls do nothing). Not a script of its own.
//
//   await import(here + 'manual-support.js?' + Date.now());
//   const { H, store, step, box } = window.__man;

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const S = (window.__man = { H, store });

S.state = () => store.getState();
S.failed = () => S.state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
S.near = (a, b, tol = 1e-3) => a !== null && a !== undefined && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
S.volume = () => S.state().result.mass?.volume ?? null;
S.shot = (label) => window.__shot?.(label);
S.pm = () => document.querySelector('.property-manager');
S.pmText = () => S.pm()?.innerText ?? '';
S.notice = () => S.state().notice?.text ?? '';

/** 「新零件」: what is open is put away (the app asks whether to save; the answer is no). */
S.fresh = async () => {
  H.ready();
  store.newPart();
  if (store.getState().unsaved) await store.answerUnsaved('discard');
  await H.settle();
};

/** The steps of a replay: each is run, shot, and its answer kept (`pass: true` is what it must say). */
S.steps = [];
S.step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await S.shot(name);
  S.steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r, ...(typeof r?.knownIssue === 'string' ? { knownIssue: r.knownIssue } : {}) });
  return r;
};
S.result = (id) => ({ name: id, steps: S.steps, pass: S.steps.length > 0 && S.steps.every((s) => s.pass) });

// ---------------------------------------------------------------- 做法 A
/** A rectangle on `plane` (the name of its row in the tree), dimensioned: the sketch is left, its name returned. */
S.rectSketch = async (plane, w, d, { center = false } = {}) => {
  await H.treeClick(plane);
  await H.action('草圖', '草圖');
  const [u0, v0, u1, v1] = center ? [0, 0, w / 2, d / 2] : [0, 0, w, d];
  const pxmm = Math.max(1.5, Math.min(800 / (w * 1.8), 520 / (d * 1.8), 12));
  await H.frameSketch(center ? 0 : w / 2, center ? 0 : d / 2, pxmm);
  await H.tool(center ? '中心矩形' : '邊角矩形');
  await H.sk(u0, v0);
  await H.sk(u1, v1);
  await H.solved();
  const top = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[1] - v1) < 0.5 && Math.abs(g.b[1] - v1) < 0.5);
  const right = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[0] - u1) < 0.5 && Math.abs(g.b[0] - u1) < 0.5);
  await H.dim([top], [(u0 + u1) / 2, v1 + 0.2 * d + 3], w);
  await H.dim([right], [u1 + 0.2 * w + 3, (v0 + v1) / 2], d);
  const name = H.sketch().name;
  await H.selectTool();
  await H.exitSketch();
  return name;
};
/** 「伸長填料/基材」 on a sketch, `depth` deep. */
S.extrude = async (sketch, depth) => {
  await H.treeClick(sketch);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', String(depth));
  await H.pmOk();
};
/** 做法 A: a new part with a w × d × h block on the top plane. */
S.box = async (w, d, h, opts) => {
  await S.fresh();
  const sketch = await S.rectSketch('上基準面', w, d, opts);
  await S.extrude(sketch, h);
  return sketch;
};

// ---------------------------------------------------------------- the model on screen
S.faceCentres = () => S.state().result.faceFingerprints.map((fp, i) => ({ i, type: fp.type, center: fp.center, dir: fp.dir }));
/** The first planar face whose normal is along `axis` (0 x, 1 y, 2 z) and whose centre is at `at` along it. */
S.planeFace = (axis, at, tol = 1e-6) => S.faceCentres().find((f) => f.type === 'plane' && f.dir && Math.abs(f.dir[axis]) > 0.99 && Math.abs(f.center[axis] - at) < tol);
S.iso = async () => {
  store.viewer.setView('iso');
  await H.wait(400);
  store.viewer.fitAll(); // 「全部顯示」: what the model is now, not what it was when the view was set
  await H.wait(200);
};
S.view = async (name) => {
  store.viewer.setView(name);
  await H.wait(400);
  store.viewer.fitAll();
  await H.wait(200);
};
/** Clicks a row of the tree with the right button and the item of the menu that comes up. */
S.treeMenu = async (rowName, item) => {
  const row = [...document.querySelectorAll('.tree-row')].filter((x) => x.textContent.replace(/^\([-+?]\) /, '') === rowName).at(-1);
  if (!row) throw new Error(`no tree row ${rowName}`);
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 8, button: 2 }));
  await H.wait(150);
  const entry = [...document.querySelectorAll('.context-menu li, .context-menu button')].find((x) => x.textContent.trim() === item);
  if (!entry) throw new Error(`no menu item ${item}: ${[...document.querySelectorAll('.context-menu li')].map((x) => x.textContent).join(' | ')}`);
  entry.click();
  await H.settle();
};
S.treeRows = () => [...document.querySelectorAll('.feature-tree .tree-row, .tree-row')].map((x) => x.textContent);
/** Double-click: opens the feature or sketch of a row for editing. */
S.treeEdit = async (rowName) => {
  const row = [...document.querySelectorAll('.tree-row')].filter((x) => x.textContent.replace(/^\([-+?]\) /, '') === rowName && !x.classList.contains('body')).at(-1);
  if (!row) throw new Error(`no tree row ${rowName}`);
  row.click();
  await H.wait(120);
  row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await H.settle();
};

// ---------------------------------------------------------------- dialogs and panels
S.modal = () => document.querySelector('.modal');
S.modalButton = async (label) => {
  const b = await H.waitFor(() => [...document.querySelectorAll('.modal button')].find((x) => x.textContent === label), 5000, `dialog button ${label}`);
  b.click();
  await H.wait(200);
};
/** Types into an input the way a person does (React sees the value) and presses Enter. */
S.type = async (input, value, { enter = true } = {}) => {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(60);
  if (enter) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.settle();
};
S.select = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
};
/** The row of the PropertyManager with this label (its span), and what is in it. */
S.pmRow = (label, nth = 0) => [...document.querySelectorAll('.property-manager .pm-row')].filter((r) => r.querySelector('span')?.textContent === label)[nth];
/** A checkbox of the PropertyManager set on or off, a number typed into a field, an option chosen from a list (`nth`: the second 「深度」 is direction 2's). */
S.pmCheck = async (label, on, nth = 0) => {
  const input = S.pmRow(label, nth)?.querySelector('input');
  if (!input) throw new Error(`no checkbox ${label}`);
  if (input.checked !== on) input.click();
  await H.settle();
};
S.pmType = async (label, value, nth = 0) => {
  const input = S.pmRow(label, nth)?.querySelector('input');
  if (!input) throw new Error(`no field ${label}`);
  await S.type(input, value);
};
S.pmChoose = async (label, value, nth = 0) => {
  const sel = S.pmRow(label, nth)?.querySelector('select');
  if (!sel) throw new Error(`no list ${label}`);
  await S.select(sel, value);
};
/** The world position of the vertex of the model that is at the given height along y and furthest along +x, +z (a corner to click). */
S.vertices = () => {
  const r = S.state().result;
  const out = [];
  for (let i = 0; i < r.vertexPoints.length; i += 3) out.push([r.vertexPoints[i], r.vertexPoints[i + 1], r.vertexPoints[i + 2]]);
  return out;
};
S.pmButton = (label) => [...document.querySelectorAll('.property-manager button')].find((b) => b.textContent === label);
S.pmClick = async (label) => {
  const b = S.pmButton(label);
  if (!b) throw new Error(`no button ${label} in the PropertyManager`);
  b.click();
  await H.settle();
};
