// The sketch's own axes (ADR 0170, G1 of the 2026-10-19 sketch-reference review): picking an axis, a symmetric relation about it, a dimension to it and a
// revolve about it, with no centerline drawn; replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-axes.js?' + Date.now());   // in a freshly loaded page
//   await __manualSketchAxes.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near } = S;
const M = (window.__manualSketchAxes = {});

const nearestPoint = (u, v) => {
  let best = null;
  for (const [id, g] of H.geom()) if (g.type === 'point') {
    const d = Math.hypot(g.p[0] - u, g.p[1] - v);
    if (!best || d < best.d) best = { id, d, p: g.p };
  }
  return best;
};

M.run = async () => {
  S.steps = [];
  await S.fresh();
  let a;
  let b;
  await step('1 on the front plane, two free points; the cursor along x = 0 lights the vertical axis, a click selects it', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 8);
    await H.tool('點');
    await H.sk(12, 8, { ctrlKey: true });
    await H.sk(-9, 5, { ctrlKey: true });
    await H.key('Escape');
    await H.solved();
    a = nearestPoint(12, 8).id;
    b = nearestPoint(-9, 5).id;
    await H.selectTool();
    await H.sk(0.1, -20);
    await H.wait(80);
    const selection = H.view().selection;
    return { selection, panel: S.pmText().slice(0, 80), pass: selection.length === 1 && selection[0] === '@axisV' && /垂直軸/.test(S.pmText()) };
  });
  await step('2 the two points and the vertical axis selected: 「對稱」 makes them mirror images across x = 0', async () => {
    await H.key('Escape');
    await H.selectTool();
    await H.sk(12, 8);
    await H.sk(-9, 5, { ctrlKey: true });
    await H.sk(0.1, -20, { ctrlKey: true });
    await H.wait(80);
    const btn = [...document.querySelectorAll('.relation-buttons button')].find((x) => x.textContent === '對稱');
    if (!btn) return { offered: [...document.querySelectorAll('.relation-buttons button')].map((x) => x.textContent), selection: H.view().selection, pass: false };
    btn.click();
    await H.waitFor(() => H.sketch().constraints.some((c) => c.type === 'symmetric' && c.axis === '@axisV'), 5000, 'symmetric about the axis');
    await H.solved();
    await H.key('Escape');
    const [pa, pb] = [H.geom().get(a).p, H.geom().get(b).p];
    return { pa, pb, pass: pa[0] > 0 && Math.abs(pa[0] + pb[0]) < 1e-9 && Math.abs(pa[1] - pb[1]) < 1e-9 };
  });
  await step('3 smart dimension from the first point to the vertical axis, 15: both points move, still mirrored', async () => {
    await H.tool('智慧型尺寸');
    await H.sk(...H.geom().get(a).p);
    await H.sk(0.1, -20);
    await H.sk(6, -6);
    const input = await H.waitFor(() => document.querySelector('.modify-box input'), 5000, 'Modify box');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '15');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await H.wait(40);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await H.waitFor(() => !document.querySelector('.modify-box'), 5000, 'Modify box to close');
    await H.solved();
    const dim = H.sketch().constraints.find((c) => c.type === 'distance' && (c.a === '@axisV' || c.b === '@axisV'));
    const [pa, pb] = [H.geom().get(a).p, H.geom().get(b).p];
    await H.selectTool();
    await H.exitSketch();
    return { dim, pa, pb, failed: S.failed(), pass: !!dim && near(pa[0], 15, 1e-6) && near(pb[0], -15, 1e-6) && S.failed().length === 0 };
  });
  await step('4 a rectangle beside the vertical axis, no centerline: 「旋轉填料/基材」 turns it about the axis, π(15² − 10²)·20', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(10, 10, 8);
    await H.tool('邊角矩形');
    await H.sk(10, 0, { ctrlKey: true });
    await H.sk(15, 20, { ctrlKey: true });
    await H.key('Escape');
    await H.solved();
    const sketchName = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(sketchName);
    await H.action('特徵', '旋轉填料/基材');
    await H.settle();
    const rev = state().doc.features.filter((f) => f.type === 'revolve').at(-1);
    return { axis: rev?.axis, volume: S.volume(), panel: S.pmText().slice(0, 80), pass: rev?.axis === '@axisV' && near(S.volume(), Math.PI * (15 ** 2 - 10 ** 2) * 20, 1e-4) };
  });
  return S.result('manual-sketch-axes');
};
