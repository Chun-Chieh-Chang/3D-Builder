// C1 of the decisions of 2026-10-14 (ADR 0136): while sketching, the model's edges outside the sketch plane are projected onto it and can be snapped to,
// as SolidWorks offers the model around a sketch. On a plane 20 above a block: the cursor is drawn to a corner of the block below, the edge is shown
// dashed, a line started there holds to it through an edge that is construction (no part of a profile), and when the block is made wider the line's
// start goes with the corner. Replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it).
// Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-projected-snap.js?' + Date.now());   // in a freshly loaded page
//   await __manualProjectedSnap.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualProjectedSnap = {});

/** Moves the cursor (no button) to (u, v) of the sketch being edited, and what the sketch then says it found. */
const hover = async (u, v) => {
  const p = H.toClient(u, v);
  H.ptr('pointermove', p.x, p.y);
  await H.wait(80);
  return H.view();
};
const lines = () => H.sketch().entities.filter((e) => e.type === 'line');

M.run = async () => {
  await step('1 做法 A: a 40 × 20 × 10 block on the top plane; 基準面1 30 above the top plane (20 above the block)', async () => {
    await S.box(40, 20, 10);
    await H.treeClick('上基準面');
    await H.action('特徵', '基準面');
    await H.pmInput('偏移距離', '30');
    await H.pmOk();
    const planes = state().doc.features.filter((f) => f.type === 'refPlane');
    return { volume: S.volume(), planes: planes.map((f) => f.name), pass: near(S.volume(), 8000, 1e-6) && planes.length === 1 && planes[0].name === '基準面1' && S.failed().length === 0 };
  });
  await step('2 a sketch on 基準面1: near the corner (40, 20) of the block below, the line tool is drawn to it — 「模型端點」, the edge 20 off the plane, shown dashed', async () => {
    await H.treeClick('基準面1');
    await H.action('草圖', '草圖');
    await H.frameSketch(30, 15, 8);
    await H.tool('直線');
    // what the sketch can snap to comes from the worker a moment after the sketch opens
    let v = await hover(39.6, 19.7);
    for (let t = 0; t < 5000 && v?.snap?.kind !== 'model'; t += 120) v = await hover(39.6, 19.7);
    await shot('2-drawn-to-the-corner-below');
    const s = v.snap;
    return {
      snap: s && { kind: s.kind, part: s.part, p: s.p, off: s.item?.off, ref: s.item?.ref?.name },
      inference: v.inference,
      pass: s?.kind === 'model' && ['start', 'end'].includes(s.part) && near(s.p[0], 40, 1e-9) && near(s.p[1], 20, 1e-9) && near(s.item.off, 20, 1e-9) && v.inference === '模型端點',
    };
  });
  let mine;
  await step('3 a line from that corner to (60, 35): it starts on the projected edge, which is construction and follows the block', async () => {
    await H.sk(39.6, 19.7);
    await H.sk(60, 35);
    await H.key('Escape');
    await H.solved();
    const ref = lines().find((l) => l.ref);
    mine = lines().find((l) => !l.ref);
    const start = H.geom().get(mine?.p1);
    return {
      lines: lines().map((l) => ({ id: l.id, p1: l.p1, p2: l.p2, ref: l.ref?.name ?? null, construction: !!l.construction })),
      start: start?.p,
      // the sketch is still open: the model is shown up to it, so it is not 'ok' yet (step 4 checks the rebuild once it is closed)
      editing: state().result.features.find((f) => f.id === H.sketch().id)?.status,
      pass: lines().length === 2 && !!ref && ref.construction === true && !!mine && !mine.construction && [ref.p1, ref.p2].includes(mine.p1) && near(start.p[0], 40, 1e-6) && near(start.p[1], 20, 1e-6),
    };
  });
  await step('4 the block made 50 wide (草圖1, 40 → 50): the line now starts at (50, 20), over the moved corner', async () => {
    await H.selectTool();
    await H.exitSketch();
    const s1 = state().doc.features.find((f) => f.name === '草圖1');
    const width = s1.constraints.find((c) => c.type === 'distance' && c.value === '40');
    store.execute({ type: 'setDimension', featureId: s1.id, constraintId: width.id, value: '50' });
    await H.settle();
    await S.treeEdit('草圖2');
    await H.solved();
    const start = H.geom().get(mine.p1);
    await shot('4-the-line-follows-the-block');
    await H.selectTool();
    await H.exitSketch();
    return { volume: S.volume(), start: start?.p, pass: near(S.volume(), 10000, 1e-6) && near(start.p[0], 50, 1e-6) && near(start.p[1], 20, 1e-6) && S.failed().length === 0 };
  });
  return S.result('projected-snap');
};
