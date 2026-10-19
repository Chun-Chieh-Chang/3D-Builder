// Helix curve (C8.3, ADR 0168): the reference circle's selection box of the helix PropertyManager — a sketch, a circular edge clicked in the graphics area,
// and a sketch chosen again from the flyout list — replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui`
// does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-helix.js?' + Date.now());   // in a freshly loaded page
//   await __manualHelix.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualHelix = {});

const helix = () => state().doc.features.find((f) => f.type === 'helix');
const status = () => state().result.features.find((r) => r.id === helix()?.id);
const box = () => [...S.pm().querySelectorAll('.selection-box li')];
// the closed form of a cylindrical helix: N turns of radius R rising H
const length = (R, N, H) => Math.hypot(2 * Math.PI * N * R, H);
const lengthIn = (info) => Number(/([\d.]+) mm$/.exec(info ?? '')?.[1]);

/** A circle of diameter `d` at the origin of the top plane, dimensioned; the sketch is left, its name returned. */
const circleSketch = async (d) => {
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 12);
  await H.tool('圓');
  await H.sk(0, 0, { ctrlKey: true });
  await H.sk(d / 2 - 1, 0.01, { ctrlKey: true }); // off the size it will be, so the snaps do not hold it to the cylinder's edge
  await H.solved();
  const id = [...H.geom()].find(([, g]) => g.type === 'circle')[0];
  await H.dim([id], [d, d / 2], d);
  const name = H.sketch().name;
  await H.selectTool();
  await H.exitSketch();
  return name;
};

let sketch2 = '';
M.run = async () => {
  await step('1 a cylinder Ø24 × 20 on the top plane (9047.79 mm³), then a second sketch: a circle Ø20', async () => {
    await S.fresh();
    const s1 = await circleSketch(24);
    await S.extrude(s1, 20);
    sketch2 = await circleSketch(20);
    return { sketch2, volume: S.volume(), pass: near(S.volume(), Math.PI * 144 * 20) && !!sketch2 };
  });
  await step('2 the second sketch selected, 「螺旋曲線與渦捲線」: the box holds the sketch', async () => {
    await H.treeClick(sketch2);
    await H.action('特徵', '螺旋曲線與渦捲線');
    const items = box().map((li) => li.textContent);
    await shot('2-box-sketch');
    return { items, circle: helix()?.circle, pass: helix()?.circle.kind === 'datum' && helix()?.circle.name !== '' && items.some((x) => x.includes(sketch2)) };
  });
  await step('3 圈數 4 (螺距 5), ✔: R10 for 20 up, the length of the closed form (252.12 mm)', async () => {
    await S.pmType('圈數', '4');
    await H.pmOk();
    await S.iso();
    const info = status()?.info;
    return { info, failed: S.failed(), pass: S.failed().length === 0 && near(lengthIn(info), length(10, 4, 20), 1e-4) };
  });
  await step('4 edited again, the box emptied with ×, the cylinder\'s top edge clicked: the box holds that edge', async () => {
    await S.treeEdit(helix().name);
    box().find((li) => li.querySelector('button'))?.querySelector('button')?.click();
    await H.settle();
    const emptied = helix().circle.name === '';
    const edge = state().result.edgeFingerprints.find((fp) => fp.type === 'circle' && Math.abs(fp.center[1] - 20) < 1e-6 && Math.abs(fp.size - 24 * Math.PI) < 1e-3);
    await H.at(edge.center); // an edge's fingerprint centre is its middle point, on the edge
    await shot('4-box-edge');
    return { emptied, notice: S.notice(), edge, circle: helix().circle, pass: emptied && helix().circle.kind === 'edge' && helix().circle.name !== '' };
  });
  await step('5 ✔: now R12 (the edge), the length of the closed form for R12', async () => {
    await H.pmOk();
    const info = status()?.info;
    return { info, failed: S.failed(), pass: S.failed().length === 0 && near(lengthIn(info), length(12, 4, 20), 1e-4) };
  });
  await step('6 edited again, the sketch chosen from the list under the box: the sketch is back, R10 once more', async () => {
    await S.treeEdit(helix().name);
    const chip = [...S.pm().querySelectorAll('.datum-picker button')].find((b) => b.title === sketch2);
    chip?.click();
    await H.settle();
    const circle = helix().circle;
    await H.pmOk();
    const info = status()?.info;
    return { chip: !!chip, circle, info, pass: !!chip && circle.kind === 'datum' && S.failed().length === 0 && near(lengthIn(info), length(10, 4, 20), 1e-4) };
  });
  return S.result('helix');
};
