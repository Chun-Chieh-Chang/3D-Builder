// Manual checklist C11 (docs/manual-verification.html): 「掃出填料/基材」 and 「掃出除料」: a 6 × 4 rectangle along a line of 40 (960 mm³), a hollow tube, an arc path (line + tangent arc), a cut in
// a block, and the three mistakes (the path misses the profile plane, a closed path, a turn so sharp that the profile folds over itself); replayed the way a person does it in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c11.js?' + Date.now());   // in a freshly loaded page
//   await __manualC11.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC11 = {});

const feature = (type) => state().doc.features.filter((f) => f.type === type).at(-1);
const resultOf = (id) => state().result.features.find((f) => f.id === id);

/** A path of straight lines (and a tangent arc to `arcTo`) from the origin on the front plane; the sketch name. */
async function path(points, { arcTo, dim } = {}) {
  await H.treeClick('前基準面');
  await H.action('草圖', '草圖');
  const xs = points.map((p) => p[0]).concat(arcTo ? [arcTo[0]] : []);
  const ys = points.map((p) => p[1]).concat(arcTo ? [arcTo[1]] : []);
  await H.frameSketch((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(2, Math.min(12, 520 / (Math.max(...xs) - Math.min(...xs) + 20))));
  await H.tool('直線');
  for (const [u, v] of points) await H.sk(u, v);
  await H.key('Escape');
  if (arcTo) {
    await H.tool('切線弧');
    await H.sk(...points.at(-1));
    await H.sk(...arcTo);
    await H.key('Escape');
  }
  await H.solved();
  if (dim) await H.dim([H.lineWhere((g) => Math.abs(g.a[1]) < 0.5 && Math.abs(g.b[1]) < 0.5)], [dim[0], dim[1]], dim[2]);
  const name = H.sketch().name;
  await H.selectTool();
  await H.exitSketch();
  return name;
}

/** The 6 × 4 centre rectangle on the right plane, dimensioned. */
async function rectangleProfile() {
  await H.treeClick('右基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 20);
  await H.tool('中心矩形');
  await H.sk(0, 0);
  await H.sk(3, 2);
  await H.solved();
  const top = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[1] - 2) < 0.2 && Math.abs(g.b[1] - 2) < 0.2);
  const right = H.lineWhere((g, id) => !H.construction(id) && Math.abs(g.a[0] - 3) < 0.2 && Math.abs(g.b[0] - 3) < 0.2);
  await H.dim([top], [0, 3.5], 6);
  await H.dim([right], [4.5, 0], 4);
  const name = H.sketch().name;
  await H.selectTool();
  await H.exitSketch();
  return name;
}

