// Hardening H-6: the closed corner in the PropertyManager of an edge flange. Run it in a freshly loaded app page (http://127.0.0.1:5391):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-corner-ui.js?' + Date.now());
//   await __cornerUi.run();
//
// A plate 100 × 60 × 1.5 with a 90° flange on the x = 100 edge is opened. A second flange on the y = 60 edge, 30 long, its bend stopping 0.5 short at the corner and the corner
// closed with a gap of 0.5: the flat piece goes on 2.0 past the bend (79.5 mm³ more than with the corner open); a gap of 3 is said by the tree; a corner against nothing is said.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__cornerUi = {});

const doc = () =>
  build(sketch('sk', front, rectangle('r', 0, 0, 100, 60)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' }, {
    id: 'fa',
    type: 'edgeFlange',
    name: 'fa',
    suppressed: false,
    edge: { kind: 'edge', name: '{bf:cap:end|bf:side:sk.rl1}' },
    length: '40',
  });
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const feature = () => store.getState().doc.features.find((f) => f.id !== 'fa' && f.type === 'edgeFlange');
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-2, `${what}: ${a} (expected ${b})`);
const T = 1.5;

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('板.3dbx', await io.writePartFile(doc()));
  await H.open('板.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the plate with its flange');

  await H.action('鈑金', '邊線凸緣');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the flange session');
  await H.settle();
  const id = store.getState().editing.featureId;
  const r = result();
  const i = r.edgeFingerprints.findIndex((f) => f.type === 'line' && Math.abs(f.center[0] - 48.25) < 1e-6 && Math.abs(f.center[1] - 60) < 1e-6 && Math.abs(f.center[2] - T) < 1e-6);
  H.check(i >= 0, 'the edge on y = 60 is there, 96.5 long');
  store.pick({ kind: 'edge', name: r.edgeNames[i], fingerprint: r.edgeFingerprints[i] });
  await H.settle();
  await H.pmInput('凸緣長度', '30');
  await H.pmInput('起端縮短', '0.5');
  await H.pmInput('起端閉合角落：與鄰接凸緣的間隙（空白＝不閉合）', '0.5');
  H.check(feature().corner?.start === '0.5', 'the corner is in the feature');
  store.commitEdit();
  await H.settle();
  const status = () => result().features.find((f) => f.id === id);
  H.check(status().status === 'ok', `made: ${status().message ?? 'ok'}`);
  const closed = volume();

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  await H.pmInput('起端閉合角落：與鄰接凸緣的間隙（空白＝不閉合）', '');
  store.commitEdit();
  await H.settle();
  near(closed - volume(), 2.0 * (30 - 3.5) * T, 'the closed corner adds the piece of 2.0');

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  await H.pmInput('起端閉合角落：與鄰接凸緣的間隙（空白＝不閉合）', '3');
  store.commitEdit();
  await H.settle();
  H.check(status().status === 'error' && /2\.500/.test(status().message ?? ''), `a gap bigger than the way there is said: ${status().message}`);

  await H.tidy();
  console.log('phase7-corner-ui: all checks passed');
  return true;
};
