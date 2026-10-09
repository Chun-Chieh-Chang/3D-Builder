// Phase 7: break corner PropertyManager and unfolded trim, exercised through the browser UI.
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-break-corner-ui.js?' + Date.now());
//   await __breakCornerUi.run();

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__breakCornerUi = {});

const doc = () => build(
  sketch('sk', front, rectangle('r', 0, 0, 100, 60)),
  { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' },
);
const result = () => store.getState().result;
const volume = () => result().bodies.find((b) => b.id === 'bf').volume;
const edgeAt = (point, what) => {
  const i = result().edgeFingerprints.findIndex((e) => e.type === 'line' && Math.hypot(e.center[0] - point[0], e.center[1] - point[1], e.center[2] - point[2]) < 1e-6);
  H.check(i >= 0, `${what} exists`);
  return { kind: 'edge', name: result().edgeNames[i], fingerprint: result().edgeFingerprints[i] };
};
const panel = () => document.querySelector('.property-manager');
const feature = () => store.getState().doc.features.find((f) => f.type === 'breakCorner');
const status = () => result().features.find((f) => f.id === feature().id);
const area = () => store.getState().flat?.report?.area;
const flat = async () => {
  await H.action('鈑金', '平板型式');
  await H.waitFor(() => store.getState().flat?.report?.area, 15000, 'the flat pattern');
  const value = area();
  store.stopFlat();
  await H.settle();
  return value;
};
const choose = async (value) => {
  const select = panel().querySelector('[data-field="breakCornerKind"]');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
};
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-2, `${what}: ${a} (expected ${b})`);

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('角落.3dbx', await io.writePartFile(doc()));
  await H.open('角落.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the sheet plate');

  await H.action('鈑金', '邊線凸緣');
  await H.waitFor(() => store.getState().editing?.kind === 'feature', 5000, 'the flange session');
  await H.settle();
  store.pick(edgeAt([100, 30, 1.5], 'the plate edge'));
  await H.pmInput('凸緣長度', '30');
  store.commitEdit();
  await H.waitFor(() => result().features.every((f) => f.status === 'ok') && result().mesh, 15000, 'the flange');
  const plainVolume = volume();
  const plainFlatArea = await flat();
  const corner = edgeAt([99.25, 0, 30], 'the flange free-end corner');

  H.check(store.getState().editing === null && store.getState().flat === null, `idle before break-corner command: ${JSON.stringify({ editing: store.getState().editing, flat: !!store.getState().flat, features: store.getState().doc.features.map((f) => f.type) })}`);
  store.selectElement(corner, false);
  H.check(store.getState().selectedElements.some((r) => r.kind === 'edge' && r.name === corner.name), 'the free-end corner is preselected');
  const sheetTab = [...document.querySelectorAll('.tabs .tab')].find((b) => b.textContent === '鈑金');
  if (sheetTab.getAttribute('aria-expanded') !== 'true') sheetTab.click();
  await H.waitFor(() => document.querySelector('.tabs .tab.active')?.getAttribute('aria-expanded') === 'true', 3000, 'the sheet menu');
  H.btn('斷開角落');
  await H.wait(300);
  H.check(store.getState().editing?.kind === 'feature', `break-corner session opened: ${JSON.stringify({ editing: store.getState().editing, selectedElements: store.getState().selectedElements, featureTypes: store.getState().doc.features.map((f) => f.type) })}`);
  await H.settle();
  await H.pmInput('尺寸', '2');
  H.check(panel().textContent.includes('倒角') && panel().textContent.includes('倒圓'), 'both treatments are offered');
  H.check(feature().corners.length === 1 && feature().kind === 'chamfer', 'the selected external corner and chamfer settings are visible');
  store.commitEdit();
  await H.waitFor(() => status()?.status === 'ok' && result().mesh, 15000, 'the chamfered corner');
  near(plainVolume - volume(), 0.5 * 2 ** 2 * 1.5, 'the chamfer volume');
  near(plainFlatArea - await flat(), 0.5 * 2 ** 2, 'the chamfer flat-pattern area');

  store.beginEdit(feature().id);
  await H.waitFor(() => store.getState().editing?.featureId === feature().id, 5000, 'editing the break corner');
  await H.settle();
  await choose('fillet');
  store.commitEdit();
  await H.waitFor(() => status()?.status === 'ok' && result().mesh, 15000, 'the filleted corner');
  near(plainVolume - volume(), 2 ** 2 * (1 - Math.PI / 4) * 1.5, 'the fillet volume');
  near(plainFlatArea - await flat(), 2 ** 2 * (1 - Math.PI / 4), 'the fillet flat-pattern area');
  H.check(result().features.every((f) => f.status === 'ok'), 'the full feature tree remains valid');
  console.log('phase7-break-corner-ui: chamfer, fillet, and flat-pattern values passed');
  return true;
};
