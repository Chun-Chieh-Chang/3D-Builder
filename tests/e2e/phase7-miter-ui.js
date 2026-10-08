// The mitre (斜接, v47) in the PropertyManager of an edge flange. Run it in a freshly loaded app page (http://127.0.0.1:5391):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-miter-ui.js?' + Date.now());
//   await __miterUi.run();
//
// A plate 100 × 60 × 1.5 with a 90° flange on the x = 100 edge (40 long) is opened. A second flange on the y = 60 edge, 30 long, mitred against it at its start: the volume is
// the hand formula (plate + the two flanges − what the plane takes from the first + what the second gains = see tests/phase7/miter.test.ts); taken away again it is the open
// corner; a negative gap and a mitre against nothing are said by the tree.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__miterUi = {});

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
  await H.pmInput('起端斜接：兩個凸緣的間隙（空白＝不斜接，0＝貼合）', '0');
  H.check(feature().miter?.start === '0', 'the mitre is in the feature');
  store.commitEdit();
  await H.settle();
  const status = () => result().features.find((f) => f.id === id);
  H.check(status().status === 'ok', `made: ${status().message ?? 'ok'}`);
  const mitred = volume();
  const R = 3.5;
  const rb = 2;
  const H1 = 40 - R;
  const H2 = 30 - R;
  const bend = (w) => (Math.PI / 2) * T * w * (rb + T / 2);
  const annulus = (c) => (c * Math.PI * (R * R - rb * rb)) / 4 - (R ** 3 - rb ** 3) / 3;
  const expected = 100 * 60 * T - R * 60 * T - R * 96.5 * T + bend(60) + T * 60 * H1 + bend(96.5) + T * 96.5 * H2 - (annulus(R) + H1 * (R * T - (R * R - rb * rb) / 2)) + ((R ** 3 - rb ** 3) / 3 + H2 * ((R * R - rb * rb) / 2));
  near(mitred, expected, 'the mitred corner is the hand volume');
  await window.__shot?.('miter-corner');

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  await H.pmInput('起端斜接：兩個凸緣的間隙（空白＝不斜接，0＝貼合）', '');
  store.commitEdit();
  await H.settle();
  H.check(volume() > 0 && Math.abs(volume() - mitred) > 1, 'without the mitre the corner is open and the volume is another');

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  await H.pmInput('末端斜接：兩個凸緣的間隙（空白＝不斜接，0＝貼合）', '0');
  store.commitEdit();
  await H.settle();
  H.check(status().status === 'error' && /斜接/.test(status().message ?? ''), `a mitre against nothing is said: ${status().message}`);

  await H.tidy();
  console.log('phase7-corner-ui: all checks passed');
  return true;
};
