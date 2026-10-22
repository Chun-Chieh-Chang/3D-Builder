// The nearest and the farthest distance of two circles (ADR 0183, G8b of the 2026-10-19 sketch-reference review): a circle of radius 10 about the origin held by
// 「固定」, a circle of diameter 10 about (30, 40), dimensioned 30 across and 50 from center to center (a 30–40–50 triangle): fully defined. The distance's
// 「圓弧條件」 in the PropertyManager made 「最近」: the value becomes 35 (50 − 10 − 5) and nothing moves; the value changed to 40 and the circle goes to
// y = √(55² − 30²); 「最遠」: the value 70 (55 + 10 + 5), nothing moves; 「圓心」 again: 55. With the circles brought so close that they cross, 「最近」 is
// refused and says why. Replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-condition.js?' + Date.now());   // in a freshly loaded page
//   await __manualSketchCondition.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near } = S;
const M = (window.__manualSketchCondition = {});

const solve = () => store.getState().sketchSolve;
const dims = () => H.sketch().constraints.filter((c) => c.type === 'distance' || c.type === 'distanceX' || c.type === 'distanceY' || c.type === 'diameter');
const distance = () => H.sketch().constraints.find((c) => c.type === 'distance');
const circles = () => [...H.geom()].filter(([, g]) => g.type === 'circle').map(([id]) => id);
const centre = (id) => H.geom().get(id).c;
const CONDITION = '圓弧條件';

M.run = async () => {
  S.steps = [];
  await S.fresh();
  let a;
  let b;
  await step('1 a circle of radius 10 about the origin, held with 「固定」; a circle about (30, 40), 30 across, 50 from center to center: fully defined', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(15, 20, 8);
    await H.tool('圓');
    await H.sk(0, 0, { ctrlKey: true });
    await H.sk(10, 0, { ctrlKey: true });
    await H.sk(30, 40, { ctrlKey: true });
    await H.sk(35, 40, { ctrlKey: true });
    await H.solved();
    [a, b] = circles();
    await H.rel([a], '固定');
    await H.dim([b], [48, 30], 10); // the diameter of the second
    await H.dim([a, b], [15, 50], 30); // above both: across (horizontal)
    await H.dim([a, b], [42, 52], 50); // beyond both: center to center (aligned)
    await H.selectTool();
    const d = distance();
    return { status: solve()?.status, dof: solve()?.dof, dims: dims().map((c) => `${c.type}:${c.value}`), pass: solve()?.status === 'fully' && !!d && d.value === '50' && !d.condition && near(centre(b)[0], 30) && near(centre(b)[1], 40) };
  });
  await step('2 「圓弧條件」 「最近」: the value becomes 35 (50 − 10 − 5), the condition is stored, nothing moves', async () => {
    await S.pmChoose(CONDITION, 'min');
    await H.solved();
    const d = distance();
    return { d: d && { value: d.value, condition: d.condition }, c: centre(b), pass: d?.condition === 'min' && d.value === '35' && near(centre(b)[0], 30) && near(centre(b)[1], 40) && solve()?.status === 'fully' };
  });
  await step('3 the value made 40: the second circle goes to y = √(55² − 30²), 40 from the first at its nearest', async () => {
    store.setDimensionValue(distance().id, '40');
    await H.solved();
    const c = centre(b);
    const want = Math.sqrt(55 * 55 - 30 * 30);
    return { c, want, pass: near(c[0], 30, 1e-6) && Math.abs(c[1] - want) < 1e-6 && Math.abs(Math.hypot(c[0], c[1]) - 15 - 40) < 1e-6 };
  });
  await step('4 「最遠」: the value becomes 70 (55 + 10 + 5), nothing moves; 「圓心」: 55 and the condition is gone', async () => {
    const before = centre(b);
    await S.pmChoose(CONDITION, 'max');
    await H.solved();
    const far = distance();
    const mid = centre(b);
    await S.pmChoose(CONDITION, 'center');
    await H.solved();
    const back = distance();
    return {
      far: far && { value: far.value, condition: far.condition }, back: back && { value: back.value, condition: back.condition },
      pass: far?.condition === 'max' && far.value === '70' && near(mid[0], before[0], 1e-9) && near(mid[1], before[1], 1e-9) && !back?.condition && back?.value === '55' && solve()?.status === 'fully',
    };
  });
  await step('5 the circles brought to cross (across 8, center to center 12): 「最近」 is refused with the reason and the sketch is not changed', async () => {
    const across = H.sketch().constraints.find((c) => c.type === 'distanceX');
    store.setDimensionValue(across.id, '8');
    store.setDimensionValue(distance().id, '12');
    await H.solved();
    const before = JSON.stringify(distance());
    await S.pmChoose(CONDITION, 'min');
    await H.wait(150);
    const after = JSON.stringify(distance());
    return { notice: S.notice(), before, after, pass: S.notice().includes('相交') && before === after && !distance().condition };
  });
  return S.result('manual-sketch-condition');
};
