// Manual list G3, the last step (a surface is shown from both sides and can be picked from both): a cylinder R10 × 20 with an offset surface of its side by 3
// (an open tube R13) is opened, the solid is hidden, and the tube is looked at from the front side (outside) and from the far end, through the open end, where only
// its inside can be seen. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/manual-g3.js?' + Date.now());
//   await __manualG3.run();

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, circle, extrude, front, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__manualG3 = {});

const SIDE = 'e1:side:s1.c';
const tube = () =>
  build(sketch('s1', front, circle('c', 0, 0, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), { id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: SIDE }], distance: '3' });

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('筒.3dbx', await io.writePartFile(tube()));
  await H.open('筒.3dbx');
  await H.waitFor(() => store.getState().result?.bodies?.length === 2, 20000, 'two bodies');
  const { viewer } = store;
  // the solid's eye in the design tree: hidden, so that only the tube is left
  const row = [...document.querySelectorAll('.tree-row.body')].find((r) => r.textContent.trim().startsWith('e1') || r.textContent.trim() === 'e1');
  H.check(!!row, 'the solid body is in the tree');
  row.querySelector('.vis-toggle').click();
  await H.settle();
  viewer.setView('iso');
  viewer.fitAll();
  await H.wait(600);
  await window.__shot?.('surface-tube-alone-iso');
  // the open end shows the inside of the far wall (it was empty while the material drew front faces only): the body's material draws both sides (three's DoubleSide = 2)
  H.check(viewer.body?.material?.side === 2, `the body draws both sides: ${viewer.body?.material?.side}`);
  console.log('manual-g3: looked at the tube');
  return true;
};

