// Reference geometry in a sketch (ADR 0172, G3 of the 2026-10-19 sketch-reference review): 基準面1, the right plane moved 10, is brought into a sketch on
// the front plane with 「轉換實體引用」 by clicking it in the tree: it is the construction line x = 10 that follows the plane, and when the plane is moved to
// 15 the line goes with it; the sketch's parents in the history now include 基準面1. Replayed the way a person does it in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-datum.js?' + Date.now());   // in a freshly loaded page
//   await __manualSketchDatum.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near } = S;
const M = (window.__manualSketchDatum = {});

M.run = async () => {
  S.steps = [];
  await S.fresh();
  let plane;
  await step('1 基準面1: the right plane moved 10', async () => {
    await H.treeClick('右基準面');
    await H.action('特徵', '基準面');
    await H.pmInput('偏移距離', '10');
    await H.pmOk();
    plane = state().doc.features.find((f) => f.type === 'refPlane');
    return { plane: plane?.name, failed: S.failed(), pass: plane?.name === '基準面1' && S.failed().length === 0 };
  });
  let sketchName;
  let lineId;
  await step('2 a sketch on the front plane, 「轉換實體引用」, 基準面1 clicked in the tree: a construction line at x = 10 that follows it', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(5, 0, 10);
    sketchName = H.sketch().name;
    await H.tool('轉換實體引用');
    await H.treeClick('基準面1');
    await H.waitFor(() => H.sketch().entities.some((e) => e.type === 'line' && e.ref?.kind === 'datum'), 5000, 'the line from 基準面1');
    await H.solved();
    const line = H.sketch().entities.find((e) => e.type === 'line' && e.ref?.kind === 'datum');
    lineId = line.id;
    const g = H.geom().get(line.id);
    return { line, g, pass: line.ref.name === plane.id && line.construction === true && near(Math.abs(g.a[0]), 10, 1e-9) && near(Math.abs(g.b[0]), 10, 1e-9) };
  });
  await step('3 基準面1 moved to 15: the line in the sketch goes to x = 15; the sketch is a child of 基準面1', async () => {
    await H.selectTool();
    await H.exitSketch();
    await S.treeEdit('基準面1');
    await H.pmInput('偏移距離', '15');
    await H.pmOk();
    await H.settle();
    const sketch = state().doc.features.find((f) => f.name === sketchName);
    const g = state().result.sketchGeometry?.get(sketch.id)?.get(lineId);
    const { parentsOf } = await import('/@fs/' + here.replace(/^.*\/@fs\//, '').replace(/tests\/e2e\/$/, '') + 'packages/regen/src/dag.ts');
    const parents = parentsOf(sketch, state().doc);
    return { g, parents, failed: S.failed(), pass: !!g && near(Math.abs(g.a[0]), 15, 1e-9) && near(Math.abs(g.b[0]), 15, 1e-9) && parents.includes(plane.id) && S.failed().length === 0 };
  });
  return S.result('manual-sketch-datum');
};
