// S-3: the mid bend in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-midbend-ui.js?' + Date.now());
//   await __midBendUi.run();   (then reload the page)
//   await __midBendUi.hole();
//
// A plate 100 × 50 × 1.5 (a base flange of a rectangle, radius 2, K 0.5) and a sketch with one vertical line at x = 50 are opened. With the sketch selected, 「鈑金」→「中間折彎」: 90°
// bends the plate along the line, the volume the flat plate's 7500 (K 0.5), the PropertyManager says the angle and the allowance 4.320; the right side kept and the other way are the
// same volume; a hole across the line is refused with its reason; accepted, the mid bend stays in the tree.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, circle, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__midBendUi = {});

const line = () => ({
  ...sketch('sm', front),
  entities: [
    { id: 'a', type: 'point', x: 50, y: -5 },
    { id: 'b', type: 'point', x: 50, y: 55 },
    { id: 'l', type: 'line', p1: 'a', p2: 'b' },
  ],
});
const plate = () => [sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' }];
const doc = (...extra) => build(...plate(), ...extra, line());
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const feature = () => store.getState().doc.features.find((f) => f.type === 'midBend');
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-2, `${what}: ${a} (expected ${b})`);
const BA = (Math.PI / 2) * 2.75;
const box = (name) => [...document.querySelectorAll('.property-manager label.checkbox')].find((l) => l.textContent.includes(name)).querySelector('input');

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('折板.3dbx', await io.writePartFile(doc()));
  await H.open('折板.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the plate and the sketch');
  near(volume(), 7500, 'the flat plate');

  await H.treeClick('sm');
  await H.action('鈑金', '中間折彎');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the mid bend session');
  await H.settle();
  const id = store.getState().editing.featureId;
  const status = () => result().features.find((f) => f.id === id);
  H.check(pm().includes('折彎角度') && pm().includes('固定線的右邊'), 'the PropertyManager has the settings');
  H.check(status().status === 'ok', `made: ${status().message ?? 'ok'}`);
  near(volume(), 7500, 'bent 90° the volume is the plate (K 0.5)');
  H.check(new RegExp(`折彎展開長 ${BA.toFixed(3)}`).test(pm()), `the PropertyManager says the allowance: ${pm().slice(0, 200)}`);
  H.check(feature().angle === '90', 'the angle is 90');

  box('固定線的右邊').click();
  await H.settle();
  H.check(feature().flipSide === true && status().status === 'ok', 'the right side kept');
  near(volume(), 7500, 'the other side turns: the same volume');
  box('固定線的右邊').click();
  box('往草圖法向的反方向折').click();
  await H.settle();
  H.check(feature().reverse === true && status().status === 'ok', 'folded the other way');
  near(volume(), 7500, 'folded down: the same volume');
  await H.pmInput('折彎角度', '60');
  H.check(status().status === 'ok', 'at 60°');
  near(volume(), 7500, 'bent 60°: the same volume');
  store.commitEdit();
  await H.settle();
  H.check(document.querySelector('.feature-tree')?.textContent.includes('中間折彎'), 'the tree has the mid bend');

  await H.tidy();
  console.log('phase7-midbend-ui: all checks passed');
  return true;
};

/** In a freshly loaded page: a hole across the line is refused with its reason. */
g.hole = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('孔.3dbx', await io.writePartFile(doc(sketch('sh', front, circle('c', 50, 25, 3)), extrude('ch', 'sh', 'cut', { type: 'blind', depth: '5', reverse: true }))));
  await H.open('孔.3dbx');
  await H.waitFor(() => result()?.features?.length === 5, 20000, 'the plate with a hole');
  await H.treeClick('sm');
  await H.action('鈑金', '中間折彎');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the mid bend session again');
  await H.settle();
  const again = store.getState().editing.featureId;
  const s2 = result().features.find((f) => f.id === again);
  H.check(s2.status === 'error' && /折彎區/.test(s2.message ?? ''), `a hole in the zone is said: ${s2.message}`);
  console.log('phase7-midbend-ui (hole): all checks passed');
  return true;
};
