// A component's own origin and planes in the assembly's FeatureManager (ADR 0144), in the real interface. Run it in a freshly loaded app page
// (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/manual-asm-component-datums.js?' + Date.now());
//   await __compDatums.run();
//
// The project folder is OPFS, as in phase2-assembly.js, whose helpers come with it. The plate is fixed off the origin and turned, the pin floats
// tilted. Every pick is a click on a row of the tree (Ctrl+click for the second), 「結合」 is the command bar's button, ✓ the PropertyManager's;
// where the pin ends up is read from the solved poses and compared with where the plate's planes are — nothing about the result is written in.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const model = await import(`${root}packages/model/src/index.ts`);
const io = await import(`${root}packages/io/src/index.ts`);
const T = (window.__compDatums = {});

const PLATE = '定位板.3dbx';
const PIN = '削邊銷.3dbx';
const PLATE_AT = { position: [12, -7, 4], rotation: model.axisAngle([0.36, 0.48, 0.8], 0.5) };
const PIN_AT = { position: [-30, 40, 12], rotation: model.axisAngle([0.6, 0, 0.8], 0.4) };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A default plane of a part where a pose puts it: its origin and its normal in the assembly. */
const placedPlane = (pose, name) => {
  const f = model.DATUM_PLANES[name];
  const o = model.transformPoint(pose, f.origin);
  return { o, n: sub(model.transformPoint(pose, [f.origin[0] + f.normal[0], f.origin[1] + f.normal[1], f.origin[2] + f.normal[2]]), o) };
};
const pose = (id) => H.asm().solution.poses.get(id);
const row = (selector) => document.querySelector(`.feature-tree ${selector}`);
const click = async (el, ctrl = false) => {
  if (!el) throw new Error('no such row');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ctrl }));
  await H.wait(120);
};
const names = (selector) => [...document.querySelectorAll(`.feature-tree ${selector}`)].map((r) => r.querySelector('.name').textContent);

async function open(doc, path) {
  await H.writeAt(path, await io.writeAssemblyFile(doc));
  document.querySelector('.status-bar .notice')?.click();
  H.next.open = path;
  await H.action('檔案', '開啟舊檔');
  await H.wait(300);
  if ([...document.querySelectorAll('.modal button')].some((b) => b.textContent === '不儲存')) await H.modalButton('不儲存');
  await H.wait(300);
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => store.getState().notice?.text === `已開啟 ${path.split('/').pop()}`, 20000, `${path} to open`);
  await H.loaded();
  await H.waitFor(() => H.asm().solution, 10000, 'the solution');
}

/** One mate by the tree: the pin's plane, Ctrl+the plate's, 「結合」, the suggested type kept (aligned), ✓, and the PropertyManager closed. */
async function mateByTree(plane) {
  await click(row(`[data-component-datum="pin:${plane}"]`));
  await click(row(`[data-component-datum="plate:${plane}"]`), true);
  const picks = H.asm().picks.map((p) => `${p.component}:${p.ref.name}`);
  H.check(picks.join() === `pin:${plane},plate:${plane}`, `both planes picked, in order: ${picks}`);
  H.check(row(`[data-component-datum="pin:${plane}"]`).classList.contains('selected') && row(`[data-component-datum="plate:${plane}"]`).classList.contains('selected'), 'both rows are shown selected');
  const shown = store.viewer.planes.map((p) => p.key);
  H.check(shown.length === 2 && shown.includes(`pin:${plane}`) && shown.includes(`plate:${plane}`), `both planes drawn in the graphics area: ${shown}`);
  await H.action('組合件', '結合');
  const d = H.asm().mate;
  H.check(!!d && d.a?.component === 'pin' && d.a.ref.name === plane && d.b?.component === 'plate' && d.b.ref.name === plane, 'the PropertyManager starts with the two planes');
  H.check(H.asm().picks.length === 0, 'the picks went into the mate');
  const boxes = [...document.querySelectorAll('.property-manager .selection-box li span')].map((s) => s.textContent);
  H.check(boxes.length === 2 && boxes[0].endsWith('@削邊銷<1>') && boxes[1].endsWith('@定位板<1>'), `the selection box lists them: ${boxes}`);
  const suggested = document.querySelector('.mate-types button.active')?.textContent;
  H.check(suggested === '重合', `重合 is suggested for two planes: ${suggested}`);
  const aligned = [...document.querySelectorAll('.mate-align button')].find((b) => b.textContent === '同向對齊');
  if (aligned && !aligned.classList.contains('active')) aligned.click();
  await H.previewed();
  await H.mateOk();
  if (H.asm().mate) document.querySelector('.property-manager .pm-ok').click(); // ✓ with nothing chosen closes it
  await H.waitFor(() => !H.asm().mate, 5000, 'the PropertyManager to close');
  await H.solved();
  return { suggested, boxes };
}

