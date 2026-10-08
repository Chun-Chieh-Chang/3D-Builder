// Manual checklist C10 (docs/manual-verification.html): 「異型孔」 on a sketch of three points: a straight hole through all, a counterbore (M6, blind 8), a countersink,
// a tapped hole (M3, M20) with the sizes chosen from the list, replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui`
// does it). Not a Vitest test. Every volume is worked out from the numbers the panel itself shows in the fields.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c10.js?' + Date.now());   // in a freshly loaded page
//   await __manualC10.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC10 = {});

const PLATE = 40 * 30 * 10;
const hole = () => state().doc.features.find((f) => f.type === 'hole');
const kind = async (value) => S.select(S.pm().querySelector('select'), value);
const size = async (value) => S.select(S.pmRow('標準規格').querySelector('select'), value);
const num = (x) => Number(x);
const cyl = (d, h) => (Math.PI * d * d * h) / 4;
/** The solid removed by a countersink: a cone from the diameter `cs` down to the hole's `d` (90°), and the hole below it, to `depth`. */
const sinkVolume = (cs, d, depth, angleDeg = 90) => {
  const h = (cs - d) / 2 / Math.tan((angleDeg / 2) * (Math.PI / 180));
  const R = cs / 2;
  const r = d / 2;
  return (Math.PI * h * (R * R + R * r + r * r)) / 3 + Math.PI * r * r * (depth - h);
};

M.run = async () => {
  await step('1 a 40 × 30 × 10 block and a sketch on its top face with three separate points', async () => {
    await S.box(40, 30, 10);
    await S.iso();
    await H.at(S.planeFace(1, 10).center);
    await H.action('草圖', '草圖');
    await H.frameSketch(20, 15, 10);
    await H.tool('點');
    // far enough apart that the countersinks (Ø12.6) of the M6 size do not cut into one another, and inside the 40 × 30 face
    for (const [u, v] of [[8, 8], [32, 8], [20, 22]]) await H.sk(u, v);
    await H.key('Escape');
    await H.solved();
    const points = H.sketch().entities.filter((e) => e.type === 'point').length;
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await S.iso();
    await H.treeClick(name);
    await H.action('特徵', '異型孔');
    return { points, panel: S.pmText().slice(0, 80), pass: points === 3 && /孔的種類/.test(S.pmText()) && /標準規格/.test(S.pmText()) && /終止型態/.test(S.pmText()) };
  });
  await step('2 直孔 and 完全貫穿: three round holes, the diameter of the 孔徑 field', async () => {
    await kind('straight');
    await S.pmChoose('終止型態', 'throughAll');
    const d = num(hole().diameter);
    await shot('2-straight-holes');
    await H.pmOk();
    return { d, volume: S.volume(), pass: d > 0 && near(S.volume(), PLATE - 3 * cyl(d, 10), 1e-4) && S.failed().length === 0 };
  });
  await step('3 the feature edited: 柱孔 with M6 fills 孔徑, 沉頭直徑 and 沉頭深度 (6.6, 11, 6.5)', async () => {
    await S.treeEdit('異型孔1');
    await kind('counterbore');
    await size('M6');
    const f = hole();
    const fields = { d: num(f.diameter), cb: num(f.cbDiameter), cbDepth: num(f.cbDepth) };
    return { fields, pass: fields.d === 6.6 && fields.cb === 11 && fields.cbDepth === 6.5 };
  });
  await step('4 給定深度 8: wide at the top, narrow below, not to the bottom', async () => {
    await S.pmChoose('終止型態', 'blind');
    await S.pmType('深度', '8');
    const f = hole();
    const one = Math.PI * ((num(f.cbDiameter) / 2) ** 2 * num(f.cbDepth) + (num(f.diameter) / 2) ** 2 * (8 - num(f.cbDepth)));
    await shot('4-counterbore-blind');
    await H.pmOk();
    return { one, volume: S.volume(), pass: near(S.volume(), PLATE - 3 * one, 1e-4) && S.failed().length === 0 };
  });
  await step('5 錐孔: the mouth is a cone', async () => {
    await S.treeEdit('異型孔1');
    await kind('countersink');
    await size('M6');
    const f = hole();
    const one = sinkVolume(num(f.csDiameter), num(f.diameter), 8, 90);
    await shot('5-countersink');
    await H.pmOk();
    return { cs: f.csDiameter, d: f.diameter, one, volume: S.volume(), pass: num(f.csDiameter) > num(f.diameter) && near(S.volume(), PLATE - 3 * one, 1e-4) && S.failed().length === 0 };
  });
  for (const [name, tap] of [['M3', 2.5], ['M20', 17.5]]) {
    await step(`6 螺紋孔（底孔） ${name}: the drill diameter of the size (${tap}), no thread`, async () => {
      await S.treeEdit('異型孔1');
      await kind('tapped');
      await size(name);
      const f = hole();
      const d = num(f.diameter);
      await shot(`6-tapped-${name}`);
      await H.pmOk();
      // three Ø17.5 holes do not fit a 40 × 30 face apart from one another: for M20 the diameter and "no error" are what is checked, not the volume
      const exact = name === 'M20' || near(S.volume(), PLATE - 3 * cyl(d, 8), 1e-4);
      return { d, volume: S.volume(), pass: d === tap && exact && S.volume() < PLATE && S.failed().length === 0 };
    });
  }
  return S.result('C10');
};
