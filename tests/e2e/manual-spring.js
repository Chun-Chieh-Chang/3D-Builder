// Sweep along a helix (ADR 0169): a spring made the way a person makes one in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does
// it) — a circle, a helix on it, a wire profile at the helix's start, 「掃出填料/基材」 with the helix as its path. Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-spring.js?' + Date.now());   // in a freshly loaded page
//   await __manualSpring.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualSpring = {});

const feature = (type) => state().doc.features.find((f) => f.type === type);
const status = (id) => state().result.features.find((r) => r.id === id);
// the wire as drawn: a click is as good as a pixel, so the volume is checked against the circle the sketch actually holds (Pappus: π·r²·2π·x·N)
let wire = null;
const pappus = (turns) => Math.PI * wire.r * wire.r * 2 * Math.PI * wire.x * turns;

M.run = async () => {
  await step('1 a circle Ø20 at the origin of the top plane, and a helix on it: pitch 5, 圈數 4', async () => {
    await S.fresh();
    await H.treeClick('上基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 12);
    await H.tool('圓');
    await H.sk(0, 0);
    await H.sk(9, 0.01);
    await H.solved();
    const c = [...H.geom()].find(([, g]) => g.type === 'circle')[0];
    await H.dim([c], [12, 8], 20);
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(name);
    await H.action('特徵', '螺旋曲線與渦捲線');
    await S.pmType('圈數', '4');
    await H.pmOk();
    return { info: status(feature('helix').id)?.info, failed: S.failed(), pass: S.failed().length === 0 && !!feature('helix') };
  });
  await step('2 on the front plane a circle Ø2 where the helix starts (10, 0)', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(10, 0, 40);
    await H.tool('圓');
    await H.sk(10, 0, { ctrlKey: true });
    await H.sk(10.8, 0.01, { ctrlKey: true });
    await H.solved();
    const [id, g] = [...H.geom()].find(([, x]) => x.type === 'circle');
    await H.dim([id], [12, 2], 2);
    const solved = H.geom().get(id);
    wire = { x: solved.c[0], y: solved.c[1], r: solved.r };
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    wire.sketch = name;
    return { wire, drawn: g, pass: near(wire.r, 1, 1e-9) && Math.abs(wire.x - 10) < 0.5 && Math.abs(wire.y) < 0.5 };
  });
  await step('3 the profile selected, 「掃出填料/基材」: the path list offers the helix and has picked it', async () => {
    await H.treeClick(wire.sketch);
    await H.action('特徵', '掃出填料/基材');
    const sweep = feature('sweep');
    const options = [...S.pm().querySelectorAll('select option')].map((o) => o.textContent);
    await shot('3-path-helix');
    return { path: sweep?.path, options, pass: sweep?.path === feature('helix').id && options.includes(feature('helix').name) };
  });
  await step('4 ✔: a spring of π·r²·2π·x·4 (Pappus with the circle as drawn)', async () => {
    await H.pmOk();
    await S.iso();
    await shot('4-spring');
    return { volume: S.volume(), expected: pappus(4), failed: S.failed(), pass: S.failed().length === 0 && near(S.volume(), pappus(4), 1e-6) };
  });
  await step('5 the helix edited to 3 turns: the spring follows (three quarters)', async () => {
    await S.treeEdit(feature('helix').name);
    await S.pmType('圈數', '3');
    await H.pmOk();
    return { volume: S.volume(), expected: pappus(3), failed: S.failed(), pass: S.failed().length === 0 && near(S.volume(), pappus(3), 1e-6) };
  });
  return S.result('spring');
};
