// ADR 0212: the crossing of two lines as a thing to dimension to, through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest
// test; the store is only read. Run one test per page load:
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-sketch-crossing.js?' + Date.now());
//   await __x.dimension();   // pick a crossing and a point, place; Esc after a pick leaves nothing -> { name, pass, ... }
//   await __x.extension();   // where two lines would meet on their extensions is not picked

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const X = (window.__x = {});

async function newSketch(centre = [0, 0], pxmm = 8) {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(centre[0], centre[1], pxmm);
}

/** Where the two lines really meet, from their own ends (the clicks land on pixels, so it is near (10, 5), not on it). */
const crossingOf = (lines) => {
  const [la, lb] = lines.map((id) => H.geom().get(id));
  const [d1, d2] = [[la.b[0] - la.a[0], la.b[1] - la.a[1]], [lb.b[0] - lb.a[0], lb.b[1] - lb.a[1]]];
  const tt = ((lb.a[0] - la.a[0]) * d2[1] - (lb.a[1] - la.a[1]) * d2[0]) / (d1[0] * d2[1] - d1[1] * d2[0]);
  return [la.a[0] + tt * d1[0], la.a[1] + tt * d1[1]];
};
const counts = () => ({ entities: H.sketch().entities.length, constraints: H.sketch().constraints.length });

X.dimension = async () => {
  await newSketch([10, 0], 8);
  // two lines that cross at (10, 5) in the middle of both, drawn with the line tool (its own inference may add relations of its own)
  await H.tool('直線');
  await H.sk(0, 0);
  await H.sk(20, 10);
  await H.key('Escape');
  await H.sk(0, 10);
  await H.sk(20, 0);
  await H.key('Escape');
  await H.tool('點');
  await H.sk(30, 0);
  await H.key('Escape');
  await H.solved();
  const lines = [...H.geom()].filter(([, g]) => g.type === 'line').map(([id]) => id);
  const q = [...H.geom()].find(([, g]) => g.type === 'point' && Math.abs(g.p[0] - 30) < 1e-6 && Math.abs(g.p[1]) < 1e-6)?.[0];
  if (lines.length !== 2 || !q) throw new Error(`setup: ${lines.length} lines, point ${q}`);
  const before = counts();

  // Esc after a pick leaves nothing
  await H.tool('智慧型尺寸');
  await H.sk(10, 5);
  const picked = H.view().pickedCrossings?.length === 1;
  await H.key('Escape');
  const afterEsc = counts();
  const escClean = afterEsc.entities === before.entities && afterEsc.constraints === before.constraints && H.view().pickedCrossings.length === 0;

  await H.tool('智慧型尺寸');
  // pick the crossing and the point, place it, type the value
  const before0 = { at: crossingOf(lines), q: [...H.geom().get(q).p] };
  await H.sk(10, 5);
  await H.sk(30, 0);
  await H.sk(40, -8);
  const input = await H.waitFor(() => document.querySelector('.modify-box input'), 5000, 'Modify box').catch((e) => {
    throw new Error(`${e.message}: picks ${JSON.stringify(H.view().picks)}, crossings ${JSON.stringify(H.view().pickedCrossings)}, tool ${H.view().tool}, hint ${H.view().hint}, message ${H.view().message}, ${JSON.stringify(counts())} (before ${JSON.stringify(before)}), picked ${picked}, escClean ${escClean}, constraints ${JSON.stringify(H.sketch().constraints)}, dimensionEdit ${store.getState().dimensionEdit}, solve ${store.getState().sketchSolve?.status}, hasP6 ${store.getState().sketchSolve?.geometry?.has("p6")}, box ${!!document.querySelector(".modify-box")}`);
  });
  const shown = input.value;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '21');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(40);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.waitFor(() => !document.querySelector('.modify-box'), 5000, 'Modify box to close');
  await H.solved();
  const s = H.sketch();
  const made = s.entities.filter((e) => e.type === 'point' && e.id !== q && !s.entities.some((l) => l.type === 'line' && (l.p1 === e.id || l.p2 === e.id)));
  const relation = s.constraints.filter((c) => c.type === 'intersection');
  const dimension = s.constraints.filter((c) => c.type === 'distance' && c.driving !== false);
  const at = made.map((p) => H.geom().get(p.id)?.p);
  const truth = crossingOf(lines);
  const qp = H.geom().get(q).p;
  const typed = Math.hypot(qp[0] - at[0][0], qp[1] - at[0][1]);
  const state = store.getState().sketchSolve;
  const pass =
    picked &&
    escClean &&
    made.length === 1 &&
    relation.length === 1 &&
    [relation[0].a, relation[0].b].sort().join() === [...lines].sort().join() &&
    Math.abs(at[0][0] - truth[0]) < 1e-6 &&
    Math.abs(at[0][1] - truth[1]) < 1e-6 &&
    dimension.length === 1 &&
    Math.abs(Number(shown) - Math.hypot(before0.q[0] - before0.at[0], before0.q[1] - before0.at[1])) < 1e-3 && // the value offered is the distance of the crossing as picked
    Math.abs(typed - 21) < 1e-6 && // and the value typed is what the point is then at
    state?.status !== 'failed';
  return { name: 'a crossing of two lines is picked, dimensioned to a point, and made a point with an intersection relation in the same step', picked, escClean, shown, made: made.length, relation, at, truth, qp, typed, before0, lines, dimension: dimension.length, status: state?.status, pass };
};

X.extension = async () => {
  await newSketch([10, 0], 8);
  // A stops at (4, 2): it would meet B at (10, 5), 6 mm further on. Nothing is there to dimension to.
  await H.tool('直線');
  await H.sk(0, 0);
  await H.sk(4, 2);
  await H.key('Escape');
  await H.sk(0, 10);
  await H.sk(20, 0);
  await H.key('Escape');
  await H.solved();
  const before = counts();
  await H.tool('智慧型尺寸');
  await H.sk(10, 5);
  const v = H.view();
  const after = counts();
  await H.key('Escape');
  const pass = v.pickedCrossings.length === 0 && v.snap?.kind !== 'intersection' && after.entities === before.entities && after.constraints === before.constraints;
  return { name: 'where two lines would meet on their extensions is not a crossing to pick', picked: v.picks, crossings: v.pickedCrossings.length, snap: v.snap?.kind ?? null, pass };
};
