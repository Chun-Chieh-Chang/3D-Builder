// A sketch attached to the model (ADR 0181, G7 of the 2026-10-19 sketch-reference review): a 40 × 30 block 20 deep (x 0 to 40, y 0 to 30, z 0 to 20); a second
// sketch on the front plane with one line from (5, 5) to (15, 5); 「編輯草圖基準面」 on it, the block's corner (40, 30, 20) clicked for the origin and the
// edge down from it, (40, 15, 20), for x: the origin falls on the plane at (40, 30, 0), x runs along y, and the line is where those put it; 「X 反向」 turns
// the axes half a turn; ✔ keeps it, the sketch is a child of the block; the block made 55 wide, the origin goes to x = 55. Replayed the way a person does it
// in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-attach.js?' + Date.now());   // in a freshly loaded page
//   await __manualSketchAttach.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near } = S;
const M = (window.__manualSketchAttach = {});

const ATTACH_FLIP = 'X 反向（X 與 Y 一起轉 180°）';
/** Features in error: while the plane of a sketch is edited that sketch is rolled back (its frame is still worked out), which is not an error. */
const errors = () => state().result.features.filter((f) => f.status === 'error').map((f) => `${f.id}:${f.message}`);
const frameOf = (id) => state().result.frames.get(id);
const sketchNamed = (name) => state().doc.features.find((f) => f.type === 'sketch' && f.name === name);
/** A point of the sketch (its own coordinates) in the part. */
const world = (id, u, v) => {
  const f = frameOf(id);
  return [0, 1, 2].map((k) => f.origin[k] + f.xDir[k] * u + f.yDir[k] * v);
};
const same = (a, b, tol = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < tol);

M.run = async () => {
  S.steps = [];
  await S.fresh();
  let first;
  let second;
  await step('1 a 40 × 30 rectangle on the front plane drawn 20 deep: a block of 24000 mm³', async () => {
    first = await S.rectSketch('前基準面', 40, 30);
    await S.extrude(first, 20);
    return { volume: S.volume(), failed: S.failed(), pass: near(S.volume(), 40 * 30 * 20, 1e-6) && S.failed().length === 0 };
  });
  await step('2 a second sketch on the front plane with a line from (5, 5) to (15, 5), drawn with Ctrl held so no snap takes it to the block', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(10, 5, 12);
    await H.tool('直線');
    await H.sk(5, 5, { ctrlKey: true });
    await H.sk(15, 5, { ctrlKey: true });
    await H.key('Escape');
    await H.solved();
    second = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    const id = sketchNamed(second).id;
    const f = frameOf(id);
    return { frame: f, pass: !!f && same(f.origin, [0, 0, 0]) && same(f.xDir, [1, 0, 0]) && same(world(id, 15, 5), [15, 5, 0]) };
  });
  await step('3 「編輯草圖基準面」 shows the attachment; the corner (40, 30, 20) clicked: the origin falls on the plane at (40, 30, 0), the axes stay, the line moves with it', async () => {
    await S.treeMenu(second, '編輯草圖基準面');
    await H.hud('等角');
    await H.hud('全部顯示');
    await H.settle();
    await H.wait(600); // the view moves to its new place over a moment: the clicks below are made on where it ends up
    const id = sketchNamed(second).id;
    const shown = S.pmText().includes('草圖附著');
    await H.at([40, 30, 20]);
    const attach = sketchNamed(second).attach;
    const f = frameOf(id);
    return {
      shown, attach, frame: f, errors: errors(),
      pass: shown && attach?.origin?.kind === 'vertex' && !attach.x && !!f && same(f.origin, [40, 30, 0]) && same(f.xDir, [1, 0, 0]) && same(world(id, 5, 5), [45, 35, 0]) && errors().length === 0,
    };
  });
  await step('4 the edge down from the corner clicked for x: x runs along y (the way the edge is drawn), y is normal × x, the origin stays', async () => {
    const id = sketchNamed(second).id;
    await H.at([40, 15, 20]);
    const attach = sketchNamed(second).attach;
    const f = frameOf(id);
    const alongY = !!f && Math.abs(Math.abs(f.xDir[1]) - 1) < 1e-9 && Math.abs(f.xDir[0]) < 1e-9 && Math.abs(f.xDir[2]) < 1e-9;
    const right = !!f && same([f.xDir[1] * f.yDir[2] - f.xDir[2] * f.yDir[1], f.xDir[2] * f.yDir[0] - f.xDir[0] * f.yDir[2], f.xDir[0] * f.yDir[1] - f.xDir[1] * f.yDir[0]], [0, 0, 1], 1e-9);
    // the line from (5, 5) to (15, 5) is 10 long on x now: from the origin + 5x + 5y to + 15x + 5y
    const moved = !!f && same(world(id, 15, 5), [f.origin[0] + 15 * f.xDir[0] + 5 * f.yDir[0], f.origin[1] + 15 * f.xDir[1] + 5 * f.yDir[1], 0]);
    return { attach, frame: f, errors: errors(), alongY, right, moved, pass: attach?.origin?.kind === 'vertex' && attach?.x?.kind === 'edge' && alongY && right && moved && same(f.origin, [40, 30, 0]) && errors().length === 0 };
  });
  await step('5 「X 反向」 turns x and y half a turn: the same origin and normal; ✔ keeps it, and the second sketch is a child of the block', async () => {
    const id = sketchNamed(second).id;
    const before = frameOf(id);
    await H.pmCheck(ATTACH_FLIP, true);
    const after = frameOf(id);
    await H.pmOk();
    await H.settle();
    const { parentsOf } = await import('/@fs/' + here.replace(/^.*\/@fs\//, '').replace(/tests\/e2e\/$/, '') + 'packages/regen/src/dag.ts');
    const doc = state().doc;
    const block = doc.features.find((f) => f.type === 'extrude');
    const parents = parentsOf(sketchNamed(second), doc);
    return {
      before: before?.xDir, after: after?.xDir, parents, failed: S.failed(),
      pass: !!before && !!after && same(after.xDir, before.xDir.map((v) => -v)) && same(after.yDir, before.yDir.map((v) => -v)) && same(after.origin, before.origin) && sketchNamed(second).attach?.flipX === true && parents.includes(block.id) && S.failed().length === 0,
    };
  });
  await step('6 the block made 55 wide: the origin follows the corner to x = 55, and nothing is in error', async () => {
    await S.treeEdit(first);
    const dim = H.sketch().constraints.find((c) => c.type === 'distance' && c.value === '40');
    const ok = store.setDimensionValue(dim.id, '55');
    await H.solved();
    await H.exitSketch();
    await H.settle();
    const id = sketchNamed(second).id;
    const f = frameOf(id);
    return { ok, frame: f, failed: S.failed(), pass: ok && !!f && same(f.origin, [55, 30, 0]) && S.failed().length === 0 };
  });
  return S.result('manual-sketch-attach');
};
