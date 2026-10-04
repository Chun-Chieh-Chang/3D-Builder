// Phase 7-2: the edge flange in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-eflange-ui.js?' + Date.now());
//   await __eflangeUi.run();
//
// A plate 100 × 50 × 1.5 (a base flange, radius 2, K 0.5) is opened. 「鈑金」→「邊線凸緣」, the edge on top of the x = 100 end clicked: a flange 20 long from the outside virtual
// sharp (material inside): the plate cut back 3.5, a bend, a flat piece of 16.5 — and on ✔ the volume is 7500 − 262.5 + 323.98 + 1.5·50·16.5; the PropertyManager of the finished
// feature is opened again and the length made 30 (9548.98), the position bend outside (9811.48), the angle 45°, the length measured from the end of the bend; a length too short for
// the bend is said by the tree; a face clicked is not an edge and changes nothing.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__eflangeUi = {});

const doc = () => build(sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' });
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const feature = () => store.getState().doc.features.find((f) => f.type === 'edgeFlange');
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-2, `${what}: ${a} (expected ${b})`);
const T = 1.5;
const Ro = 3.5;
const bend = (theta) => theta * T * 50 * 2.75;
const edgeRef = () => {
  const r = result();
  const i = r.edgeFingerprints.findIndex((f) => f.type === 'line' && Math.abs(f.center[0] - 100) < 1e-6 && Math.abs(f.center[1] - 25) < 1e-6 && Math.abs(f.center[2] - T) < 1e-6);
  H.check(i >= 0, 'the edge on top of the end is there');
  return { kind: 'edge', name: r.edgeNames[i], fingerprint: r.edgeFingerprints[i] };
};
const select = (label, value) => {
  const row = [...document.querySelectorAll('.property-manager .pm-row')].find((x) => x.querySelector('span')?.textContent === label);
  const el = row.querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('板.3dbx', await io.writePartFile(doc()));
  await H.open('板.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the plate');
  near(volume(), 7500, 'the plate');

  await H.action('鈑金', '邊線凸緣');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the flange session');
  await H.settle();
  const id = store.getState().editing.featureId;
  H.check(pm().includes('凸緣長度') && pm().includes('點選板的一條邊'), `the PropertyManager asks for an edge: ${pm().slice(0, 80)}`);
  await H.pmInput('凸緣長度', '20');

  // a click on a face does nothing; the edge is taken
  store.pick({ kind: 'face', name: result().faceNames[0], fingerprint: result().faceFingerprints[0] });
  await H.settle();
  H.check(!feature().edge.name, 'a face is not an edge');
  store.pick(edgeRef());
  await H.settle();
  H.check(!!feature().edge.name && pm().includes(feature().edge.name), 'the edge is in the selection box');

  store.commitEdit();
  await H.settle();
  near(volume(), 7500 - Ro * 50 * T + bend(Math.PI / 2) + T * 50 * (20 - Ro), 'accepted: 20 long');
  H.check(document.querySelector('.feature-tree')?.textContent.includes('邊線凸緣'), 'the tree has the flange');
  const status = () => result().features.find((f) => f.id === id);
  H.check(/16.500/.test(status().info ?? ""), `the flange says its flat piece: ${status().info}`);

  // open it again
  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing the flange again');
  await H.settle();
  await H.pmInput('凸緣長度', '30');
  store.commitEdit();
  await H.settle();
  near(volume(), 9548.98, 'made 30 long');

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  select('凸緣的位置', 'bendOutside');
  await H.settle();
  store.commitEdit();
  await H.settle();
  near(volume(), 7500 + bend(Math.PI / 2) + T * 50 * (30 - Ro), 'bend outside');

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  select('凸緣的位置', 'materialInside');
  select('長度從哪裡量', 'tangent');
  await H.settle();
  await H.pmInput('折彎角度（空白＝90°）', '45');
  store.commitEdit();
  await H.settle();
  const setback = 0;
  near(volume(), 7500 - Ro * Math.tan(Math.PI / 8) * 50 * T + bend(Math.PI / 4) + T * 50 * 30 + setback, '45°, 30 after the bend');

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  select('長度從哪裡量', 'outer');
  await H.pmInput('凸緣長度', '1');
  store.commitEdit();
  await H.settle();
  H.check(status().status === 'error' && /太短/.test(status().message ?? ''), `a length too short for the bend is said: ${status().message}`);

  await H.tidy();
  console.log('phase7-eflange-ui: all checks passed');
  return true;
};
