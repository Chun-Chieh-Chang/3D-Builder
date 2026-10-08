// Manual checklist D6 (docs/manual-verification.html): 「測量」 on a 40 × 30 × 10 block with the cursor (two faces, a face and an edge, two vertices, a third click that starts again, the
// same element again that takes it off), 「物質特性…」 (12000 mm³, carbon steel 94.20 g), 「檢查幾何…」, and the same three in an assembly; replayed the way a person does it in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The kernel has no way to make an open shell here, so the broken part of the checklist is
// tests/phase3/check.test.ts.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-d6.js?' + Date.now());   // in a freshly loaded page
//   await __manualD6.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-measure.js?` + Date.now());
await import(`${root}tests/e2e/phase3-physical.js?` + Date.now());
await import(`${root}tests/e2e/phase3-check.js?` + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualD6 = {});

const field = (name) => document.querySelector(`[data-measure] [data-field="${name}"]`);
const picks = () => state().measure?.picks.length ?? 0;
const settled = async (n) => {
  await H.waitFor(() => state().measure && state().measure.picks.length === n && (state().measure.report || state().measure.error), 8000, `the measurement of ${n}`);
  await H.wait(150);
};
/** A click on the model once the view has settled: the measure window that appears at the right narrows the view, and the click has to be where the model is after that. */
const click = async (P) => {
  store.viewer.resize();
  await H.wait(300);
  await H.at(P);
};
const edgeMid = (edge) => {
  const m = state().result.mesh;
  for (let g = 0; g < m.edgeRanges.length; g += 3) {
    if (m.edgeRanges[g + 2] !== edge) continue;
    const k = m.edgeRanges[g] + Math.floor(m.edgeRanges[g + 1] / 2);
    return [m.edgePoints[k * 3], m.edgePoints[k * 3 + 1], m.edgePoints[k * 3 + 2]];
  }
};

M.run = async () => {
  await step('1 a 40 × 30 × 10 block with 碳鋼: 工具 → 測量', async () => {
    await S.box(40, 30, 10);
    await H.action('工具', '檔案屬性');
    const sel = document.querySelector('.modal .props-material select');
    await S.select(sel, [...sel.options].find((o) => /碳鋼/.test(o.textContent)).value);
    await S.modalButton('關閉');
    await S.iso();
    await H.action('工具', '測量');
    await H.waitFor(() => document.querySelector('[data-measure]'), 5000, 'the measure window');
    return { pass: !!document.querySelector('[data-measure]') && !!state().measure };
  });
  await step('2 two faces clicked (the top, then the bottom from below): 元素1 and 元素2, the shortest distance 10 and an angle of 0', async () => {
    await click(S.planeFace(1, 10).center);
    await settled(1);
    await S.view('bottom');
    await click(S.planeFace(1, 0).center);
    await settled(2);
    await S.iso();
    await shot('2-two-faces');
    return { distance: field('distance')?.textContent, angle: field('angle')?.textContent, panel: document.querySelector('[data-measure]').textContent.slice(0, 160), pass: near(Number(field('distance').textContent), 10, 1e-6) && field('angle') !== null && near(Number(field('angle').textContent), 0, 1e-6) };
  });
  await step('3 a click on a third element starts again; the same element again takes it off', async () => {
    const front = S.planeFace(2, 0);
    await click(front.center);
    await settled(1);
    const restarted = picks() === 1;
    const first = JSON.stringify(state().measure.picks);
    await click(front.center);
    await H.wait(300);
    return { restarted, first, now: JSON.stringify(state().measure.picks), left: picks(), pass: restarted && picks() === 0 };
  });
  await step('4 a face and an edge: the area of the face (1200) and the length of the edge (40)', async () => {
    await click(S.planeFace(1, 10).center);
    await settled(1);
    const area = Number(field('area').textContent);
    const edge = state().result.edgeFingerprints.findIndex((fp) => fp.type === 'line' && Math.abs(fp.size - 40) < 1e-6 && Math.abs(fp.center[1]) < 1e-6);
    await click(edgeMid(edge));
    await settled(2);
    const text = document.querySelector('[data-measure]').textContent;
    await shot('4-face-and-edge');
    return { area, text: text.slice(0, 200), pass: near(area, 1200, 1e-6) && /40/.test(text) };
  });
  await step('5 two vertices: the coordinates, the distance and ΔX／ΔY／ΔZ', async () => {
    await click(edgeMid(0)); // lets go of the earlier two: this starts again with an edge, which the next clicks replace
    await settled(1);
    await click(edgeMid(0));
    await H.wait(200);
    const vs = S.vertices();
    const a = vs[0];
    const b = vs.find((v) => Math.hypot(v[0] - a[0], v[1] - a[1], v[2] - a[2]) > 40);
    await click(a);
    await settled(1);
    const point = field('point')?.textContent;
    await click(b);
    await settled(2);
    const delta = field('delta')?.textContent.split(/\s+/).map(Number);
    const want = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    await shot('5-two-vertices');
    return { point, delta, want, distance: field('distance')?.textContent, pass: near(Number(field('distance').textContent), want, 1e-3) && !!delta && delta.every((v, i) => near(Math.abs(v), Math.abs(b[i] - a[i]), 1e-3)) };
  });
  await step('6 結束 closes it; 物質特性…: 12000 mm³, carbon steel 94.20 g', async () => {
    document.querySelector('[data-measure] .primary').click();
    await H.wait(300);
    await H.action('工具', '物質特性…');
    await H.waitFor(() => document.querySelector('[data-physical]'), 5000, 'the mass properties');
    const text = document.querySelector('[data-physical]').textContent;
    await shot('6-mass-properties');
    const mass = document.querySelector('[data-physical] [data-field="mass"]')?.textContent;
    const inertia = document.querySelector('[data-physical] [data-field="principal"]') !== null;
    [...document.querySelectorAll('.modal button')].find((b) => b.textContent === '取消' || b.textContent === '關閉').click();
    await H.wait(200);
    return { mass, volume: /12000/.test(text), pass: /94\.2/.test(mass ?? '') && /12000/.test(text.replace(/,/g, '')) && inertia };
  });
  await step('7 檢查幾何…: 正常, 共 1 個零件，全部正常', async () => {
    await H.action('工具', '檢查幾何…');
    await H.waitFor(() => state().check?.status === 'done', 15000, 'the check');
    const text = document.querySelector('[data-check]').textContent;
    await shot('7-check');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await H.wait(200);
    return { text: text.slice(0, 160), pass: /正常/.test(text) && /共 1 個零件，全部正常/.test(text) };
  });
  await step('8 in an assembly: 測量 (two parts), 物質特性… (the mass of the parts that have a material, the others named), 檢查幾何… (a row for each part file)', async () => {
    store.newPart();
    if (store.getState().unsaved) await store.answerUnsaved('discard');
    await H.settle();
    const m = await window.__measure.assembly();
    const p = await window.__physical.run();
    const c = await window.__check.assembly();
    return { measure: !!m, mass: p.mass, check: c, pass: !!m && !!p.mass && c.length === 2 };
  });
  return S.result('D6');
};
