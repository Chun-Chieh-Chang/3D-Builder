// Phase 4b-4: the surface-editing features in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase4b-surface-edit-ui.js?' + Date.now());
//   await __surfaceEditUi.run();
//
// A cylinder R10 × 20 (growing to −z), the side of it offset by 3 (a surface body of R13) and a rectangle sketched on a plane beside it are made with the model and io
// packages and opened. Then, by the ribbon and the PropertyManager's own paths: 延伸曲面 past the top circle of the surface, 修剪曲面 to the rectangle, 平坦曲面 over the
// cylinder's top circle, 填補曲面 over the same circle, and 縫織曲面 of the surface bodies — each with its message box and what it measured.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, circle, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__surfaceEditUi = {});

const on = (name) => ({ kind: 'datum', name });
const doc = () =>
  build(
    sketch('s1', front, circle('c', 0, 0, 10)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '20', reverse: true }),
    { id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: 'e1:side:s1.c' }], distance: '3' },
    { id: 'rpl', type: 'refPlane', name: 'rpl', suppressed: false, def: { mode: 'offset', plane: on('plane:right'), distance: '40' } },
    sketch('s2', on('rpl'), rectangle('r', 5, 2, 10, 10)),
  );
const text = (sel) => document.querySelector(sel)?.textContent ?? '';
const result = () => store.getState().result;
const pm = () => text('.property-manager');
/** The edge of a body (its names start with `{body:`) that is a circle of radius r at height z, by its fingerprint. */
const circleEdge = (body, z, r) => {
  const res = result();
  const i = res.edgeNames.findIndex((n, k) => n.startsWith(`{${body}:`) && Math.abs(res.edgeFingerprints[k].center[2] - z) < 1e-6 && Math.abs(Math.hypot(res.edgeFingerprints[k].center[0], res.edgeFingerprints[k].center[1]) - r) < 0.05);
  return i < 0 ? null : { kind: 'edge', name: res.edgeNames[i] };
};
const status = (id) => result().features.find((f) => f.id === id);
const open = async (label) => {
  await H.action('特徵', label);
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, `the ${label} session`);
  await H.settle();
};
const accept = async () => {
  store.commitEdit();
  await H.settle();
};

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('面.3dbx', await io.writePartFile(doc()));
  await H.open('面.3dbx');
  await H.waitFor(() => result()?.features?.length === 5 && result().features.every((f) => f.status === 'ok'), 20000, 'the part');
  H.check(result().bodies.length === 2 && result().bodies[1].surface, 'a cylinder and a surface body');
  const side = result().faceNames.find((n) => n.startsWith('os1:offset:e1:side'));
  H.check(!!side, `the surface's side face: ${side}`);

  // 延伸曲面: past the top circle of the surface, by 5
  await open('延伸曲面');
  H.check(pm().includes('延伸曲面'), 'the PropertyManager says 延伸曲面');
  const top = circleEdge('os1', 0, 13);
  H.check(!!top, `the surface's top circle: ${top?.name}`);
  store.pick(top);
  await H.settle();
  H.check(status(store.getState().editing.featureId).status === 'ok', `extended: ${status(store.getState().editing.featureId).message ?? 'ok'}`);
  const extendId = store.getState().editing.featureId;
  const longer = (await (async () => result().mesh)()).positions;
  let zMax = -1e9;
  for (let i = 2; i < longer.length; i += 3) zMax = Math.max(zMax, longer[i]);
  H.check(zMax > 4.9, `the mesh reaches past z = 0 by the 5 asked: z up to ${zMax.toFixed(2)}`);
  await H.pmInput('延伸距離', '8');
  H.check(status(extendId).status === 'ok', 'the distance can be changed');
  await accept();

  // 修剪曲面: to the rectangle, which is projected away from the surface until the direction is reversed
  await H.treeClick('s2');
  await open('修剪曲面');
  H.check(pm().includes('修剪曲面'), 'the PropertyManager says 修剪曲面');
  store.pick({ kind: 'face', name: side });
  await H.settle();
  const trimId = store.getState().editing.featureId;
  H.check(/投影不到/.test(pm()), `projected the wrong way says so: ${pm().slice(0, 120)}`);
  [...document.querySelectorAll('.property-manager label.checkbox')].find((l) => l.textContent.includes('反轉')).querySelector('input').click();
  await H.settle();
  H.check(status(trimId).status === 'ok', `trimmed: ${status(trimId).message ?? 'ok'}`);
  H.check(result().faceNames.some((n) => /:side:s2\.rl0$/.test(n) && n.startsWith(trimId)), `the kept face is named after the sketch: ${result().faceNames}`);
  await accept();

  // 平坦曲面: a disc over the top circle of the cylinder
  await open('平坦曲面');
  store.pick(circleEdge('e1', 0, 10));
  await H.settle();
  const flatId = store.getState().editing.featureId;
  H.check(status(flatId).status === 'ok', `flat: ${status(flatId).message ?? 'ok'}`);
  await accept();
  H.check(result().bodies.length === 3 && result().bodies[2].surface, 'the disc is a surface body of its own');

  // 填補曲面: over the same circle, which has two faces beside it: tangent has none to follow and says it only touches; touching only says the same plainly
  await open('填補曲面');
  store.pick(circleEdge('e1', 0, 10));
  await H.settle();
  const fillId = store.getState().editing.featureId;
  H.check(status(fillId).status === 'ok' && /只接觸/.test(pm()) && /離邊線最遠/.test(pm()), `it fills and says how far, and that it only touches: ${pm().slice(0, 200)}`);
  const select = [...document.querySelectorAll('.property-manager select')].find((s) => [...s.options].some((o) => o.value === 'contact'));
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'contact');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  H.check(status(fillId).status === 'ok' && /填補（只接觸）/.test(pm()), `touching only: ${pm().slice(0, 120)}`);
  await accept();

  // 縫織曲面: the disc and the trimmed surface (they do not meet): the PropertyManager lists the surface bodies and says what is left open
  await open('縫織曲面');
  H.check(document.querySelectorAll('.property-manager input[type=checkbox]').length >= 3, 'the surface bodies are listed');
  const boxes = [...document.querySelectorAll('.property-manager label.checkbox')].filter((l) => /os1|fl|fi|平坦|填補/.test(l.textContent) && !l.textContent.includes('實體'));
  H.check(boxes.length >= 2, `bodies to tick: ${boxes.map((b) => b.textContent)}`);
  boxes[0].querySelector('input').click();
  await H.settle();
  boxes[1].querySelector('input').click();
  await H.settle();
  const knitId = store.getState().editing.featureId;
  H.check(status(knitId).status === 'ok' && /自由邊/.test(pm()), `knit says what is left open: ${pm().slice(0, 200)}`);
  await accept();
  console.log('phase4b-surface-edit-ui: all checks passed');
  return true;
};
