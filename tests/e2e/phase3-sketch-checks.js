// Phase 3a-4c (A2.5, D7.2, C1.34, C1.35): the over-definition diagnosis, 「檢查草圖用於特徵」 / 「修復草圖」 and 「所選輪廓」, through the UI, in the
// app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test. Everything the user would do is done with the tools and the
// PropertyManager; only the two situations the tools refuse to make on purpose (an over-defined sketch, a 0.05 mm gap) are set up with
// `store.execute`. Run one test per page load:
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-sketch-checks.js?' + Date.now());
//   await __k.diagnose();   // diagnose, repair, contours -> { name, pass, ... }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const K = (window.__k = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const pm = () => document.querySelector('.property-manager');
const buttons = (label) => [...pm().querySelectorAll('button')].filter((b) => b.textContent === label);

async function newSketch(centre = [0, 0], pxmm = 6) {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(centre[0], centre[1], pxmm);
  return H.sketch().name;
}

K.diagnose = async () => {
  await newSketch([15, 10], 5);
  await H.tool('邊角矩形');
  await H.sk(0, 0);
  await H.sk(30, 20);
  await H.solved();
  const id = H.sketch().id;
  const [bottom, right, top] = ['l1', 'l2', 'l3'];
  await H.dim([bottom], [15, -4], 30);
  await H.dim([right], [34, 10], 20);
  const fully = state().sketchSolve?.status === 'fully';
  // two disagreeing widths: set up directly, since the dimension tool would make the second one a reference
  store.execute({ type: 'addSketchItems', featureId: id, entities: [], constraints: [{ id: 'dx', type: 'distance', a: top, value: '25' }] });
  await H.waitFor(() => state().sketchSolve?.status === 'over', 5000, 'over-defined');
  await H.wait(600);
  const box = [...pm().querySelectorAll('.pm-group')].find((g) => g.querySelector('h4')?.textContent === '過多定義診斷');
  const offered = box ? [...box.querySelectorAll('li')].map((li) => li.textContent) : [];
  // each cure says what it does to which item (ADR 0195), e.g. 「距離 25 (改為從動)」, and is applied by its own button
  const cure = [...box.querySelectorAll('li')].find((li) => li.querySelector('span')?.textContent === '距離 25 (改為從動)');
  const driven = cure?.querySelector('button');
  if (!driven) throw new Error(`no 改為從動 for the 25: ${offered.join(' | ')}`);
  driven.click();
  await H.waitFor(() => state().sketchSolve?.status === 'fully', 5000, 'fully defined again');
  const dx = H.sketch().constraints.find((c) => c.id === 'dx');
  const gone = ![...pm().querySelectorAll('.pm-group h4')].some((h) => h.textContent === '過多定義診斷');
  return { name: 'an over-defined sketch lists the cures, one click makes the extra dimension a reference', fully, offered, dx, gone, pass: fully && !!box && offered.length >= 2 && dx.driving === false && gone };
};

K.repair = async () => {
  await newSketch([10, 5], 8);
  const id = H.sketch().id;
  // a rectangle with a 0.05 mm gap in its left side and a copy of the top side
  const P = (n, x, y) => ({ id: n, type: 'point', x, y });
  store.execute({
    type: 'addSketchItems',
    featureId: id,
    entities: [
      P('ga', 0, 0), P('gb', 20, 0), P('gc', 20, 10), P('gd', 0, 10), P('ge', 0, 0.05),
      { id: 'gl1', type: 'line', p1: 'ga', p2: 'gb' }, { id: 'gl2', type: 'line', p1: 'gb', p2: 'gc' }, { id: 'gl3', type: 'line', p1: 'gc', p2: 'gd' }, { id: 'gl4', type: 'line', p1: 'ge', p2: 'gd' },
      { id: 'gl5', type: 'line', p1: 'gd', p2: 'gc' },
    ],
    constraints: [],
  });
  await H.solved();
  await H.wait(300);
  const box = () => [...pm().querySelectorAll('.pm-group')].find((g) => g.querySelector('h4')?.textContent === '檢查草圖用於特徵');
  const before = [...box().querySelectorAll('li')].map((li) => li.textContent);
  buttons('修復草圖')[0].click();
  await H.waitFor(() => !box().querySelector('li'), 5000, 'issues gone');
  await H.solved();
  const after = box().textContent;
  const lineCount = H.sketch().entities.filter((e) => e.type === 'line').length;
  const name = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(name);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '10');
  await H.pmOk();
  return { name: 'a gap and a duplicate are repaired in one step and the sketch extrudes (20 × 10 × 10)', before, after, lineCount, volume: state().result.mass.volume, failed: failed(), pass: before.length >= 2 && lineCount === 4 && near(state().result.mass.volume, 2000) && failed().length === 0 };
};

K.contours = async () => {
  const name = await newSketch([30, 5], 5);
  await H.tool('邊角矩形');
  await H.sk(0, 0);
  await H.sk(20, 10);
  await H.tool('邊角矩形');
  await H.sk(40, 0);
  await H.sk(50, 10);
  await H.solved();
  await H.exitSketch();
  await H.treeClick(name);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '10');
  const both = state().result.mass.volume;
  await H.waitFor(() => pm().querySelectorAll('.pm-row.checkbox input[type=checkbox]').length >= 3, 8000, 'contour list');
  const rows = [...pm().querySelectorAll('.pm-row.checkbox')].filter((r) => r.textContent.includes('輪廓'));
  const labels = rows.map((r) => r.textContent);
  // uncheck the 10 × 10 one (area 100)
  const small = rows.find((r) => r.textContent.includes('面積 100'));
  small.querySelector('input').click();
  await H.settle();
  const feature = state().doc.features.find((f) => f.type === 'extrude');
  const one = state().result.mass.volume;
  // the last contour cannot be unchecked
  rows.find((r) => r.textContent.includes('面積 200')).querySelector('input').click();
  await H.settle();
  const still = state().doc.features.find((f) => f.type === 'extrude').contours;
  small.querySelector('input').click();
  await H.settle();
  const reset = !('contours' in state().doc.features.find((f) => f.type === 'extrude'));
  await H.pmOk();
  return { name: 'choosing one of two contours extrudes only that one (2000, not 3000)', labels, both, one, contours: feature.contours, still, reset, failed: failed(), pass: near(both, 3000) && near(one, 2000) && feature.contours?.length === 1 && still?.length === 1 && reset && failed().length === 0 };
};
