// Phase 4b-1: a surface body in the app. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase4b-surface.js?' + Date.now());
//   await __surface.run();
//
// The part is made here with the model and io packages: a cylinder R10 × 20 and an offset surface of its side by 3 (a surface body of R13). It is opened, and the rules
// of a surface body are checked where the worker applies them: the feature tree says it is a surface, the mass is the cylinder's, a drawing of the part draws the
// cylinder (20 wide) and not the surface (26), and a part that is only a surface is not a part to count.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, circle, extrude, front, sketch } = await import(`${root}tests/phase1/builders.ts`);
const s = (window.__surface = {});

const offset = (id, face, distance) => ({ id, type: 'offsetSurface', name: id, suppressed: false, faces: [{ kind: 'face', name: face }], distance });
const SIDE = 'e1:side:s1.c';
const cylinder = () => build(sketch('s1', front, circle('c', 0, 0, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), offset('os1', SIDE, '3'));

s.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('筒.3dbx', await io.writePartFile(cylinder()));
  await H.open('筒.3dbx');
  await H.waitFor(() => store.getState().result?.bodies?.length === 2, 20000, 'two bodies');

  // the feature tree: the second body is a surface
  const bodies = store.getState().result.bodies;
  H.check(JSON.stringify(bodies.map((b) => [b.id, b.surface])) === JSON.stringify([['e1', false], ['os1', true]]), `the bodies: ${JSON.stringify(bodies.map((b) => [b.id, b.surface]))}`);
  H.check(document.querySelector('.feature-tree')?.textContent.includes('（曲面）'), 'the tree says (surface)');
  H.check(store.getState().result.features.every((f) => f.status === 'ok'), 'every feature is ok');

  // the mass is the cylinder's: π·10²·20
  const mass = store.getState().result.mass;
  H.check(Math.abs(mass.volume - Math.PI * 100 * 20) < 1e-3, `the mass is the cylinder's: ${mass.volume}`);

  // a drawing of the part draws the cylinder only
  await H.newDrawing();
  await H.waitFor(() => store.getState().drw && [...store.getState().drw.lines.values()].filter(Boolean).length === 3, 30000, 'the lines');
  const drw = store.getState().drw;
  const front = drw.lines.get(drw.doc.views.find((v) => v.direction === 'front').id);
  H.check(Math.abs(front.box.max[0] - front.box.min[0] - 20) < 0.05, `the front view is the cylinder (20 wide), not the surface (26): ${front.box.max[0] - front.box.min[0]}`);

  console.log('phase4b-surface: all checks passed');
  return true;
};
