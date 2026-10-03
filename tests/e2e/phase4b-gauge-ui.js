// Phase 4b-3: the split line and the offset surface in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase4b-gauge-ui.js?' + Date.now());
//   await __gaugeUi.run();
//
// A cone frustum (Ø50 to Ø30, 30 high, growing to −z) and a rectangle sketched on a plane beside it are made with the model and io packages and opened. Then, by the
// ribbon and the PropertyManager's own paths: 分割線 on the cone's side (the region comes out, named after the sketch), then 偏移曲面 on that region (the PropertyManager
// says the gap it measured), and the surface body is there when both are accepted.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, circle, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__gaugeUi = {});

const plane = (id, base, distance, reverse) => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: base, distance: String(distance), ...(reverse ? { reverse: true } : {}) } });
const on = (name) => ({ kind: 'datum', name });
const cone = () =>
  build(
    sketch('s0', front, circle('c0', 0, 0, 25)),
    plane('pl1', front, 30, true),
    sketch('s1', on('pl1'), circle('c1', 0, 0, 15)),
    { id: 'lf1', type: 'loft', name: 'lf1', suppressed: false, sections: ['s0', 's1'], op: 'boss' },
    plane('rpl', on('plane:right'), 40),
    sketch('s2', on('rpl'), rectangle('r', 5, 2, 20, 10)),
  );
const text = (sel) => document.querySelector(sel)?.textContent ?? '';

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('錐.3dbx', await io.writePartFile(cone()));
  await H.open('錐.3dbx');
  await H.waitFor(() => store.getState().result?.features?.length === 6 && store.getState().result.features.every((f) => f.status === 'ok'), 20000, 'the cone');
  const side = store.getState().result.faceNames[0];
  H.check(store.getState().result.faceNames.length === 3, `the cone has three faces: ${store.getState().result.faceNames}`);

  // 分割線: from the ribbon, with the sketch of the rectangle selected; then the face is picked in the graphics area's way
  await H.treeClick('s2');
  await H.action('特徵', '分割線');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the split line session');
  H.check(text('.property-manager').includes('分割線'), 'the PropertyManager says 分割線');
  H.check(text('.property-manager').includes('點選') || text('.property-manager').includes('在圖面中點選一個面'), 'it asks for a face');
  const coneFace = store.getState().result.faceNames.find((n) => store.getState().result.faceNames.length && n.startsWith('lf1:side'));
  H.check(!!coneFace, `the cone's side face: ${coneFace}`);
  store.pick({ kind: 'face', name: coneFace });
  await H.settle();
  // the default direction goes away from the cone: the message box says why, and reversing it makes the regions
  H.check(/投影不到/.test(text('.property-manager')), `projected the wrong way says so: ${text('.property-manager').slice(0, 160)}`);
  const reverse = [...document.querySelectorAll('.property-manager label.checkbox')].find((l) => l.textContent.includes('反轉'));
  reverse.querySelector('input').click();
  await H.settle();
  H.check(!/投影不到/.test(text('.property-manager')), 'reversed, it projects');
  const names = store.getState().result.faceNames;
  const region = names.find((n) => /:side:s2\.rl0/.test(n));
  H.check(!!region && names.length === 4, `the region is a face named after the sketch: ${names}`);
  store.commitEdit();
  await H.settle();

  // 偏移曲面 on the region: the faces of a region are picked, the gap is measured and shown
  await H.action('特徵', '偏移曲面');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the offset session');
  store.pick({ kind: 'face', name: region });
  await H.settle();
  H.check(/量到的間隙/.test(text('.property-manager')), `the PropertyManager shows the gap: ${text('.property-manager').slice(0, 200)}`);
  const m = /最小 ([0-9.]+) mm、最大 ([0-9.]+) mm/.exec(text('.property-manager'));
  H.check(m && Math.abs(Number(m[1]) - 3) < 0.05 && Math.abs(Number(m[2]) - 3) < 0.05, `the gap is 3: ${m?.slice(1)}`);
  // the faces the feature makes are not for it to pick
  const own = store.getState().result.faceNames.find((n) => n.startsWith(store.getState().editing.featureId + ':'));
  if (own) {
    store.pick({ kind: 'face', name: own });
    await H.settle();
    H.check(store.getState().doc.features.find((f) => f.id === store.getState().editing.featureId).faces.length === 1, 'a face of its own result is not taken');
  }
  // a distance that cannot be made is refused with the error
  await H.pmInput('偏移距離', '-40');
  H.check(store.getState().result.features.find((f) => f.id === store.getState().editing.featureId).status === 'error', 'an impossible distance is an error');
  await H.pmInput('偏移距離', '3');
  store.commitEdit();
  await H.settle();

  const bodies = store.getState().result.bodies;
  H.check(bodies.length === 2 && bodies[1].surface === true, `the surface body is there: ${JSON.stringify(bodies.map((b) => [b.id, b.surface]))}`);
  H.check(text('.feature-tree').includes('（曲面）'), 'the tree says surface');
  console.log('phase4b-gauge-ui: all checks passed');
  return true;
};
