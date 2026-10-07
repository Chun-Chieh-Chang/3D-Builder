// P-3: mutual trim of two surface bodies in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase4b-mutual-trim-ui.js?' + Date.now());
//   await __mutualTrimUi.run();
//
// A block 40 × 30 × 20 with two surfaces: the top offset 8 down (the plane z = 12, 40 × 30) and the side at x = 40 offset 15 in (the plane x = 25, 30 × 20). 互相修剪曲面 cuts
// them along x = 25, z = 12: the first is 750 + 450, the second 360 + 240. A click on a piece takes it away (and again takes it back), the list in the panel takes it back too;
// with the 450 and the 240 gone, 縫織曲面 sews what is left into one body of two faces.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__mutualTrimUi = {});

const offset = (id, face, distance) => ({ id, type: 'offsetSurface', name: id, suppressed: false, faces: [{ kind: 'face', name: face }], distance });
const doc = () => build(sketch('s1', front, rectangle('r', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), offset('os1', 'e1:cap:end', '-8'), offset('os2', 'e1:side:s1.rl1', '-15'));
const NAME1 = 'os1:offset:e1:cap:end';
const NAME2 = 'os2:offset:e1:side:s1.rl1';
const result = () => store.getState().result;
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const status = (id) => result().features.find((f) => f.id === id);
const faces = (bodyId) => {
  const b = result().bodies.find((x) => x.id === bodyId);
  return result().faceNames.slice(b.face0, b.face0 + b.faces);
};
const near = (a, b, tol, what) => H.check(Math.abs(a - b) < tol, `${what}: ${a} (expected ${b})`);

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('面.3dbx', await io.writePartFile(doc()));
  await H.open('面.3dbx');
  await H.waitFor(() => result()?.features?.length === 4 && result().features.every((f) => f.status === 'ok'), 20000, 'the block and its two surfaces');

  await H.action('特徵', '互相修剪曲面');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the mutual trim session');
  await H.settle();
  const id = store.getState().editing.featureId;
  const feature = () => store.getState().doc.features.find((f) => f.id === id);
  H.check(pm().includes('互相修剪'), 'the PropertyManager says 互相修剪');
  H.check(feature().a.name === 'os1' && feature().b.name === 'os2', `it starts with the two surfaces: ${JSON.stringify([feature().a.name, feature().b.name])}`);
  H.check(status(id).status === 'ok', `trimmed: ${status(id).message ?? 'ok'}`);
  H.check(/各有 2 片、2 片（去掉了 0 片）/.test(pm()), `it says what it made: ${pm().slice(0, 200)}`);
  H.check(faces('os1').join('|') === `${NAME1}#1|${NAME1}#2`, `the pieces of the first: ${faces('os1')}`);
  H.check(faces('os2').join('|') === `${NAME2}#1|${NAME2}#2`, `the pieces of the second: ${faces('os2')}`);

  // a click on a piece takes it away, again takes it back
  store.pick({ kind: 'face', name: `${NAME1}#2` });
  await H.settle();
  H.check(faces('os1').join('|') === `${NAME1}#1`, `the 450 is gone: ${faces('os1')}`);
  H.check(pm().includes(`${NAME1}#2`) && /去掉了 1 片/.test(pm()), 'the panel lists it and says one is taken away');
  [...document.querySelectorAll('.property-manager .pm-list button')][0].click();
  await H.settle();
  H.check(faces('os1').length === 2, 'taken back from the list');
  store.pick({ kind: 'face', name: `${NAME1}#2` });
  await H.settle();
  store.pick({ kind: 'face', name: `${NAME2}#2` });
  await H.settle();
  H.check(faces('os1').length === 1 && faces('os2').length === 1, `one piece of each is left: ${faces('os1')} ${faces('os2')}`);
  // a face of the block is not a piece of either surface
  store.pick({ kind: 'face', name: 'e1:cap:end' });
  await H.settle();
  H.check(feature().discard.length === 2, 'a face of the block is not taken away');
  store.commitEdit();
  await H.settle();
  H.check(document.querySelector('.feature-tree')?.textContent.includes('互相修剪曲面'), 'the tree has the mutual trim');

  // and the two pieces knitted into one body
  await H.action('特徵', '縫織曲面');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the knit session');
  await H.settle();
  for (const body of ['os1', 'os2']) {
    if (!store.getState().doc.features.find((f) => f.type === 'knit').bodies.some((x) => x.name === body)) store.pick({ kind: 'face', name: faces(body)[0] });
    await H.settle();
  }
  const knit = store.getState().doc.features.find((f) => f.type === 'knit');
  H.check(knit.bodies.length === 2, `both bodies are to be knitted: ${JSON.stringify(knit.bodies)}`);
  store.commitEdit();
  await H.settle();
  H.check(result().bodies.filter((b) => b.surface).length === 1 && faces('os1').length === 2, `one surface body of two faces: ${JSON.stringify(result().bodies.map((b) => [b.id, b.surface, b.faces]))}`);
  console.log('phase4b-mutual-trim-ui: all checks passed');
  return true;
};
