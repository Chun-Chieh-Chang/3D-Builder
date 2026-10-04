// Phase 7-1: the base flange in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-flange-ui.js?' + Date.now());
//   await __flangeUi.run();
//
// A part with one sketch, the U polyline (0,20) (0,0) (60,0) (60,20), is opened. With the sketch selected, 「鈑金」→「基材凸緣」: a sheet 1.5 thick, radius 1.5, K 0.5, 50 wide
// (T × (the straight pieces + 2·(π/2)(r + T/2)) × 50); the width made 40, the radius 2: 5678.3 mm³, the PropertyManager says the flat length 94.639; K 0.4: 94.168 and the
// folded sheet is the same; the thickness on the other side; a radius too big for the legs is said; accepted, the flange stays in the tree.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__flangeUi = {});

const U = [[0, 20], [0, 0], [60, 0], [60, 20]];
const doc = () =>
  build({
    ...sketch('sk', front),
    entities: [...U.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y })), ...U.slice(1).map((_, i) => ({ id: String.fromCharCode(97 + i), type: 'line', p1: `p${i}`, p2: `p${i + 1}` }))],
  });
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const feature = () => store.getState().doc.features.find((f) => f.type === 'baseFlange');
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-3, `${what}: ${a} (expected ${b})`);
const T = 1.5;
const bent = (r, k = 0.5, outer = true) => {
  const R = r + T;
  const straight = outer ? 2 * (20 - R) + (60 - 2 * R) : 2 * (20 - r) + (60 - 2 * r);
  return { straight, flat: straight + 2 * (Math.PI / 2) * (r + k * T), volume: T * 40 * (straight + 2 * (Math.PI / 2) * (r + T / 2)) };
};

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('鈑金.3dbx', await io.writePartFile(doc()));
  await H.open('鈑金.3dbx');
  await H.waitFor(() => result() && !result().bodies?.length && result().features.every((f) => f.status === 'ok'), 20000, 'the sketch');

  await H.treeClick('sk');
  await H.action('鈑金', '基材凸緣');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the flange session');
  await H.settle();
  const id = store.getState().editing.featureId;
  const status = () => result().features.find((f) => f.id === id);
  H.check(pm().includes('板厚') && pm().includes('折彎半徑') && pm().includes('K 因子'), 'the PropertyManager has the sheet parameters');
  H.check(status().status === 'ok', `made: ${status().message ?? 'ok'}`);
  await H.pmInput('板寬（開放輪廓）', '40');
  await H.pmInput('折彎半徑（內側）', '2');
  near(volume(), bent(2).volume, 'the U channel');
  H.check(/展開長度 94\.639/.test(pm()), `the PropertyManager says the flat length: ${pm().slice(0, 160)}`);

  await H.pmInput('K 因子（0 到 1）', '0.4');
  H.check(/展開長度 94\.168/.test(pm()), 'K 0.4 shortens the flat length');
  near(volume(), bent(2).volume, 'the folded sheet is the same');

  const flip = [...document.querySelectorAll('.property-manager label.checkbox')].find((l) => l.textContent.includes('另一側'));
  flip.querySelector('input').click();
  await H.settle();
  H.check(feature().flipSide === true, 'the thickness flipped');
  near(volume(), bent(2, 0.4, false).volume, 'the path is the inner face now');
  flip.querySelector('input').click();
  await H.settle();

  await H.pmInput('折彎半徑（內側）', '20');
  H.check(status().status === 'error' && /太短/.test(pm()), `a radius too big for the legs is said: ${pm().slice(0, 140)}`);
  await H.pmInput('折彎半徑（內側）', '2');
  H.check(status().status === 'ok', 'back to 2');

  store.commitEdit();
  await H.settle();
  near(volume(), bent(2).volume, 'accepted');
  H.check(document.querySelector('.feature-tree')?.textContent.includes('基材凸緣'), 'the tree has the flange');
  await H.tidy();
  console.log('phase7-flange-ui: all checks passed');
  return true;
};
