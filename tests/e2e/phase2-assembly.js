// Phase 2A acceptance (handoff §10): an assembly made with the UI only.
//
// Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720), e.g. through the
// built-in browser's JavaScript tool; it is not a Vitest test. Every step is a DOM, pointer or keyboard
// event — what a mouse and keyboard produce — and every click on the model lands inside the canvas.
// The store is only read, to know where things are and to report results.
//
// The project folder is a folder of the browser's origin-private file system (OPFS). Its handles are
// real FileSystemDirectoryHandle / FileSystemFileHandle objects, so relative paths, resolve(), reads
// and writes run through the same browser code as a folder on disk. The system dialogs (which only
// open on a real click) are replaced by stand-ins that return handles from that folder.
//
//   const r = await __asm.all();

const storeUrl = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/state/store.ts'));
const { store } = await import(storeUrl);
const H = (window.__ui2 = { store });

// ---------------------------------------------------------------- waiting
H.wait = (ms) => new Promise((r) => setTimeout(r, ms));
H.waitFor = async (fn, ms = 10000, what = 'condition') => {
  for (let t = 0; t < ms; t += 40) {
    const v = fn();
    if (v) return v;
    await H.wait(40);
  }
  throw new Error(`timeout waiting for ${what}`);
};
H.asm = () => store.getState().asm;
/** Every part file of the open assembly has been read and rebuilt (or found missing). */
H.loaded = async () => {
  await H.wait(100);
  await H.waitFor(() => H.asm() && ![...H.asm().files.values()].some((s) => s.status === 'loading'), 30000, 'part files');
  await H.wait(100);
};
H.settle = async () => {
  await H.wait(250);
  await H.waitFor(() => !store.getState().rebuilding, 30000, 'rebuild');
  await H.wait(100);
};

// ---------------------------------------------------------------- the project folder (OPFS) and dialog stand-ins
H.GOLDEN = '/@fs/C:/Users/3kids/Downloads/3D-Builder/tests/golden/';
H.handleAt = async (path, create = false) => {
  const parts = path.split('/');
  let dir = H.root;
  for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create });
  return dir.getFileHandle(parts[parts.length - 1], { create });
};
H.writeAt = async (path, bytes) => {
  const w = await (await H.handleAt(path, true)).createWritable();
  await w.write(bytes);
  await w.close();
};
H.readAt = async (path) => new Uint8Array(await (await (await H.handleAt(path)).getFile()).arrayBuffer());
/** A fresh project folder holding the given files (path → URL). */
H.project = async (files) => {
  const opfs = await navigator.storage.getDirectory();
  try {
    await opfs.removeEntry('3db-e2e', { recursive: true });
  } catch {
    // not there yet
  }
  H.root = await opfs.getDirectoryHandle('3db-e2e', { create: true });
  for (const [path, url] of Object.entries(files)) await H.writeAt(path, new Uint8Array(await (await fetch(url)).arrayBuffer()));
};
/** What the next file dialog answers: a path in the project folder, or null for 「取消」. */
H.next = { open: null, save: null };
H.dialogs = [];
window.showDirectoryPicker = async (o) => {
  H.dialogs.push(['folder', o?.id]);
  return H.root;
};
window.showOpenFilePicker = async (o) => {
  const path = H.next.open;
  H.next.open = null;
  H.dialogs.push(['open', path, o?.startIn?.name ?? null]);
  if (!path) throw new DOMException('cancelled', 'AbortError');
  return [await H.handleAt(path)];
};
window.showSaveFilePicker = async (o) => {
  const path = H.next.save;
  H.next.save = null;
  H.dialogs.push(['save', path, o?.suggestedName, o?.startIn?.name ?? null]);
  if (!path) throw new DOMException('cancelled', 'AbortError');
  return H.handleAt(path, true);
};

