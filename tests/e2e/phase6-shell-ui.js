// Phase 6-4: walls of another thickness in the shell's PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase6-shell-ui.js?' + Date.now());
//   await __shellUi.run();
//
// A box 60 × 40 × 30 is opened and shelled 2, open at the top (薄殼 with the top face selected): 15552 mm³. Then, in the same PropertyManager: 「壁厚不同的面」 picked, the
// floor picked in the view and its wall made 4: 19584 mm³; the top face (taken away) is refused; the floor picked again is taken off the list; a wall of 40, which does not
// fit, is an error in the message box with the reason; accepted, the shell stays with its floor of 4.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__shellUi = {});

const doc = () => build(sketch('s', front, rectangle('r', -30, -20, 60, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' }));
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const shellFeature = () => store.getState().doc.features.find((f) => f.type === 'shell');
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-3, `${what}: ${a} (expected ${b})`);
const setWall = async (value) => {
  const input = document.querySelector('.property-manager [data-field="walls"] input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(30);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.settle();
};

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('盒.3dbx', await io.writePartFile(doc()));
  await H.open('盒.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the box');

  // the top face selected, then 薄殼
  const faces = result().faceNames;
  const top = faces.indexOf('e:cap:end');
  H.check(top >= 0, `the top face: ${faces}`);
  store.selectFace({ kind: 'face', name: 'e:cap:end', fingerprint: result().faceFingerprints[top] });
  await H.action('特徵', '薄殼');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the shell session');
  await H.settle();
  const id = store.getState().editing.featureId;
  H.check(shellFeature().faces[0].name === 'e:cap:end', 'the top face is the one taken away');
  H.check(pm().includes('壁厚不同的面'), 'the PropertyManager has the walls of another thickness');

  // the floor, with the walls mode
  document.querySelector('.property-manager [data-field="pick-walls"]').click();
  await H.wait(100);
  H.check(store.getState().shellPick === 'thickness', 'the walls mode is on');
  store.pick({ kind: 'face', name: 'e:cap:start' });
  await H.settle();
  H.check(shellFeature().faceThickness?.length === 1 && shellFeature().faceThickness[0].face.name === 'e:cap:start' && shellFeature().faceThickness[0].thickness === '2', 'the floor is on the list, with the thickness of the rest');
  H.check(/e:cap:start/.test(document.querySelector('.property-manager [data-field="walls"]')?.textContent ?? ''), 'and the PropertyManager lists it');
  await setWall('4');
  H.check(shellFeature().faceThickness[0].thickness === '4', 'its wall is 4');

  // the face taken away cannot have a wall of its own
  store.pick({ kind: 'face', name: 'e:cap:end' });
  await H.settle();
  H.check(shellFeature().faceThickness.length === 1, 'the top face is refused');
  // (while a shell is edited the view is of the model before it, as for the other features: the result is there once it is accepted)
  store.commitEdit();
  await H.settle();
  near(volume(), 19584, 'accepted: the floor 4 thick');
  H.check(result().features.find((f) => f.id === id).status === 'ok', 'the shell is ok');
  await window.__shot?.('shell-thicker-floor');

  // a wall that does not fit is an error, with the reason, on the feature
  store.beginEdit(id);
  await H.settle();
  await setWall('40');
  store.commitEdit();
  await H.settle();
  const failed = result().features.find((f) => f.id === id);
  H.check(failed.status === 'error' && /個別壁厚/.test(failed.message) && /放不進/.test(failed.message), `a wall of 40 does not fit, and the feature says so: ${failed.message}`);
  store.beginEdit(id);
  await H.settle();
  await setWall('4');
  store.commitEdit();
  await H.settle();
  near(volume(), 19584, 'back to 4');

  // the floor picked again is taken off the list
  store.beginEdit(id);
  await H.settle();
  store.pick({ kind: 'face', name: 'e:cap:start' });
  await H.settle();
  H.check(!shellFeature().faceThickness, 'picked again, the floor is off the list');
  store.commitEdit();
  await H.settle();
  near(volume(), 72000 - 56 * 36 * 28, 'the walls all 2 again');
  await H.tidy();
  console.log('phase6-shell-ui: all checks passed');
  return true;
};
