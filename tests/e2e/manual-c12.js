// Manual checklist C12 (docs/manual-verification.html): 「疊層拉伸填料/基材」 of two and three sections (10 × 6, 5 × 3, 10 × 6 on planes 0, 10 and 20 from the front plane),
// the sections ordered with 上移／下移, a square to a circle, and 「疊層拉伸除料」, replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720;
// `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c12.js?' + Date.now());   // in a freshly loaded page
//   await __manualC12.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC12 = {});

const buttons = (title) => [...S.pm().querySelectorAll('button')].filter((b) => b.title === title);
const sections = () => [...S.pm().querySelectorAll('.pm-row')].map((r) => r.querySelector('span')?.textContent ?? '').filter((s) => /^\d+\. /.test(s)).map((s) => s.replace(/^\d+\. /, ''));
const offsetPlane = async (from, distance) => {
  await H.treeClick(from);
  await H.action('特徵', '基準面');
  await H.pmInput('偏移距離', String(distance));
  await H.pmOk();
};
const frustum = (h, a1, a2) => (h / 3) * (a1 + Math.sqrt(a1 * a2) + a2);

M.run = async () => {
  let s1;
  let s2;
  let s3;
  await step('1 草圖1: a 10 × 6 centre rectangle on the front plane', async () => {
    await S.fresh();
    s1 = await S.rectSketch('前基準面', 10, 6, { center: true });
    return { s1, pass: s1 === '草圖1' };
  });
  await step('2 基準面1 (10 from the front plane) with 草圖2: 5 × 3; 基準面2 (20) with 草圖3: 10 × 6', async () => {
    await offsetPlane('前基準面', 10);
    s2 = await S.rectSketch('基準面1', 5, 3, { center: true });
    await offsetPlane('前基準面', 20);
    s3 = await S.rectSketch('基準面2', 10, 6, { center: true });
    return { s2, s3, pass: s2 === '草圖2' && s3 === '草圖3' };
  });
  await step('3 草圖2 selected, 「疊層拉伸填料/基材」: the sections are 草圖2 and 草圖3, a frustum of about 350 mm³', async () => {
    await H.treeClick(s2);
    await H.action('特徵', '疊層拉伸填料/基材');
    await S.iso();
    const list = sections();
    return { list, volume: S.volume(), pass: [...list].sort().join() === `${s2},${s3}` && near(S.volume(), frustum(10, 60, 15), 1e-3) && near(S.volume(), 350, 1e-3) };
  });
  await step('4 加入截面… 草圖1, ordered 草圖1, 草圖2, 草圖3 with 上移: thick, thin, thick; between 350 and 1200', async () => {
    const select = S.pm().querySelector('select');
    await S.select(select, state().doc.features.find((f) => f.name === s1).id);
    const added = sections();
    // the new section comes last; ordered with the arrows of each row until the list reads 草圖1, 草圖2, 草圖3
    const move = async (name, title) => {
      const row = [...S.pm().querySelectorAll('.pm-row')].find((r) => (r.querySelector('span')?.textContent ?? '').endsWith(`. ${name}`));
      [...row.querySelectorAll('button')].find((b) => b.title === title).click();
      await H.settle();
    };
    for (const want of [s1, s2, s3]) {
      for (let guard = 0; guard < 4 && sections().indexOf(want) > [s1, s2, s3].indexOf(want); guard++) await move(want, '上移');
    }
    const ordered = sections();
    await shot('4-three-sections');
    return { added, ordered, volume: S.volume(), pass: ordered.join() === `${s1},${s2},${s3}` && S.volume() > 350 && S.volume() < 1200 && S.failed().length === 0 };
  });
  await step('5 ✔: the loft is in the tree', async () => {
    await H.pmOk();
    return { rows: S.treeRows().filter((r) => /疊層/.test(r)), pass: S.treeRows().some((r) => /疊層拉伸/.test(r)) && S.failed().length === 0 };
  });
  await step('6 a square to a circle: a loft of 10 × 10 to Ø10 is between the prism and the cylinder', async () => {
    await S.fresh();
    const a = await S.rectSketch('前基準面', 10, 10, { center: true });
    await offsetPlane('前基準面', 20);
    await H.treeClick('基準面1');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 20);
    await H.tool('圓');
    await H.sk(0, 0);
    await H.sk(5, 0.01);
    await H.solved();
    const c = [...H.geom()].find(([, g]) => g.type === 'circle')[0];
    await H.dim([c], [7, 7], 10);
    const b = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(b);
    await H.action('特徵', '疊層拉伸填料/基材');
    const select = S.pm().querySelector('select');
    await S.select(select, state().doc.features.find((f) => f.name === a).id);
    await S.iso();
    await shot('6-square-to-circle');
    const volume = S.volume();
    await H.pmOk();
    // between a prism of the square (2000) and the cylinder (1570.8), and failing neither
    return { volume, pass: volume > (Math.PI * 25 * 20) && volume < 2000 && S.failed().length === 0 };
  });
  await step('7 疊層拉伸除料: a frustum 10 × 10 to 6 × 6 over 20 taken out of a 40 × 40 × 30 block', async () => {
    await S.fresh();
    const base = await S.rectSketch('前基準面', 40, 40, { center: true });
    await S.extrude(base, 30);
    await offsetPlane('前基準面', 5);
    const a = await S.rectSketch('基準面1', 10, 10, { center: true });
    await offsetPlane('前基準面', 25);
    const b = await S.rectSketch('基準面2', 6, 6, { center: true });
    const block = S.volume();
    await H.treeClick(a);
    await H.action('特徵', '疊層拉伸除料');
    const list = sections();
    await S.iso();
    await shot('7-loft-cut');
    await H.pmOk();
    const removed = frustum(20, 100, 36);
    return { block, list, volume: S.volume(), pass: near(block, 48000) && [...list].sort().join() === [a, b].sort().join() && near(S.volume(), block - removed, 1e-3) && S.failed().length === 0 };
  });
  return S.result('C12');
};
