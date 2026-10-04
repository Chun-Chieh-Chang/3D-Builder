// Phase 8 (hardening) H-2: the golden bracket of the Phase 7 acceptance opened in the app, to be looked at. Run it in a freshly loaded app page:
//
//   await import('/@fs/<checkout>/tests/e2e/phase8-visual.js?' + Date.now());
//   await __visual.open();
//
// It opens the bracket (a plate 120 × 60 × 1.5 with two holes, a 90° flange, a 135° flange, a hem); the screenshots are taken by hand.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, circle, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__visual = {});

const plate = () => [sketch('sk', front, rectangle('r', 0, 0, 120, 60), circle('h1', 40, 20, 2.5), circle('h2', 40, 40, 2.5)), { id: 'bf', type: 'baseFlange', name: '基材凸緣1', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' }];

g.open = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('plate.3dbx', await io.writePartFile(build(...plate())));
  await H.open('plate.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the plate');
  const r = store.getState().result;
  const at = (mid) => {
    const i = r.edgeFingerprints.findIndex((f) => f.type === 'line' && Math.hypot(f.center[0] - mid[0], f.center[1] - mid[1], f.center[2] - mid[2]) < 1e-6);
    return { kind: 'edge', name: r.edgeNames[i], fingerprint: r.edgeFingerprints[i] };
  };
  const a = at([120, 30, 1.5]);
  const b = at([60, 60, 1.5]);
  const hem = at([60, 0, 1.5]);
  const full = build(
    ...plate(),
    { id: 'fa', type: 'edgeFlange', name: '90° 凸緣', suppressed: false, edge: a, length: '40', inset: { start: '10', end: '10' }, relief: { width: '1.5', depth: '1.5' } },
    { id: 'fb', type: 'edgeFlange', name: '135° 凸緣', suppressed: false, edge: b, length: '25', angle: '135deg', inset: { start: '8', end: '0' }, relief: { width: '1.5', depth: '1.5' } },
    { id: 'hm', type: 'hem', name: '摺邊', suppressed: false, edge: hem, length: '7', gap: '1' },
  );
  store.cancelEdit?.();
  await H.tidy();
  await H.writeAt('bracket.3dbx', await io.writePartFile(full));
  await H.open('bracket.3dbx');
  await H.waitFor(() => store.getState().result?.features?.every((f) => f.status === 'ok') && store.getState().result.bodies.length === 1, 20000, 'the bracket');
  return store.getState().result.bodies[0].volume;
};