// ---------------------------------------------------------------- command bar, tree, dialogs, PropertyManager
H.tab = (name) => {
  const t = [...document.querySelectorAll('.tabs button')].find((b) => b.textContent === name);
  if (!t) throw new Error(`no tab ${name}`);
  t.click();
};
H.btn = (label) => {
  const b = [...document.querySelectorAll('.tools button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  if (b.disabled) throw new Error(`button disabled: ${label}`);
  b.click();
};
H.action = async (tab, label) => {
  H.tab(tab);
  await H.wait(80);
  H.btn(label);
  await H.wait(150);
};
H.modalButton = async (label) => {
  const b = await H.waitFor(() => [...document.querySelectorAll('.modal button')].find((x) => x.textContent === label), 5000, `dialog button ${label}`);
  b.click();
  await H.wait(150);
};
H.key = async (key) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await H.wait(80);
};
H.tree = () => [...document.querySelectorAll('.feature-tree .tree-row')].map((r) => r.textContent);
H.treeClick = async (name) => {
  const r = [...document.querySelectorAll('.tree-row')].find((x) => x.textContent.replace(/^\([-+f?]\) /, '') === name);
  if (!r) throw new Error(`no tree row ${name}`);
  r.click();
  await H.wait(120);
  return r;
};
H.pmInput = async (label, value) => {
  const row = [...document.querySelectorAll('.property-manager .pm-row')].find((r) => r.querySelector('span')?.textContent === label);
  if (!row) throw new Error(`no PM field ${label}`);
  const input = row.querySelector('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(30);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.settle();
  if (input.className.includes('invalid')) throw new Error(`PM refused ${label}=${value}`);
};

// ---------------------------------------------------------------- the canvas
H.canvas = () => document.querySelector('.viewport-canvas canvas');
H.rect = () => H.canvas().getBoundingClientRect();
/** A hidden pane never lays the page out: give the viewer its real size first. */
H.ready = () => store.viewer.resize();
H.ptr = (type, x, y) => H.canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: type === 'pointerdown' ? 1 : 0 }));
/** A left click at a fraction of the canvas; it must land inside it, like a real mouse. */
H.clickAt = async (fx, fy) => {
  const r = H.rect();
  const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
  if (x < r.left + 2 || x > r.right - 2 || y < r.top + 2 || y > r.bottom - 2) throw new Error(`click outside the canvas at (${x.toFixed(0)}, ${y.toFixed(0)})`);
  for (let i = 3; i >= 0; i--) {
    H.ptr('pointermove', x - i * 7, y - i * 5); // the cursor comes in, so the preview follows it
    await H.wait(20);
  }
  H.ptr('pointerdown', x, y);
  H.ptr('pointerup', x, y);
  H.canvas().dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  await H.wait(80);
};

// ---------------------------------------------------------------- assembly steps
/** 「插入零組件」: the project folder when asked, the part from the list, then a click in the view or ✓. */
H.insert = async (path, where = null) => {
  await H.action('組合件', '插入零組件');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => H.asm()?.insert?.files, 10000, 'the part list');
  const item = [...document.querySelectorAll('.file-list li')].find((li) => li.title === path);
  if (!item) throw new Error(`${path} is not in the list: ${H.asm().insert.files.join(', ')}`);
  item.click();
  await H.waitFor(() => H.asm().files.get(path)?.status === 'ok' && document.querySelector('.pick-hint')?.textContent.includes('按一下以放置'), 30000, `${path} to load`);
  const before = H.asm().doc.components.length;
  if (where) await H.clickAt(...where);
  else document.querySelector('.property-manager .pm-ok').click();
  await H.waitFor(() => !H.asm().insert && H.asm().doc.components.length === before + 1, 5000, 'the component');
  return H.asm().doc.components.at(-1);
};
H.save = async (path) => {
  H.next.save = path;
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => H.asm() ? !H.asm().dirty : !store.getState().dirty, 10000, 'the save');
};
H.open = async (path) => {
  document.querySelector('.status-bar .notice')?.click(); // dismiss the last notice, so the next one is this open's
  H.next.open = path;
  await H.action('檔案', '開啟舊檔');
  await H.waitFor(() => store.getState().notice?.text === `已開啟 ${path.split('/').pop()}`, 20000, `${path} to open`);
  if (H.asm()) await H.loaded();
  else await H.settle();
};

