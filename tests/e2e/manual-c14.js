// Manual checklist C14 (docs/manual-verification.html): 「基準軸」「參考點」「基準面」(perpendicular, midplane, tangent with nothing to touch) and 「座標系統」 on a 40 × 30 × 10
// block, then a circle drawn on 基準面1 as a sketch plane, replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The
// steps of the first part are those of phase3-datums.js (the same clicks, the same checks); what it adds is the sketch on the datum plane and the pictures.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c14.js?' + Date.now());   // in a freshly loaded page
//   await __manualC14.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
await import(here + 'phase3-datums.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC14 = {});

M.run = async () => {
  await step('1 axis, point, planes and coordinate system: every one where the manual says (phase3-datums.js)', async () => {
    const r = await window.__g.run();
    await S.iso();
    await shot('1-datums-in-the-model');
    return { steps: r.steps.map((s) => [s.name, s.pass]), tree: r.tree, pass: r.pass === true };
  });
  await step('2 基準面1 as a sketch plane: a circle drawn on it, the sketch leaves, and the model is as before', async () => {
    const before = S.volume();
    await H.treeClick('基準面1');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 8);
    await H.tool('圓');
    await H.sk(0, 0);
    await H.sk(8, 0.01);
    await H.solved();
    const entities = H.sketch().entities.filter((e) => e.type === 'circle').length;
    await shot('2-circle-on-the-datum-plane');
    await H.selectTool();
    await H.exitSketch();
    return { entities, before, volume: S.volume(), pass: entities === 1 && near(S.volume(), before) && S.failed().length === 0 };
  });
  return S.result('C14');
};
