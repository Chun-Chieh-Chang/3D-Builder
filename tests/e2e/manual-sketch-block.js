// 「固定」 of whole lines, circles and arcs (ADR 0182, G8a of the 2026-10-19 sketch-reference review): a line from (5, 5) to (25, 15) and a circle of radius 5
// about (40, 10), drawn with Ctrl held so no snap or inferred relation touches them: 7 freedoms. Both selected, 「固定」 holds each of them in one step (two
// relations, nothing left free, nothing moved); one undo takes both; the line held alone, then both selected: only the circle is added, and for the line
// alone 「固定」 is no longer offered. Replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it).
// Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-block.js?' + Date.now());   // in a freshly loaded page
//   await __manualSketchBlock.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step } = S;
const M = (window.__manualSketchBlock = {});

const solve = () => store.getState().sketchSolve;
const blocks = () => H.sketch().constraints.filter((c) => c.type === 'block');
const ids = () => {
  const geom = [...H.geom()];
  return { line: geom.find(([, g]) => g.type === 'line')[0], circle: geom.find(([, g]) => g.type === 'circle')[0] };
};
/** What is selected, and the labels of the relation buttons the PropertyManager offers for it. */
const offered = async (list) => {
  await H.selectTool();
  for (let i = 0; i < list.length; i++) {
    const [u, v] = H.onEntity(list[i]);
    await H.sk(u, v, i > 0 ? { ctrlKey: true } : {});
  }
  await H.wait(80);
  const labels = [...document.querySelectorAll('.relation-buttons button')].map((b) => b.textContent);
  await H.key('Escape');
  return labels;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
/** Ctrl+key, as the keyboard sends it (the helper of the assembly script is not in this page's set). */
const ctrl = async (key) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
  await H.wait(120);
};

M.run = async () => {
  S.steps = [];
  await S.fresh();
  let line;
  let circle;
  await step('1 a line (5, 5) to (25, 15) and a circle of radius 5 about (40, 10), drawn with Ctrl held: 7 freedoms, no relation', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(22, 10, 12);
    await H.tool('直線');
    await H.sk(5, 5, { ctrlKey: true });
    await H.sk(25, 15, { ctrlKey: true });
    await H.key('Escape');
    await H.tool('圓');
    await H.sk(40, 10, { ctrlKey: true });
    await H.sk(45, 10, { ctrlKey: true });
    await H.solved();
    ({ line, circle } = ids());
    const g = H.geom();
    return { dof: solve()?.dof, relations: H.sketch().constraints.length, pass: solve()?.dof === 7 && H.sketch().constraints.length === 0 && near(g.get(circle).r, 5, 1e-6) };
  });
  await step('2 both selected, 「固定」: one relation for each, in one step; fully defined, and nothing moved', async () => {
    const before = H.geom();
    const [lineBefore, circleBefore] = [before.get(line), before.get(circle)];
    await H.rel([line, circle], '固定');
    const g = H.geom();
    const [l, c] = [g.get(line), g.get(circle)];
    const held = blocks().map((b) => b.entity).sort();
    return {
      held, status: solve()?.status, dof: solve()?.dof,
      pass:
        held.length === 2 && held[0] === [line, circle].sort()[0] && held[1] === [line, circle].sort()[1] && solve()?.status === 'fully' && solve()?.dof === 0 &&
        near(l.a[0], lineBefore.a[0]) && near(l.b[1], lineBefore.b[1]) && near(c.c[0], circleBefore.c[0]) && near(c.r, circleBefore.r),
    };
  });
  await step('3 one undo takes both relations (they were one step), the sketch is where it was', async () => {
    await ctrl('z');
    await H.solved();
    const g = H.geom();
    return { held: blocks().length, dof: solve()?.dof, pass: blocks().length === 0 && solve()?.dof === 7 && near(g.get(circle).c[0], 40) && near(g.get(line).a[1], 5) };
  });
  await step('4 the line held alone, then both selected: only the circle is added; for the line alone 「固定」 is no longer offered, for the circle it still is', async () => {
    await H.rel([line], '固定');
    const afterLine = blocks().map((b) => b.entity);
    await H.rel([line, circle], '固定');
    const afterBoth = blocks().map((b) => b.entity).sort();
    const forLine = await offered([line]);
    const forCircle = await offered([circle]);
    return {
      afterLine, afterBoth, forLine, forCircle,
      pass: afterLine.length === 1 && afterLine[0] === line && afterBoth.length === 2 && !forLine.includes('固定') && !forCircle.includes('固定') && solve()?.status === 'fully',
    };
  });
  return S.result('manual-sketch-block');
};
