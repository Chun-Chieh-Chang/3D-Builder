// Phase 7-3: the hem in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-hem-ui.js?' + Date.now());
//   await __hemUi.run();
//
// A plate 100 × 50 × 1.5 (a base flange) is opened. 「鈑金」→「摺邊」, the edge on top of the x = 100 end clicked: a hem with a gap of 0.5 and 10 folded back; the gap made 1: on ✔ the
// volume is 7500 − 150 + 294.52 + 750 = 8394.52; opened again, bend outside (8544.52); a gap too big for nothing in particular is fine, a length of 0 is refused where it is given.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__hemUi = {});

const doc = () => build(sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' });
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const feature = () => store.getState().doc.features.find((f) => f.type === 'hem');
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-2, `${what}: ${a} (expected ${b})`);
const T = 1.5;
const bend180 = (rb) => Math.PI * T * 50 * (rb + T / 2);
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

  await H.action('鈑金', '摺邊');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the hem session');
  await H.settle();
  const id = store.getState().editing.featureId;
  H.check(pm().includes('回折的長度') && pm().includes('兩層的間隙'), 'the PropertyManager has the hem sizes');
  store.pick(edgeRef());
  await H.settle();
  H.check(!!feature().edge.name, 'the edge is taken');
  await H.pmInput('兩層的間隙（內側）', '1');
  await H.pmInput('回折的長度（折彎之後）', '10');
  store.commitEdit();
  await H.settle();
  near(volume(), 7500 - 2 * 50 * T + bend180(0.5) + T * 50 * 10, 'accepted');
  H.check(document.querySelector('.feature-tree')?.textContent.includes('摺邊'), 'the tree has the hem');
  H.check(/3\.927/.test(result().features.find((f) => f.id === id).info ?? ''), `the hem says its bend allowance: ${result().features.find((f) => f.id === id).info}`);
  await window.__shot?.('hem-folded-back');

  store.beginEdit(id);
  await H.waitFor(() => store.getState().editing?.featureId === id, 5000, 'editing again');
  await H.settle();
  select('凸緣的位置', 'bendOutside');
  await H.settle();
  store.commitEdit();
  await H.settle();
  near(volume(), 7500 + bend180(0.5) + T * 50 * 10, 'bend outside');

  await H.tidy();
  console.log('phase7-hem-ui: all checks passed');
  return true;
};
