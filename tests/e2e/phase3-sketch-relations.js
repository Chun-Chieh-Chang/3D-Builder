// Phase 3a-4b (C1.26, C1.28, C1.29): 同心同徑, 交錯, 合併, the arc-length dimension and driven (reference) dimensions, through the UI, in the
// app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read. Run one test per page load:
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-sketch-relations.js?' + Date.now());
//   await __r.coradial();   // coradial, intersection, merge, arcLength, driven -> { name, pass, ... }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const R = (window.__r = {});

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const status = () => store.getState().sketchSolve?.status;

async function newSketch(centre = [0, 0], pxmm = 8) {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(centre[0], centre[1], pxmm);
}

R.coradial = async () => {
  await newSketch();
  await H.tool('圓');
  await H.sk(0, 0);
  await H.sk(10, 0);
  await H.sk(30, 2); // not level with the first center: that would line up (D5.3a) and a coradial relation would be redundant with it
  await H.sk(34, 2);
  await H.solved();
  const [c1, c2] = [...H.geom()].filter(([, g]) => g.type === 'circle').map(([id]) => id);
  await H.rel([c1, c2], '同心同徑');
  const [g1, g2] = [H.geom().get(c1), H.geom().get(c2)];
  const pass = near(g1.r, g2.r) && near(g1.c[0], g2.c[0]) && near(g1.c[1], g2.c[1]);
  return { name: 'two circles made coradial have the same center and radius', r: [g1.r, g2.r], c: [g1.c, g2.c], pass };
};

R.intersection = async () => {
  await newSketch();
  await H.tool('直線');
  await H.sk(-10, -5);
  await H.sk(10, 5);
  await H.key('Escape');
  await H.sk(-10, 6);
  await H.sk(10, -4);
  await H.key('Escape');
  await H.tool('點');
  await H.sk(20, 20);
  await H.key('Escape');
  await H.solved();
  const lines = [...H.geom()].filter(([, g]) => g.type === 'line').map(([id]) => id);
  const ends = lines.flatMap((id) => { const l = H.geom().get(id); return [l.p1, l.p2]; });
  const before = ends.map((id) => H.geom().get(id).p);
  const p = H.pointAt(20, 20);
  await H.rel([p, ...lines], '交錯');
  const g = H.geom().get(p).p;
  const [a, b] = lines.map((id) => H.geom().get(id));
  const onLine = (l) => Math.abs((l.b[0] - l.a[0]) * (g[1] - l.a[1]) - (l.b[1] - l.a[1]) * (g[0] - l.a[0])) < 1e-6 * Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
  // the two lines as drawn cross at (1, 0.5): the point comes there and the sketch does not move to the point (C6.2)
  const moved = Math.max(...ends.map((id, k) => { const q = H.geom().get(id).p; return Math.hypot(q[0] - before[k][0], q[1] - before[k][1]); }));
  return { name: 'a point made an intersection lands on the crossing and leaves the two lines where they are', at: g, moved, pass: onLine(a) && onLine(b) && moved < 1e-6 && near(g[0], 1) && near(g[1], 0.5) };
};

R.merge = async () => {
  await newSketch();
  await H.tool('直線');
  await H.sk(0, 0);
  await H.sk(10, 0);
  await H.key('Escape');
  await H.sk(14, 3);
  await H.sk(14, 9);
  await H.key('Escape');
  await H.solved();
  const before = H.sketch().entities.filter((e) => e.type === 'point').length;
  const a = H.pointAt(10, 0);
  const b = H.pointAt(14, 3);
  await H.selectTool();
  await H.sk(10, 0);
  await H.sk(14, 3, { ctrlKey: true });
  await H.wait(80);
  const button = [...document.querySelectorAll('.relation-buttons button')].find((x) => x.textContent === '合併');
  if (!button) throw new Error('合併 not offered');
  button.click();
  await H.waitFor(() => H.sketch().entities.filter((e) => e.type === 'point').length < before, 5000, 'merge');
  await H.solved();
  const after = H.sketch().entities.filter((e) => e.type === 'point').length;
  const joined = H.sketch().entities.filter((e) => e.type === 'line').filter((l) => l.p1 === a || l.p2 === a).length;
  return { name: 'merging two points joins the two lines at one point', before, after, joined, removed: b, pass: after === before - 1 && joined === 2 };
};

R.arcLengthAndDriven = async () => {
  await newSketch();
  await H.tool('中心點圓弧');
  await H.sk(0, 0);
  await H.sk(10, 0);
  await H.sk(0, 10);
  await H.solved();
  const arc = [...H.geom()].find(([, g]) => g.type === 'arc')[0];
  await H.selectTool();
  const [u, v] = H.onEntity(arc, 0.3, Math.PI / 4);
  await H.sk(u, v);
  await H.wait(80);
  const button = [...document.querySelectorAll('.relation-buttons button')].find((x) => x.textContent === '標註弧長');
  if (!button) throw new Error('標註弧長 not offered');
  button.click();
  await H.waitFor(() => H.sketch().constraints.some((c) => c.type === 'arcLength'), 5000, 'arc length');
  await H.solved();
  const dim = H.sketch().constraints.find((c) => c.type === 'arcLength');
  // the arc is under-defined, so the length drives: change it and the arc follows (radius 10, length π·10/2 → a quarter circle)
  const labelOf = () => [...document.querySelectorAll('.overlay-label.dimension')].map((e) => e.textContent);
  return { name: 'an arc gets a length dimension', dim, labels: labelOf(), driving: dim.driving !== false, pass: dim.driving !== false && labelOf().some((t) => t.includes('⌒')) };
};

R.driven = async () => {
  await newSketch([15, 10], 5);
  await H.tool('邊角矩形');
  await H.sk(0, 0);
  await H.sk(30, 20);
  await H.solved();
  const bottom = H.lineWhere((g) => Math.abs(g.a[1]) < 0.5 && Math.abs(g.b[1]) < 0.5);
  const right = H.lineWhere((g) => Math.abs(g.a[0] - 30) < 0.5 && Math.abs(g.b[0] - 30) < 0.5);
  const top = H.lineWhere((g) => Math.abs(g.a[1] - 20) < 0.5 && Math.abs(g.b[1] - 20) < 0.5);
  await H.dim([bottom], [15, -4], 30);
  await H.dim([right], [34, 10], 20);
  const fully = status() === 'fully';
  // a third dimension would over-define: it is added as a reference showing what is measured, in parentheses
  await H.tool('智慧型尺寸');
  const [u, v] = H.onEntity(top);
  await H.sk(u, v);
  await H.sk(15, 24);
  await H.waitFor(() => H.sketch().constraints.filter((c) => c.type === 'distance').length === 3, 5000, 'third dimension');
  await H.solved();
  const driven = H.sketch().constraints.find((c) => c.driving === false);
  const labels = [...document.querySelectorAll('.overlay-label.dimension.driven')].map((e) => e.textContent);
  const stillFully = status() === 'fully';
  return { name: 'a dimension that would over-define becomes a reference that shows (30)', fully, stillFully, driven, labels, pass: fully && stillFully && !!driven && labels.includes('(30)') };
};
