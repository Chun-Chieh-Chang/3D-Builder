// Manual checklist C8 (docs/manual-verification.html): the end conditions of 「伸長填料/基材」 (up to next, up to vertex, up to body, offset from a surface with and without
// 「超出該面」, through all, blind), the second direction, the thin wall, the draft, and a thin revolve; replayed the way a person does it in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The base plate is 40 × 30 × 10, the ceiling a plate of the same size 5 thick at 40 above the top plane.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c8.js?' + Date.now());   // in a freshly loaded page
//   await __manualC8.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC8 = {});

const PLATE = 40 * 30 * 10;
const CEILING = 40 * 30 * 5;
const R = 3;
const POST = (h) => Math.PI * R * R * h;

M.run = async () => {
  let post;
  await step('1 the base plate 40 × 30 × 10', async () => {
    await S.box(40, 30, 10);
    return { volume: S.volume(), pass: near(S.volume(), PLATE) };
  });
  await step('2 the ceiling: a datum plane 40 above the top plane, a 40 × 30 sketch on it, 5 thick: two bodies', async () => {
    await H.treeClick('上基準面');
    await H.action('特徵', '基準面');
    await H.pmInput('偏移距離', '40');
    await H.pmOk();
    const sketch = await S.rectSketch('基準面1', 40, 30);
    await S.extrude(sketch, 5);
    await S.iso();
    return { bodies: state().result.bodies.length, volume: S.volume(), tree: S.treeRows().filter((r) => /實體/.test(r)), pass: state().result.bodies.length === 2 && near(S.volume(), PLATE + CEILING) && S.failed().length === 0 };
  });
  await step('3 a circle of radius 3 on the top face of the plate, and 「伸長填料/基材」 on that sketch', async () => {
    await H.at(S.planeFace(1, 10).center);
    await H.action('草圖', '草圖');
    await H.frameSketch(20, 15, 12);
    await H.tool('圓');
    await H.sk(20, 15);
    await H.sk(20 + R, 15);
    await H.solved();
    post = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await S.iso();
    await H.treeClick(post);
    await H.action('特徵', '伸長填料/基材');
    return { panel: S.pmText().slice(0, 30), pass: /伸長/.test(S.pmText()) };
  });
  await step('4 成形到下一面: the post reaches the underside of the ceiling and joins the two plates into one body', async () => {
    await S.pmChoose('終止型態', 'upToNext');
    return { bodies: state().result.bodies.length, volume: S.volume(), pass: state().result.bodies.length === 1 && near(S.volume(), PLATE + CEILING + POST(30), 1e-4) && S.failed().length === 0 };
  });
  await step('5 成形至頂點: a corner of the top of the ceiling', async () => {
    await S.pmChoose('終止型態', 'upToVertex');
    const corner = S.vertices().filter((p) => Math.abs(p[1] - 45) < 1e-6).sort((a, b) => b[0] + b[2] - (a[0] + a[2]))[0];
    await H.at(corner);
    return { corner, volume: S.volume(), pass: near(S.volume(), PLATE + CEILING + POST(30), 1e-4) || near(S.volume(), PLATE + CEILING + POST(35) - POST(5), 1e-4) };
  });
  await step('6 成形至本體: the ceiling picked by its top face, the panel names the body', async () => {
    await S.pmChoose('終止型態', 'upToBody');
    await H.at(S.planeFace(1, 45).center);
    const panel = S.pmText();
    return { panel: panel.slice(0, 200), volume: S.volume(), lost: /遺失參考/.test(panel), pass: !/遺失參考/.test(panel) && S.failed().length === 0 && state().result.bodies.length === 1 };
  });
  await step('7 從曲面偏移 10 from the top of the ceiling: stops 5 under its underside; 超出該面: 10 beyond the top', async () => {
    await S.pmChoose('終止型態', 'offsetFromFace');
    await H.at(S.planeFace(1, 45).center);
    await S.pmType('偏移距離', '10');
    const before = { volume: S.volume(), bodies: state().result.bodies.length };
    await shot('7-offset-before-the-face');
    await S.pmCheck('超出該面（預設是在該面之前停下）', true);
    const beyond = { volume: S.volume(), bodies: state().result.bodies.length };
    await shot('7-offset-beyond-the-face');
    return {
      before,
      beyond,
      // 10 under the top face (y = 35) leaves 5 of air under the ceiling: the post is a body of its own with the plate; 10 beyond the top (y = 55) goes through the ceiling
      pass: before.bodies === 2 && near(before.volume, PLATE + CEILING + POST(25), 1e-4) && beyond.bodies === 1 && near(beyond.volume, PLATE + CEILING + POST(45) - POST(5), 1e-4),
    };
  });
  await step('8 完全貫穿, then 給定深度 10', async () => {
    await S.pmCheck('超出該面（預設是在該面之前停下）', false);
    await S.pmChoose('終止型態', 'throughAll');
    const through = { volume: S.volume(), failed: S.failed() };
    await S.pmChoose('終止型態', 'blind');
    await S.pmType('深度', '10');
    return { through, volume: S.volume(), pass: through.failed.length === 0 && through.volume > PLATE + CEILING + POST(30) && near(S.volume(), PLATE + CEILING + POST(10), 1e-4) && state().result.bodies.length === 2 };
  });
  await step('9 方向 2 with depth 4 (grows into the plate: nothing more), then off', async () => {
    await S.pmCheck('方向 2', true);
    await S.pmType('深度', '4', 1);
    const on = { volume: S.volume(), failed: S.failed() };
    await S.pmCheck('方向 2', false);
    return { on, volume: S.volume(), pass: on.failed.length === 0 && near(on.volume, PLATE + CEILING + POST(10), 1e-4) && near(S.volume(), PLATE + CEILING + POST(10), 1e-4) };
  });
  await step('10 薄件 with thickness 1: a hollow tube, then off', async () => {
    await S.pmCheck('薄件', true);
    await S.pmType('厚度', '1');
    const tube = Math.PI * (R * R - (R - 1) * (R - 1)) * 10;
    const on = { volume: S.volume(), failed: S.failed() };
    await shot('10-thin-tube');
    await S.pmCheck('薄件', false);
    return { on, volume: S.volume(), pass: on.failed.length === 0 && near(on.volume, PLATE + CEILING + tube, 1e-4) && near(S.volume(), PLATE + CEILING + POST(10), 1e-4) };
  });
  await step('11 拔模 3° and 往內拔模: the wall leans, narrower towards the top', async () => {
    await S.pmCheck('拔模', true);
    await S.pmType('拔模角度', '3');
    await S.pmCheck('往內拔模（預設往外）', true);
    const r2 = R - 10 * Math.tan((3 * Math.PI) / 180);
    const frustum = (Math.PI / 3) * 10 * (R * R + R * r2 + r2 * r2);
    const volume = S.volume();
    await shot('11-draft-inward');
    await H.pmOk();
    return { volume, frustum, failed: S.failed(), pass: near(volume, PLATE + CEILING + frustum, 1e-4) && S.failed().length === 0 };
  });
  await step('12 旋轉填料/基材 with 薄件: a rectangle beside a centre line on the front plane gives a hollow cylinder', async () => {
    await S.fresh();
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(15, 10, 10);
    await H.tool('邊角矩形');
    await H.sk(10, 0);
    await H.sk(20, 20);
    await H.solved();
    await H.tool('中心線');
    await H.sk(0, -5);
    await H.sk(0, 25);
    await H.key('Escape');
    await H.solved();
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(name);
    await H.action('特徵', '旋轉填料/基材');
    const full = S.volume();
    await S.pmCheck('薄件', true);
    await S.pmType('厚度', '2');
    const thin = S.volume();
    await shot('12-thin-revolve');
    // the solid: a ring of inner radius 10 and outer 20, 20 high. Thin 2 inward from the outline of the 10 × 20 rectangle leaves a wall of 200 − 6 × 16 = 104 mm²
    // whose centroid is 15 from the axis (Pappus): 2π · 15 · 104
    return { full, thin, failed: S.failed(), pass: S.failed().length === 0 && near(full, Math.PI * (400 - 100) * 20, 1e-3) && near(thin, 2 * Math.PI * 15 * 104, 1e-3) };
  });
  return S.result('C8');
};
