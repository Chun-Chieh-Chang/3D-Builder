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
H.drw = () => store.getState().drw;
/** The active page (or page at index) of the open drawing (B2.8, ADR 0154). */
H.page = (doc = store.getState().drw?.doc, index) => {
  if (!doc) return undefined;
  if (doc.pages) return doc.pages[index ?? store.getState().drw?.activePageIndex ?? 0];
  return doc;
};
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
// Wherever this checkout is (a string, not `new URL('../golden/', import.meta.url)`: Vite rewrites that as an asset).
H.GOLDEN = new URL(import.meta.url).pathname.replace(/e2e\/[^/]*$/, 'golden/');
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
  const tabs = [...document.querySelectorAll('.tabs .tab')];
  const t = tabs.find((b) => b.textContent === name);
  if (!t) throw new Error(`no tab ${name} (have: ${tabs.map((b) => b.textContent).join(', ') || 'none'})`);
  t.click();
};
H.btn = (label) => {
  const b = [...document.querySelectorAll('.tools button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  if (b.disabled) throw new Error(`button disabled: ${label}`);
  b.click();
};
H.action = async (tab, label) => {
  await H.waitFor(() => [...document.querySelectorAll('.tabs .tab')].some((b) => b.textContent === tab), 10000, `tab ${tab}`);
  H.tab(tab);
  await H.wait(80);
  await H.waitFor(() => [...document.querySelectorAll('.tools button')].some((x) => x.textContent === label), 10000, `button ${label}`);
  H.btn(label);
  await H.wait(150);
  // a drawing needs the project folder: without one remembered from an earlier run the app asks, and the stand-in answers
  if (label === '新工程圖' && store.getState().folderRequest) await H.modalButton('選擇資料夾…');
};
/**
 * 「新工程圖」 and then the views (D-V2, ADR 0134): a new drawing is an empty sheet whose main view the user places, so a script that wants the three views
 * asks for them as a person would — the 「標準三視圖」 button of the task pane — and one that wants others names them.
 */
H.newDrawing = async (directions) => {
  await H.action('檔案', '新工程圖');
  await H.waitFor(() => store.getState().drw, 20000, 'the new drawing');
  if (directions) {
    await H.waitFor(() => store.getState().drw.palette, 30000, 'the part of the drawing');
    store.drawingStore.addViews(directions);
    return;
  }
  const button = await H.waitFor(() => {
    const b = document.querySelector('[data-action="standardViews"]');
    return b && !b.disabled ? b : null;
  }, 30000, 'the standard 3 views button');
  button.click();
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
/** A tree row's name: the text of its name, not what the tree shows beside it (▾ of the sketches under it, ▲ 父 / ▼ 子 badges, ↳ the parent, └── lines). */
H.rowName = (x) => (x.querySelector('.name')?.textContent ?? x.textContent).replace(/^\([-+f?]\) /, '');
H.treeClick = async (name) => {
  // a part with one body lists the body under the name of its first feature: the feature's own row is the one that edits
  const found = [...document.querySelectorAll('.tree-row')].filter((x) => H.rowName(x) === name);
  const r = found.find((x) => !x.classList.contains('body')) ?? found[0];
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
H.ready = () => store.viewer?.resize();
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
  // A new assembly opens in 「開始組合件」 already.
  if (!H.asm()?.insert) await H.action('組合件', '插入零組件');
  await H.wait(100);
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
/** Leaves nothing unsaved behind (a part with changes keeps a recovery copy in the browser, which the next load offers: 找到沒有儲存的零件): saves it into the e2e project. */
H.tidy = async () => {
  if (!H.asm() && store.getState().dirty) await H.save('tidy.3dbx');
};
/** The text of a STEP file the app wrote, with the \X2\…\X0\ escapes (names outside ASCII, four hex digits a character) turned back into characters. */
H.decodeStep = (raw) => raw.replace(/\\X2\\([0-9A-F]+)\\X0\\/g, (_, hex) => hex.match(/.{4}/g).map((h) => String.fromCharCode(parseInt(h, 16))).join(''));
H.open = async (path) => {
  document.querySelector('.status-bar .notice')?.click(); // dismiss the last notice, so the next one is this open's
  H.next.open = path;
  await H.action('檔案', '開啟舊檔');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…'); // an assembly asks for its project folder when none is remembered
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
  H.check(document.querySelector('.tabs .tab.active')?.textContent === '組合件', 'on the 組合件 tab');
  // A new assembly starts in 「開始組合件」, after the project folder is chosen (asked once per session).
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => document.querySelector('.property-manager .pm-title')?.textContent === '開始組合件', 5000, '開始組合件');
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

H.row = (name) => [...document.querySelectorAll('.feature-tree .tree-row')].find((r) => H.rowName(r) === name);
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
 * Run in a freshly loaded page after all(), with no project folder remembered (__asm.forget(), then
 * reload): 「開啟舊檔」 on the assembly asks for the project folder; a folder that does not contain it is
 * refused and asked again.
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

// ---------------------------------------------------------------- 2C: mates, picked as a user picks them

H.worldToClient = ([x, y, z]) => {
  const r = H.rect();
  const p = store.viewer.screenOf({ origin: [x, y, z], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }, [0, 0]);
  return { x: r.left + p.x, y: r.top + p.y };
};
H.hud = async (label) => {
  [...document.querySelectorAll('.heads-up button')].find((b) => b.textContent === label).click();
  await H.wait(150);
};
/** Middle-drag: turns the view (the SolidWorks mouse). */
H.orbit = async (dx, dy) => {
  const r = H.rect();
  const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
  H.canvas().dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 2, button: 1, buttons: 4 }));
  for (let i = 1; i <= 10; i++) window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + (dx * i) / 10, clientY: y + (dy * i) / 10, bubbles: true, pointerId: 2, buttons: 4 }));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + dx, clientY: y + dy, bubbles: true, pointerId: 2, button: 1, buttons: 0 }));
  await H.wait(150);
};
/** Wheel-zooms in (steps > 0) or out at a point of the assembly, if it is on screen. */
H.zoomAt = async (world, steps) => {
  const { x, y } = H.worldToClient(world);
  const r = H.rect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
  for (let i = 0; i < Math.abs(steps); i++) {
    H.canvas().dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: steps > 0 ? -100 : 100, bubbles: true, cancelable: true }));
    await H.wait(20);
  }
  await H.wait(80);
};
/** Points on an element of a component, in its part's coordinates: triangle centers, edge points, the vertex. */
H.pointsOn = (build, kind, index) => {
  const m = build.mesh;
  const pts = [];
  if (kind === 'face') {
    for (let r = 0; r < m.faceRanges.length; r += 3) {
      if (m.faceRanges[r + 2] !== index) continue;
      for (let i = m.faceRanges[r]; i < m.faceRanges[r] + m.faceRanges[r + 1]; i += 3) {
        const c = [0, 0, 0];
        for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) c[a] += m.positions[m.indices[i + k] * 3 + a] / 3;
        pts.push(c);
      }
    }
  } else if (kind === 'edge') {
    for (let g = 0; g < m.edgeRanges.length; g += 3) {
      if (m.edgeRanges[g + 2] !== index) continue;
      for (let p = m.edgeRanges[g]; p < m.edgeRanges[g] + m.edgeRanges[g + 1] - 1; p++) pts.push([0, 1, 2].map((a) => (m.edgePoints[p * 3 + a] + m.edgePoints[p * 3 + 3 + a]) / 2));
    }
  } else {
    pts.push([0, 1, 2].map((a) => build.vertexPoints[index * 3 + a]));
  }
  // Spread out: every n-th point, so a big face does not take long to scan.
  const step = Math.max(1, Math.floor(pts.length / 40));
  return pts.filter((_, i) => i % step === 0);
};
/**
 * Picks an element of a component the way a user does: moves the cursor over points of it until the
 * viewer says that very element is under the cursor, then clicks. If none shows, the view is turned
 * (from below, then the standard views) and tried again.
 */
