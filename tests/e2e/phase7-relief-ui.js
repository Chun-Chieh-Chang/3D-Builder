// Phase 7-4: the insets and the relief of an edge flange in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-relief-ui.js?' + Date.now());
//   await __reliefUi.run();
//
// A plate 100 × 50 × 1.5 (a base flange, radius 2, K 0.5) is opened. 「鈑金」→「邊線凸緣」, the edge on top of the x = 100 end clicked, 30 long; shortened 10 at the start and 5 at
// the end: on ✔ the flange is 35 wide (7500 − 3.5·35·1.5 + the bend + the flat piece); with the relief ticked 22.5 mm³ less; an inset that leaves nothing of the
// edge is said by the tree.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__reliefUi = {});

const doc = () => build(sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' });
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const feature = () => store.getState().doc.features.find((f) => f.type === 'edgeFlange');
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-2, `${what}: ${a} (expected ${b})`);
const T = 1.5;
const Ro = 3.5;
const sized = (w) => 7500 - Ro * w * T + (Math.PI / 2) * T * w * 2.75 + T * w * (30 - Ro);
const edgeRef = () => {
  const r = result();
  const i = r.edgeFingerprints.findIndex((f) => f.type === 'line' && Math.abs(f.center[0] - 100) < 1e-6 && Math.abs(f.center[1] - 25) < 1e-6 && Math.abs(f.center[2] - T) < 1e-6);
  H.check(i >= 0, 'the edge on top of the end is there');
  return { kind: 'edge', name: r.edgeNames[i], fingerprint: r.edgeFingerprints[i] };
};

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('板.3dbx', await io.writePartFile(doc()));
  await H.open('板.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the plate');

  await H.action('鈑金', '邊線凸緣');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the flange session');
  await H.settle();
  const id = store.getState().editing.featureId;
  H.check(pm().includes('起端縮短') && pm().includes('末端縮短'), 'the PropertyManager has the insets');
  store.pick(edgeRef());
  await H.settle();
  await H.pmInput('凸緣長度', '30');
  await H.pmInput('起端縮短', '10');
  await H.pmInput('末端縮短', '5');
  H.check(feature().inset?.start === '10' && feature().inset?.end === '5', 'the insets are in the feature');
  store.commitEdit();
  await H.settle();
  near(volume(), sized(35), 'accepted: 35 wide');
  const status = () => result().features.find((f) => f.id === id);
  H.check(/縮短 10／5/.test(status().info ?? ''), `the flange says its insets: ${status().info}`);

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  const box = [...document.querySelectorAll('.property-manager label.checkbox')].find((l) => l.textContent.includes('縮短處的離隙'));
  box.querySelector('input').click();
  await H.settle();
  H.check(pm().includes('離隙寬度') && !!feature().relief, 'the relief is ticked and has its sizes');
  store.commitEdit();
  await H.settle();
  near(volume(), sized(35) - 2 * 1.5 * (Ro + 1.5) * T, 'with the relief');

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  await H.pmInput('起端縮短', '30');
  await H.pmInput('末端縮短', '25');
  store.commitEdit();
  await H.settle();
  H.check(status().status === 'error' && /縮短/.test(status().message ?? ''), `insets that leave nothing are said: ${status().message}`);

  await H.tidy();
  console.log('phase7-relief-ui: all checks passed');
  return true;
};
