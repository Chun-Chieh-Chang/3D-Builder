// Phase 3a-7a (C3.2–C3.5): reference axes, points, planes and coordinate systems through the UI, in the app's page (http://127.0.0.1:5391, 1280×720).
// Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-datums.js?' + Date.now());   // after a fresh load of the page; then wait a moment for the viewer
//   await __g.run();   // -> { name, steps: [{ name, pass, ... }], failed, pass }
//
// A plate 40 × 30 on the top plane, 10 thick (x from −20 to 20, z from −15 to 15, y from 0 to 10). 「基準軸」 along the vertical edge at (20, 15); 「參考點」 at the
// centre of the top face (0, 10, 0); 「基準面」 square to that axis through that point (the plane y = 10, picked from the tree); a plane tangent to nothing
// is refused with a message; 「座標系統」 at the point with X along the axis. Every click is a DOM or pointer event.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const G = (window.__g = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (got, want, tol = 1e-6) => got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) <= tol);
const sameLine = (dir, want) => near(dir, want) || near(dir.map((v) => -v), want);
/** A datum from the buttons of the PropertyManager (the FeatureManager is hidden while it is open). */
const chip = async (label) => {
  const b = [...document.querySelectorAll('.property-manager .datum-picker button')].find((x) => x.title === label);
  if (!b) throw new Error(`no datum button ${label}`);
  b.click();
  await H.settle();
};
/** Empties the box with this label (the × next to what it holds). */
const clear = async (label) => {
  const li = [...document.querySelectorAll('.property-manager .selection-box li')].find((x) => x.textContent.startsWith(label) && x.querySelector('.link'));
  if (!li) throw new Error(`no filled box ${label}`);
  li.querySelector('.link').click();
  await H.settle();
};
const items = () => [...document.querySelectorAll('.property-manager .selection-box li')].map((li) => li.textContent);

G.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 6);
  await H.tool('邊角矩形');
  await H.sk(-20, -15);
  await H.sk(20, 15);
  await H.solved();
  const first = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(first);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '10');
  await H.pmOk();
  const steps = [];
  const step = (name, pass, extra = {}) => steps.push({ name, pass: !!pass, ...extra });

  // the axis along the vertical edge at (20, y, 15): the edge is picked in the graphics area (seen from the corner, not from above)
  await H.hud('等角');
  await H.hud('全部顯示');
  await H.action('特徵', '基準軸');
  const prompt = document.querySelector('.viewport .pick-prompt, .pick-prompt')?.textContent ?? '';
  await H.at([20, 5, 15]);
  const axis = state().result.axes.get('axis1');
  step('axis along the edge: through (20, 5, 15) along Y', axis && sameLine(axis.dir, [0, 1, 0]) && near(axis.origin, [20, 5, 15]), { axis, items: items(), prompt });
  await H.pmOk();

  // the point at the centre of the top face: the mode changes to 「邊線或面的中心」, the face is picked
  await H.action('特徵', '參考點');
  await H.pmSelect('center');
  await H.at([5, 10, 5]);
  const point = state().result.points.get('point1');
  step('point at the centre of the top face: (0, 10, 0)', point && near(point, [0, 10, 0]), { point, items: items() });
  await H.pmOk();

  // the plane square to the axis through the point: both picked from the PropertyManager's buttons
  await H.action('特徵', '基準面');
  await H.pmSelect('perpendicular');
  await chip('基準軸1');
  await chip('參考點1');
  await H.settle();
  const frame = state().result.frames.get('plane1');
  step('plane square to the axis through the point: y = 10, normal along Y', frame && sameLine(frame.normal, [0, 1, 0]) && Math.abs(frame.origin[1] - 10) < 1e-6, { frame, items: items() });
  await H.pmCheck('反轉方向', true);
  const reversed = state().result.frames.get('plane1');
  step('reversed: the normal turns round', reversed && near(reversed.normal, frame.normal.map((v) => -v)));
  await H.pmCheck('反轉方向', false);
  await H.pmOk();

  // a midplane between the top plane and the top face (both at the same time parallel): the first box holds the plane the new one started from, so it is emptied first
  await H.action('特徵', '基準面');
  await H.pmSelect('midplane');
  await clear('參考面');
  await chip('上基準面'); // y = 0, normal +Y
  await H.at([5, 10, 5]); // the top face, y = 10
  const mid = state().result.frames.get('plane2');
  step('midplane between the top plane and the top face: y = 5', mid && Math.abs(mid.origin[1] - 5) < 1e-6, { mid, items: items() });
  // a tangent plane with no cylinder in the model: it asks for one instead of failing without a word
  await H.pmSelect('tangent');
  const message = document.querySelector('.property-manager .pm-message')?.textContent ?? '';
  step('a tangent plane with no cylinder chosen asks for one', message.includes('圓柱面'), { message, items: items() });
  document.querySelector('.property-manager .pm-cancel').click();
  await H.settle();

  // the coordinate system at the point with X along the axis and Y along the right plane's normal; it starts with X and Y along the default ones
  await H.action('特徵', '座標系統');
  await chip('參考點1');
  await clear('X 方向');
  await chip('基準軸1'); // the first empty box that takes an axis: X
  await chip('右基準面'); // every box is full: the last one (Y) is replaced
  const system = state().result.systems.get('csys1');
  step('coordinate system at the point, X along the axis, Y along the right plane normal, Z = X × Y', system && near(system.origin, [0, 10, 0], 1e-9) && near(system.x, [0, 1, 0]) && near(system.y, [1, 0, 0]) && near(system.z, [0, 0, -1]), { system, items: items() });
  await H.pmCheck('反轉 X 軸', true);
  const flipped = state().result.systems.get('csys1');
  step('X flipped: X and Z turn round, Y stays', flipped && near(flipped.x, [0, -1, 0]) && near(flipped.y, [1, 0, 0]) && near(flipped.z, [0, 0, 1]), { flipped });
  await H.pmOk();

  const tree = [...document.querySelectorAll('.tree-row')].map((r) => r.textContent);
  return { name: 'reference axis, point, planes and coordinate system from the UI', steps, tree, failed: failed(), pass: steps.every((s) => s.pass) && failed().length === 0 };
};