H.pickOn = async (component, kind, name) => {
  const a = store.assembly;
  const build = a.buildOf(component);
  const names = kind === 'face' ? build.faceNames : kind === 'edge' ? build.edgeNames : build.vertexNames;
  const index = names.indexOf(name);
  if (index < 0) throw new Error(`${component} has no ${kind} ${name}`);
  // the views of the cube too, last: a face that looks away from every one of the above (the left side, the back) shows from its own side
  const views = [
    async () => H.hud('等角'),
    async () => (await H.hud('等角'), await H.orbit(0, -260)),
    async () => H.hud('前視'),
    async () => H.hud('右視'),
    async () => H.hud('上視'),
    async () => (await H.hud('前視'), await H.orbit(0, -200)),
    ...['left', 'back', 'bottom'].map((name) => async () => (store.viewer.setView(name), await H.wait(250))),
    // a face that looks down at a gap (the underside of a part above another): from the side, a little below it
    ...['前視', '右視'].flatMap((name) => [60, -60, 110, -110].map((dy) => async () => (await H.hud(name), await H.orbit(0, dy)))),
  ];
  const r = H.rect();
  const points = H.pointsOn(build, kind, index);
  const middle = transformPoint(a.poseOf(component), [0, 1, 2].map((k) => points.reduce((s, q) => s + q[k], 0) / points.length));
  // Each view as it is, then zoomed in on the element: small faces hide behind their edges otherwise.
  const tries = views.flatMap((view) => [view, async () => (await view(), await H.zoomAt(middle, 8))]);
  for (const view of tries) {
    await view();
    for (const p of points) {
      // Whole pixels, as a mouse reports them: a click's clientX/Y are whole, so the hover must be too.
      const c = H.worldToClient(transformPoint(a.poseOf(component), p));
      const [x, y] = [Math.round(c.x), Math.round(c.y)];
      if (x < r.left + 4 || x > r.right - 4 || y < r.top + 4 || y > r.bottom - 4) continue;
      H.ptr('pointermove', x, y);
      const h = store.viewer.hoveredElement;
      if (h && h.key === component && h.kind === kind && h.index === index) {
        H.ptr('pointerdown', x, y);
        H.ptr('pointerup', x, y);
        H.canvas().dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
        await H.wait(120);
        await H.hud('等角');
        await H.hud('全部顯示');
        return;
      }
    }
  }
  throw new Error(`could not get the cursor onto ${kind} ${name} of ${component}`);
};
const transformPoint = (pose, [px, py, pz]) => {
  const m = H.poseMatrix(pose);
  return [m[0] * px + m[4] * py + m[8] * pz + m[12], m[1] * px + m[5] * py + m[9] * pz + m[13], m[2] * px + m[6] * py + m[10] * pz + m[14]];
};
/** A plane or the origin, from the flyout tree: 'asm' for the assembly's own, or a component's name. */
H.flyout = async (owner, label) => {
  const tree = document.querySelector('.flyout-tree');
  if (!tree) throw new Error('no flyout tree');
  let list = tree.querySelector('ul');
  if (owner !== 'asm') {
    const row = [...tree.querySelectorAll('.flyout-component')].find((x) => x.textContent.includes(owner));
    if (!row) throw new Error(`no ${owner} in the flyout tree`);
    if (!row.nextElementSibling || row.nextElementSibling.tagName !== 'UL') {
      row.click();
      await H.wait(80);
    }
    list = row.nextElementSibling;
  }
  const item = [...list.querySelectorAll('li')].find((li) => li.textContent === label);
  if (!item) throw new Error(`no ${label} under ${owner}`);
  item.click();
  await H.wait(120);
};
H.mateType = async (label) => {
  const b = [...document.querySelectorAll('.mate-types button')].find((x) => x.textContent === label);
  if (!b || b.disabled) throw new Error(`mate type ${label} not offered`);
  b.click();
  await H.wait(120);
};
H.mateValue = async (value) => {
  const input = document.querySelector('.property-manager .value-input input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.wait(120);
};
/** Waits for the preview of the mate being defined to be solved. */
H.previewed = async () => {
  await H.waitFor(() => {
    const d = H.asm().mate;
    return d && d.a && d.b && H.asm().solution?.mates.has(d.editing ?? 'preview');
  }, 5000, 'the mate preview');
  await H.wait(100);
};
H.mateOk = async () => {
  const before = H.asm().doc.mates.length;
  document.querySelector('.property-manager .pm-ok').click();
  await H.waitFor(() => H.asm().doc.mates.length === before + 1 || !H.asm().mate, 5000, 'the mate to be added');
  await H.wait(200);
};
/** One mate: two elements, the type (when not the suggested one), options; returns what the PropertyManager showed. */
H.mate = async (first, second, { type, value, align } = {}) => {
  const pick = async ([owner, kind, name]) => (kind === 'datum' ? H.flyout(owner, name) : H.pickOn(owner, kind, name));
  await pick(first);
  await pick(second);
  const suggested = document.querySelector('.mate-types button.active')?.textContent;
  if (type && type !== suggested) await H.mateType(type);
  if (value !== undefined) await H.mateValue(value);
  if (align) [...document.querySelectorAll('.mate-align button')].find((b) => b.textContent === align).click();
  await H.previewed();
  const preview = document.querySelector('.property-manager .pm-group:last-child p')?.textContent;
  await H.mateOk();
  return { suggested, preview };
};
H.solved = async () => {
  await H.wait(200);
  await H.waitFor(() => H.asm().solution && H.asm().solution.mates.size === H.asm().doc.mates.length, 10000, 'the solve');
};

/**
 * 2C acceptance (handoff §10): the three golden parts made into a small fixture with the UI only, and
 * fully defined; then a contradicting mate, named.
 */
asm.fixture = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx`, '零件/削邊銷.3dbx': `${H.GOLDEN}diamond-pin.3dbx` });
  await H.action('檔案', '新組合件');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  const plate = await H.insert('定位板.3dbx');
  const vblock = await H.insert('V型塊.3dbx', [0.25, 0.25]);
  const pin1 = await H.insert('零件/削邊銷.3dbx', [0.8, 0.3]);
  const pin2 = await H.insert('零件/削邊銷.3dbx', [0.8, 0.7]);
  await H.loaded();
  await H.hud('全部顯示');
  const log = [];

  await H.action('組合件', '結合');
  // The diamond pins: shank concentric with an R4 hole, flange on the top, flat squared to the side.
  // The flange's underside is hidden under it once the pin is in its hole; as in SolidWorks, its bottom
  // edge (seen from above) puts the flange on the face just the same.
  for (const [pin, hole] of [[pin1.id, 'cut1:side:sketch2.ci5'], [pin2.id, 'cut1:side:sketch2.ci6']]) {
    log.push(await H.mate([plate.id, 'face', hole], [pin, 'face', 'revolve1:side:sketch1.l3#1']));
    log.push(await H.mate([plate.id, 'face', 'extrude1:cap:end'], [pin, 'edge', '{revolve1:side:sketch1.l4|revolve1:side:sketch1.l5}']));
    log.push(await H.mate([plate.id, 'face', 'extrude1:side:sketch1.l4'], [pin, 'face', 'cut1:cap:start'], { type: '平行' }));
  }
  // The V-block: its bottom on the top, its middle planes on the plate's.
  log.push(await H.mate([plate.id, 'face', 'extrude1:cap:end'], [vblock.id, 'face', 'extrude1:side:sketch1.l1']));
  log.push(await H.mate(['定位板<1>', 'datum', '右基準面'], ['V型塊<1>', 'datum', '右基準面']));
  log.push(await H.mate(['定位板<1>', 'datum', '前基準面'], ['V型塊<1>', 'datum', '前基準面']));
  document.querySelector('.property-manager .pm-ok').click(); // ✓ with nothing chosen: done
  await H.solved();

  const s = H.asm().solution;
  const at = (id, p) => transformPoint(s.poses.get(id), p).map((v) => +v.toFixed(6));
  const result = {
    mates: H.asm().doc.mates.map((m) => [m.name, s.mates.get(m.id).status]),
    components: H.asm().doc.components.map((c) => [c.id, s.components.get(c.id)]),
    tree: H.tree(),
    status: document.querySelector('.status-bar').textContent,
    pins: [at(pin1.id, [0, 0, 0]), at(pin2.id, [0, 0, 0])],
    vblock: at(vblock.id, [0, 0, 0]),
    log,
  };
  H.check(result.mates.every(([, st]) => st === 'ok'), 'every mate holds');
  H.check(result.components.every(([, r]) => r.status === 'fixed' || r.status === 'full'), 'fully defined');
  H.check(result.status.includes('完全定義'), 'the status bar says so');

  // A contradicting mate: the V-block's top 30 mm above the plate, where the block (40 mm high) sits on it.
  await H.action('組合件', '結合');
  const extra = await H.mate([plate.id, 'face', 'extrude1:cap:end'], [vblock.id, 'face', 'extrude1:side:sketch1.l3'], { type: '距離', value: '30' });
  document.querySelector('.property-manager .pm-ok').click();
  await H.solved();
  const bad = H.asm().doc.mates.filter((m) => H.asm().solution.mates.get(m.id).status !== 'ok').map((m) => m.name);
  result.conflict = { preview: extra.preview, named: bad, tree: H.tree().filter((t) => t.startsWith('(+)')), status: document.querySelector('.status-bar').textContent };
  H.check(bad.length === 1 && bad[0].startsWith('距離'), `only the new distance is named: ${bad}`);
  H.check(result.conflict.tree.join() === '(+) V型塊<1>', 'the V-block is over-defined');
  return result;
};

H.treeRow = (text) => [...document.querySelectorAll('.feature-tree .tree-row')].find((r) => r.textContent.startsWith(text));
H.mateMenu = async (mateName, item) => {
  H.treeRow(mateName).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 150, clientY: 300 }));
  await H.wait(80);
  const li = [...document.querySelectorAll('.context-menu li')].find((x) => x.textContent === item);
  if (!li) throw new Error(`no menu item ${item} for ${mateName}`);
  li.click();
  await H.wait(150);
};
const statusOf = (name) => {
  const a = H.asm();
  const m = a.doc.mates.find((x) => x.name === name);
  return m && a.solution.mates.get(m.id).status;
};

/**
 * Run after fixture(): managing mates (C15.12). The conflicting mate is found with 「錯誤為何？」 and
 * deleted; a mate is edited into a distance and undone; one is suppressed and back; the assembly is
 * saved and reopened fully defined.
 */
asm.mateExtras = async () => {
  const out = {};
  // 「錯誤為何？」 lists the conflict; a click selects it, Delete asks, and it goes.
  document.querySelector('.status-bar .whats-wrong-button').click();
  await H.wait(100);
  const listed = [...document.querySelectorAll('.whats-wrong li strong')].map((x) => x.textContent);
  H.check(listed.join() === '距離1', `錯誤為何 lists ${listed}`);
  document.querySelector('.whats-wrong li').click();
  await H.wait(100);
  H.check(H.asm().doc.mates.find((m) => m.id === H.asm().selected)?.name === '距離1', 'the conflict is selected');
  await H.key('Delete');
  await H.modalButton('刪除');
  await H.solved();
  H.check(!H.asm().doc.mates.some((m) => m.name === '距離1') && document.querySelector('.status-bar').textContent.includes('完全定義'), 'deleted: fully defined again');
  out.deleted = 'ok';

  // Selecting a mate shows its two elements.
  H.treeRow('同軸心1').click();
  await H.wait(150);
  out.shown = store.viewer.selectedElements.map((e) => `${e.key}:${e.kind}`);
  H.check(out.shown.length === 2, 'both elements of the selected mate are shown');

  // Edit: the V-block's right planes become 10 mm apart; undo brings the coincidence back.
  await H.mateMenu('重合4', '編輯結合');
  await H.mateType('距離');
  await H.mateValue('10');
  await H.previewed();
  document.querySelector('.property-manager .pm-ok').click();
  await H.solved();
  const x = () => +transformPoint(H.asm().solution.poses.get(H.asm().doc.components[1].id), [0, 0, 0])[0].toFixed(6);
  out.edited = { names: H.asm().doc.mates.map((m) => m.name), x: x() };
  // Along the plate's right plane's normal (+x): the plain side, since the planes were coincident.
  H.check(out.edited.x === 10 && statusOf('距離1') === 'ok', `the V-block moved 10 mm along +x: ${out.edited.x}`);
  await H.ctrl('z');
  await H.solved();
  H.check(x() === 0 && statusOf('重合4') === 'ok', 'undo: back on the middle');
  out.edit = 'ok';

  // Suppress: the pin can turn again (-); unsuppress: fully defined.
  await H.mateMenu('平行2', '抑制');
  await H.solved();
  const pin2 = H.asm().doc.components[3];
  H.check(H.asm().solution.components.get(pin2.id).status === 'under' && H.treeRow('(-) 削邊銷<2>'), 'suppressed: the pin turns in its hole');
  await H.mateMenu('平行2', '恢復抑制');
  await H.solved();
  H.check(H.asm().solution.components.get(pin2.id).status === 'full', 'back');
  out.suppress = 'ok';

  // Saved with its mates, reopened fully defined, everything where it was.
  const before = JSON.stringify([...H.asm().solution.poses].map(([k, p]) => [k, p.position.map((v) => +v.toFixed(6))]));
  await H.save('小夾具.3dba');
  await H.action('檔案', '新零件');
  await H.open('小夾具.3dba');
  await H.solved();
  const after = JSON.stringify([...H.asm().solution.poses].map(([k, p]) => [k, p.position.map((v) => +v.toFixed(6))]));
  H.check(before === after && document.querySelector('.status-bar').textContent.includes('完全定義'), 'reopened as it was');
  out.reopened = { mates: H.asm().doc.mates.length, schema: H.asm().doc.schemaVersion };
  return out;
};

/**
 * STEP files as components (user report 2026-09-29: the STEP files did not show): the list holds them,
 * tagged STEP, but not what lies in node_modules; a STEP plate takes a pin in its hole.
 */
asm.step = async () => {
  H.ready();
  const STEP = `${H.GOLDEN.replace(/golden\/$/, 'fixtures/step/')}plate-with-hole.step`;
  await H.project({ 'CIV0000467治具.STEP': STEP, '削邊銷.3dbx': `${H.GOLDEN}diamond-pin.3dbx`, 'node_modules/pkg/skip.step': STEP });
  await H.action('檔案', '新組合件');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => H.asm()?.insert?.files, 10000, 'the part list');
  const listed = [...document.querySelectorAll('.file-list li')].map((li) => li.textContent);
  H.check(JSON.stringify([...H.asm().insert.files].sort()) === JSON.stringify(['CIV0000467治具.STEP', '削邊銷.3dbx'].sort()), `listed: ${H.asm().insert.files}`);
  const plate = await H.insert('CIV0000467治具.STEP');
  const pin = await H.insert('削邊銷.3dbx', [0.8, 0.3]);
  await H.loaded();
  H.check(H.tree().join('|').includes('(f) CIV0000467治具<1>|(-) 削邊銷<1>'), `tree: ${H.tree()}`);
  H.check(store.viewer.instances.size === 2, 'both shown');
  const build = store.assembly.buildOf(plate.id);
  const hole = build.faceNames[build.faceGeometry.findIndex((g) => g?.kind === 'cylinder' && !g.convex)];
  await H.action('組合件', '結合');
  const log = await H.mate([plate.id, 'face', hole], [pin.id, 'face', 'revolve1:side:sketch1.l3#1']);
  document.querySelector('.property-manager .pm-ok').click();
  await H.solved();
  const r = H.asm().solution;
  H.check(r.mates.get(H.asm().doc.mates[0].id).status === 'ok' && r.components.get(pin.id).dof === 2, 'the pin turns and slides in the hole of the STEP plate');
  return { listed, hole, log, pin: r.components.get(pin.id), problems: build.problems };
};


// ---------------------------------------------------------------- 2D: moving components, reference files

/**
 * A drag with a mouse button (left moves, right turns): the cursor comes in, the button goes down,
 * the cursor moves through `path` in whole pixels, and the button comes up where it ends.
 */
H.drag = async (path, button = 'left') => {
  const [b, bs] = button === 'left' ? [0, 1] : [2, 2];
  const c = H.canvas();
  const ev = (type, p, extra) => c.dispatchEvent(new PointerEvent(type, { clientX: Math.round(p.x), clientY: Math.round(p.y), bubbles: true, pointerId: 1, ...extra }));
  ev('pointermove', path[0], { buttons: 0 });
  ev('pointerdown', path[0], { button: b, buttons: bs });
  for (const p of path.slice(1)) {
    ev('pointermove', p, { buttons: bs });
    await H.wait(40);
  }
  const end = path[path.length - 1];
  ev('pointerup', end, { button: b, buttons: 0 });
  if (button === 'left') c.dispatchEvent(new MouseEvent('click', { clientX: Math.round(end.x), clientY: Math.round(end.y), bubbles: true }));
  await H.waitFor(() => !H.asm().drag, 5000, 'the drag to end');
  await H.solved();
};
/** A straight path of `n` steps. */
H.line = (from, to, n = 12) => Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }));
/**
 * A screen point on a component the cursor really finds there: points of its mesh (in the part's
 * coordinates, `choose` orders them), each pulled 10 % toward `toward` so it is not on an edge pixel.
 */
H.onComponent = (component, choose = (pts) => pts, toward = null) => {
  const build = store.assembly.buildOf(component);
  const pose = H.asm().solution.poses.get(component);
  const m = build.mesh.positions;
  let pts = [];
  for (let i = 0; i < m.length; i += 3) pts.push([m[i], m[i + 1], m[i + 2]]);
  pts = choose(pts);
  const r = H.rect();
  for (const p of pts.slice(0, 400)) {
    const w = transformPoint(pose, p);
    const q = toward ? w.map((v, k) => v + 0.1 * (toward[k] - v)) : w;
    const s = H.worldToClient(q);
    const [x, y] = [Math.round(s.x), Math.round(s.y)];
    if (x < r.left + 4 || x > r.right - 4 || y < r.top + 4 || y > r.bottom - 4) continue;
    H.ptr('pointermove', x, y);
    if (store.viewer.hoveredInstance === component) return { x, y, world: q };
  }
  throw new Error(`the cursor finds no point of ${component}`);
};
H.pose = (id) => H.asm().solution.poses.get(id);
H.placement = (id) => H.asm().doc.components.find((c) => c.id === id).placement;
H.near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** Angle of a component's x axis about the y axis (radians), seen from above. */
H.yaw = (id) => {
  const o = transformPoint(H.pose(id), [0, 0, 0]);
  const x = transformPoint(H.pose(id), [1, 0, 0]);
  return Math.atan2(-(x[2] - o[2]), x[0] - o[0]);
};
H.pmSelect = async (label, value) => {
  const s = document.querySelector(`.property-manager select[aria-label="${label}"]`);
  if (!s) throw new Error(`no select ${label}`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(100);
};
H.pmFields = async (values) => {
  const inputs = [...document.querySelectorAll('.property-manager .xyz-fields input')];
  if (inputs.length !== values.length) throw new Error(`${inputs.length} fields, ${values.length} values`);
  inputs.forEach((input, i) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(values[i]));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await H.wait(60);
  const before = JSON.stringify(H.asm().doc.components.map((c) => c.placement));
  [...document.querySelectorAll('.property-manager button')].find((b) => b.textContent === '套用').click();
  await H.wait(300);
  await H.solved();
  return JSON.stringify(H.asm().doc.components.map((c) => c.placement)) !== before;
};
H.notice = () => store.getState().notice?.text ?? '';

/**
 * 2D acceptance, moving (C15.3, A3.5): a free component slides with the cursor; a pin seated in its
 * hole only turns about it when dragged or turned; fixed and fully defined components do not move; Esc
 * cancels a drag; each drag is one undo step. Then moving by numbers in 「移動零組件」/「旋轉零組件」.
 */
asm.move = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx`, '零件/削邊銷.3dbx': `${H.GOLDEN}diamond-pin.3dbx` });
  await H.action('檔案', '新組合件');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  const plate = await H.insert('定位板.3dbx');
  const vblock = await H.insert('V型塊.3dbx', [0.25, 0.3]);
  const pin = await H.insert('零件/削邊銷.3dbx', [0.75, 0.3]);
  await H.loaded();
  await H.solved();
  await H.hud('全部顯示');
  const out = {};

  // A free component (6 freedoms) slides parallel to the screen, without turning.
  const q0 = H.pose(vblock.id);
  const from = H.onComponent(vblock.id);
  const o0 = H.worldToClient(q0.position);
  await H.drag(H.line(from, { x: from.x + 90, y: from.y + 50 }));
  const q1 = H.pose(vblock.id);
  const o1 = H.worldToClient(q1.position);
  out.free = { screen: [+(o1.x - o0.x).toFixed(2), +(o1.y - o0.y).toFixed(2)] };
  H.check(Math.abs(o1.x - o0.x - 90) < 1 && Math.abs(o1.y - o0.y - 50) < 1, `slid with the cursor: ${out.free.screen}`);
  H.check(H.near(q1.rotation, q0.rotation, 1e-9), 'without turning');
  H.check(H.near(H.placement(vblock.id).position, q1.position, 1e-9) && H.asm().dirty, 'where it went is its placement now');
  await H.ctrl('z');
  await H.solved();
  H.check(H.near(H.pose(vblock.id).position, q0.position, 1e-9), 'undo puts it back');
  out.undo = 'ok';

  // Esc during a drag puts it back, and nothing is written.
  const doc0 = JSON.stringify(H.asm().doc);
  const at = H.onComponent(vblock.id);
  const c = H.canvas();
  c.dispatchEvent(new PointerEvent('pointerdown', { clientX: at.x, clientY: at.y, bubbles: true, pointerId: 1, button: 0, buttons: 1 }));
  for (let i = 1; i <= 8; i++) {
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: at.x + 10 * i, clientY: at.y, bubbles: true, pointerId: 1, buttons: 1 }));
    await H.wait(40);
  }
  await H.waitFor(() => H.asm().drag?.poses, 5000, 'the drag');
  await H.key('Escape');
  c.dispatchEvent(new PointerEvent('pointerup', { clientX: at.x + 80, clientY: at.y, bubbles: true, pointerId: 1, button: 0, buttons: 0 }));
  c.dispatchEvent(new MouseEvent('click', { clientX: at.x + 80, clientY: at.y, bubbles: true }));
  await H.wait(200);
  H.check(!H.asm().drag && JSON.stringify(H.asm().doc) === doc0 && H.near(H.pose(vblock.id).position, q0.position, 1e-9), 'Esc cancels the drag');
  out.escape = 'ok';

  // The fixed plate does not move.
  const p0 = H.pose(plate.id);
  const onPlate = H.onComponent(plate.id);
  document.querySelector('.status-bar .notice')?.click();
  await H.drag(H.line(onPlate, { x: onPlate.x + 60, y: onPlate.y }));
  H.check(H.near(H.pose(plate.id).position, p0.position, 1e-12) && H.notice().includes('已固定'), `the fixed plate stays: ${H.notice()}`);
  out.fixed = H.notice();

  // Seat the pin: its shank in the plate's hole, its flange on the top.
  await H.action('組合件', '結合');
  await H.mate([plate.id, 'face', 'cut1:side:sketch2.ci6'], [pin.id, 'face', 'revolve1:side:sketch1.l3#1']);
  await H.mate([plate.id, 'face', 'extrude1:cap:end'], [pin.id, 'edge', '{revolve1:side:sketch1.l4|revolve1:side:sketch1.l5}']);
  document.querySelector('.property-manager .pm-ok').click();
  await H.solved();
  H.check(H.asm().solution.components.get(pin.id).dof === 1, 'the pin can only turn in its hole');

  // Dragged from above round its hole by a quarter turn, the pin turns about the hole only.
  await H.hud('上視');
  await H.zoomAt([-40, 15, 0], 6);
  const axis = transformPoint(H.pose(pin.id), [0, 0, 0]);
  const radius = (p) => Math.hypot(p[0], p[2]);
  const grab = H.onComponent(pin.id, (pts) => pts.filter((p) => p[1] > 10).sort((a, b) => radius(b) - radius(a)), [axis[0], transformPoint(H.pose(pin.id), [0, 30, 0])[1], axis[2]]);
  const yaw0 = H.yaw(pin.id);
  const [dx, dz] = [grab.world[0] - axis[0], grab.world[2] - axis[2]];
  const arc = Array.from({ length: 13 }, (_, i) => {
    const t = ((Math.PI / 2) * i) / 12; // about +y: x → −z
    return H.worldToClient([axis[0] + dx * Math.cos(t) + dz * Math.sin(t), grab.world[1], axis[2] - dx * Math.sin(t) + dz * Math.cos(t)]);
  });
  await H.drag(arc);
  const turned = H.yaw(pin.id) - yaw0;
  const pinAxis = transformPoint(H.pose(pin.id), [0, 0, 0]);
  out.turned = +((turned * 180) / Math.PI).toFixed(2);
  H.check(Math.abs(out.turned - 90) < 1.5, `turned a quarter turn: ${out.turned}°`);
  H.check(H.near(pinAxis, axis, 1e-6) && [...H.asm().solution.mates.values()].every((m) => m.status === 'ok'), 'still seated in its hole');
  H.check(H.near(H.placement(pin.id).rotation, H.pose(pin.id).rotation, 1e-9), 'its placement is where it turned to');

  // Turned with the right button, seen from the front: it still turns only about the hole, upright.
  await H.hud('前視');
  await H.zoomAt([-40, 15, 0], 6);
  const steps0 = H.asm().doc;
  const grab2 = H.onComponent(pin.id, (pts) => pts.filter((p) => p[1] > 10).sort((a, b) => radius(b) - radius(a)), [axis[0], grab.world[1], axis[2]]);
  await H.drag(H.line(grab2, { x: grab2.x + 60, y: grab2.y + 10 }), 'right');
  H.check(H.near(transformPoint(H.pose(pin.id), [0, 0, 0]), axis, 1e-6) && H.near(transformPoint(H.pose(pin.id), [0, 1, 0]), [axis[0], axis[1] + 1, axis[2]], 1e-6), 'turning keeps it upright in its hole');
  out.rightDrag = +(((H.yaw(pin.id) - yaw0) * 180) / Math.PI).toFixed(2);
  // Both drags undone: back as it was (its flat facing +x again, to be picked below).
  if (H.asm().doc !== steps0) await H.ctrl('z');
  await H.ctrl('z');
  await H.solved();
  H.check(Math.abs(H.yaw(pin.id) - yaw0) < 1e-6 && H.asm().doc.mates.length === 2, 'undo turns it back');

  // Its flat squared to the plate's side: fully defined, it no longer moves.
  await H.hud('等角');
  await H.hud('全部顯示');
  await H.action('組合件', '結合');
  await H.mate([plate.id, 'face', 'extrude1:side:sketch1.l4'], [pin.id, 'face', 'cut1:cap:start'], { type: '平行' });
  document.querySelector('.property-manager .pm-ok').click();
  await H.solved();
  const full = H.pose(pin.id);
  const onPin = H.onComponent(pin.id);
  document.querySelector('.status-bar .notice')?.click();
  await H.drag(H.line(onPin, { x: onPin.x + 50, y: onPin.y + 20 }));
  H.check(H.near(H.pose(pin.id).position, full.position, 1e-9) && H.notice().includes('完全定義'), `fully defined: stays (${H.notice()})`);
  out.full = H.notice();

  // By numbers: the V-block to (10, 20, 30), then 5 more along x, then a quarter turn about z.
  await H.treeClick('V型塊<1>');
  await H.action('組合件', '移動零組件');
  H.check(document.querySelector('.property-manager .pm-title')?.textContent === '移動零組件', 'the PropertyManager');
  await H.pmSelect('移動方式', 'to');
  await H.pmFields([10, 20, 30]);
  H.check(H.near(H.pose(vblock.id).position, [10, 20, 30], 1e-6), `moved to (10, 20, 30): ${H.pose(vblock.id).position}`);
  await H.pmSelect('移動方式', 'by');
  await H.pmFields([5, 0, 0]);
  H.check(H.near(H.pose(vblock.id).position, [15, 20, 30], 1e-6), 'then 5 mm along x');
  const middle = (id) => {
    const b = store.assembly.buildOf(id).mesh.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < b.length; i += 3) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], b[i + k]);
      hi[k] = Math.max(hi[k], b[i + k]);
    }
    return transformPoint(H.pose(id), lo.map((v, k) => (v + hi[k]) / 2));
  };
  const m0 = middle(vblock.id);
  [...document.querySelectorAll('.property-manager .mate-align button')].find((b) => b.textContent === '旋轉').click();
  await H.wait(100);
  H.check(document.querySelector('.property-manager .pm-title')?.textContent === '旋轉零組件', '旋轉零組件');
  await H.pmSelect('旋轉方式', 'by');
  await H.pmFields([0, 0, 90]);
  const x = transformPoint(H.pose(vblock.id), [1, 0, 0]).map((v, k) => v - H.pose(vblock.id).position[k]);
  H.check(H.near(x, [0, 1, 0], 1e-6) && H.near(middle(vblock.id), m0, 1e-6), 'a quarter turn about z, about its middle');
  // The pin is held by its mates: asked to rise, it stays, and says so. (With the PropertyManager open,
  // components are chosen in the graphics area.)
  await H.hud('上視'); // the V-block, lifted and turned, hides the pin in the isometric view
  const onPin2 = H.onComponent(pin.id, (pts) => pts.sort((a, b) => b[1] - a[1]));
  H.ptr('pointerdown', onPin2.x, onPin2.y);
  H.ptr('pointerup', onPin2.x, onPin2.y);
  H.canvas().dispatchEvent(new MouseEvent('click', { clientX: onPin2.x, clientY: onPin2.y, bubbles: true }));
  await H.wait(150);
  H.check(H.asm().selected === pin.id, 'the pin is chosen');
  [...document.querySelectorAll('.property-manager .mate-align button')].find((b) => b.textContent === '移動').click();
  await H.wait(100);
  await H.pmSelect('移動方式', 'by');
  document.querySelector('.status-bar .notice')?.click();
  const changed = await H.pmFields([0, 5, 0]);
  H.check(!changed && /完全定義|受結合限制/.test(H.notice()), `the pin stays: ${H.notice()}`);
  await H.key('Enter');
  H.check(!H.asm().move, '✓ (Enter) closes it');
  out.numbers = 'ok';
  const steps = [];
  while (H.asm().canUndo && steps.length < 3) {
    await H.ctrl('z');
    steps.push('undo');
  }
  await H.solved();
  out.undoNumbers = H.pose(vblock.id).position.map((v) => +v.toFixed(3));
  return out;
};

