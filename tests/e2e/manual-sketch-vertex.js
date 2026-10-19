// A sketch point that follows a model vertex (ADR 0171, G2 of the 2026-10-19 sketch-reference review): a cone turned about the sketch's vertical axis,
// seen from the right plane, where its apex is a vertex no edge leads the cursor to. The point tool is drawn to it (「模型頂點」), the point follows the
// vertex, and when the cone is made taller (20 → 25) the point goes with the apex. Replayed the way a person does it in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-vertex.js?' + Date.now());   // in a freshly loaded page
//   await __manualSketchVertex.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near } = S;
const M = (window.__manualSketchVertex = {});

const hover = async (u, v) => {
  const p = H.toClient(u, v);
  H.ptr('pointermove', p.x, p.y);
  await H.wait(80);
  return H.view();
};
/** The vertex the sketch can snap to that is `r` from the origin of the sketch (the apex: its height). */
const vertexItem = (r) => (store.modelSnap ?? []).find((i) => 'vertex' in i && Math.abs(Math.hypot(i.vertex[0], i.vertex[1]) - r) < 1e-6);

M.run = async () => {
  S.steps = [];
  await S.fresh();
  let profile;
  await step('1 on the front plane a right triangle 10 wide and 20 high at the origin, turned about the sketch\'s vertical axis: a cone, π·10²·20/3', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(5, 10, 12);
    await H.tool('直線');
    await H.sk(0, 0);
    await H.sk(10, 0);
    await H.sk(0, 20);
    await H.sk(0, 0);
    await H.key('Escape');
    await H.solved();
    const lines = H.sketch().entities.filter((e) => e.type === 'line');
    const along = (id, axis) => {
      const g = H.geom().get(id);
      return Math.abs(g.a[axis] - g.b[axis]) < 1e-9;
    };
    const base = lines.find((l) => along(l.id, 1));
    const upright = lines.find((l) => along(l.id, 0));
    await H.dim([base.id], [5, -3], 10);
    await H.dim([upright.id], [-3, 10], 20);
    profile = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(profile);
    await H.action('特徵', '旋轉填料/基材');
    await H.settle();
    await H.pmOk?.();
    await H.settle();
    const rev = state().doc.features.find((f) => f.type === 'revolve');
    return { axis: rev?.axis, volume: S.volume(), failed: S.failed(), pass: rev?.axis === '@axisV' && near(S.volume(), (Math.PI * 100 * 20) / 3, 1e-4) };
  });
  let point;
  await step('2 a sketch on the right plane: the point tool is drawn to the apex (「模型頂點」) and the point follows that vertex', async () => {
    await H.treeClick('右基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 10, 12);
    await H.tool('點');
    // what the sketch can snap to comes from the worker a moment after the sketch opens
    for (let t = 0; t < 5000 && !vertexItem(20); t += 120) await H.wait(120);
    const item = vertexItem(20);
    if (!item) return { items: (store.modelSnap ?? []).map((i) => Object.keys(i)), pass: false };
    const v = await hover(item.vertex[0] + 0.05, item.vertex[1] - 0.05);
    const s = v.snap;
    await H.sk(item.vertex[0] + 0.05, item.vertex[1] - 0.05);
    await H.key('Escape');
    await H.solved();
    point = H.sketch().entities.find((e) => e.type === 'point' && e.ref);
    const at = point && H.geom().get(point.id).p;
    return {
      snap: s && { kind: s.kind, part: s.part }, inference: v.inference, ref: point?.ref, at,
      pass: s?.kind === 'model' && s.part === 'vertex' && v.inference === '模型頂點' && point?.ref?.kind === 'vertex' && near(Math.hypot(...at), 20, 1e-6),
    };
  });
  await step('3 the cone made taller (20 → 25): the point in the right-plane sketch goes with the apex', async () => {
    const sketch2 = H.sketch().id;
    await H.selectTool();
    await H.exitSketch();
    await S.treeEdit(profile);
    const dim = H.sketch().constraints.find((c) => c.type === 'distance' && c.value === '20');
    const ok = store.setDimensionValue(dim.id, '25');
    await H.solved();
    await H.exitSketch();
    await H.settle();
    const g = state().result.sketchGeometry?.get(sketch2)?.get(point.id);
    return { ok, at: g?.p, failed: S.failed(), pass: ok && !!g && near(Math.hypot(...g.p), 25, 1e-6) && S.failed().length === 0 };
  });
  return S.result('manual-sketch-vertex');
};
