// Manual checklist C23 (docs/manual-verification.html): 「圓角」 given faces (the top face, then the bottom face as well, then taken out again, a fillet with nothing to round, a pocket whose
// edges come with the face) and 「導角」 distance-distance with the distances turned, and the one edge with its fillet, replayed the way a person does it in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The faces are picked with a click at the screen position of the face.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c23.js?' + Date.now());   // in a freshly loaded page
//   await __manualC23.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC23 = {});

const listed = () => [...S.pm().querySelectorAll('[data-group="faces"] li, .selection-box li')].map((li) => li.textContent).filter((t) => /^面 \d/.test(t));
const last = (type) => state().doc.features.filter((f) => f.type === type).at(-1);
const edgeLengthsOnTop = (y) => state().result.edgeFingerprints.filter((fp) => fp.type === 'line' && Math.abs(fp.center[1] - y) < 1e-6).map((fp) => Math.round(fp.size * 1e6) / 1e6).sort((a, b) => b - a);

M.run = async () => {
  await step('1 a 40 × 30 × 12 block (14400 mm³), the isometric view', async () => {
    await S.box(40, 30, 12);
    await S.iso();
    return { volume: S.volume(), pass: near(S.volume(), 14400) };
  });
  await step('2 「圓角」, the top face clicked: the list has 面 1; 半徑 2, ✔: the four top edges round, 14282.89 mm³', async () => {
    await H.action('特徵', '圓角');
    await H.at(S.planeFace(1, 12).center);
    const rows = listed();
    await shot('2-top-face-listed');
    await H.pmInput('半徑', '2');
    await H.pmOk();
    await S.iso();
    await shot('2-top-rounded');
    return { rows, volume: S.volume(), pass: rows.length === 1 && near(S.volume(), 14282.89, 1e-5) && S.failed().length === 0 };
  });
  await step('3 圓角1 edited, the bottom face clicked (from below): two rows, 14165.78 mm³', async () => {
    await S.treeEdit('圓角1');
    await S.view('bottom');
    await H.at(S.planeFace(1, 0).center);
    const rows = listed();
    await H.pmOk();
    await S.iso();
    await shot('3-top-and-bottom-rounded');
    return { rows, volume: S.volume(), pass: rows.length === 2 && near(S.volume(), 14165.78, 1e-5) };
  });
  await step('4 the bottom face clicked again: it leaves the list, 14282.89 mm³ again', async () => {
    await S.treeEdit('圓角1');
    await S.view('bottom');
    await H.at(S.planeFace(1, 0).center);
    const rows = listed();
    await H.pmOk();
    await S.iso();
    return { rows, volume: S.volume(), pass: rows.length === 1 && near(S.volume(), 14282.89, 1e-5) };
  });
  await step('5 a second 「圓角」 on the top face, 半徑 1: an error that says the face has no edge to round; ✕', async () => {
    await H.action('特徵', '圓角');
    await H.at(S.planeFace(1, 12).center ?? [20, 12, -15]);
    await H.pmInput('半徑', '1');
    await H.pmOk();
    const f = last('fillet');
    const r = state().result.features.find((x) => x.id === f?.id);
    const message = r?.message ?? S.pm()?.querySelector('.pm-message')?.textContent ?? '';
    await shot('5-nothing-to-round');
    // the feature is kept with its error by ✔; the person leaves it with ✕ before, or deletes it: here the part goes on from a clean state
    store.cancelEdit?.();
    await H.settle();
    return { status: r?.status, message, pass: /沒有可以倒的邊/.test(message) };
  });
  await step('6 a pocket 6 × 6 × 4 in the top face, then 「圓角」 of the top face (半徑 1): the edges of the pocket come with it', async () => {
    await S.box(40, 30, 12);
    await S.iso();
    await H.at(S.planeFace(1, 12).center);
    await H.action('草圖', '草圖');
    await H.frameSketch(20, 15, 10);
    await H.tool('邊角矩形');
    await H.sk(17, 12);
    await H.sk(23, 18);
    await H.solved();
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(name);
    await H.action('特徵', '伸長除料');
    await H.pmInput('深度', '4');
    await H.pmOk();
    const pocket = S.volume();
    await S.iso();
    await H.action('特徵', '圓角');
    // the top face is clicked beside the pocket: the middle of the face is where the pocket is
    await H.at([5, 12, -5]);
    await H.pmInput('半徑', '1');
    await H.pmOk();
    await S.iso();
    await shot('6-pocket-rounded');
    const fillet = last('fillet');
    const roundFaces = state().result.faceNames.filter((n) => n.startsWith(`${fillet.id}:fillet`)).length;
    return { pocket, volume: S.volume(), roundFaces, pass: near(pocket, 14400 - 6 * 6 * 4) && S.volume() < pocket && roundFaces >= 8 && S.failed().length === 0 };
  });
  await step('7 「導角」 距離-距離 2 and 2 on the top face: 2 × 2 bevels, 14130.67 mm³', async () => {
    await S.box(40, 30, 12);
    await S.iso();
    await H.action('特徵', '導角');
    await H.at(S.planeFace(1, 12).center);
    await S.select(S.pm().querySelector('select'), 'distanceDistance');
    await H.pmInput('距離 1', '2');
    await H.pmInput('距離 2', '2');
    await H.pmOk();
    await S.iso();
    await shot('7-chamfer-2-2');
    return { volume: S.volume(), pass: near(S.volume(), 14130.67, 1e-5) && S.failed().length === 0 };
  });
  await step('8 導角1 edited to 3 and 1: the long edge of the top face is 34; with 反轉方向 it is 38', async () => {
    await S.treeEdit('導角1');
    await H.pmInput('距離 1', '3');
    await H.pmInput('距離 2', '1');
    await H.pmOk();
    const a = edgeLengthsOnTop(12);
    await S.treeEdit('導角1');
    await S.pmCheck('反轉方向', true);
    await H.pmOk();
    const b = edgeLengthsOnTop(12);
    await S.iso();
    await shot('8-chamfer-reversed');
    return { top: a, reversed: b, pass: a[0] === 34 && b[0] === 38 && S.failed().length === 0 };
  });
  await step('9 (選做) 「圓角」 on one long top edge, 半徑 2: only that edge rounds', async () => {
    await S.box(40, 30, 12);
    await S.iso();
    await H.action('特徵', '圓角');
    const edge = state().result.edgeFingerprints.map((fp, i) => ({ fp, i })).filter(({ fp }) => fp.type === 'line' && Math.abs(fp.center[1] - 12) < 1e-6 && Math.abs(fp.size - 40) < 1e-6)[0];
    // a point on that edge: the middle of its polyline
    const m = state().result.mesh;
    let at;
    for (let g = 0; g < m.edgeRanges.length; g += 3) if (m.edgeRanges[g + 2] === edge.i) at = [m.edgePoints[(m.edgeRanges[g] + 1) * 3], m.edgePoints[(m.edgeRanges[g] + 1) * 3 + 1], m.edgePoints[(m.edgeRanges[g] + 1) * 3 + 2]];
    await H.at(edge.fp.center);
    const edges = last('fillet').edges?.length ?? 0;
    await H.pmInput('半徑', '2');
    await H.pmOk();
    return { edges, volume: S.volume(), pass: edges === 1 && near(S.volume(), 14400 - (1 - Math.PI / 4) * 4 * 40, 1e-4) && S.failed().length === 0 };
  });
  return S.result('C23');
};