/**
 * 2D acceptance, part files (B9.4): 「開啟零件」 from the assembly, a changed dimension, saved;
 * 「返回組合件」 shows the changed part and its mates still hold. A part file saved from elsewhere shows
 * when the window comes back. A renamed file is asked for when the assembly opens and pointed at again;
 * a file moved to another folder is found by its name.
 */
asm.files = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, '零件/削邊銷.3dbx': `${H.GOLDEN}diamond-pin.3dbx` });
  const original = await H.readAt('零件/削邊銷.3dbx');
  await H.action('檔案', '新組合件');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  const plate = await H.insert('定位板.3dbx');
  const pin = await H.insert('零件/削邊銷.3dbx', [0.75, 0.3]);
  await H.loaded();
  await H.action('組合件', '結合');
  await H.mate([plate.id, 'face', 'cut1:side:sketch2.ci6'], [pin.id, 'face', 'revolve1:side:sketch1.l3#1']);
  await H.mate([plate.id, 'face', 'extrude1:cap:end'], [pin.id, 'edge', '{revolve1:side:sketch1.l4|revolve1:side:sketch1.l5}']);
  document.querySelector('.property-manager .pm-ok').click();
  await H.solved();
  H.check(H.near(transformPoint(H.pose(pin.id), [0, 0, 0]), [-40, 0, 0], 1e-6), 'the pin sits in its hole');
  const out = {};

  // Modified and not saved: 「開啟零件」 asks first; saved, the pin opens as the document.
  await H.save('夾具.3dba');
  await H.menu('定位板<1>', '浮動');
  await H.menu('削邊銷<1>', '開啟零件');
  const ask = document.querySelector('.modal[aria-label="要儲存變更嗎"]')?.textContent ?? '';
  H.check(ask.includes('開啟零件之前要先儲存嗎'), `asked: ${ask}`);
  await H.modalButton('取消');
  await H.ctrl('z');
  await H.menu('削邊銷<1>', '開啟零件');
  await H.waitFor(() => store.getState().active === 'part' && store.getState().fileName === '削邊銷.3dbx', 10000, 'the part');
  await H.settle();
  H.check(document.querySelector('.return-bar')?.textContent.includes('夾具'), 'the way back is shown');
  out.opened = store.getState().notice?.text;

  // The shank 15 → 13 mm, in its sketch's Modify box; saved into the part file.
  await H.menu('草圖1', '編輯草圖');
  await H.waitFor(() => store.getState().editing?.kind === 'sketch', 5000, 'the sketch');
  await H.settle();
  const label = store.viewer.labels.get('dim:d3').el;
  label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = await H.waitFor(() => document.querySelector('.modify-box input'), 5000, 'the Modify box');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '13');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(40);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.waitFor(() => !document.querySelector('.modify-box'), 5000, 'the Modify box to close');
  document.querySelector('.property-manager .pm-ok').click(); // 離開草圖
  await H.waitFor(() => !store.getState().editing, 5000, 'the sketch to close');
  await H.settle();
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => !store.getState().dirty, 10000, 'the part to save');

  // Back in the assembly: the shorter pin, still in its hole and on the plate: 2 mm higher.
  document.querySelector('.return-bar').click();
  await H.waitFor(() => H.asm(), 10000, 'the assembly');
  await H.loaded();
  await H.solved();
  const seated = transformPoint(H.pose(pin.id), [0, 0, 0]);
  out.returned = seated.map((v) => +v.toFixed(6));
  H.check(H.near(seated, [-40, 2, 0], 1e-6) && [...H.asm().solution.mates.values()].every((m) => m.status === 'ok'), `the mates hold on the changed pin: ${out.returned}`);
  H.check(!H.asm().dirty && store.getState().returnTo === null, 'the assembly as saved');

  // The part file saved from elsewhere (here: the original written back): the window comes back, it shows.
  await H.writeAt('零件/削邊銷.3dbx', original);
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  await H.waitFor(() => H.near(transformPoint(H.asm().solution.poses.get(pin.id), [0, 0, 0]), [-40, 0, 0], 1e-6), 10000, 'the changed file to show');
  out.refreshed = 'ok';

  // Renamed: opening the assembly asks for it; 「瀏覽…」 points the file entry at the new name.
  await H.writeAt('零件/削邊銷-改.3dbx', original);
  await (await H.root.getDirectoryHandle('零件')).removeEntry('削邊銷.3dbx');
  await H.action('檔案', '新零件');
  await H.open('夾具.3dba');
  await H.waitFor(() => H.asm().relink?.candidates, 5000, 'the missing-file dialog');
  const dialog = document.querySelector('.modal[aria-label="找不到參考的檔案"]')?.textContent ?? '';
  H.check(dialog.includes('零件/削邊銷.3dbx') && dialog.includes('削邊銷<1>') && dialog.includes('沒有同名的檔案'), `asked: ${dialog}`);
  H.next.open = '零件/削邊銷-改.3dbx';
  await H.modalButton('瀏覽…');
  await H.waitFor(() => !H.asm().relink, 10000, 'the dialog to close once the file is read');
  await H.loaded();
  await H.solved();
  H.check(H.asm().doc.files.map((f) => f.path).join() === '定位板.3dbx,零件/削邊銷-改.3dbx' && H.asm().dirty, 'pointed at the new name');
  H.check([...H.asm().solution.mates.values()].every((m) => m.status === 'ok') && H.tree().join('|').includes('削邊銷-改<1>'), 'its mates hold');
  await H.save('夾具.3dba');
  out.renamed = H.tree();

  // Moved to another folder under the same name: offered by the dialog.
  await H.writeAt('舊版/削邊銷-改.3dbx', original);
  await (await H.root.getDirectoryHandle('零件')).removeEntry('削邊銷-改.3dbx');
  await H.action('檔案', '新零件');
  await H.open('夾具.3dba');
  await H.waitFor(() => H.asm().relink?.candidates, 5000, 'the missing-file dialog');
  await H.modalButton('使用 舊版/削邊銷-改.3dbx');
  await H.waitFor(() => !H.asm().relink, 10000, 'the dialog to close');
  await H.loaded();
  await H.solved();
  H.check(H.asm().doc.files[1].path === '舊版/削邊銷-改.3dbx' && [...H.asm().solution.mates.values()].every((m) => m.status === 'ok'), 'found where it went');
  await H.save('夾具.3dba');
  out.moved = 'ok';
  return out;
};

