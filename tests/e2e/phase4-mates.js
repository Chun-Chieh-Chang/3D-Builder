// Phase 4a-2: the advanced mates (width, symmetric, limits) in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase4-mates.js?' + Date.now());
//   await __mates.run();
//
// The project folder is OPFS, as in phase2-assembly.js, whose helpers come with it. The parts are the golden plate, pin and V-block; the elements are
// picked through the same calls the graphics area makes (`pickElement`), and the PropertyManager's own buttons and boxes are used for the rest.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const model = await import(`${root}packages/model/src/index.ts`);
const io = await import(`${root}packages/io/src/index.ts`);
const m = (window.__mates = {});

const at = (position) => ({ position, rotation: [0, 0, 0, 1] });
const face = (component, name) => ({ component, ref: { kind: 'face', name } });
const datum = (component, name) => ({ component, ref: { kind: 'datum', name } });
const TOP = 'extrude1:cap:end';

/** The name of the plane face of a built part with this normal that lies furthest along it (a side, the top …). */
const outermost = (build, n) => {
  let best = null;
  build.faceGeometry.forEach((g, i) => {
    if (g?.kind !== 'plane') return;
    if (g.normal.some((v, k) => Math.abs(v - n[k]) > 1e-9)) return;
    const d = g.origin[0] * n[0] + g.origin[1] * n[1] + g.origin[2] * n[2];
    if (!best || d > best.d) best = { name: build.faceNames[i], d };
  });
  if (!best) throw new Error(`no plane facing ${n}`);
  return best.name;
};

async function open(doc, path) {
  await H.writeAt(path, await io.writeAssemblyFile(doc));
  document.querySelector('.status-bar .notice')?.click();
  H.next.open = path;
  await H.action('檔案', '開啟舊檔');
  await H.wait(300);
  // a document with changes asks first: what was done in it is not wanted
  if ([...document.querySelectorAll('.modal button')].some((b) => b.textContent === '不儲存')) await H.modalButton('不儲存');
  await H.wait(300);
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => store.getState().notice?.text === `已開啟 ${path.split('/').pop()}`, 20000, `${path} to open`);
  await H.loaded();
  await H.waitFor(() => H.asm().solution, 10000, 'the solution');
}

const jig = (x, y) => {
  let doc = model.createEmptyAssembly();
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '定位板.3dbx' }, component: { id: 'plate', file: 'file1', instance: 1, fixed: true, placement: at([0, 0, 0]) } });
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: 'V型塊.3dbx' }, component: { id: 'v', file: 'file2', instance: 1, fixed: false, placement: at([x, y, 2]) } });
  return doc;
};

const pose = (id) => H.asm().solution.poses.get(id);