T.run = async () => {
  H.ready();
  const out = {};
  await H.project({ [PLATE]: `${H.GOLDEN}locating-plate.3dbx`, [PIN]: `${H.GOLDEN}diamond-pin.3dbx` });
  let doc = model.createEmptyAssembly();
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'f1', path: PLATE }, component: { id: 'plate', file: 'f1', instance: 1, fixed: true, placement: PLATE_AT } });
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'f2', path: PIN }, component: { id: 'pin', file: 'f2', instance: 1, fixed: false, placement: PIN_AT } });
  await open(doc, 'datums.3dba');

  // 1. A part's row opens (▸), and shows its origin, its three planes and its features, as the part file has them
  H.check(!row('[data-component-datum^="pin:"]'), 'closed at first');
  H.check(!!row('[data-twisty="pin"]') && !!row('[data-twisty="plate"]'), 'each part has ▸');
  // the ▸ is drawn, so a row still reads as its name (scripts and people find a component by it)
  H.check(row('[data-component-row="pin"]').textContent.startsWith('(-) 削邊銷<1>') && H.treeRow('(f) 定位板<1>'), `the rows read as before: ${row('[data-component-row="pin"]').textContent}`);
  await click(row('[data-twisty="pin"]'));
  await click(row('[data-twisty="plate"]'));
  const pinDoc = (await io.readPartFile(await H.readAt(PIN))).doc;
  const pinRows = names('[data-component-datum^="pin:"], [data-component-feature^="pin:"]');
  const expected = ['原點', '前基準面', '上基準面', '右基準面', ...pinDoc.features.map((f) => f.name)];
  H.check(JSON.stringify(pinRows) === JSON.stringify(expected), `the pin's rows are its origin, planes and features: ${pinRows}`);
  out.pinRows = pinRows.length;
  const refPlanes = pinDoc.features.filter((f) => f.type === 'refPlane').map((f) => f.id);
  H.check(refPlanes.length > 0 && refPlanes.every((id) => row(`[data-component-datum="pin:${id}"]`)), `its reference planes are pickable datums: ${refPlanes}`);
  H.check(!row('[data-component-feature^="pin:"].error'), 'no feature of the pin fails');

  // 2. A click on a feature does nothing (read only); the origin, picked, is drawn where the plate's origin is
  await click(row(`[data-component-feature="pin:${pinDoc.features[0].id}"]`));
  H.check(H.asm().picks.length === 0 && H.asm().selected === null, 'a feature row picks nothing');
  await click(row('[data-component-datum="plate:origin"]'));
  const dots = store.viewer.datums.points;
  H.check(dots.length === 1 && dots[0].p.every((v, i) => Math.abs(v - PLATE_AT.position[i]) < 1e-9), `the plate's origin is drawn where the plate is: ${dots[0]?.p}`);
  await H.key('Escape');
  H.check(H.asm().picks.length === 0 && store.viewer.datums.points.length === 0 && store.viewer.planes.length === 0, 'Esc: nothing picked, nothing drawn');

  // 3. Front on front, top on top, right on right, each picked in the tree: fully defined, the pin where the plate is
  const startGap = dot(sub(placedPlane(pose('pin'), 'plane:front').o, placedPlane(PLATE_AT, 'plane:front').o), placedPlane(PLATE_AT, 'plane:front').n);
  H.check(Math.abs(startGap) > 1, `the pin starts off the plate's front plane: ${startGap}`);
  out.front = await mateByTree('plane:front');
  const pl = placedPlane(PLATE_AT, 'plane:front');
  const pn = placedPlane(pose('pin'), 'plane:front');
  H.check(Math.abs(dot(sub(pn.o, pl.o), pl.n)) < 1e-6 && pn.n.every((v, i) => Math.abs(v - pl.n[i]) < 1e-6), 'front on front: the pin\'s front plane lies in the plate\'s');
  H.check(H.asm().solution.components.get('pin').status === 'under', 'still free to slide in the plane');
  await mateByTree('plane:top');
  await mateByTree('plane:right');
  H.check([...H.asm().solution.mates.values()].every((m) => m.status === 'ok'), 'all three hold');
  H.check(H.asm().solution.components.get('pin').status === 'full', 'the pin is fully defined');
  H.check(document.querySelector('.status-bar').textContent.includes('完全定義'), 'the status bar says 完全定義');
  const off = (p) => Math.hypot(...sub(model.transformPoint(pose('pin'), p), model.transformPoint(PLATE_AT, p)));
  out.offset = Math.max(...[[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]].map(off));
  H.check(out.offset < 1e-6, `the pin is where the plate is: ${out.offset}`);
  H.check(H.asm().doc.mates.every((m) => m.a.ref.kind === 'datum' && m.a.component === 'pin' && m.b.component === 'plate'), 'the mates are on the components\' own planes');

  // 4. Saved and reopened: the same mates, the pin where it was
  const before = JSON.stringify([...H.asm().solution.poses].map(([k, p]) => [k, p.position.map((v) => +v.toFixed(6))]));
  await H.save('datums.3dba');
  await H.action('檔案', '新零件');
  await H.open('datums.3dba');
  await H.solved();
  const after = JSON.stringify([...H.asm().solution.poses].map(([k, p]) => [k, p.position.map((v) => +v.toFixed(6))]));
  H.check(before === after && H.asm().solution.components.get('pin').status === 'full', `reopened as it was: ${after}`);
  H.check(H.tree().filter((t) => /^重合\d/.test(t)).length === 3, 'the three mates are in the tree');
  return out;
};
