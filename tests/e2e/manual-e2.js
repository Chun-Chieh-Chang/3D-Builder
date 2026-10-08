// Manual checklist E2 (docs/manual-verification.html): 「異型孔」 of the kind 定位銷孔 on a point drawn on the top face of a plate: 標準規格 6, 公差等級 H6, H7 and H8 (the line of the fit changes:
// 6.000 to 6.012 for H7, 6.018 for H8), 完全貫穿 and ✔, the hole where the point was; replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui`
// does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-e2.js?' + Date.now());   // in a freshly loaded page
//   await __manualE2.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualE2 = {});

const hints = () => [...S.pm().querySelectorAll('.hint')].map((h) => h.textContent).join(' | ');
const kind = async (value) => S.select(S.pm().querySelector('select'), value);

M.run = async () => {
  let point;
  await step('1 a plate 40 × 30 × 10, a sketch on its top face with one point away from the edge', async () => {
    await S.box(40, 30, 10);
    await S.iso();
    await H.at(S.planeFace(1, 10).center);
    await H.action('草圖', '草圖');
    await H.frameSketch(20, 15, 10);
    await H.tool('點');
    await H.sk(12, 9);
    await H.key('Escape');
    await H.solved();
    const name = H.sketch().name;
    point = H.geom().get(H.pointAt(12, 9)).p;
    await H.selectTool();
    await H.exitSketch();
    await S.iso();
    await H.treeClick(name);
    await H.action('特徵', '異型孔');
    return { point, pass: Math.abs(point[0] - 12) < 1e-6 && /孔的種類/.test(S.pmText()) };
  });
  await step('2 孔的種類 = 定位銷孔: 標準規格, 公差等級, 入口導角 and a line of the fit', async () => {
    await kind('dowel');
    const text = S.pmText();
    return { hint: hints().slice(0, 160), pass: /標準規格/.test(text) && /公差等級/.test(text) && /入口導角/.test(text) && /孔 H7/.test(hints()) };
  });
  await step('3 標準規格 6; 公差等級 H6, H7, H8: the limits of the hole and of the pin that goes with it change', async () => {
    await S.select(S.pmRow('標準規格').querySelector('select'), '6');
    const read = async (fit) => {
      await S.select(S.pmRow('公差等級').querySelector('select'), fit);
      return hints().match(/孔 H\d：([\d.]+) 到 ([\d.]+) mm/)?.slice(1).map(Number);
    };
    const h6 = await read('H6');
    const h7 = await read('H7');
    const h8 = await read('H8');
    await S.select(S.pmRow('公差等級').querySelector('select'), 'H7');
    await shot('3-fit-line');
    return { h6, h7, h8, pass: !!h6 && !!h7 && !!h8 && h7[0] === 6 && h7[1] === 6.012 && h8[1] === 6.018 && h6[1] > 6 && h6[1] < 6.012 };
  });
  await step('4 完全貫穿 and ✔: a hole through the plate at the point, made at the nominal diameter', async () => {
    await S.pmChoose('終止型態', 'throughAll');
    await H.pmOk();
    await S.iso();
    await shot('4-dowel-hole');
    const f = state().doc.features.find((x) => x.type === 'hole');
    const c = Number(f.chamfer ?? 0);
    const R = 3;
    const removed = Math.PI * R * R * 10 + (Math.PI * c * ((R + c) ** 2 + (R + c) * R + R ** 2)) / 3 - Math.PI * R * R * c;
    const wall = state().result.faceNames.find((n) => /:side:.*\.wall$/.test(n) && n.startsWith(f.id));
    return { kind: f.kind, fit: f.fit, diameter: f.diameter, chamfer: f.chamfer, volume: S.volume(), removed, wall, pass: f.kind === 'dowel' && f.diameter === '6' && f.fit === 'H7' && near(S.volume(), 12000 - removed, 1e-6) && S.failed().length === 0 };
  });
  return S.result('E2');
};