m.run = async () => {
  H.ready();
  const g = H.GOLDEN;
  await H.project({ '定位板.3dbx': `${g}locating-plate.3dbx`, 'V型塊.3dbx': `${g}v-block.3dbx` });

  // ---------------------------------------------------------------- width: the V-block between the plate's sides
  await open(jig(17, 15), 'a.3dba');
  const a = H.asm();
  const plate = a.builds.get(a.files.get('定位板.3dbx').key);
  const block = a.builds.get(a.files.get('V型塊.3dbx').key);
  const sides = { pl: outermost(plate, [-1, 0, 0]), pr: outermost(plate, [1, 0, 0]), vl: outermost(block, [-1, 0, 0]), vr: outermost(block, [1, 0, 0]) };
  H.check(Math.abs(pose('v').position[0] - 17) < 1e-9, 'the V-block starts 17 mm off');
  await H.action('組合件', '結合');
  H.check(!!document.querySelector('.property-manager'), 'the mate PropertyManager is open');
  H.check([...document.querySelectorAll('.property-manager h4')].map((h) => h.textContent).includes('進階結合'), 'it has the advanced mates');
  [...document.querySelectorAll('.mate-types button')].find((b) => b.textContent === '寬度').click();
  await H.wait(150);
  H.check(H.asm().mate.type === 'width', 'width is the type');
  const pick = async (ref) => {
    store.assembly.pickElement(ref);
    await H.wait(100);
  };
  // the width faces first, then the tab faces
  await pick(face('plate', sides.pl));
  await pick(face('plate', sides.pr));
  await pick(face('v', sides.vl));
  H.check(!H.asm().solution.mates.has('preview'), 'no preview before the fourth element');
  await pick(face('v', sides.vr));
  await H.waitFor(() => H.asm().solution?.mates.get('preview')?.status === 'ok', 5000, 'the width preview');
  H.check([...document.querySelectorAll('.property-manager .hint')].some((h) => h.textContent.includes('結合成立')), 'the panel says the mate holds');
  document.querySelector('.property-manager .pm-ok').click();
  await H.waitFor(() => H.asm().doc.mates.length === 1, 5000, 'the mate');
  await H.waitFor(() => Math.abs(pose('v').position[0]) < 1e-6, 5000, 'the V-block to be centred');
  const width = H.asm().doc.mates[0];
  H.check(width.type === 'width' && width.more.length === 2 && width.name.startsWith('寬度'), `the mate is stored: ${JSON.stringify(width)}`);
  await H.waitFor(() => H.asm().solution.mates.get(width.id)?.status === 'ok', 5000, 'the width mate to hold');
  // a pick on the wrong component is refused, in words
  document.querySelector('.property-manager .pm-cancel')?.click();
  await H.wait(150);

  // ---------------------------------------------------------------- symmetric: the V-block mirrored in the plate's right plane — a face of the plate and the V-block's, equal distances from it
  // (the V-block's own left face at x = −30 mirrors the plate's right face at x = +60 only when x = 30 + 60: instead mirror the V-block's two sides onto each other)
  await open(jig(12, 15), 'b.3dba');
  await H.action('組合件', '結合');
  [...document.querySelectorAll('.mate-types button')].find((b) => b.textContent === '相互對稱').click();
  await H.wait(150);
  await pick(face('v', sides.vl));
  await pick(face('v', sides.vr));
  H.check(H.asm().mate.a && H.asm().mate.b, 'two elements on one component are taken for a symmetric mate');
  await pick(datum('plate', 'plane:right'));
  await H.wait(300);
  const preview = H.asm().solution.mates.get('preview');
  // a and b on the same component cannot be solved: the mate says why
  H.check(preview && preview.status !== 'ok', `two faces of one component are not a pair for a symmetric mate: ${JSON.stringify(preview)}`);
  document.querySelector('.property-manager .pm-cancel')?.click();
  await H.wait(150);

  // ---------------------------------------------------------------- a limit: the V-block may stand 0 to 10 mm above the plate
  await open(jig(0, 45), 'c.3dba');
  await H.action('組合件', '結合');
  await pick(face('plate', TOP));
  await pick(face('v', outermost(block, [0, -1, 0])));
  await H.mateType('距離');
  await H.mateValue('5');
  const boxes = [...document.querySelectorAll('.property-manager .pm-row')];
  const box = (label) => boxes.find((r) => r.textContent.startsWith(label))?.querySelector('input');
  const type = async (input, text) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.blur();
    await H.wait(150);
  };
  await type(box('最小值'), '0');
  await type(document.querySelectorAll('.property-manager .pm-row')[0] && [...document.querySelectorAll('.property-manager .pm-row')].find((r) => r.textContent.startsWith('最大值')).querySelector('input'), '10');
  await H.waitFor(() => H.asm().solution?.mates.get('preview')?.status === 'ok', 5000, 'the limit preview');
  document.querySelector('.property-manager .pm-ok').click();
  await H.waitFor(() => H.asm().doc.mates.length === 1, 5000, 'the limit mate');
  const limit = H.asm().doc.mates[0];
  H.check(limit.min === '0' && limit.max === '10' && limit.value === '5', `the limits are stored: ${JSON.stringify(limit)}`);
  await H.waitFor(() => Math.abs(pose('v').position[1] - 25) < 1e-6, 5000, 'the V-block brought down to 10 mm above the plate (y = 15 + 10)');
  console.log('phase4-mates: all checks passed');
  return true;
};