/**
 * (C15.3) The hint at the foot of the graphics area while the cursor is on a component: which button
 * does what, or why it cannot be dragged. Needs a page that is drawn (the cursor has to be over the part).
 */
asm.hint = async () => {
  const out = {};
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
  await H.action('檔案', '新組合件');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  const plate = await H.insert('定位板.3dbx');
  const vblock = await H.insert('V型塊.3dbx', [0.25, 0.25]);
  await H.loaded();
  await H.hud('全部顯示');
  const hint = async (id) => {
    const p = H.onComponent(id);
    H.ptr('pointermove', p.x, p.y);
    await H.wait(150);
    return document.querySelector('.pick-hint')?.textContent ?? null;
  };
  out.fixed = await hint(plate.id);
  H.check(out.fixed?.endsWith('（已固定，不能拖曳）'), `fixed: ${out.fixed}`);
  out.free = await hint(vblock.id);
  H.check(out.free?.endsWith('（左鍵拖曳移動，右鍵拖曳旋轉）'), `free: ${out.free}`);
  await H.action('組合件', '旋轉零組件');
  out.rotateTool = await hint(vblock.id);
  H.check(out.rotateTool?.endsWith('（左鍵拖曳旋轉，右鍵拖曳旋轉）'), `with 旋轉零組件 open: ${out.rotateTool}`);
  await H.key('Enter'); // closes the PropertyManager
  // Held by three mates on the plate (bottom on the top, centred on its right and front planes): fully defined.
  const mate = (id, a, b, align) => ({ id, name: id, type: 'coincident', a: { component: plate.id, ref: a }, b: { component: vblock.id, ref: b }, align, suppressed: false });
  const face = (name) => ({ kind: 'face', name });
  const datum = (name) => ({ kind: 'datum', name });
  store.assembly.execute({ type: 'insertMate', mate: mate('m1', face('extrude1:cap:end'), face('extrude1:side:sketch1.l1'), 'antiAligned') });
  store.assembly.execute({ type: 'insertMate', mate: mate('m2', datum('plane:right'), datum('plane:right'), 'aligned') });
  store.assembly.execute({ type: 'insertMate', mate: mate('m3', datum('plane:front'), datum('plane:front'), 'aligned') });
  await H.solved();
  await H.hud('等角');
  out.defined = await hint(vblock.id);
  H.check(out.defined?.endsWith('（已被結合完全定義，不能拖曳）'), `fully defined: ${out.defined}`);
  return out;
};

