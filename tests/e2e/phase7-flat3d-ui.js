// The flat pattern shown in the 3D view (ADR 0115). Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-flat3d-ui.js?' + Date.now());
//   await __flat3dUi.run();
//
// A plate 100 × 60 × 1.5 with a 90° flange on the x = 100 edge (40 long) is opened. 「鈑金」→「平板型式」, and the box 「在 3D 視窗顯示展開的狀態」: the 3D view shows the pattern, a plate of the size of
// the window (157.320 wide is the sheet: 100 − 3.5 + 4.320 + 36.5 = 137.320 along x, 60 along y, 1.5 thick), nothing can be picked; unticked, the folded part is back (the flange 36.5 + 3.5 high).

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__flat3dUi = {});

const doc = () =>
  build(sketch('sk', front, rectangle('r', 0, 0, 100, 60)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' }, {
    id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: { kind: 'edge', name: '{bf:cap:end|bf:side:sk.rl1}' }, length: '40' });
const extent = (mesh) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.positions[i + k]); hi[k] = Math.max(hi[k], mesh.positions[i + k]); }
  return hi.map((h, k) => h - lo[k]);
};
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-2, `${what}: ${a} (expected ${b})`);

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('板.3dbx', await io.writePartFile(doc()));
  await H.open('板.3dbx');
  await H.waitFor(() => store.getState().result?.features?.every((f) => f.status === 'ok') && store.getState().result.mesh, 20000, 'the plate with its flange');
  const folded = extent(store.viewer.mesh);
  await H.action('鈑金', '平板型式');
  await H.waitFor(() => store.getState().flat?.status === 'done' && store.getState().flat.mesh, 20000, 'the flat pattern');
  const box = document.querySelector('[data-field="show3d"]');
  H.check(!!box && !box.checked, 'the box is there, not ticked');
  box.click();
  await H.settle();
  const flat = extent(store.viewer.mesh);
  const report = store.getState().flat.report;
  near(flat[0], report.width, 'the 3D view is as long as the pattern');
  near(flat[1], report.height, 'and as wide');
  near(flat[2], 1.5, 'and as thick as the sheet');
  H.check(Math.abs(flat[0] - folded[0]) > 1 || Math.abs(flat[2] - folded[2]) > 1, 'it is not the folded part');
  await window.__shot?.('flat-pattern-in-3d');
  box.click();
  await H.settle();
  const back = extent(store.viewer.mesh);
  near(back[2], folded[2], 'unticked, the folded part is back (as high as it was)');
  await H.tidy();
  console.log('phase7-flat3d-ui: all checks passed');
  return true;
};
