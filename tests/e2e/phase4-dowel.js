// Phase 4a-3 (C4.8): the dowel pin hole through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test; the store is driven with
// the commands the panels send, and the PropertyManager of the hole is used for the dowel settings.
//
//   await import('/@fs/<checkout>/tests/e2e/phase4-dowel.js?' + Date.now());
//   await __dowel.run();
//
// A 40 × 30 plate centred on the origin, 10 thick; a sketch on its top face with a point; a straight Ø6 hole, which is made a dowel pin hole (H7, chamfer 0.5)
// from the hole's PropertyManager; the fit limits are shown next to it.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const d = (window.__dowel = {});

const pm = () => document.querySelector('.property-manager');
const field = (label) => [...pm().querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent === label);
const choose = async (label, value) => {
  const sel = field(label).querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
};
const volume = () => store.getState().result.mass.volume;
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

d.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  const rect = (id, x, y, w, h) => {
    const p = [`${id}1`, `${id}2`, `${id}3`, `${id}4`];
    return {
      entities: [
        ...[[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py], i) => ({ id: p[i], type: 'point', x: px, y: py })),
        ...p.map((a, i) => ({ id: `${id}l${i + 1}`, type: 'line', p1: a, p2: p[(i + 1) % 4] })),
      ],
      constraints: [],
    };
  };
  const exec = (cmd) => store.execute(cmd);
  const sketchOn = (id, plane, parts) => ({ id, type: 'sketch', name: id, suppressed: false, plane, ...parts });
  const before = store.getState().doc.features.length;
  exec({ type: 'insertFeature', index: before, feature: sketchOn('sk1', { kind: 'datum', name: 'plane:front' }, rect('a', -20, -15, 40, 30)) });
  exec({ type: 'insertFeature', index: before + 1, feature: { id: 'ex1', type: 'extrude', name: 'ex1', suppressed: false, sketch: 'sk1', op: 'boss', dir1: { type: 'blind', depth: '10' } } });
  await H.settle();
  H.check(near(volume(), 12000), `the plate: ${volume()}`);
  exec({ type: 'insertFeature', index: before + 2, feature: sketchOn('sk2', { kind: 'face', name: 'ex1:cap:end' }, { entities: [{ id: 'p1', type: 'point', x: 5, y: 5 }], constraints: [] }) });
  exec({ type: 'insertFeature', index: before + 3, feature: { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 'sk2', kind: 'straight', diameter: '6', end: { type: 'blind', depth: '8' } } });
  await H.settle();
  H.check(near(volume(), 12000 - Math.PI * 9 * 8), `the straight hole: ${volume()}`);

  // the hole's PropertyManager: the dowel pin hole is a kind in the list
  store.beginEdit('h1');
  await H.wait(300);
  H.check(!!pm(), 'the PropertyManager of the hole is open');
  const select = [...pm().querySelectorAll('select')][0];
  H.check([...select.options].some((o) => o.value === 'dowel'), `the kinds: ${[...select.options].map((o) => o.value)}`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'dowel');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  let hole = store.getState().doc.features.find((f) => f.id === 'h1');
  H.check(hole.kind === 'dowel' && hole.fit === 'H7' && hole.chamfer === '0.5' && hole.diameter === '6', `made a dowel hole: ${JSON.stringify(hole)}`);
  const c = 0.5;
  const R = 3;
  const removed = (R0, depth) => Math.PI * R0 * R0 * depth + (Math.PI * c * ((R0 + c) ** 2 + (R0 + c) * R0 + R0 ** 2)) / 3 - Math.PI * R0 * R0 * c;
  H.check(near(volume(), 12000 - removed(R, 8)), `with the entrance chamfer: ${volume()} vs ${12000 - removed(R, 8)}`);
  H.check(store.getState().result.faceNames.includes('h1:side:sk2.p1.cone'), 'the chamfer cone has its name');
  // the limits of the fit are shown: Ø6 H7 is 6.000 to 6.012
  const hint = [...pm().querySelectorAll('.hint')].map((h) => h.textContent).join(' | ');
  H.check(hint.includes('6.000') && hint.includes('6.012') && hint.includes('m6'), `the limits are shown: ${hint}`);
  // another fit, another size
  await choose('公差等級', 'H8');
  hole = store.getState().doc.features.find((f) => f.id === 'h1');
  H.check(hole.fit === 'H8', 'H8');
  H.check([...pm().querySelectorAll('.hint')].some((h) => h.textContent.includes('6.018')), 'H8 for Ø6 is 6.018');
  await choose('標準規格', '8');
  hole = store.getState().doc.features.find((f) => f.id === 'h1');
  H.check(hole.diameter === '8', 'Ø8');
  H.check(near(volume(), 12000 - removed(4, 8)), `Ø8: ${volume()}`);
  // back to a straight hole drops the fit and the chamfer
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'straight');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  hole = store.getState().doc.features.find((f) => f.id === 'h1');
  H.check(hole.kind === 'straight' && hole.fit === undefined && hole.chamfer === undefined, `a straight hole again: ${JSON.stringify(hole)}`);
  console.log('phase4-dowel: all checks passed');
  return true;
};
