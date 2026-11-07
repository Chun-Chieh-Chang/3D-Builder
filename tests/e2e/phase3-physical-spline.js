// The mass properties dialog on a closed spline (ADR 0241), in the page: the volume and mass at once, the centre and inertia after the worker has integrated them, and the
// fast figures with a note when it cannot. The figures themselves are checked against the section in tests/phase3/mass-spline.test.ts; here it is the wiring, in a real worker.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-physical-spline.js?' + Date.now());
//   await __physicalSpline.run();
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(root + 'tests/e2e/phase2-assembly.js?' + Date.now());
const H = window.__ui2;
const { store } = H;
const M = await import(root + 'packages/model/src/index.ts');
const IO = await import(root + 'packages/io/src/index.ts');

const field = (name) => document.querySelector(`[data-physical] [data-field="${name}"]`);
const must = (ok, text) => {
  if (!ok) throw new Error(text);
};
const close = () => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === '取消').click();
const shownCenter = () => field('center').textContent.split(/\s+/).map(Number);
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

/** A closed spline through 12 points well off round, and away from it a disc of its own: two bodies, the second one to be suppressed while the dialog is open. */
function part() {
  const radii = [28, 12, 25, 9, 30, 14, 22, 8, 27, 16, 19, 11];
  const points = radii.map((r, i) => ({ id: `p${i}`, type: 'point', x: r * Math.cos((2 * Math.PI * i) / 12), y: r * Math.sin((2 * Math.PI * i) / 12) }));
  let doc = M.createEmptyPart();
  const add = (feature) => {
    doc = M.applyCommand(doc, { type: 'insertFeature', index: doc.features.length, feature });
  };
  add({ id: 's', name: 'spline', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [...points, { id: 'sp', type: 'spline', points: points.map((p) => p.id), closed: true }], constraints: [] });
  add({ id: 'e', name: 'spline body', type: 'extrude', suppressed: false, sketch: 's', op: 'boss', dir1: { type: 'blind', depth: '10' } });
  add({ id: 's2', name: 'disc', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [{ id: 'c', type: 'point', x: 100, y: 0 }, { id: 'circle', type: 'circle', center: 'c', radius: 10 }], constraints: [] });
  add({ id: 'e2', name: 'disc body', type: 'extrude', suppressed: false, sketch: 's2', op: 'boss', dir1: { type: 'blind', depth: '10' } });
  return M.applyCommand(doc, { type: 'setMaterial', material: { name: 'steel', density: 7.85 } });
}

window.__physicalSpline = {
  run: async () => {
    H.ready();
    await H.project({});
    await H.writeAt('spline.3dbx', await IO.writePartFile(part()));
    await H.open('spline.3dbx');
    await H.waitFor(() => store.getState().result?.mass, 30000, 'the part');
    must(store.getState().result.bodies.length === 2, `two bodies: ${store.getState().result.bodies.length}`);
    const real = store.exactMass;

    // held back: what is known at once is shown, what is not says so
    let release;
    store.exactMass = (key) => new Promise((resolve) => (release = () => resolve(real.call(store, key))));
    await H.action('工具', '物質特性…');
    await H.waitFor(() => field('center'), 5000, 'the dialog');
    const volumeAtOnce = Number(field('volume').textContent);
    must(volumeAtOnce > 0, `the volume at once: ${field('volume').textContent}`);
    must(/g$/.test(field('mass').textContent.trim()), `the mass at once: ${field('mass').textContent}`);
    must(field('center').textContent === '計算中…', `the centre is on its way: ${field('center').textContent}`);
    must(!field('inertia') && !field('principal'), 'no inertia yet');

    // let through: the exact figures, from the real worker, are what is shown
    release();
    await H.waitFor(() => field('principal'), 30000, 'the exact figures');
    store.exactMass = real;
    const fast = store.getState().result.mass;
    const exact = await store.exactMass(null);
    must(near(shownCenter(), exact.center, 1e-3), `the exact centre is shown: ${field('center').textContent} against ${exact.center}`);
    must(Math.hypot(exact.center[0] - fast.center[0], exact.center[1] - fast.center[1]) > 1e-3, `the exact centre differs from the fixed rule's here, or this proves nothing: ${exact.center} against ${fast.center}`);
    must(exact.volume === fast.volume, `the volume is the same on both paths: ${exact.volume} against ${fast.volume}`);

    // the result changes under the open dialog: the figures of the old one do not stay
    const twoBodies = shownCenter();
    must(store.execute({ type: 'setSuppressed', featureIds: ['e2'], value: true }), 'suppressing the disc');
    await H.waitFor(() => store.getState().result.bodies.length === 1 && field('principal') && !near(shownCenter(), twoBodies, 1), 30000, 'the figures of the new result');
    const one = await store.exactMass(null);
    must(near(shownCenter(), one.center, 1e-3), `the new centre: ${field('center').textContent} against ${one.center}`);
    close();
    await H.wait(100);

    // it fails: the fast figures, and a note that says so
    store.exactMass = () => Promise.reject(new Error('probe'));
    await H.action('工具', '物質特性…');
    await H.waitFor(() => field('principal'), 5000, 'the fast figures');
    store.exactMass = real;
    must(document.querySelector('[data-field="exactFailed"]'), 'the note');
    must(near(shownCenter(), store.getState().result.mass.center, 1e-3), `the fast centre: ${field('center').textContent}`);
    close();
    return { pass: true, exact: one.center, fast: store.getState().result.mass.center };
  },
};
