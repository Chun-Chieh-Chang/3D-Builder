// Manual checklist C15 (docs/manual-verification.html): 「線性複製排列」 (count and spacing, an instance skipped, a count that leaves the plate, a spacing that makes the instances overlap,
// a second direction) and 「環狀複製排列」 about a 基準軸 made of two planes, replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui`
// does it). Not a Vitest test. The first part is phase3-pattern.js (the same clicks and checks); the second adds the grid (方向 2), which that script did not do.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c15.js?' + Date.now());   // in a freshly loaded page
//   await __manualC15.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
await import(here + 'phase3-pattern.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC15 = {});

const PLATE = 6000;
const POST = Math.PI * 4 * 5;

M.run = async () => {
  await step('1 linear pattern of five, one skipped, off the plate, overlapping, then a circular pattern about 基準軸1 (phase3-pattern.js)', async () => {
    const r = await window.__p.run();
    await S.iso();
    await shot('1-after-the-patterns');
    return { offPlate: r.offPlate, overlap: r.overlap, steps: r.steps.map((s) => [s.name, s.pass]), pass: r.pass === true };
  });
  await step('2 a plate 60 × 20 × 5 centred on the origin with a post of radius 2 at the left edge', async () => {
    await S.box(60, 20, 5, { center: true });
    await S.iso();
    await H.at(S.planeFace(1, 5).center);
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 8);
    await H.tool('圓');
    await H.sk(-25, 0);
    await H.sk(-23, 0.01);
    await H.solved();
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await S.extrude(name, 5);
    return { volume: S.volume(), pass: near(S.volume(), PLATE + POST, 1e-3) };
  });
  await step('3 線性複製排列 of the post: 5 in direction 1 (10 apart) and 2 in direction 2 (8 apart): a grid of ten posts, instances numbered 列×行', async () => {
    const post = state().doc.features.filter((f) => f.type === 'extrude').at(-1);
    await H.treeClick(post.name);
    await H.action('特徵', '線性複製排列');
    await S.pmType('實例數', '5');
    await S.pmClick('加入方向 2（排成格子）');
    // the direction 2 the panel starts with is the top plane (straight up: the second row would float); it is emptied and the front plane (along the plate's width) put in
    const dir2 = [...S.pm().querySelectorAll('.selection-box li')].find((li) => li.textContent.startsWith('方向 2'));
    dir2.querySelector('.link').click();
    await H.settle();
    const front = [...S.pm().querySelectorAll('.datum-picker button')].find((b) => b.title === '前基準面' || b.textContent === '前基準面');
    front.click();
    await H.settle();
    await S.pmType('實例數', '2', 1);
    await S.pmType('間距', '8', 1);
    const volume = S.volume();
    const skipRow = [...S.pm().querySelectorAll('.datum-picker button')].map((b) => b.textContent);
    await S.iso();
    await shot('3-grid-of-posts');
    const message = document.querySelector('.property-manager .pm-message')?.textContent ?? '';
    return { volume, skipRow, message, failed: S.failed(), panel: S.pmText().slice(0, 400), pass: near(volume, PLATE + 10 * POST, 1e-3) && skipRow.some((x) => /^\dx\d$/.test(x)) && S.failed().length === 0 };
  });
  await step('4 移除方向 2: back to a row of five; ✔', async () => {
    await S.pmClick('移除方向 2');
    const volume = S.volume();
    await H.pmOk();
    return { volume, pass: near(volume, PLATE + 5 * POST, 1e-3) && near(S.volume(), PLATE + 5 * POST, 1e-3) && S.failed().length === 0 };
  });
  return S.result('C15');
};
