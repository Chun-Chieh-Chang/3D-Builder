// Manual checklist C7 (docs/manual-verification.html): 「轉換實體引用」 and 「貫穿」, then the block made wider through 「工具」→「方程式」, then the first
// feature suppressed: replayed the way a person does it, in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c7.js?' + Date.now());   // in a freshly loaded page
//   await __manualC7.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const { H, store, step, state, near, shot } = window.__man;
const M = (window.__manualC7 = {});
const S = window.__man;

M.run = async () => {
  let sketchName;
  let refName;
  let sketchId;
  await step('1 a 40 × 30 × 10 block, the top face picked, a sketch on it', async () => {
    sketchName = await S.box(40, 30, 10);
    await S.iso();
    const top = S.planeFace(1, 10);
    await H.at(top.center);
    const selected = state().selectedFace?.name;
    await H.action('草圖', '草圖');
    refName = H.sketch().name;
    sketchId = H.sketch().id;
    await H.frameSketch(20, 15, 8);
    return { selected, editing: refName, volume: S.volume(), pass: !!selected && near(S.volume(), 12000) && !!refName };
  });
  await step('2 轉換實體引用: the outline of the top face, fixed, fully defined', async () => {
    await H.tool('轉換實體引用');
    const hint = document.querySelector('.pick-hint')?.textContent ?? '';
    await H.at(S.planeFace(1, 10).center);
    await H.solved();
    const lines = H.sketch().entities.filter((e) => e.type === 'line' && e.ref).length;
    const status = state().sketchSolve?.status;
    return { hint, lines, status, pass: /模型的邊線|平面/.test(hint) && lines === 4 && status === 'fully' };
  });
  await step('3 貫穿: a point where a vertical edge passes through the sketch plane', async () => {
    const r = state().result;
    const pts = [];
    for (let i = 0; i < r.vertexPoints.length; i += 3) pts.push([r.vertexPoints[i], r.vertexPoints[i + 1], r.vertexPoints[i + 2]]);
    const [a, b] = (() => {
      for (const p of pts) for (const q of pts) if (Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[2] - q[2]) < 1e-6 && p[1] < q[1] - 1) return [p, q];
      throw new Error('no vertical edge');
    })();
    await S.iso();
    await H.tool('貫穿');
    await H.at([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    await H.solved();
    const pierce = H.sketch().entities.filter((e) => e.type === 'point' && e.pierce).length;
    return { pierce, pass: pierce === 1 };
  });
  await step('4 the width 40 changed to 60 in 工具 → 方程式: the block and the purple outline follow', async () => {
    await H.selectTool();
    await H.exitSketch();
    await H.action('工具', '方程式');
    const row = await H.waitFor(() => [...document.querySelectorAll('.modal .eq-table tr')].find((tr) => tr.querySelector('td.owner')?.textContent === sketchName && tr.querySelectorAll('input')[1]?.value === '40'), 5000, 'the row of the width');
    await S.type(row.querySelectorAll('input')[1], '60');
    await shot('4-equations-dialog');
    await S.modalButton('關閉');
    const volume = S.volume();
    const geometry = state().result.sketchGeometry.get(sketchId);
    const lengths = [...geometry.values()].filter((g) => g.type === 'line').map((g) => Math.round(Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) * 1e6) / 1e6).sort((x, y) => x - y);
    const failed = S.failed();
    await S.treeEdit(refName); // the reference sketch is opened: its outline is as wide as the block now
    await H.wait(300);
    return { volume, lengths, failed, pass: near(volume, 18000) && lengths.join() === '30,30,60,60' && failed.length === 0 };
  });
  // The checklist (before 2026-10-08) said the reference sketch reports an error while 伸長1 is suppressed. It does not: suppressing a feature suppresses what depends on it (B2.6),
  // so the sketch is greyed out with it, and 「恢復抑制（含相依特徵）」 brings both back; a plain 「恢復抑制」 restores the extrusion only.
  await step('5 the first feature suppressed: the reference sketch goes with it (no error); 恢復抑制（含相依特徵） brings both back', async () => {
    await H.selectTool?.();
    document.querySelector('.confirm-corner .pm-ok')?.click();
    await H.settle();
    await S.treeMenu('伸長1', '抑制');
    const failedWhile = S.failed();
    const statuses = state().result.features.map((f) => `${f.id}=${f.status}${f.message ? `(${f.message})` : ''}`);
    await shot('5-suppressed');
    const volumeWhile = S.volume();
    await S.treeMenu('伸長1', '恢復抑制（含相依特徵）');
    const after = state().result.features.map((f) => `${f.id}=${f.status}`);
    await shot('5-restored');
    return {
      statuses,
      after,
      volumeWhile,
      volume: S.volume(),
      pass: statuses.join() === 'sketch1=ok,extrude1=suppressed,sketch2=suppressed' && failedWhile.length === 0 && after.join() === 'sketch1=ok,extrude1=ok,sketch2=ok' && S.failed().length === 0 && near(S.volume(), 18000),
    };
  });
  return S.result('C7');
};