/** 「輸出 STEP」 in the assembly: what the button downloads, or null (and why) when it does not. */
H.exportedStep = async () => {
  const downloads = [];
  const create = URL.createObjectURL;
  URL.createObjectURL = (blob) => (downloads.push(blob), create.call(URL, blob));
  document.querySelector('.status-bar .notice')?.click();
  try {
    await H.action('檔案', '輸出 STEP');
    await H.waitFor(() => store.getState().notice, 20000, 'the export notice');
    const notice = store.getState().notice;
    return { notice, text: downloads[0] ? await downloads[0].text() : null };
  } finally {
    URL.createObjectURL = create;
  }
};

/**
 * (F1.2, 2E) 「輸出 STEP」 in the assembly writes the components where they are shown, one product per
 * part file, named after the files and the tree; while a PropertyManager is open the command is off; a
 * part file that cannot be read stops the export with its name, and nothing is written.
 *
 * The jig is made here: the components are inserted through the UI and the pins seated by the same
 * mates as fixture(), added as commands (picking them with the cursor, as fixture() does, needs a page
 * that is drawn). The pins are seated by concentric + coincident: each keeps one turn about its hole.
 */
asm.exportStep = async () => {
  const out = {};
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx`, '零件/削邊銷.3dbx': `${H.GOLDEN}diamond-pin.3dbx` });
  await H.action('檔案', '新組合件');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  const plate = await H.insert('定位板.3dbx');
  const vblock = await H.insert('V型塊.3dbx', [0.25, 0.25]);
  const pin1 = await H.insert('零件/削邊銷.3dbx', [0.8, 0.3]);
  const pin2 = await H.insert('零件/削邊銷.3dbx', [0.8, 0.7]);
  await H.loaded();
  const face = (name) => ({ kind: 'face', name });
  for (const [pin, hole] of [[pin1.id, 'cut1:side:sketch2.ci5'], [pin2.id, 'cut1:side:sketch2.ci6']]) {
    const mate = (type, a, b, align) => ({ id: `${type}-${pin}`, name: `${type}-${pin}`, type, a: { component: plate.id, ref: face(a) }, b: { component: pin, ref: face(b) }, align, suppressed: false });
    store.assembly.execute({ type: 'insertMate', mate: mate('concentric', hole, 'revolve1:side:sketch1.l3#1', 'aligned') });
    store.assembly.execute({ type: 'insertMate', mate: mate('coincident', 'extrude1:cap:end', 'revolve1:side:sketch1.l4', 'antiAligned') });
  }
  await H.solved();
  H.check([...H.asm().solution.mates.values()].every((m) => m.status === 'ok'), 'every mate holds');
  const stored = H.asm().doc.components.find((c) => c.id === pin1.id).placement;
  H.check(!H.near(H.pose(pin1.id).position, stored.position, 1), 'the seated pin is not where it was dropped');

  const enabled = (label) => [...document.querySelectorAll('.tools button')].find((b) => b.textContent === label)?.disabled === false;
  H.tab('檔案');
  await H.wait(80);
  H.check(enabled('輸出 STEP'), '輸出 STEP is on for an assembly with components');
  await H.action('組合件', '結合');
  H.tab('檔案');
  await H.wait(80);
  H.check(!enabled('輸出 STEP'), '輸出 STEP is off while the mate PropertyManager is open');
  document.querySelector('.property-manager .pm-cancel, .property-manager .pm-ok').click();
  await H.wait(150);

  // The file, read the way STEP says: the products (one per part file), the placed uses of them.
  const r = await H.exportedStep();
  H.check(r.text && r.notice.kind !== 'error', `written: ${r.notice.text}`);
  const text = r.text;
  const names = (re) => [...text.matchAll(re)].map((m) => m[1]);
  out.notice = r.notice.text;
  out.products = names(/PRODUCT\('[^']*','([^']*)'/g);
  out.uses = (text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || []).length;
  out.solids = (text.match(/MANIFOLD_SOLID_BREP/g) || []).length;
  H.check(out.notice === `已輸出 ${H.asm().untitled}.step`, `notice: ${out.notice}`);
  for (const n of ['定位板', 'V型塊', '削邊銷']) H.check(out.products.includes(n), `product ${n} in ${out.products}`);
  H.check(out.uses === 4, `4 components (plate, V-block, 2 pins): ${out.uses}`);
  H.check(out.solids === 3, `one solid per part file: ${out.solids}`);

  // Where each component is written is where it is shown: its origin is a point of the file.
  const points = [...text.matchAll(/CARTESIAN_POINT\('[^']*',\(([^)]*)\)\)/g)].map((m) => m[1].split(',').map(Number));
  const shown = H.asm().doc.components.map((c) => [c.id, H.pose(c.id).position]);
  for (const [id, p] of shown) H.check(points.some((q) => q.length === 3 && H.near(q, p, 1e-6)), `${id} at ${p.map((v) => +v.toFixed(3))} is in the file`);
  out.placed = shown.map(([id, p]) => [id, p.map((v) => +v.toFixed(3))]);

  // A part file that cannot be read: nothing is written and the file is named.
  const file = H.asm().doc.files.find((f) => f.path === '零件/削邊銷.3dbx');
  await (await H.root.getDirectoryHandle('零件')).removeEntry('削邊銷.3dbx');
  store.assembly?.reload();
  await H.loaded();
  const bad = await H.exportedStep();
  out.refused = bad.notice.text;
  H.check(bad.text === null && bad.notice.kind === 'error' && bad.notice.text.includes(file.path), `refused with the file's name: ${bad.notice.text}`);
  H.check(bad.notice.text.startsWith('STEP 輸出失敗：有 1 個零件檔無法讀取') && !bad.notice.text.includes('、'), `the file is listed once, though two pins use it: ${bad.notice.text}`);
  return out;
};

