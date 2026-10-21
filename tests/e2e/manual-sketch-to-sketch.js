// A sketch that follows an earlier sketch (ADR 0175, G6 of the 2026-10-19 sketch-reference review): 草圖1 a 40 × 20 rectangle on the front plane;
// 基準面1 20 in front of it; on that plane a second sketch, 「轉換實體引用」 and 草圖1 clicked in the tree: its four sides come in as construction lines
// that follow it; 草圖1 made 55 wide, the second sketch's right side goes to x = 55; the second sketch is a child of 草圖1. Replayed the way a person does
// it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-to-sketch.js?' + Date.now());   // in a freshly loaded page
//   await __manualSketchToSketch.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near } = S;
const M = (window.__manualSketchToSketch = {});

M.run = async () => {
  S.steps = [];
  await S.fresh();
  let first;
  await step('1 草圖1: a 40 × 20 rectangle on the front plane; 基準面1 20 in front of it', async () => {
    first = await S.rectSketch('前基準面', 40, 20);
    await H.treeClick('前基準面');
    await H.action('特徵', '基準面');
    await H.pmInput('偏移距離', '20');
    await H.pmOk();
    return { first, failed: S.failed(), pass: !!first && S.failed().length === 0 && state().doc.features.some((f) => f.type === 'refPlane') };
  });
  let second;
  await step('2 a sketch on 基準面1, 「轉換實體引用」, 草圖1 clicked in the tree: its four sides come in as construction lines that follow it', async () => {
    await H.treeClick('基準面1');
    await H.action('草圖', '草圖');
    await H.frameSketch(20, 10, 10);
    second = H.sketch().id;
    await H.tool('轉換實體引用');
    await H.treeClick(first);
    await H.waitFor(() => H.sketch().entities.filter((e) => e.type === 'line' && e.ref?.kind === 'sketch').length === 4, 5000, 'the four sides of 草圖1');
    await H.solved();
    const lines = H.sketch().entities.filter((e) => e.type === 'line' && e.ref?.kind === 'sketch');
    const xs = lines.flatMap((l) => [H.geom().get(l.id).a[0], H.geom().get(l.id).b[0]]);
    return { lines: lines.map((l) => l.ref.name), construction: lines.every((l) => l.construction), xs, pass: lines.length === 4 && lines.every((l) => l.construction) && near(Math.max(...xs.map(Math.abs)), 40, 1e-9) };
  });
  await step('3 草圖1 made 55 wide: the right side of the second sketch goes to x = 55; the second sketch is a child of 草圖1', async () => {
    await H.selectTool();
    await H.exitSketch();
    await S.treeEdit(first);
    const dim = H.sketch().constraints.find((c) => c.type === 'distance' && c.value === '40');
    const ok = store.setDimensionValue(dim.id, '55');
    await H.solved();
    await H.exitSketch();
    await H.settle();
    const g = state().result.sketchGeometry?.get(second);
    const xs = g ? [...g.values()].flatMap((x) => (x.type === 'line' ? [Math.abs(x.a[0]), Math.abs(x.b[0])] : [])) : [];
    const { parentsOf } = await import('/@fs/' + here.replace(/^.*\/@fs\//, '').replace(/tests\/e2e\/$/, '') + 'packages/regen/src/dag.ts');
    const doc = state().doc;
    const parents = parentsOf(doc.features.find((f) => f.id === second), doc);
    const firstId = doc.features.find((f) => f.name === first)?.id;
    return { ok, xs, parents, failed: S.failed(), pass: ok && near(Math.max(...xs), 55, 1e-9) && parents.includes(firstId) && S.failed().length === 0 };
  });
  return S.result('manual-sketch-to-sketch');
};
