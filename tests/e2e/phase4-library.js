// Phase 4a-4 (F6.1): the standard parts library in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase4-library.js?' + Date.now());
//   await __library.run();
//
// The project folder is OPFS, as in phase2-assembly.js, whose helpers come with it. A new assembly: an ISO 7089 M6 washer made from the library and placed
// (fixed), an ISO 4762 M6 × 20 screw made and placed, then the screw's shank is mated into the washer's bore and its head to the washer's top.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const lib = (window.__library = {});

const pm = () => document.querySelector('.property-manager');
const setSelect = async (label, value) => {
  const row = [...pm().querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent === label);
  const sel = row.querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(100);
};

/** Makes the part in the library group and places it at the origin (✓). */
async function make(kindLabel, size, length) {
  await setSelect('種類', kindLabel);
  await setSelect('規格', size);
  if (length !== undefined) await setSelect('長度', String(length));
  const before = H.asm().doc.components.length;
  [...pm().querySelectorAll('button')].find((b) => b.textContent === '做出並選取').click();
  await H.waitFor(() => H.asm().insert?.chosen && H.asm().files.get(H.asm().insert.chosen)?.status === 'ok', 20000, 'the part to be made and read');
  const chosen = H.asm().insert.chosen;
  pm().querySelector('.pm-ok').click();
  await H.waitFor(() => !H.asm().insert && H.asm().doc.components.length === before + 1, 5000, 'the component');
  return { path: chosen, component: H.asm().doc.components.at(-1) };
}

lib.run = async () => {
  H.ready();
  await H.project({});
  await H.action('檔案', '新組合件');
  await H.wait(300);
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => H.asm()?.insert?.files, 10000, 'the insert panel');
  H.check([...pm().querySelectorAll('h4')].some((h) => h.textContent === '標準件圖庫'), 'the library group is in the insert panel');

  const washer = await make('washer', 'M6');
  H.check(washer.path === '標準件/ISO 7089 M6.3dbx', `the washer's file: ${washer.path}`);
  H.check(washer.component.fixed, 'the first component is fixed');
  const file = await H.readAt(washer.path);
  H.check(file.length > 100, 'the part file is in the project folder');

  await H.action('組合件', '插入零組件');
  await H.waitFor(() => H.asm()?.insert?.files, 10000, 'the insert panel again');
  H.check(H.asm().insert.files.includes(washer.path), 'the washer is in the list now');
  const screw = await make('socketScrew', 'M6', 20);
  H.check(screw.path === '標準件/ISO 4762 M6x20.3dbx', `the screw's file: ${screw.path}`);
  H.check(!screw.component.fixed, 'the screw floats');

  // the parts as drawn: a washer's ring and a screw
  const a = H.asm();
  const built = (path) => a.builds.get(H.asm().files.get(path).key);
  H.check(built(washer.path).mass && Math.abs(built(washer.path).mass.volume - Math.PI * (36 - 10.24) * 1.6) < 1e-6, `the washer's volume: ${built(washer.path).mass?.volume}`);
  H.check(built(washer.path).properties['料號'] === 'ISO 7089 M6', 'the part number is in the file properties');

  // the mates: shank in the bore, head on the washer
  const face = (component, name) => ({ component: component.id, ref: { kind: 'face', name } });
  store.assembly.startMate();
  store.assembly.pickElement(face(washer.component, 'revolve1:side:sketch1.bore'));
  store.assembly.pickElement(face(screw.component, 'revolve1:side:sketch1.shank'));
  await H.waitFor(() => H.asm().mate?.type === 'concentric', 5000, 'the concentric suggestion');
  store.assembly.applyMate();
  await H.waitFor(() => H.asm().doc.mates.length === 1, 5000, 'the first mate');
  store.assembly.pickElement(face(washer.component, 'revolve1:side:sketch1.top'));
  store.assembly.pickElement(face(screw.component, 'revolve1:side:sketch1.under'));
  await H.waitFor(() => H.asm().mate?.type === 'coincident', 5000, 'the coincident suggestion');
  store.assembly.applyMate();
  await H.waitFor(() => H.asm().doc.mates.length === 2, 5000, 'the second mate');
  await H.waitFor(() => [...(H.asm().solution?.mates.values() ?? [])].length === 2 && [...H.asm().solution.mates.values()].every((m) => m.status === 'ok'), 8000, 'both mates to hold');
  const pose = H.asm().solution.poses.get(screw.component.id);
  H.check(Math.abs(pose.position[1] - 1.6) < 1e-6 && Math.abs(pose.position[0]) < 1e-6 && Math.abs(pose.position[2]) < 1e-6, `the screw sits on the washer: ${JSON.stringify(pose.position)}`);
  pm().querySelector('.pm-cancel').click();
  await H.action('組合件', '插入零組件');
  await H.waitFor(() => H.asm()?.insert?.files, 10000, 'the insert panel for the set screw');
  const option = pm().querySelector('select option[value="setScrew"]');
  H.check(option?.textContent.includes('ISO 4029') && option.textContent.includes('內六角止付螺絲'), 'the cup point set screw is listed');
  const setScrew = await make('setScrew', 'M6', 20);
  H.check(setScrew.path === '標準件/ISO 4029 M6x20.3dbx', `the set screw file: ${setScrew.path}`);
  H.check(!setScrew.component.fixed, 'the set screw is inserted as a floating component');
  await H.loaded();
  const setBuilt = H.asm().builds.get(H.asm().files.get(setScrew.path).key);
  H.check(setBuilt?.mass?.volume > 0 && setBuilt.properties['料號'] === 'ISO 4029 M6x20', 'the set screw has rebuilt geometry and its part number');
  console.log('phase4-library: all checks passed');
  return true;
};
