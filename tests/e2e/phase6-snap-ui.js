// Phase 6-7: the snap hook, its catch window and the vent in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase6-snap-ui.js?' + Date.now());
//   await __snapUi.hook();   // then reload the page, and
//   await __snapUi.wall();   // the window and the vent
//
// A box 60 × 40 × 30 shelled 2 (15552 mm³). `hook`: a sketch of one free point on the inside of the floor; 「特徵」→「卡榫」: a beam 2 × 6 × 15 with a wedge 3 high standing
// out 1.2 (+190.8 mm³); the beam made 12 long; turned 90°; a hook as high as the beam is long is said; accepted, it stays in the tree.
// `wall`: a sketch with one point in the middle of the outside of the wall at x = 30; 「卡榫的窗」: 8 × 4 cut through the wall (−64 mm³); 1 deep (−32); 「排氣口」: five slots
// 10 × 2, 4 apart (−168 more: the middle one lies in the window); three slots; a pitch not above the slot width is said; round ends take less out.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__snapUi = {});

const FLOOR = 'sh1:shell:e:cap:start';
const WALL = 'e:side:s.rl1';
const doc = (...more) =>
  build(
    sketch('s', front, rectangle('r', -30, -20, 60, 40)),
    extrude('e', 's', 'boss', { type: 'blind', depth: '30' }),
    { id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: [{ kind: 'face', name: 'e:cap:end' }], thickness: '2' },
    ...more,
  );
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const feature = (type) => store.getState().doc.features.find((f) => f.type === type);
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-3, `${what}: ${a} (expected ${b})`);
const SHELLED = 15552;

const start = async (name, file, ready) => {
  H.ready();
  await H.project({});
  await H.writeAt(`${name}.3dbx`, await io.writePartFile(file));
  await H.open(`${name}.3dbx`);
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, ready);
  near(volume(), SHELLED, 'the shell');
};

g.hook = async () => {
  await start('卡榫', doc({ ...sketch('sk', { kind: 'face', name: FLOOR }), entities: [{ id: 'p1', type: 'point', x: 15, y: 10 }] }), 'the shell and its sketch');
  await H.treeClick('sk');
  await H.action('特徵', '卡榫');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the hook session');
  await H.settle();
  const id = store.getState().editing.featureId;
  const status = () => result().features.find((f) => f.id === id);
  H.check(pm().includes('榫寬') && pm().includes('鉤高'), 'the PropertyManager has the sizes');
  H.check(status().status === 'ok', `made: ${status().message ?? 'ok'}`);
  near(volume(), SHELLED + 190.8, 'a beam 2 × 6 × 15 with the wedge');
  await H.pmInput('樑長', '12');
  near(volume(), SHELLED + 2 * 6 * 12 + 0.5 * 1.2 * 3 * 6, 'the beam 12 long');
  await H.pmInput('方向角度（空白＝草圖的 x）', '90');
  near(volume(), SHELLED + 2 * 6 * 12 + 0.5 * 1.2 * 3 * 6, 'turned 90°: the same volume');
  H.check(feature('snapHook').angle === '90', 'the angle is in the feature');
  await H.pmInput('鉤高', '12');
  H.check(status().status === 'error' && /鉤高/.test(pm()), `a hook as high as the beam is long is said: ${pm().slice(0, 120)}`);
  await H.pmInput('鉤高', '3');
  H.check(status().status === 'ok', 'back to 3');
  store.commitEdit();
  await H.settle();
  near(volume(), SHELLED + 2 * 6 * 12 + 0.5 * 1.2 * 3 * 6, 'accepted');
  H.check(document.querySelector('.feature-tree')?.textContent.includes('卡榫'), 'the tree has the hook');
  await H.tidy();
  console.log('phase6-snap-ui hook: all checks passed');
  return true;
};

g.wall = async () => {
  await start('排氣', doc({ ...sketch('sk', { kind: 'face', name: WALL }), entities: [{ id: 'p1', type: 'point', x: -15, y: 0 }] }), 'the shell and its sketch');
  H.check(result().faceNames.includes(WALL), `the outside of the wall is there: ${result().faceNames.length} faces`);
  await H.treeClick('sk');
  await H.action('特徵', '卡榫的窗');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the window session');
  await H.settle();
  let id = store.getState().editing.featureId;
  let status = () => result().features.find((f) => f.id === id);
  H.check(pm().includes('切入深度'), 'the PropertyManager has the sizes');
  H.check(status().status === 'ok', `made: ${status().message ?? 'ok'}`);
  near(volume(), SHELLED - 64, 'a window 8 × 4 through the wall');
  await H.pmInput('切入深度', '1');
  near(volume(), SHELLED - 32, 'only 1 deep');
  await H.pmInput('切入深度', '3');
  store.commitEdit();
  await H.settle();
  near(volume(), SHELLED - 64, 'the window accepted');
  H.check(document.querySelector('.feature-tree')?.textContent.includes('卡榫的窗'), 'the tree has the window');

  // the vent, on the same sketch
  await H.treeClick('sk');
  await H.action('特徵', '排氣口');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the vent session');
  await H.settle();
  id = store.getState().editing.featureId;
  status = () => result().features.find((f) => f.id === id);
  H.check(status().status === 'ok', `made: ${status().message ?? 'ok'}`);
  near(volume(), SHELLED - 64 - 168, 'the window and five slots (the middle slot is 8 of its 10 long inside the window: 4 · 40 + 8 more)');
  await H.pmInput('槽數', '3');
  H.check(status().status === 'ok' && result().faceNames.filter((n) => n.startsWith(`${id}:`)).length > 0, 'three slots');
  await H.pmInput('槽距（中心到中心）', '2');
  H.check(status().status === 'error' && /槽距/.test(pm()), `a pitch that is not above the slot width is said: ${pm().slice(0, 120)}`);
  await H.pmInput('槽距（中心到中心）', '4');
  H.check(status().status === 'ok', 'back to 4');
  const before = volume();
  document.querySelector('.property-manager input[type="checkbox"]');
  const round = [...document.querySelectorAll('.property-manager label.checkbox')].find((l) => l.textContent.includes('圓頭'));
  round.querySelector('input').click();
  await H.settle();
  H.check(feature('vent').rounded === true && volume() > before, `round ends take less out: ${before} → ${volume()}`);
  store.commitEdit();
  await H.settle();
  H.check(document.querySelector('.feature-tree')?.textContent.includes('排氣口'), 'the tree has the vent');
  await H.tidy();
  console.log('phase6-snap-ui wall: all checks passed');
  return true;
};