/** What the assembly shows: every component's pose, and the placed copies in the view. */
H.snapshot = () => {
  const a = H.asm();
  const instances = store.viewer.instances; // the viewer's own record of what it draws
  return {
    tree: H.tree(),
    files: a.doc.files.map((f) => f.path),
    components: a.doc.components.map((c) => ({ id: c.id, file: c.file, instance: c.instance, fixed: c.fixed, placement: c.placement })),
    shown: a.doc.components.map((c) => (instances.get(c.id) ? Array.from(instances.get(c.id).group.matrix.elements) : null)),
    keys: [...a.files].map(([p, s]) => [p, s.status, s.key?.slice(0, 12)]),
  };
};
/** Extent of a part's mesh along x, y and z (mm). */
H.extent = (path) => {
  const s = H.asm().files.get(path);
  const p = H.asm().builds.get(s.key).mesh.positions;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[i + k]);
    hi[k] = Math.max(hi[k], p[i + k]);
  }
  return hi.map((h, k) => +(h - lo[k]).toFixed(6));
};
H.poseMatrix = (p) => {
  const [x, y, z, w] = p.rotation;
  const [tx, ty, tz] = p.position;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, tx, ty, tz, 1];
};
H.check = (ok, what) => {
  if (!ok) throw new Error(`check failed: ${what}`);
};

// ---------------------------------------------------------------- 2A acceptance
const asm = (window.__asm = {});

/**
 * New assembly → insert 定位板 (fixed, at the origin) and 削邊銷 twice (clicked into place) → save into a
 * subfolder → reopen: the same components at the same places. Then change the plate in its own file
 * and reopen the assembly: it shows the new plate, where it was.
 */
