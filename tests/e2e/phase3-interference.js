// Phase 3b-5d: interference detection in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280x720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-interference.js?' + Date.now());
//   await __interference.run();
//
// It builds on phase3-subassembly.js (the fixture of two sub-assemblies in an OPFS project folder). A third plate is inserted at the origin, on top of the
// plate of the first sub-assembly: the overlap is the whole plate, whose volume the build of the part gives.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const interference = (window.__interference = {});

const field = (name) => document.querySelector(`[data-interference] [data-field="${name}"]`);
const done = async () => {
  await H.waitFor(() => store.getState().interference?.status === 'done' || store.getState().interference?.status === 'error', 20000, 'the interference result');
  await H.wait(100);
  return store.getState().interference;
};
const open = async () => {
  await H.action('組合件', '干涉檢查');
  await H.waitFor(() => document.querySelector('[data-interference]'), 5000, 'the interference window');
  return done();
};
const close = () => {
  document.querySelector('[data-interference] .primary').click();
};

interference.run = async () => {
  await __sub.open();
  // the fixture as it is: parts that touch (pins in their holes, plates side by side) are not interference
  let r = await open();
  H.check(r.status === 'done' && !r.error, `done: ${r.error}`);
  H.check(r.pairs.length === 0, `the fixture has no interference: ${JSON.stringify(r.pairs.map((p) => [p.aName, p.bName, p.volume]))}`);
  H.check(field('summary').textContent.includes('沒有干涉'), `it says so: ${field('summary').textContent}`);
  H.check(r.checked > 0, `it did compare parts: ${r.checked}`);
  H.check(store.viewer.highlights.length === 0, 'nothing is drawn red');
  close();
  // a plate on top of the first plate
  const plate = await H.insert('定位板.3dbx');
  await H.loaded();
  const key = [...H.asm().builds.keys()].find((k) => H.asm().builds.get(k).mass && Math.abs(H.asm().builds.get(k).mass.volume - 137197) < 1);
  H.check(!!key, 'the plate part is built (volume 137197)');
  const volume = H.asm().builds.get(key).mass.volume;
  r = await open();
  H.check(r.pairs.length === 1, `one pair: ${JSON.stringify(r.pairs.map((p) => [p.aName, p.bName, p.volume]))}`);
  const p = r.pairs[0];
  // The whole plate, and also what the two pins of the first sub-assembly have inside it: their r = 5 shanks stand in r = 4 holes of the plate (the fixture's
  // own geometry; inside one sub-assembly it is not compared). So: at least the plate, at most the plate and both pins.
  const pinVolume = H.asm().builds.get([...H.asm().builds.keys()].find((k) => Math.abs((H.asm().builds.get(k).mass?.volume ?? 0) - 2487.03) < 1)).mass.volume;
  H.check(p.volume >= volume * (1 - 1e-9) && p.volume <= volume + 2 * pinVolume, `the plate is shared: ${p.volume} against ${volume} (+ at most ${2 * pinVolume})`);
  const extra = p.volume - volume;
  H.check(Math.abs(extra - 2 * Math.PI * (25 - 16) * 14.3) < 15, `the pins' shanks in the holes: ${extra.toFixed(1)} mm3 (about 2 pi (5^2 - 4^2) 14.3)`);
  H.check(p.aName.includes('定位') && p.bName.includes('定位'), `named after the components: ${p.aName} × ${p.bName}`);
  H.check(Number(field('volume').textContent) > 0 && field('pairs').querySelectorAll('tbody tr').length === 1, 'listed');
  await H.waitFor(() => store.viewer.highlights.length === p.overlaps.length && p.overlaps.length > 0, 3000, 'the overlap drawn red');
  H.check(store.viewer.highlights.every((m) => m.material.color.getHex() === 0xe53935), 'red');
  H.check(store.viewer.highlights.every((m) => m.geometry.getAttribute('position').count > 0), 'with triangles');
  // choosing the pair selects its two components in the view
  field('pairs').querySelector('tbody tr').click();
  await H.wait(200);
  H.check(store.getState().interference.selected === 0, 'the pair is chosen');
  H.check(store.viewer.selectedInstances.size > 0, 'its components are selected in the view');
  field('pairs').querySelector('tbody tr').click();
  await H.wait(100);
  H.check(store.getState().interference.selected === null, 'chosen again, all are shown');
  // out of date once the assembly changes; suppressed components are not compared, hidden ones are
  const id = plate.id;
  store.assembly.setComponentState([id], 'hidden', true);
  await H.wait(300);
  H.check(!!field('stale'), 'the window says the result is out of date');
  await document.querySelector('[data-interference] .measure-head button').click();
  r = await done();
  H.check(r.pairs.length === 1, `a hidden component is still compared: ${r.pairs.length}`);
  store.assembly.setComponentState([id], 'suppressed', true);
  await H.wait(300);
  document.querySelector('[data-interference] .measure-head button').click();
  await H.wait(100);
  r = await done();
  H.check(r.pairs.length === 0, `a suppressed component is not compared: ${r.pairs.length}`);
  H.check(store.viewer.highlights.length === 0, 'and nothing is drawn red');
  // Esc closes it
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await H.wait(200);
  H.check(store.getState().interference === null && !document.querySelector('[data-interference]'), 'Esc closes the window');
  return { volume, shared: p.volume, checked: r.checked, ms: r.ms };
};
