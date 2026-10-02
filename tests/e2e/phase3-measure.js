// Phase 3b-5c: the measure tool in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280x720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-measure.js?' + Date.now());
//   await __measure.assembly();   // elements of parts in an assembly, placed by their poses
//   await __measure.part();       // elements of the open part
//
// It builds on phase3-subassembly.js (the fixture of two sub-assemblies in an OPFS project folder). Elements are picked through the store, as the
// viewer's click does; the numbers are checked against the vertices of the parts transformed here by the poses (the kernel's side is in tests/phase3/measure.test.ts).

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const model = await import(`${root}packages/model/src/index.ts`);
const measure = (window.__measure = {});

const field = (name) => document.querySelector(`[data-measure] [data-field="${name}"]`);
const settled = async (picks) => {
  await H.waitFor(() => {
    const m = store.getState().measure;
    return m && m.picks.length === picks && (m.report || m.error);
  }, 8000, 'the measurement');
  await H.wait(100);
  return store.getState().measure;
};
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
const vertexOf = (leaf, i) => {
  const build = store.assembly.buildOfLeaf(leaf);
  const p = [build.vertexPoints[3 * i], build.vertexPoints[3 * i + 1], build.vertexPoints[3 * i + 2]];
  return model.transformPoint(leaf.pose, p);
};

measure.assembly = async () => {
  await __sub.open();
  await H.action('組合件', '測量');
  await H.waitFor(() => document.querySelector('[data-measure]'), 5000, 'the measure window');
  H.check(store.getState().measure !== null, 'measuring is on');
  const leaves = store.assembly.leaves().filter((l) => store.assembly.buildOfLeaf(l)?.vertexPoints.length > 6);
  H.check(leaves.length >= 2, `leaves with vertices: ${leaves.length}`);
  const [a, b] = [leaves[0], leaves[leaves.length - 1]];
  H.check(a.id !== b.id, 'two different components');
  // one vertex: its place in the assembly is the part's vertex put through the pose
  store.measurePick('vertex', 0, a.id);
  let m = await settled(1);
  H.check(!m.error, `no error: ${m.error}`);
  const pa = vertexOf(a, 0);
  const shown = field('point').textContent.split(/\s+/).map(Number);
  H.check(shown.every((v, i) => near(v, pa[i], 1e-3)), `vertex of ${a.id}: ${shown} against ${pa}`);
  // two vertices of two components: the distance between them
  const last = store.assembly.buildOfLeaf(b).vertexPoints.length / 3 - 1;
  store.measurePick('vertex', last, b.id);
  m = await settled(2);
  const pb = vertexOf(b, last);
  const want = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
  H.check(near(Number(field('distance').textContent), want, 1e-3), `distance ${field('distance').textContent} against ${want}`);
  const delta = field('delta')?.textContent.split(/\s+/).map(Number);
  H.check(want < 1e-6 || (delta && delta.every((v, i) => near(v, pb[i] - pa[i], 1e-3))), `delta ${delta}`);
  H.check(field('angle') === null, 'no angle between two vertices');
  H.check(JSON.stringify(m.picks.map((p) => p.leaf)) === JSON.stringify([a.id, b.id]), 'the picks name their components');
  // a face of a part: it is a plane or a cylinder, with an area
  const faceBuild = store.assembly.buildOfLeaf(a);
  const planar = faceBuild.faceGeometry.findIndex((g) => g?.kind === 'plane');
  H.check(planar >= 0, 'the part has a planar face');
  store.measurePick('face', planar, a.id);
  m = await settled(1); // a third pick starts again
  H.check(m.report.elements[0].kind === 'face' && m.report.elements[0].area > 0, `a face: ${JSON.stringify(m.report.elements[0])}`);
  H.check(field('area') && Number(field('area').textContent) > 0, 'its area is shown');
  // the direction is the plane's normal turned by the pose
  const g = faceBuild.faceGeometry[planar];
  const n0 = model.transformPoint({ position: [0, 0, 0], rotation: a.pose.rotation }, g.normal);
  H.check(m.report.elements[0].direction.every((v, i) => near(v, n0[i], 1e-6)) || m.report.elements[0].direction.every((v, i) => near(v, -n0[i], 1e-6)), `its direction: ${m.report.elements[0].direction} against ${n0}`);
  // a cylinder: its radius is the part's (the mate geometry says it)
  const cyl = faceBuild.faceGeometry.findIndex((g) => g?.kind === 'cylinder');
  if (cyl >= 0) {
    store.clearMeasure();
    store.measurePick('face', cyl, a.id);
    m = await settled(1);
    H.check(near(m.report.elements[0].radius, faceBuild.faceGeometry[cyl].radius, 1e-6), `radius ${m.report.elements[0].radius}`);
    H.check(near(Number(field('diameter').textContent), 2 * faceBuild.faceGeometry[cyl].radius, 1e-3), 'and the diameter');
    store.measurePick('face', planar, a.id);
    m = await settled(2); // the cylinder and the plane of one part
    H.check(m.report.distance !== null && m.report.distance.value >= 0, `a face and a cylinder: ${field('distance').textContent}`);
    store.clearMeasure();
    store.measurePick('face', planar, a.id);
    await settled(1);
  }
  // the same element again takes it off
  store.measurePick('face', planar, a.id);
  await H.wait(200);
  H.check(store.getState().measure.picks.length === 0, 'the same element again takes it off');
  // nothing else can run meanwhile; Esc turns it off
  H.check([...document.querySelectorAll('.tools button')].find((x) => x.textContent === '零件表…')?.disabled === true, 'the parts list is not offered while measuring');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await H.wait(200);
  H.check(store.getState().measure === null, 'Esc turns it off');
  H.check(!document.querySelector('[data-measure]'), 'the window is gone');
  return { want, shown: pa };
};

measure.part = async () => {
  store.newDemo();
  await H.waitFor(() => store.getState().result?.mesh, 15000, 'the demo part');
  await H.action('工具', '測量');
  await H.waitFor(() => document.querySelector('[data-measure]'), 5000, 'the measure window');
  const r = store.getState().result;
  const v = (i) => [r.vertexPoints[3 * i], r.vertexPoints[3 * i + 1], r.vertexPoints[3 * i + 2]];
  const last = r.vertexPoints.length / 3 - 1;
  store.measurePick('vertex', 0, null);
  await settled(1);
  store.measurePick('vertex', last, null);
  await settled(2);
  const want = Math.hypot(...v(last).map((x, i) => x - v(0)[i]));
  H.check(near(Number(field('distance').textContent), want, 1e-3), `distance ${field('distance').textContent} against ${want}`);
  store.measurePick('face', 0, null);
  const m = await settled(1);
  H.check(m.report.elements[0].kind === 'face' && Number(field('area').textContent) > 0, 'a face of the part');
  H.check(store.getState().selectedFace === null, 'measuring does not select');
  document.querySelector('[data-measure] .primary').click();
  await H.wait(200);
  H.check(store.getState().measure === null, '結束 turns it off');
  return { want };
};