asm.all = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, '零件/削邊銷.3dbx': `${H.GOLDEN}diamond-pin.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
  const steps = [];

  await H.action('檔案', '新組合件');
  H.check(store.getState().active === 'assembly', 'an assembly is open');
  const plate = await H.insert('定位板.3dbx');
  H.check(plate.fixed && plate.placement.position.every((v) => v === 0), 'the first component is fixed at the origin');
  const pin1 = await H.insert('零件/削邊銷.3dbx', [0.7, 0.35]);
  const pin2 = await H.insert('零件/削邊銷.3dbx', [0.3, 0.3]);
  H.check(!pin1.fixed && !pin2.fixed && pin1.instance === 1 && pin2.instance === 2 && pin1.file === pin2.file, 'two floating instances of one file');
  H.check(Math.hypot(...pin1.placement.position.map((v, k) => v - pin2.placement.position[k])) > 10, 'placed where clicked, apart');
  await H.loaded();
  const made = H.snapshot();
  steps.push({ step: 'made', ...made });
  H.check(made.shown.every((m, i) => m && m.every((v, k) => Math.abs(v - H.poseMatrix(made.components[i].placement)[k]) < 1e-9)), 'every component drawn at its pose');

  await H.save('組合件/夾具.3dba'); // into a subfolder: the paths are rewritten to start from there
  const file = await H.readAt('組合件/夾具.3dba');
  H.check(file[0] === 0x50 && file[1] === 0x4b, 'written as a .3dba archive');
  steps.push({ step: 'saved', bytes: file.length, dialogs: H.dialogs.slice() });
  H.check(H.asm().fileName === '夾具.3dba' && document.title.startsWith('夾具.3dba - ') && document.querySelector('.tree-part').textContent === '夾具', 'named after its file');
  H.check(H.asm().doc.files.map((f) => f.path).join() === '../定位板.3dbx,../零件/削邊銷.3dbx', 'paths from the assembly folder');

  await H.action('檔案', '新零件'); // put the assembly away
  H.check(store.getState().active === 'part', 'a part replaced it');
  await H.open('組合件/夾具.3dba');
  const reopened = H.snapshot();
  steps.push({ step: 'reopened', ...reopened });
  H.check(JSON.stringify(reopened.components) === JSON.stringify(made.components), 'same components and poses after reopening');
  H.check(JSON.stringify(reopened.shown) === JSON.stringify(made.shown), 'drawn at the same places');
  H.check(reopened.tree.join('|').includes('(f) 定位板<1>|(-) 削邊銷<1>|(-) 削邊銷<2>'), 'the tree lists them');

  // Change the plate in its own file: 伸長1 15 → 20 mm.
  const before = H.extent('定位板.3dbx');
  await H.open('定位板.3dbx');
  H.check(store.getState().active === 'part', 'the part is open');
  const row = await H.treeClick('伸長1');
  row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await H.settle();
  await H.pmInput('深度', '20');
  document.querySelector('.property-manager .pm-ok').click();
  await H.settle();
  H.next.save = null;
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => !store.getState().dirty, 10000, 'the part to save');

  await H.open('組合件/夾具.3dba');
  const updated = H.snapshot();
  const after = H.extent('定位板.3dbx');
  steps.push({ step: 'part changed', before, after, ...updated });
  H.check(before[1] === 15 && after[1] === 20 && before[0] === after[0] && before[2] === after[2], 'the plate is 20 mm thick now');
  H.check(JSON.stringify(updated.components) === JSON.stringify(made.components), 'the components stay where they were');
  H.check(updated.keys[0][2] !== reopened.keys[0][2] && updated.keys[1][2] === reopened.keys[1][2], 'only the plate was rebuilt');
  return { ok: true, steps };
};

H.row = (name) => [...document.querySelectorAll('.feature-tree .tree-row')].find((r) => r.textContent.replace(/^\([-+f?]\) /, '') === name);
H.menu = async (name, item) => {
  H.row(name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 }));
  await H.wait(80);
  const li = [...document.querySelectorAll('.context-menu li')].find((x) => x.textContent === item);
  if (!li) throw new Error(`no menu item ${item}`);
  li.click();
  await H.wait(120);
};
H.ctrl = async (key) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
  await H.wait(120);
};

/**
 * Run after all(), with 夾具.3dba open: undo/redo, 「要儲存變更嗎？」, delete, a part file gone missing
 * and back (「重新計算」 reads the files again), and Esc out of 「插入零組件」.
 */
asm.extras = async () => {
  const out = {};
  const prefix = (name) => H.row(name).textContent.slice(0, 3);

  // Fixed/floating (C15.2) through the context menu, with undo and redo.
  await H.menu('定位板<1>', '浮動');
  H.check(prefix('定位板<1>') === '(-)' && H.asm().dirty && document.title.includes('*'), 'floated, modified');
  await H.ctrl('z');
  H.check(prefix('定位板<1>') === '(f)' && !H.asm().dirty, 'undo fixes it again, unmodified');
  await H.ctrl('y');
  H.check(prefix('定位板<1>') === '(-)' && H.asm().dirty, 'redo floats it');
  out.undo = 'ok';

  // A modified assembly is not replaced without asking.
  await H.action('檔案', '新零件');
  const ask = document.querySelector('.modal[aria-label="要儲存變更嗎"]')?.textContent ?? '';
  H.check(ask.includes('「夾具」有尚未儲存的變更') && ask.includes('建立新零件'), `asked to save: ${ask}`);
  await H.modalButton('取消');
  H.check(store.getState().active === 'assembly', 'cancel keeps the assembly');
  await H.ctrl('z');
  H.check(!H.asm().dirty, 'back to what was saved');
  out.unsaved = 'ok';

  // 「確認刪除」 for a component; the file stays while another instance uses it.
  await H.treeClick('削邊銷<2>');
  await H.key('Delete');
  const confirm = document.querySelector('.modal[aria-label="確認刪除"]')?.textContent ?? '';
  H.check(confirm.includes('削邊銷<2>'), `asked to delete: ${confirm}`);
  await H.modalButton('刪除');
  H.check(H.asm().doc.components.length === 2 && H.asm().doc.files.length === 2, 'one instance deleted, its file still used');
  H.check(store.viewer.instances.size === 2, 'and gone from the view');
  await H.ctrl('z');
  H.check(H.asm().doc.components.length === 3 && store.viewer.instances.size === 3 && !H.asm().dirty, 'undo brings it back');
  out.delete = 'ok';

  // A part file that is gone: its components say so, the rest still shows (B9.4; re-pointing is 2D).
  const pin = await H.readAt('零件/削邊銷.3dbx');
  await (await H.root.getDirectoryHandle('零件')).removeEntry('削邊銷.3dbx');
  await H.action('組合件', '重新計算');
  await H.loaded();
  const missing = [...document.querySelectorAll('.feature-tree .tree-row.error')].map((r) => r.textContent);
  H.check(missing.join() === '(-) 削邊銷<1>,(-) 削邊銷<2>', `missing rows: ${missing}`);
  H.check(document.querySelector('.status-bar').textContent.includes('1 個零件檔無法載入'), 'the status bar says so');
  H.check(store.viewer.instances.size === 1, 'the plate still shows');
  out.missingTip = H.row('削邊銷<1>').title;
  await H.writeAt('零件/削邊銷.3dbx', pin);
  await H.action('組合件', '重新計算');
  await H.loaded();
  H.check(store.viewer.instances.size === 3 && !document.querySelector('.feature-tree .tree-row.error'), 'back once the file is back');
  out.missing = 'ok';

  // Esc leaves 「插入零組件」 without inserting.
  await H.action('組合件', '插入零組件');
  await H.waitFor(() => H.asm().insert?.files, 5000, 'the part list');
  await H.key('Escape');
  H.check(!H.asm().insert && H.asm().doc.components.length === 3, 'Esc cancels the insert');
  out.escape = 'ok';
  return out;
};

/**
 * Run in a freshly loaded page after all(): 「開啟舊檔」 on the assembly asks for the project folder;
 * a folder that does not contain it is refused and asked again.
 */
asm.openFresh = async () => {
  H.ready();
  H.check(!store.getState().projectName, 'no project folder yet (reload the page first)');
  H.root = await (await navigator.storage.getDirectory()).getDirectoryHandle('3db-e2e');
  const answers = [await H.root.getDirectoryHandle('零件'), H.root]; // first the wrong folder, then the right one
  window.showDirectoryPicker = async () => answers.shift();
  H.next.open = '組合件/夾具.3dba';
  await H.action('檔案', '開啟舊檔');
  await H.waitFor(() => store.getState().folderRequest, 5000, 'the folder dialog');
  const first = store.getState().folderRequest;
  await H.modalButton('選擇資料夾…');
  await H.waitFor(() => store.getState().folderRequest?.includes('不包含'), 5000, 'the wrong folder to be refused');
  const second = store.getState().folderRequest;
  await H.modalButton('選擇資料夾…');
  await H.waitFor(() => H.asm(), 10000, 'the assembly');
  await H.loaded();
  H.check(store.getState().projectName === '3db-e2e' && H.asm().folder === '組合件', 'opened inside the project folder');
  H.check(store.viewer.instances.size === 3, 'all three components show');
  return { first, second, tree: H.tree(), folder: H.asm().folder };
};

'phase 2A assembly ready: await __asm.all(), then __asm.extras(); after a reload, __asm.openFresh()';
