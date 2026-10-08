// Manual checklist C25 (docs/manual-verification.html): 「圓角」 of the kind 「完整圓角」 on a 40 × 30 × 20 block: the top face as the middle set, the front and the back (the view turned
// to see it) as the two side sets, 20137.17 mm³ with no radius box; the width 30 made 36 in the sketch (radius 18, 23237.52 mm³); and the 40 × 30 × 10 block that is too low (an error),
// replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c25.js?' + Date.now());   // in a freshly loaded page
//   await __manualC25.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC25 = {});

const last = (type) => state().doc.features.filter((f) => f.type === type).at(-1);
const group = async (g, P) => {
  document.querySelector(`[data-group="${g}"] input[type=radio]`).click();
  await H.settle();
  await H.at(P);
  await H.wait(200);
};
const front = (h) => S.faceCentres().find((f) => f.type === 'plane' && f.dir && Math.abs(f.dir[2]) > 0.99 && Math.abs(f.center[2]) < 1e-6 && Math.abs(f.center[1] - h / 2) < 1e-6);
const back = (h) => S.faceCentres().find((f) => f.type === 'plane' && f.dir && Math.abs(f.dir[2]) > 0.99 && Math.abs(f.center[2] + 30) < 1e-6 && Math.abs(f.center[1] - h / 2) < 1e-6);

M.run = async () => {
  let sketch;
  await step('1 a 40 × 30 × 20 block (24000 mm³); 「圓角」 with 完整圓角: three lists, no 半徑 box', async () => {
    sketch = await S.box(40, 30, 20);
    await S.iso();
    await H.action('特徵', '圓角');
    await S.pmChoose('圓角種類', 'full');
    const groups = ['faces', 'center', 'faces2'].map((g) => !!document.querySelector(`[data-group="${g}"]`));
    const radius = !!S.pmRow('半徑');
    await shot('1-three-lists');
    return { groups, radius, pass: groups.every(Boolean) && !radius && near(S.volume(), 24000) };
  });
  await step('2 the top face in 中央面組, the front in 邊側面組 1, the view turned and the back in 邊側面組 2; ✔: a half cylinder of radius 15, 20137.17 mm³', async () => {
    await group('center', S.planeFace(1, 20).center);
    await group('faces', front(20).center);
    await S.view('back');
    await group('faces2', back(20).center);
    const f = last('fillet');
    const picked = [f.faces?.length ?? 0, f.center?.length ?? 0, f.faces2?.length ?? 0];
    await H.pmOk();
    await S.iso();
    await shot('2-half-cylinder');
    const expected = 24000 - 40 * (30 * 15 - (Math.PI * 225) / 2);
    return { picked, volume: S.volume(), expected, cylinder: state().result.faceFingerprints.some((fp) => fp.type === 'cylinder'), pass: picked.join() === '1,1,1' && near(S.volume(), expected, 1e-5) && near(S.volume(), 20137.17, 1e-5) && S.failed().length === 0 };
  });
  await step('3 the width 30 made 36 (the sketch of the block): the radius follows, 18, 23237.52 mm³', async () => {
    await H.action('工具', '方程式');
    const row = await H.waitFor(() => [...document.querySelectorAll('.modal .eq-table tr')].find((tr) => tr.querySelector('td.owner')?.textContent === sketch && tr.querySelectorAll('input')[1]?.value === '30'), 5000, 'the row of the depth 30');
    await S.type(row.querySelectorAll('input')[1], '36');
    await S.modalButton('關閉');
    await S.iso();
    const expected = 36 * 20 * 40 - 40 * (36 * 18 - (Math.PI * 324) / 2);
    const cyl = state().result.faceFingerprints.find((fp) => fp.type === 'cylinder');
    return { volume: S.volume(), expected, radius: cyl?.radius ?? cyl?.size ?? null, pass: near(S.volume(), 23237.52, 1e-5) && S.failed().length === 0 };
  });
  await step('4 (選做) a block 40 × 30 × 10, the same fillet: an error that says the sides cannot be lower than half the width; nothing is cut', async () => {
    await S.box(40, 30, 10);
    await S.iso();
    await H.action('特徵', '圓角');
    await S.pmChoose('圓角種類', 'full');
    await group('center', S.planeFace(1, 10).center);
    await group('faces', front(10).center);
    await S.view('back');
    await group('faces2', back(10).center);
    await H.pmOk();
    const f = last('fillet');
    const r = state().result.features.find((x) => x.id === f.id);
    await S.iso();
    await shot('4-too-low');
    return { status: r?.status, message: r?.message, volume: S.volume(), pass: r?.status === 'error' && /完整圓角做不出來/.test(r.message ?? '') && /不能比寬度的一半矮/.test(r.message ?? '') && near(S.volume(), 12000) };
  });
  return S.result('C25');
};
