// Phase 3a-4a (C1.8, C1.9, C1.15, C1.16, C1.17, C1.19): the sketch tools slot, polygon, round, trim, extend, offset and mirror,
// through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-sketch-tools.js?' + Date.now());
//   const r = await __t.slot();  // one at a time, each after a reload of the page (a new part is not made over a changed one)
//   // slot, polygon, fillet, trim, offset -> { name, pass, ... }
//
// Each shape is drawn with its tool in a sketch on the top plane, pushed up 10 mm, and the volume compared with a hand calculation.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const T = (window.__t = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const lines = () => H.sketch().entities.filter((e) => e.type === 'line');

async function newSketch(centre = [0, 0]) {
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(centre[0], centre[1], 8);
  return H.sketch().name;
}

async function extrude(name, depth = 10) {
  await H.exitSketch();
  await H.treeClick(name);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', String(depth));
  await H.pmOk();
}

T.slot = async () => {
  H.ready();
  const name = await newSketch();
  await H.tool('狹槽');
  await H.sk(-15, 0);
  await H.sk(15, 0);
  await H.sk(0, 5);
  await H.solved();
  const arcs = H.sketch().entities.filter((e) => e.type === 'arc').length;
  const lineCount = lines().length;
  await extrude(name);
  // 30 × 10 and two half discs of radius 5: (300 + 25π) × 10
  const expected = (300 + 25 * Math.PI) * 10;
  return { name: 'a slot extrudes to the hand-calculated volume', arcs, lines: lineCount, volume: state().result.mass.volume, expected, failed: failed(), pass: arcs === 2 && near(state().result.mass.volume, expected) && failed().length === 0 };
};

T.polygon = async () => {
  const name = await newSketch();
  await H.tool('多邊形');
  await H.pmInput('邊數', '6');
  await H.sk(0, 0);
  await H.sk(10, 0);
  await H.solved();
  const sides = lines().length;
  await extrude(name);
  const expected = ((3 * Math.sqrt(3)) / 2) * 100 * 10;
  return { name: 'a hexagon extrudes to the hand-calculated volume', sides, volume: state().result.mass.volume, expected, failed: failed(), pass: sides === 6 && near(state().result.mass.volume, expected) && failed().length === 0 };
};

T.fillet = async () => {
  const name = await newSketch();
  await H.tool('邊角矩形');
  await H.sk(-20, -10);
  await H.sk(20, 10);
  await H.solved();
  await H.tool('草圖圓角');
  await H.pmInput('圓角半徑', '4');
  await H.sk(20, -10); // the corner
  await H.solved();
  const arcs = H.sketch().entities.filter((e) => e.type === 'arc').length;
  await extrude(name);
  const expected = (800 - (16 - 4 * Math.PI)) * 10;
  return { name: 'a rounded corner extrudes to the hand-calculated volume', arcs, volume: state().result.mass.volume, expected, failed: failed(), pass: arcs === 1 && near(state().result.mass.volume, expected) && failed().length === 0 };
};

T.trim = async () => {
  await newSketch();
  await H.tool('直線');
  await H.sk(-10, 0);
  await H.sk(10, 0);
  await H.key('Escape');
  await H.sk(0, -5);
  await H.sk(0, 5);
  await H.key('Escape');
  await H.solved();
  const before = H.sketch().entities.length;
  await H.tool('修剪');
  await H.sk(6, 0); // the right half of the horizontal line
  await H.solved();
  const horizontal = H.sketch().entities.find((e) => e.id === 'l1');
  const geom = H.geom().get('l1');
  const trimmed = geom.type === 'line' && near(geom.b[0], 0, 1e-6);
  // one undo brings the whole line back
  store.undo();
  await H.settle();
  await H.solved();
  const restored = H.sketch().entities.length === before && near(H.geom().get('l1').b[0], 10, 1e-6);
  return { name: 'trim cuts a line back to the crossing, one undo restores it', trimmed, restored, horizontal: !!horizontal, pass: trimmed && restored };
};

T.offset = async () => {
  const name = await newSketch();
  await H.tool('邊角矩形');
  await H.sk(-20, -10);
  await H.sk(20, 10);
  await H.solved();
  await H.selectTool();
  for (const [u, v] of [[0, -10], [20, 0], [0, 10], [-20, 0]]) await H.sk(u, v, { ctrlKey: true });
  await H.tool('偏移圖元');
  await H.pmInput('偏移距離', '2');
  await H.sk(0, 0); // the inner side
  await H.solved();
  const s = H.sketch();
  const inner = s.entities.filter((e) => e.type === 'line').slice(4);
  const xs = inner.flatMap((e) => {
    const g = H.geom().get(e.id);
    return g.type === 'line' ? [g.a[0], g.b[0]] : [];
  });
  const sized = inner.length === 4 && near(Math.max(...xs), 18, 1e-6) && near(Math.min(...xs), -18, 1e-6);
  await extrude(name);
  // a frame: 40 × 20 minus 36 × 16
  const expected = (800 - 576) * 10;
  return { name: 'offsetting an outline inward by 2 gives a frame of the hand-calculated volume', sized, volume: state().result.mass.volume, expected, failed: failed(), pass: sized && near(state().result.mass.volume, expected) && failed().length === 0 };
};
