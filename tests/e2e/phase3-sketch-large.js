// Large sketches in the app (2026-10-30): 150 dimensioned rectangles in one sketch used to abort the solver (`Aborted(OOM)`, a fixed 16 MiB heap); they
// are now solved part by part, and the definition analysis probes each part alone (it took 31 s in this page when every probe solved the whole sketch).
// One connected part too large for the solver is refused with a message the PropertyManager shows, and the solver goes on solving. Not a Vitest test:
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-sketch-large.js?' + Date.now());
//   await __skLarge.solves();    // 150 rectangles: solved, every size exact, in seconds -> { name, pass, ... }
//   await __skLarge.refused();   // a chain of 600 points: refused with the message, solved again after undo, the feature in error after exit

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const L = (window.__skLarge = {});

const solve = () => store.getState().sketchSolve;
const TOL = 1e-6;

async function newSketch() {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(300, 100, 1);
  await H.solved();
  return H.sketch().id;
}

/** `n` rectangles of 20 × 10, drawn 21 × 9: horizontal and vertical sides, the width and the height dimensioned, free to move (2 freedoms each). */
function rectangles(n) {
  const entities = [];
  const constraints = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = [(i % 20) * 30, Math.floor(i / 20) * 30];
    [[x, y], [x + 21, y], [x + 21, y + 9], [x, y + 9]].forEach(([px, py], k) => entities.push({ id: `p${i}_${k}`, type: 'point', x: px, y: py }));
    for (let k = 0; k < 4; k++) entities.push({ id: `l${i}_${k}`, type: 'line', p1: `p${i}_${k}`, p2: `p${i}_${(k + 1) % 4}` });
    constraints.push(
      { id: `h${i}a`, type: 'horizontal', a: `l${i}_0` },
      { id: `h${i}b`, type: 'horizontal', a: `l${i}_2` },
      { id: `v${i}a`, type: 'vertical', a: `l${i}_1` },
      { id: `v${i}b`, type: 'vertical', a: `l${i}_3` },
      { id: `w${i}`, type: 'distance', a: `l${i}_0`, value: '20' },
      { id: `t${i}`, type: 'distance', a: `l${i}_1`, value: '10' },
    );
  }
  return { entities, constraints };
}

/** Adds to the sketch being edited and waits for the solve of what was added. */
async function add(items, timeout) {
  const seq = solve().seq;
  const began = performance.now();
  store.execute({ type: 'addSketchItems', featureId: H.sketch().id, ...items });
  await H.waitFor(() => solve().seq > seq && H.sketch().entities.every((e) => solve().geometry.has(e.id)), timeout, 'solve of the large sketch');
  return performance.now() - began;
}

L.solves = async () => {
  await newSketch();
  const ms = await add(rectangles(150), 15000);
  const s = solve();
  const p = (id) => s.geometry.get(id).p;
  const off = [];
  for (let i = 0; i < 150; i++) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => p(`p${i}_${k}`));
    const errors = [b[0] - a[0] - 20, c[1] - b[1] - 10, b[1] - a[1], c[1] - d[1], b[0] - c[0], a[0] - d[0]];
    if (errors.some((e) => Math.abs(e) >= TOL)) off.push(i);
  }
  const shown = document.querySelector('[data-sketch-solve-message]')?.textContent ?? null;
  return { name: '150 dimensioned rectangles in one sketch: solved, every size exact, in seconds', ms: Math.round(ms), status: s.status, dof: s.dof, off, shown, pass: s.status === 'under' && s.dof === 300 && off.length === 0 && shown === null && !s.message };
};

L.refused = async () => {
  await newSketch();
  await add(rectangles(10), 15000);
  // one chain of 600 points, every one tied to the next: one part of 2398 unknowns and equations
  const entities = [];
  const constraints = [];
  for (let i = 0; i < 600; i++) entities.push({ id: `q${i}`, type: 'point', x: i * 3, y: -200 + (i % 2) * 0.01 });
  for (let i = 1; i < 600; i++) constraints.push({ id: `qh${i}`, type: 'horizontal', a: `q${i - 1}`, b: `q${i}` }, { id: `qx${i}`, type: 'distanceX', a: `q${i - 1}`, b: `q${i}`, value: '3' });
  await add({ entities, constraints }, 30000);
  const refused = solve().status;
  await H.wait(300);
  const shown = document.querySelector('[data-sketch-solve-message]')?.textContent ?? null;
  // the solver is not lost with it: without the chain the sketch solves again
  const seq = solve().seq;
  store.undo();
  await H.waitFor(() => solve().seq > seq, 30000, 'solve after undo');
  const again = { status: solve().status, dof: solve().dof, message: solve().message ?? null };
  // with it, the rebuild after the sketch puts the feature in error with the same message
  const redo = solve().seq;
  store.redo();
  await H.waitFor(() => solve().seq > redo, 30000, 'solve after redo');
  const id = H.sketch().id;
  await H.exitSketch();
  await H.settle();
  const feature = store.getState().result.features.find((f) => f.id === id);
  const message = (text) => typeof text === 'string' && text.includes('2398') && text.includes('超出求解器的記憶體');
  return {
    name: 'a part too large for the solver: refused with a message in the PropertyManager, solved again after undo, the feature in error after the sketch',
    refused,
    shown,
    again,
    feature: { status: feature?.status, message: feature?.message },
    pass: refused === 'failed' && message(shown) && again.status === 'under' && again.dof === 20 && again.message === null && feature?.status === 'error' && message(feature?.message),
  };
};