/**
 * (2F) The wait while a part file loads: the stages the worker reports in their order, the card over the
 * graphics area and the line in the panel with their seconds, all gone once the part is in; a file that
 * cannot be read ends as an error, not as a bar that never stops; a component is meshed with under half
 * the triangles of a part. It needs a STEP file that takes seconds: `base` is the URL of a folder that
 * serves 「CIV0000467治具_step.STEP」 (the 7.5 MB fixture of the sample; the app's page cannot fetch files
 * of another drive from the dev server, so serve that folder read-only on 127.0.0.1 for the run).
 *
 *   await __asm.progress('http://127.0.0.1:5393/')
 */
asm.progress = async (base = globalThis.__samplesOrigin) => {
  const out = {};
  const name = 'CIV0000467治具_step.STEP';
  H.ready();
  const bytes = new Uint8Array(await (await fetch(base + encodeURIComponent(name))).arrayBuffer());
  await H.project({});
  await H.writeAt(name, bytes);
  await H.writeAt('壞檔.STEP', new TextEncoder().encode('ISO-10303-21;\nHEADER;\nnot a step file at all\n'));
  await H.action('檔案', '新組合件');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => H.asm()?.insert?.files, 10000, 'the part list');

  // The stages, and what is on the screen while they last: sampled every 40 ms.
  const stages = [];
  const cards = new Set();
  const seconds = new Set();
  let panelLine = null;
  let bar = false;
  let timer;
  const sample = () => {
    const s = H.asm()?.files.get(name);
    if (s?.status === 'loading' && stages.at(-1) !== s.stage) stages.push(s.stage);
    const card = document.querySelector('.load-progress');
    if (card) {
      cards.add(card.querySelector('.load-progress-name')?.textContent);
      const m = card.querySelector('.load-progress-stage')?.textContent.match(/(\d+) 秒/);
      if (m) seconds.add(+m[1]);
      bar ||= !!card.querySelector('.busy-bar');
    }
    panelLine ??= [...document.querySelectorAll('.property-manager p.muted')].map((p) => p.textContent).find((t) => t.startsWith('正在載入')) ?? null;
  };
  const t0 = performance.now();
  timer = setInterval(sample, 40);
  [...document.querySelectorAll('.file-list li')].find((li) => li.title === name).click();
  await H.waitFor(() => H.asm().files.get(name)?.status === 'ok', 90000, 'the fixture to load');
  clearInterval(timer);
  out.loadedInMs = Math.round(performance.now() - t0);
  out.stages = stages;
  out.card = [...cards];
  out.secondsSeen = [...seconds].sort((a, b) => a - b);
  out.panelLine = panelLine;
  // 「讀取檔案」 is over in a few tens of ms for a file on this machine: the sampling may not catch it.
  H.check(stages.filter((s) => s !== 'reading').join() === 'building,meshing' && (stages.length === 2 || stages[0] === 'reading'), `stages in order: ${stages}`);
  H.check(cards.size === 1 && [...cards][0] === `正在載入「CIV0000467治具_step」`, `the card names the part: ${[...cards]}`);
  H.check(bar, 'the card has the moving bar');
  H.check(seconds.size >= 3, `the seconds count up: ${[...seconds]}`);
  H.check(panelLine?.includes('CIV0000467治具_step') && /重建幾何|讀取檔案|產生網格/.test(panelLine), `the panel says what it waits for: ${panelLine}`);

  // Done: nothing of it is left on the screen.
  await H.wait(300);
  H.check(!document.querySelector('.load-progress'), 'the card is gone once the part is in');
  H.check(![...document.querySelectorAll('.property-manager p.muted')].some((p) => p.textContent.startsWith('正在載入')), 'the panel line is gone');
  H.check(!document.querySelector('.status-bar').textContent.includes('正在載入'), 'the status bar does not say loading');

  // The mesh of a component: under half of the 74 048 triangles the part mesh of this file has.
  const mesh = H.asm().builds.get(H.asm().files.get(name).key).mesh;
  out.triangles = mesh.indices.length / 3;
  H.check(out.triangles <= 74048 / 2, `component mesh under half of 74048: ${out.triangles}`);

  // Looks: type at least 13 px, the bar stands still for those who ask for no motion.
  const card = document.createElement('div');
  card.className = 'load-progress';
  document.body.append(card);
  out.cardFontPx = parseFloat(getComputedStyle(card).fontSize);
  card.remove();
  const rules = [...document.styleSheets].flatMap((s) => [...s.cssRules]);
  out.reducedMotionRule = rules.some((r) => r instanceof CSSMediaRule && r.conditionText.includes('prefers-reduced-motion') && [...r.cssRules].some((c) => c.selectorText?.includes('.busy-bar')));
  H.check(out.cardFontPx >= 13, `type size ${out.cardFontPx}px`);
  H.check(out.reducedMotionRule, 'a rule for prefers-reduced-motion');

  // A file that cannot be read: an error with its reason, and the bar goes.
  [...document.querySelectorAll('.file-list li')].find((li) => li.title === '壞檔.STEP').click();
  await H.waitFor(() => H.asm().files.get('壞檔.STEP')?.status === 'error', 30000, 'the bad file to fail');
  await H.wait(300);
  out.badFile = H.asm().files.get('壞檔.STEP').message;
  H.check(!document.querySelector('.load-progress') && !document.querySelector('.busy-bar'), 'no bar after a failed load');
  H.check(document.querySelector('.property-manager .error-text')?.textContent === out.badFile, 'the reason is in the panel');
  return out;
};

