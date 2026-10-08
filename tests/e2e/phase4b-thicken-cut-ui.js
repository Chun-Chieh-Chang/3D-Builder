// Phase 4b-5: thicken and cut with surface in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase4b-thicken-cut-ui.js?' + Date.now());
//   await __thickenCutUi.block();   (then reload the page)
//   await __thickenCutUi.cylinder();
//
// First a block 40 × 30 × 20 with the surface of its top offset 8 down: 延伸曲面 makes the surface larger than the block (past its four edges), then 以曲面除料 cuts the
// block along it (the volume is read from what the worker sent), reversed it cuts the other side. Then a cylinder R10 × 20 with its side offset 3 (a surface of R13):
// 厚面 makes it a solid wall of 2 (the volume is π(15² − 13²)·20) and says how far the solid reaches from the surface.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, circle, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__thickenCutUi = {});

const offset = (face, distance) => ({ id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: face }], distance });
const block = () => build(sketch('s1', front, rectangle('r', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), offset('e1:cap:end', '-8'));
const cylinder = () => build(sketch('s1', front, circle('c', 0, 0, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), offset('e1:side:s1.c', '3'));
const text = (sel) => document.querySelector(sel)?.textContent ?? '';
const result = () => store.getState().result;
const pm = () => text('.property-manager');
const status = (id) => result().features.find((f) => f.id === id);
const volumeOf = (id) => result().bodies.find((b) => b.id === id).volume;
const open = async (label) => {
  await H.action('特徵', label);
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, `the ${label} session`);
  await H.settle();
};
const accept = async () => {
  store.commitEdit();
  await H.settle();
};
const near = (a, b, tol, what) => H.check(Math.abs(a - b) < tol, `${what}: ${a} (expected ${b})`);

/** Run each part in a freshly loaded page: opening a file asks first when the one open has changed. */
g.block = async () => {
  H.ready();
  await H.project({});

  // ---- the block, cut along a surface
  await H.writeAt('塊.3dbx', await io.writePartFile(block()));
  await H.open('塊.3dbx');
  await H.waitFor(() => result()?.features?.length === 3 && result().features.every((f) => f.status === 'ok'), 20000, 'the block');
  await open('延伸曲面');
  for (const name of result().edgeNames.filter((n) => n.startsWith('{os1:'))) store.pick({ kind: 'edge', name });
  await H.settle();
  const extendId = store.getState().editing.featureId;
  H.check(status(extendId).status === 'ok', `extended on four edges: ${status(extendId).message ?? 'ok'}`);
  await H.pmInput('延伸距離', '10');
  await accept();

  await open('以曲面除料');
  H.check(pm().includes('以曲面除料'), 'the PropertyManager says 以曲面除料');
  const cutId = store.getState().editing.featureId;
  const cutFeature = () => store.getState().doc.features.find((f) => f.id === cutId);
  H.check(cutFeature().target.name === 'e1' && cutFeature().surface.name === 'os1', `it starts with the solid and the surface: ${JSON.stringify([cutFeature().target.name, cutFeature().surface.name])}`);
  H.check(status(cutId).status === 'ok', `cut: ${status(cutId).message ?? 'ok'}`);
  near(volumeOf('e1'), 40 * 30 * 12, 1e-3, 'the part above the surface goes');
  [...document.querySelectorAll('.property-manager label.checkbox')].find((l) => l.textContent.includes('反轉')).querySelector('input').click();
  await H.settle();
  near(volumeOf('e1'), 40 * 30 * 8, 1e-3, 'reversed, the part below goes');
  [...document.querySelectorAll('.property-manager label.checkbox')].find((l) => l.textContent.includes('反轉')).querySelector('input').click();
  await H.settle();
  // a face of the surface picked in the graphics area is the surface; a face of the solid is the solid (the same ones here, so they stay)
  store.pick({ kind: 'face', name: result().faceNames.find((n) => n.startsWith('os1:')) });
  await H.settle();
  H.check(cutFeature().surface.name === 'os1' && cutFeature().target.name === 'e1', 'picking a face of the surface keeps the surface');
  await accept();
  H.check(result().bodies.length === 2 && result().bodies[1].surface, 'the surface is left as it was');
  console.log('phase4b-thicken-cut-ui (block): all checks passed');
  return true;
};

g.cylinder = async () => {
  H.ready();
  await H.project({});

  // ---- the gauge block: the offset thickened
  await H.writeAt('筒.3dbx', await io.writePartFile(cylinder()));
  await H.open('筒.3dbx');
  await H.waitFor(() => result()?.features?.length === 3 && result().features.every((f) => f.status === 'ok'), 20000, 'the cylinder');
  await open('厚面');
  H.check(pm().includes('厚面'), 'the PropertyManager says 厚面');
  const thickenId = store.getState().editing.featureId;
  H.check(status(thickenId).status === 'ok', `thickened: ${status(thickenId).message ?? 'ok'}`);
  H.check(/離曲面最遠/.test(pm()), `it says how far the solid reaches: ${pm().slice(0, 200)}`);
  near(volumeOf('os1'), Math.PI * (225 - 169) * 20, 1e-2, 'the wall of 2 outside the surface');
  H.check(result().bodies.find((b) => b.id === 'os1').surface === false, 'it is a solid body now');
  await window.__shot?.('thickened-solid');
  await H.pmInput('厚度', '-2');
  near(volumeOf('os1'), Math.PI * (169 - 121) * 20, 1e-2, 'negative thickness, the wall inside');
  // both sides: 4 thick in total round the surface R13 is the wall between R11 and R15; kept, the surface is still there and the solid is a body of its own
  await H.pmInput('厚度', '4');
  const box = (label) => [...document.querySelectorAll('.property-manager label.checkbox')].find((l) => l.textContent.includes(label)).querySelector('input');
  box('兩側').click();
  await H.settle();
  H.check(status(thickenId).status === 'ok', `both sides: ${status(thickenId).message ?? 'ok'}`);
  near(volumeOf('os1'), Math.PI * (225 - 121) * 20, 1e-2, 'both sides, 4 in total');
  box('保留曲面').click();
  await H.settle();
  H.check(status(thickenId).status === 'ok', `kept: ${status(thickenId).message ?? 'ok'}`);
  H.check(result().bodies.length === 3 && result().bodies[1].id === 'os1' && result().bodies[1].surface && !result().bodies[2].surface, `the surface stays and the solid is another body: ${JSON.stringify(result().bodies.map((b) => [b.id, b.surface]))}`);
  await window.__shot?.('thicken-keep-surface');
  near(volumeOf(thickenId), Math.PI * (225 - 121) * 20, 1e-2, 'the solid of the kept surface');
  box('保留曲面').click();
  box('兩側').click();
  await H.settle();
  await H.pmInput('厚度', '-2');
  near(volumeOf('os1'), Math.PI * (169 - 121) * 20, 1e-2, 'both options off again: the wall inside');
  await accept();
  H.check(document.querySelector('.feature-tree')?.textContent.includes('厚面'), 'the tree has the thicken');
  console.log('phase4b-thicken-cut-ui (cylinder): all checks passed');
  return true;
};

g.run = async () => (await g.block()) && 'run block, then reload and run cylinder';
