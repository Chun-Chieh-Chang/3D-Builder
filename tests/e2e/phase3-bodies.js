// Phase 3a-3 (C7.1, C7.2, D4.6): a part with several bodies, through the UI, in the app's page (http://127.0.0.1:5391, 1280×720).
// Not a Vitest test. Sketches are drawn with the sketch tools and features made with the PropertyManager, like the other scripts
// here; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-bodies.js?' + Date.now());
//   const r = await __b.all();   // [{ name, pass, ... }]
//
// Two blocks apart are two bodies; a third one over the first with 「合併結果」 off is a body of its own; 「組合」 adds it to the
// first; a body is hidden (its faces leave the mesh), renamed and made a reference body (it leaves the mass).

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const B = (window.__b = {});

const state = () => store.getState();
const bodies = () => state().result.bodies;
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);

/** A block on the top plane: a corner rectangle (u0, v0)–(u1, v1) drawn with the tool, pushed up by `depth`. */
async function block(sketchName, [u0, v0], [u1, v1], depth, { merge = true } = {}) {
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch((u0 + u1) / 2, (v0 + v1) / 2, 5);
  await H.tool('邊角矩形');
  await H.sk(u0, v0);
  await H.sk(u1, v1);
  await H.solved();
  await H.exitSketch();
  await H.treeClick(sketchName);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', String(depth));
  if (!merge) await H.pmCheck('合併結果', false);
  await H.pmOk();
}

const faceRangesOf = (mesh) => {
  const out = new Set();
  for (let k = 0; k < mesh.faceRanges.length; k += 3) out.add(mesh.faceRanges[k + 2]);
  return out;
};

B.twoBodies = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  // The third block starts on an edge of the first. With the model snap on (D5.3b) that edge is anchored in the sketch as a reference line and
  // is an open end in the profile; this script is about bodies, so the snap to the model is off here.
  store.setOptions({ snap: { ...state().options.snap, model: false } });
  await block('草圖1', [-20, -10], [20, 10], 10); // 40 × 20 × 10
  await block('草圖2', [60, -10], [80, 10], 10); // 20 × 20 × 10, apart from the first
  const b = bodies();
  const tree = [...document.querySelectorAll('.tree-row.body')].map((r) => r.textContent);
  return {
    name: 'two blocks apart are two bodies',
    ids: b.map((x) => x.id),
    volumes: b.map((x) => Math.round(x.volume)),
    faces: b.map((x) => [x.face0, x.faces]),
    tree,
    folder: document.querySelector('.tree-row.folder')?.textContent,
    failed: failed(),
    pass: b.length === 2 && b[0].volume > 7999 && b[0].volume < 8001 && b[1].volume > 3999 && b[1].volume < 4001 && tree.length === 2 && state().result.faceNames.length === 12 && failed().length === 0,
  };
};

B.mergeOff = async () => {
  await block('草圖3', [10, -10], [30, 10], 10, { merge: false }); // over the first block, and not merged with it
  const b = bodies();
  return { name: '合併結果 off keeps an overlapping boss a body of its own', ids: b.map((x) => x.id), pass: b.length === 3 && failed().length === 0 };
};

B.combine = async () => {
  const volume0 = state().result.mass.volume;
  const before = bodies().length;
  await H.action('特徵', '組合');
  const pm = document.querySelector('.property-manager')?.innerText ?? '';
  // the main body: the first one (a select), the tool: the third (a checkbox of the list)
  await H.pmSelect(bodies()[0].id, 1);
  await H.pmCheck(bodies()[2].name, true);
  const tools = state().doc.features.find((f) => f.type === 'combine')?.tools.map((t) => t.name);
  await H.pmOk();
  const b = bodies();
  return {
    name: '組合 adds the third body to the first',
    pm: pm.slice(0, 60),
    tools,
    before,
    ids: b.map((x) => x.id),
    volumes: b.map((x) => Math.round(x.volume)),
    mass: state().result.mass.volume,
    // 40 × 20 × 10 and 20 × 20 × 10 overlapping by 10 × 20 × 10: the union is 8000 + 4000 − 2000
    pass: before === 3 && b.length === 2 && Math.abs(b[0].volume - 10000) < 1e-3 && failed().length === 0 && Math.abs(state().result.mass.volume - (volume0 - 2000)) < 1e-3,
  };
};

B.hideRenameReference = async () => {
  const rows = () => [...document.querySelectorAll('.tree-row.body')];
  const second = bodies()[1];
  // hide: the eye of the second body's row; its faces leave the mesh and cannot be picked
  rows()[1].querySelector('.vis-toggle').click();
  await H.settle();
  const shown = state().result.mesh ? faceRangesOf(state().result.mesh) : new Set();
  const hiddenOk = [...Array(second.faces).keys()].every((k) => !shown.has(second.face0 + k)) && state().result.bodies[1].shown === false;
  rows()[1].querySelector('.vis-toggle').click();
  await H.settle();
  const back = faceRangesOf(state().result.mesh);
  const shownAgain = [...Array(second.faces).keys()].every((k) => back.has(second.face0 + k));
  // rename: double-click, type, Enter
  rows()[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await H.wait(100);
  const input = document.querySelector('.tree-row.body input.rename');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '工件');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.settle();
  const renamed = bodies()[1].name;
  // reference: the context menu
  const v0 = state().result.mass.volume;
  rows()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 200 }));
  await H.wait(100);
  [...document.querySelectorAll('.context-menu li')].find((li) => li.textContent.includes('設為參考本體')).click();
  await H.settle();
  const ref = bodies()[1];
  const massAfter = state().result.mass.volume;
  return {
    name: 'hide, rename and reference',
    hiddenOk,
    shownAgain,
    renamed,
    reference: ref.reference,
    row: rows()[1].textContent,
    mass: [v0, massAfter],
    saved: { names: state().doc.bodies, visibility: state().doc.visibility },
    pass: hiddenOk && shownAgain && renamed === '工件' && ref.reference === true && Math.abs(massAfter - (v0 - ref.volume)) < 1e-3 && rows()[1].textContent.includes('參考'),
  };
};

B.all = async () => {
  const snap = state().options.snap;
  try {
    return [await B.twoBodies(), await B.mergeOff(), await B.combine(), await B.hideRenameReference()];
  } finally {
    store.setOptions({ snap }); // the option is kept in the browser
  }
};