/** Forgets the remembered project folder: run before reloading for openFresh(). */
asm.forget = () =>
  new Promise((resolve) => {
    const q = indexedDB.deleteDatabase('3d-builder');
    q.onsuccess = q.onerror = q.onblocked = () => resolve('forgotten; reload the page now');
  });

/**
 * Run in a freshly loaded page after files(): the project folder of the last session is remembered
 * (B9.4). Where the browser asks again, the folder dialog offers it; where it allows it on every visit
 * (as with this test folder), it is used without asking.
 */
asm.remembered = async () => {
  H.ready();
  H.check(store.getState().rememberedProject === '3db-e2e' && !store.getState().projectName, 'remembered, not in use yet (reload the page first)');
  H.root = await (await navigator.storage.getDirectory()).getDirectoryHandle('3db-e2e');
  const proto = Object.getPrototypeOf(H.root);
  const own = ['queryPermission', 'requestPermission'].map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)]);
  const asked = [];
  proto.queryPermission = async () => 'prompt';
  proto.requestPermission = async (o) => (asked.push(o.mode), 'granted');
  try {
    H.dialogs.length = 0;
    H.next.open = '夾具.3dba';
    await H.action('檔案', '開啟舊檔');
    await H.waitFor(() => store.getState().folderRequest, 5000, 'the folder dialog');
    const offered = [...document.querySelectorAll('.modal button')].map((b) => b.textContent);
    H.check(offered.includes('使用「3db-e2e」'), `offered: ${offered}`);
    await H.modalButton('使用「3db-e2e」');
    await H.waitFor(() => H.asm(), 10000, 'the assembly');
    await H.loaded();
    H.check(asked.join() === 'read' && !H.dialogs.some((d) => d[0] === 'folder'), 'the browser asked again; no folder picker');
    H.check(store.viewer.instances.size === 2, 'both components show');
  } finally {
    for (const [k, d] of own) {
      if (d) Object.defineProperty(proto, k, d);
      else delete proto[k];
    }
  }
  return { projectName: store.getState().projectName, tree: H.tree() };
};

'phase 2 assembly ready: await __asm.all(), then __asm.extras(); after await __asm.forget() and a reload, __asm.openFresh(); 2C: await __asm.fixture(), then __asm.mateExtras(); STEP: await __asm.step(); 2D: await __asm.move(), await __asm.files(), then after a reload __asm.remembered()';
