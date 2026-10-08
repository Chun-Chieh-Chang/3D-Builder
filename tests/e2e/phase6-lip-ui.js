// Phase 6-5: the lip and groove in the PropertyManager. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase6-lip-ui.js?' + Date.now());
//   await __lipUi.run();
//
// A box 60 × 40 × 30 shelled 2, open at the top (the rim 2 wide), is opened. With the rim selected, 「特徵」→「唇與溝槽」: a lip 1 high, 1 wide, 0.5 in from the edge — a ring of
// 192 mm², 192 mm³ on the body (15744); made a groove, the same taken away (15360); made 2 wide it runs into the cavity and the message box says so; a face the lip made
// itself is refused; accepted at 1.2 high the volume is 15552 + 230.4.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__lipUi = {});

const doc = () =>
  build(sketch('s', front, rectangle('r', -30, -20, 60, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' }), {
    id: 'sh1',
    type: 'shell',
    name: 'sh1',
    suppressed: false,
    faces: [{ kind: 'face', name: 'e:cap:end' }],
    thickness: '2',
  });
const result = () => store.getState().result;
const volume = () => result().bodies[0].volume;
const feature = () => store.getState().doc.features.find((f) => f.type === 'lipGroove');
const pm = () => document.querySelector('.property-manager')?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-3, `${what}: ${a} (expected ${b})`);
const input = async (label, value) => {
  const row = [...document.querySelectorAll('.property-manager .pm-row')].find((r) => r.querySelector('span')?.textContent === label);
  const field = row.querySelector('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(30);
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.settle();
};

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('殼.3dbx', await io.writePartFile(doc()));
  await H.open('殼.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the shell');
  near(volume(), 15552, 'the shell');

  // the rim selected
  const rim = result().faceFingerprints.findIndex((f) => f.type === 'plane' && f.dir && f.dir[2] > 0.99 && Math.abs(f.center[2] - 30) < 1e-6);
  H.check(rim >= 0, 'the rim is there');
  const rimName = result().faceNames[rim];
  store.selectFace({ kind: 'face', name: rimName, fingerprint: result().faceFingerprints[rim] });
  await H.action('特徵', '唇與溝槽');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the lip session');
  await H.settle();
  const id = store.getState().editing.featureId;
  H.check(pm().includes('唇與溝槽') && feature().face.name === rimName, 'the PropertyManager opens on the rim');
  const status = () => result().features.find((f) => f.id === id);
  H.check(status().status === 'ok' && /唇：環的面積 192\.00/.test(pm()), `a lip, and what it came to: ${pm().slice(0, 140)}`);
  await window.__shot?.('lip-on-rim');
  near(volume(), 15552 + 192, 'the lip on the body');

  // a groove
  const kind = [...document.querySelectorAll('.property-manager select')].find((s) => [...s.options].some((o) => o.value === 'groove'));
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(kind, 'groove');
  kind.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  near(volume(), 15552 - 192, 'made a groove');

  // a ring too wide for the rim
  await input('環的寬度', '2');
  H.check(status().status === 'error' && /超出/.test(pm()), `2 wide runs into the cavity, and the message box says so: ${pm().slice(0, 140)}`);
  await input('環的寬度', '1');
  H.check(status().status === 'ok', 'back to 1 wide');

  // a lip again, 1.2 high; the face it made itself is refused
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(kind, 'lip');
  kind.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  await input('高度（溝槽：深度）', '1.2');
  near(volume(), 15552 + 192 * 1.2, 'a lip 1.2 high');
  const own = result().faceNames.find((n) => n.startsWith(`${id}:`));
  H.check(!!own, `a face the lip made: ${own}`);
  store.pick({ kind: 'face', name: own, fingerprint: { type: 'plane', size: 1, center: [0, 0, 0], dir: [0, 0, 1] } });
  await H.settle();
  H.check(feature().face.name === rimName, 'the face the feature made is refused: it is still on the rim');

  store.commitEdit();
  await H.settle();
  near(volume(), 15552 + 230.4, 'accepted');
  H.check(document.querySelector('.feature-tree')?.textContent.includes('唇與溝槽'), 'the tree has it');
  await H.tidy();
  console.log('phase6-lip-ui: all checks passed');
  return true;
};