M.run = async () => {
  let pathName;
  let profile;
  await step('1 a path of 40 from the origin on the front plane: its start is on the origin', async () => {
    await S.fresh();
    pathName = await path([[0, 0], [40, 0]], { dim: [20, -3, 40] });
    const sk = state().doc.features.find((f) => f.name === pathName);
    const g = state().result.sketchGeometry.get(sk.id);
    const line = [...g.values()].find((x) => x.type === 'line');
    return { a: line.a, b: line.b, pass: Math.hypot(...line.a) < 1e-6 && Math.abs(line.b[0] - 40) < 1e-6 };
  });
  await step('2 a 6 × 4 rectangle centred on the origin on the right plane', async () => {
    profile = await rectangleProfile();
    return { profile, pass: !!profile };
  });
  await step('3 the profile selected, 「掃出填料/基材」: the path is the latest sketch with a line; ✔: a 6 × 4 × 40 bar of 960 mm³', async () => {
    await H.treeClick(profile);
    await H.action('特徵', '掃出填料/基材');
    const chosen = S.pm().querySelector('select')?.selectedOptions[0]?.textContent;
    await H.pmOk();
    await S.iso();
    return { chosen, volume: S.volume(), pass: chosen === pathName && near(S.volume(), 960) && S.failed().length === 0 };
  });
  await step('4 a hollow tube: two circles round the origin (Ø6 and Ø4) swept along the same path', async () => {
    await S.fresh();
    await path([[0, 0], [40, 0]], { dim: [20, -3, 40] });
    await H.treeClick('右基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 20);
    await H.tool('圓');
    await H.sk(0, 0);
    await H.sk(3, 0.01);
    await H.solved();
    await H.tool('圓');
    await H.sk(0, 0);
    await H.sk(2, 0.01);
    await H.solved();
    const circles = [...H.geom()].filter(([, g]) => g.type === 'circle').map(([id, g]) => ({ id, r: g.r })).sort((a, b) => b.r - a.r);
    await H.dim([circles[0].id], [5, 5], 6);
    await H.dim([circles[1].id], [-5, 5], 4);
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(name);
    await H.action('特徵', '掃出填料/基材');
    await H.pmOk();
    await S.iso();
    return { volume: S.volume(), pass: near(S.volume(), Math.PI * (9 - 4) * 40, 1e-4) && S.failed().length === 0 };
  });
  await step('5 an arc path: a line of 30 and a tangent arc to (50, 20), the same rectangle: area × length of the path', async () => {
    await S.fresh();
    await path([[0, 0], [30, 0]], { arcTo: [50, 20] });
    const prof = await rectangleProfile();
    await H.treeClick(prof);
    await H.action('特徵', '掃出填料/基材');
    await H.pmOk();
    await S.iso();
    const length = 30 + (Math.PI * 20) / 2;
    return { volume: S.volume(), pass: near(S.volume(), 24 * length, 2e-3) && S.failed().length === 0 };
  });
  await step('6 掃出除料: the same path and profile cut a groove in the front face of a 120 × 80 × 20 block', async () => {
    await S.fresh();
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 4);
    await H.tool('中心矩形');
    await H.sk(0, 0);
    await H.sk(60, 40);
    await H.solved();
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(name);
    await H.action('特徵', '伸長填料/基材');
    await S.pmType('深度', '20');
    await H.pmOk();
    const block = S.volume();
    await path([[0, 0], [30, 0]], { arcTo: [50, 20] });
    const prof = await rectangleProfile();
    await H.treeClick(prof);
    await H.action('特徵', '掃出除料');
    await H.pmOk();
    await S.iso();
    const length = 30 + (Math.PI * 20) / 2;
    // the path lies in the front face of the block, so half of the profile (3 of its 6) is in the material: the groove is half of 24 × length
    return { block, volume: S.volume(), pass: near(block, 120 * 80 * 20) && near(S.volume(), block - 12 * length, 2e-3) && S.failed().length === 0 };
  });
  await step('7 mistake 1: a path that does not reach the profile plane says so in Chinese', async () => {
    await S.fresh();
    await path([[10, 0], [40, 0]]);
    const prof = await rectangleProfile();
    await H.treeClick(prof);
    await H.action('特徵', '掃出填料/基材');
    await H.pmOk();
    const f = feature('sweep');
    const r = f && resultOf(f.id);
    await shot('7-path-misses-the-plane');
    return { status: r?.status, message: r?.message, pass: r?.status === 'error' && /路徑沒有一端在輪廓所在的平面上/.test(r.message ?? '') };
  });
  await step('8 mistake 2: a closed path is refused with the known limitation', async () => {
    await S.fresh();
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(15, 10, 10);
    await H.tool('邊角矩形');
    await H.sk(0, 0);
    await H.sk(30, 20);
    await H.solved();
    await H.selectTool();
    await H.exitSketch();
    const prof = await rectangleProfile();
    await H.treeClick(prof);
    await H.action('特徵', '掃出填料/基材');
    await H.pmOk();
    const f = feature('sweep');
    const r = f && resultOf(f.id);
    await shot('8-closed-path');
    return { status: r?.status, message: r?.message, pass: r?.status === 'error' && /封閉的路徑還不支援/.test(r.message ?? '') };
  });
  await step('9 mistake 3: a turn so sharp that the profile folds over itself is refused in Chinese (a two-leg path that turns back 158°)', async () => {
    await S.fresh();
    await path([[0, 0], [20, 0], [10, 4]]);
    const prof = await rectangleProfile();
    await H.treeClick(prof);
    await H.action('特徵', '掃出填料/基材');
    await H.pmOk();
    const f = feature('sweep');
    const r = f && resultOf(f.id);
    await shot('9-sharp-turn');
    // 6 × 4 along 20 + 10.77 should hold about 738 mm³; OCCT calls the folded solid valid (240 mm³), so the kernel measures it: it is refused with the reason
    return { status: r?.status, message: r?.message, pass: r?.status === 'error' && /路徑轉折太急，掃出的結果自己疊在一起/.test(r.message ?? '') };
  });
  return S.result('C11');
};
