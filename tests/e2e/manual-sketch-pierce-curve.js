// Pierce points on curves (ADR 0173, G4 of the 2026-10-19 sketch-reference review): a helix of radius 10, pitch 5, 4 turns about y, seen from the front plane
// (which holds its axis). The point tool is drawn to where the second turn passes through the plane, (−10, 7.5) — 「貫穿點」 — and the point follows that
// crossing; when the helix is made 6 pitch the crossing moves to (−10, 9). Replayed the way a person does it in the app's page (http://127.0.0.1:5391,
// 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-pierce-curve.js?' + Date.now());   // in a freshly loaded page
//   await __manualPierceCurve.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near } = S;
const M = (window.__manualPierceCurve = {});

const helix = () => state().doc.features.find((f) => f.type === 'helix');
const hover = async (u, v) => {
  const p = H.toClient(u, v);
  H.ptr('pointermove', p.x, p.y);
  await H.wait(80);
  return H.view();
};
/** The pierce snap item near (u, v) of the sketch being edited. */
const pierceItem = (u, v) => (store.modelSnap ?? []).find((i) => 'pierce' in i && Math.hypot(i.pierce[0] - u, i.pierce[1] - v) < 0.5);

M.run = async () => {
  S.steps = [];
  await S.fresh();
  let circleSketch;
  await step('1 a circle Ø20 at the origin of the top plane; 「螺旋曲線與渦捲線」 4 turns of pitch 5', async () => {
    await H.treeClick('上基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 12);
    await H.tool('圓');
    await H.sk(0, 0);
    await H.sk(9, 0.01, { ctrlKey: true });
    await H.solved();
    const id = [...H.geom()].find(([, g]) => g.type === 'circle')[0];
    await H.dim([id], [12, 6], 20);
    circleSketch = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(circleSketch);
    await H.action('特徵', '螺旋曲線與渦捲線');
    await S.pmType('圈數', '4');
    await H.pmOk();
    await H.settle();
    return { helix: helix()?.name, failed: S.failed(), pass: !!helix() && S.failed().length === 0 };
  });
  let point;
  await step('2 a sketch on the front plane: the point tool is drawn to where the second turn passes through it, (−10, 7.5) — 「貫穿點」', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 10, 10);
    await H.tool('點');
    for (let t = 0; t < 5000 && !pierceItem(-10, 7.5); t += 120) await H.wait(120);
    const item = pierceItem(-10, 7.5);
    if (!item) return { items: (store.modelSnap ?? []).map((i) => Object.keys(i).join('/')), pass: false };
    const v = await hover(item.pierce[0] + 0.05, item.pierce[1] + 0.05);
    const s = v.snap;
    await H.sk(item.pierce[0] + 0.05, item.pierce[1] + 0.05);
    await H.key('Escape');
    await H.solved();
    point = H.sketch().entities.find((e) => e.type === 'point' && e.pierce);
    const at = point && H.geom().get(point.id).p;
    return {
      snap: s && { kind: s.kind, part: s.part }, inference: v.inference, at,
      pass: s?.kind === 'model' && s.part === 'pierce' && v.inference === '貫穿點' && !!point && Math.abs(Math.abs(at[0]) - 10) < 1e-6 && near(at[1], 7.5, 1e-6),
    };
  });
  await step('3 the helix made pitch 6: the point goes with the crossing, to (−10, 9)', async () => {
    const sketchId = H.sketch().id;
    await H.selectTool();
    await H.exitSketch();
    await S.treeEdit(helix().name);
    await S.pmType('螺距', '6');
    await H.pmOk();
    await H.settle();
    const g = state().result.sketchGeometry?.get(sketchId)?.get(point.id);
    return { at: g?.p, failed: S.failed(), pass: !!g && Math.abs(Math.abs(g.p[0]) - 10) < 1e-6 && near(g.p[1], 9, 1e-6) && S.failed().length === 0 };
  });
  return S.result('manual-sketch-pierce-curve');
};
