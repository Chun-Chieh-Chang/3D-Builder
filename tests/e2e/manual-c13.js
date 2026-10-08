// Manual checklist C13 (docs/manual-verification.html): 「肋材」: one line on the right plane above a 40 × 30 × 10 plate, dimensioned 16 long and 25 from the origin, a wall of
// 4 grown down to the plate (12960 mm³), the three places of the thickness, 「反轉方向」 and its message; replayed the way a person does it in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c13.js?' + Date.now());   // in a freshly loaded page
//   await __manualC13.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC13 = {});

const PLATE = 40 * 30 * 10;
const RIB = (t) => PLATE + t * 16 * 15;
/** The x range of what stands above the plate (the vertices higher than its top face). */
const ribX = () => {
  const xs = S.vertices().filter((p) => p[1] > 10 + 1e-6).map((p) => p[0]);
  return xs.length ? [Math.min(...xs), Math.max(...xs)].map((x) => Math.round(x * 1e6) / 1e6) : null;
};

M.run = async () => {
  let line;
  await step('1 a 40 × 30 plate, centred on the origin, 10 thick', async () => {
    await S.box(40, 30, 10, { center: true });
    return { volume: S.volume(), pass: near(S.volume(), PLATE) };
  });
  await step('2 on the right plane a horizontal line above the plate, 16 long, 25 from the origin', async () => {
    await H.treeClick('右基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 20, 8);
    await H.tool('直線');
    await H.sk(-8, 25);
    await H.sk(8, 25);
    await H.key('Escape');
    await H.solved();
    const id = [...H.geom()].find(([, g]) => g.type === 'line')[0];
    await H.dim([id], [0, 32], 16);
    await H.dim([id, '@origin'], [14, 12], 25);
    const g = H.geom().get(id);
    line = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    return { a: g.a, b: g.b, pass: Math.abs(Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) - 16) < 1e-6 && Math.abs(g.a[1] - 25) < 1e-6 && Math.abs(g.b[1] - 25) < 1e-6 };
  });
  await step('3 the sketch selected, 「肋材」: a wall grows from the line down to the plate', async () => {
    await H.treeClick(line);
    await H.action('特徵', '肋材');
    await S.iso();
    return { volume: S.volume(), panel: S.pmText().slice(0, 60), pass: /肋材/.test(S.pmText()) && near(S.volume(), RIB(4)) };
  });
  await step('4 肋材厚度 4; the places 兩側, 草圖法向的一側 and 草圖法向的另一側 put the wall on different sides, the volume stays 12960', async () => {
    await S.pmType('肋材厚度', '4');
    const side = S.pmRow('厚度的位置').querySelector('select');
    const seen = {};
    for (const o of [...side.options]) {
      await S.select(S.pmRow('厚度的位置').querySelector('select'), o.value);
      seen[o.textContent] = { x: ribX(), volume: S.volume() };
      await shot(`4-side-${o.value}`);
    }
    const xs = Object.values(seen).map((v) => v.x.join(','));
    return {
      seen,
      pass: Object.values(seen).length === 3 && Object.values(seen).every((v) => near(v.volume, RIB(4))) && seen['兩側（以草圖面為中心）'].x.join() === '-2,2' && new Set(xs).size === 3 && xs.includes('0,4') && xs.includes('-4,0'),
    };
  });
  await step('5 反轉方向: the rib goes up, away from the plate, and the panel says to turn it back; unchecked it is well again; ✔', async () => {
    await S.select(S.pmRow('厚度的位置').querySelector('select'), 'mid');
    await S.pmCheck('反轉方向', true);
    const message = document.querySelector('.property-manager .pm-message')?.textContent ?? '';
    await shot('5-reversed-message');
    await S.pmCheck('反轉方向', false);
    const back = S.volume();
    await H.pmOk();
    return { message, back, pass: /肋材往這個方向碰不到本體/.test(message) && /反轉方向/.test(message) && near(back, RIB(4)) && S.failed().length === 0 };
  });
  return S.result('C13');
};
