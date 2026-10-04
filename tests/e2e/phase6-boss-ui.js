// Phase 6-6: the screw boss in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase6-boss-ui.js?' + Date.now());
//   await __bossUi.run();
//
// A box 60 × 40 × 30 shelled 2 (15552 mm³) with a sketch of one free point on the inside of its floor is opened. With the sketch selected, 「特徵」→「螺柱」: a column Ø6, Ø2.5
// pilot hole, 10 high (+233.656 mm³); made 12 high; the hole 8 deep; 2° of draft; ribs added (three, then four) and taken away; the PropertyManager says what is wrong when
// the hole is wider than the column; accepted, the boss stays in the tree.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__bossUi = {});

const FLOOR = 'sh1:shell:e:cap:start';
const doc = () =>
  build(
    sketch('s', front, rectangle('r', -30, -20, 60, 40)),
    extrude('e', 's', 'boss', { type: 'blind', depth: '30' }),
    { id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: [{ kind: 'face', name: 'e:cap:end' }], thickness: '2' },
    { ...sketch('sk', { kind: 'face', name: FLOOR }), entities: [{ id: 'p1', type: 'point', x: 15, y: 10 }] },
  );
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const feature = () => store.getState().doc.features.find((f) => f.type === 'screwBoss');
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-3, `${what}: ${a} (expected ${b})`);
const R = 3;
const rh = 1.25;
const column = (height, depth, top = R) => (Math.PI * height * (R * R + R * top + top * top)) / 3 - Math.PI * rh * rh * depth;
const SHELLED = 15552;

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('殼.3dbx', await io.writePartFile(doc()));
  await H.open('殼.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the shell and its sketch');
  H.check(result().faceNames.includes(FLOOR), `the inside of the floor is there: ${result().faceNames.length} faces`);
  near(volume(), SHELLED, 'the shell');

  await H.treeClick('sk');
  await H.action('特徵', '螺柱');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the boss session');
  await H.settle();
  const id = store.getState().editing.featureId;
  const status = () => result().features.find((f) => f.id === id);
  H.check(pm().includes('外徑') && pm().includes('孔徑'), 'the PropertyManager has the sizes');
  H.check(status().status === 'ok', `made: ${status().message ?? 'ok'}`);
  near(volume(), SHELLED + column(10, 10), 'a column Ø6, Ø2.5 pilot hole, 10 high');

  await H.pmInput('高度', '12');
  near(volume(), SHELLED + column(12, 12), '12 high');
  await H.pmInput('孔深（空白＝到底）', '8');
  near(volume(), SHELLED + column(12, 8), 'the hole 8 deep');
  await H.pmInput('外壁拔模（空白＝沒有）', '2');
  near(volume(), SHELLED + column(12, 8, R - 12 * Math.tan((2 * Math.PI) / 180)), '2° of draft');
  await H.pmInput('外壁拔模（空白＝沒有）', '');
  near(volume(), SHELLED + column(12, 8), 'draft taken away again (empty)');

  // ribs
  document.querySelector('.property-manager [data-field="add-ribs"]').click();
  await H.settle();
  H.check(feature().ribs?.count === '3' && pm().includes('肋厚'), 'the ribs are added with their sizes in the PropertyManager');
  const three = volume();
  H.check(three > SHELLED + column(12, 8) + 5, `three ribs add volume: ${three}`);
  await H.pmInput('數量', '4');
  H.check(volume() > three + 1 && result().faceNames.filter((n) => n.includes('.rib3.')).length > 0, 'a fourth rib makes more');
  [...document.querySelectorAll('.property-manager button')].find((b) => b.textContent === '去掉肋').click();
  await H.settle();
  H.check(!feature().ribs, 'the ribs are taken away');
  near(volume(), SHELLED + column(12, 8), 'without ribs again');

  // a hole as wide as the column is said
  await H.pmInput('孔徑（先導孔）', '6');
  H.check(status().status === 'error' && /孔徑/.test(pm()), `a hole as wide as the column is said: ${pm().slice(0, 120)}`);
  await H.pmInput('孔徑（先導孔）', '2.5');
  H.check(status().status === 'ok', 'back to 2.5');

  store.commitEdit();
  await H.settle();
  near(volume(), SHELLED + column(12, 8), 'accepted');
  H.check(document.querySelector('.feature-tree')?.textContent.includes('螺柱'), 'the tree has the boss');
  console.log('phase6-boss-ui: all checks passed');
  return true;
};
