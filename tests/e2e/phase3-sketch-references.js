// Phase 3a-4d (C1.18, C1.26): 「轉換實體引用」 (the outline of a model face as sketch entities that follow the model) and 「貫穿」, through the
// UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test. The block is made with the sketch tools and the PropertyManager,
// the face and the edge are picked by clicking the model; only the widening of the block (to see the entities follow) is a `store.execute`.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-sketch-references.js?' + Date.now());
//   await __f.outlineAndPierce();   // -> { name, pass, ... }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const F = (window.__f = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

F.outlineAndPierce = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  // the block: 20 × 10 on the top plane, 10 high
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(10, 5, 8);
  await H.tool('邊角矩形');
  await H.sk(0, 0);
  await H.sk(20, 10);
  await H.solved();
  const first = H.sketch();
  await H.dim([first.entities.find((e) => e.type === 'line').id], [10, -3], 20);
  await H.exitSketch();
  await H.treeClick(first.name);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '10');
  await H.pmOk();
  const volume0 = state().result.mass.volume;

  // the far cap of the block: the planar face whose centre is 10 away from the sketch plane
  const r = state().result;
  const faceIndex = r.faceFingerprints.findIndex((fp) => fp.type === 'plane' && Math.abs(Math.abs(fp.center[1]) - 10) < 1e-6);
  const centre = r.faceFingerprints[faceIndex].center;
  await H.at(centre);
  const selected = state().selectedFace?.name;
  await H.action('草圖', '草圖');
  const sketchName = H.sketch().name;
  await H.frameSketch(10, 5, 8);
  await H.tool('轉換實體引用');
  await H.at(centre); // click the face: its outline becomes entities
  await H.solved();
  const lines = H.sketch().entities.filter((e) => e.type === 'line' && e.ref);
  const status = state().sketchSolve?.status;
  const hint = document.querySelector('.pick-hint')?.textContent;

  // a vertical edge (along the thickness): where it passes through the sketch plane
  const pts = [];
  for (let i = 0; i < r.vertexPoints.length; i += 3) pts.push([r.vertexPoints[i], r.vertexPoints[i + 1], r.vertexPoints[i + 2]]);
  const [a, b] = (() => {
    for (const p of pts) for (const q of pts) if (Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[2] - q[2]) < 1e-6 && p[1] < q[1] - 1) return [p, q];
    throw new Error('no edge along y');
  })();
  // seen along the sketch's normal that edge is a point, so look at the model from an angle to click it
  store.viewer.setView('iso');
  await H.wait(400);
  await H.tool('貫穿');
  await H.at([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  await H.solved();
  const pierce = H.sketch().entities.filter((e) => e.type === 'point' && e.pierce);
  const sketchId = H.sketch().id;
  await H.exitSketch();

  // the block is made wider: the entities follow it
  const width = state().doc.features.find((f) => f.id === first.id).constraints.find((c) => c.type === 'distance');
  store.execute({ type: 'setDimension', featureId: first.id, constraintId: width.id, value: '35' });
  await H.settle();
  const geometry = state().result.sketchGeometry.get(sketchId);
  const lengths = [...geometry.values()].filter((g) => g.type === 'line').map((g) => Math.round(Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) * 1e6) / 1e6).sort((x, y) => x - y);
  const stillOk = failed().length === 0;

  // and the outline makes a profile: 35 × 10 × 5 more
  await H.treeClick(sketchName);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '5');
  await H.pmOk();
  const volume = state().result.mass.volume;
  return {
    name: 'a face outline and a pierce point follow the model, and the outline extrudes',
    selected,
    hint,
    lines: lines.length,
    status,
    pierce: pierce.length,
    lengths,
    volume0,
    volume,
    failed: failed(),
    pass: !!selected && lines.length === 4 && status === 'fully' && pierce.length === 1 && stillOk && lengths.join() === '10,10,35,35' && near(volume0, 2000) && near(volume, 35 * 10 * 15) && failed().length === 0,
  };
};
