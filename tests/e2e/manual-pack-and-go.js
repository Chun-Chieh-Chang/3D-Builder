// await __packAndGo.run();
// ADR 0234: 「打包成單一檔…」 and opening the .3dbp. An assembly of two parts and its drawing are made in a project folder that also holds a part nothing
// uses; the drawing is packed (it takes its assembly, which takes its parts; the unused part stays out). Then the folder is changed — a part replaced
// by another, a part deleted — and the package is opened into it three times: unticking the changed part keeps the folder's, leaving it ticked
// replaces it, and 「取消」 writes nothing. Files that are the same are skipped and missing ones added. Last, packing with a part gone is refused.
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
const root = here.replace(/tests\/e2e\/$/, '');
await import(here + 'phase2-assembly.js?' + Date.now());
const H = window.__ui2, { store } = H;
const IO = await import(root + 'packages/io/src/index.ts');
const check = (ok, why) => { if (!ok) throw new Error(why); };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const notice = () => store.getState().notice?.text ?? '';
const exists = (path) => H.handleAt(path).then(() => true, () => false);

window.__packAndGo = { run: async () => {
  const out = {};
  H.ready();
  const VBLOCK = new Uint8Array(await (await fetch(`${H.GOLDEN}v-block.3dbx`)).arrayBuffer());
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, '零件/削邊銷.3dbx': `${H.GOLDEN}diamond-pin.3dbx`, '不相干.3dbx': `${H.GOLDEN}v-block.3dbx` });
  const anchorClick = HTMLAnchorElement.prototype.click;
  let download = null;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download?.endsWith('.3dbp')) download = fetch(this.href).then((r) => r.arrayBuffer()).then((b) => ({ name: this.download, bytes: new Uint8Array(b) }));
    else anchorClick.call(this);
  };
  try {
    // ---- the assembly and its drawing, saved in the project folder
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.insert('定位板.3dbx');
    await H.insert('零件/削邊銷.3dbx', [0.62, 0.5]);
    await H.save('治具組.3dba');
    await H.newDrawing();
    await H.waitFor(() => H.page()?.views.length === 3, 30000, 'the three views');
    H.next.save = '圖/治具組.3dbd';
    await H.action('檔案', '儲存檔案');
    await H.waitFor(() => H.drw()?.fileName === '治具組.3dbd' && !H.drw().dirty, 10000, 'the drawing to be saved');

    // ---- pack the drawing: it takes its assembly and the assembly its parts, not the part nothing uses
    await H.action('檔案', '打包成單一檔…');
    await H.waitFor(() => download, 10000, 'the package download');
    const pkgFile = await download;
    const pkg = await IO.readPackage(pkgFile.bytes);
    out.packed = pkg.files.map((f) => f.path);
    check(pkgFile.name === '治具組.3dbp', `named after the drawing: ${pkgFile.name}`);
    check(pkg.main === '圖/治具組.3dbd', `the drawing is the main file: ${pkg.main}`);
    check(JSON.stringify([...out.packed].sort()) === JSON.stringify(['圖/治具組.3dbd', '治具組.3dba', '定位板.3dbx', '零件/削邊銷.3dbx'].sort()), `the files it uses, and only those: ${out.packed}`);
    for (const f of pkg.files) check(same(f.bytes, await H.readAt(f.path)), `${f.path} is packed as saved`);
    check(notice().includes('4 個檔案'), `it says how many: ${notice()}`);
    const packed = Object.fromEntries(pkg.files.map((f) => [f.path, f.bytes]));

    // the package is put in the folder so that the open-dialog stand-in can answer it, as a file the user downloaded would be chosen
    await H.writeAt('下載/治具組.3dbp', pkgFile.bytes);
    const unpack = async () => {
      store.dismissNotice(); // the notice this unpack gives is the one waited for, not the last one's
      H.next.open = '下載/治具組.3dbp';
      await H.action('檔案', '開啟舊檔');
      if (store.getState().unsaved) await H.modalButton('不儲存');
      await H.waitFor(() => store.getState().folderRequest, 10000, 'the question where to unpack');
      check(store.getState().folderRequest.includes('4 個檔案'), `it says what is unpacked: ${store.getState().folderRequest}`);
      await H.modalButton('選擇資料夾…');
    };
    const change = async () => {
      await H.writeAt('定位板.3dbx', VBLOCK); // another version of the part
      await (await H.root.getDirectoryHandle('零件')).removeEntry('削邊銷.3dbx'); // a part gone
    };

    // ---- 1. the changed part unticked: the folder keeps its own; the missing part comes back; the same files are skipped
    await change();
    await unpack();
    let dialog = await H.waitFor(() => document.querySelector('[data-unpack]'), 10000, 'the list of files that differ');
    const listed = [...dialog.querySelectorAll('[data-replace]')].map((c) => [c.dataset.replace, c.checked]);
    out.listed = listed;
    check(JSON.stringify(listed) === JSON.stringify([['定位板.3dbx', true]]), `only the changed part is listed, ticked: ${JSON.stringify(listed)}`);
    check(dialog.textContent.includes('新增 1 個') && dialog.textContent.includes('2 個與資料夾中的相同'), `it says what is added and skipped: ${dialog.textContent}`);
    dialog.querySelector('[data-replace="定位板.3dbx"]').click();
    await H.wait(100);
    check(!dialog.querySelector('[data-replace="定位板.3dbx"]').checked, 'unticked');
    dialog.querySelector('[data-unpack-ok]').click();
    await H.waitFor(() => notice().includes('已解開'), 30000, 'the unpack');
    out.first = notice();
    check(notice().includes('新增 1、取代 0、略過 3'), `added 1, replaced 0, skipped 3: ${notice()}`);
    check(same(await H.readAt('定位板.3dbx'), VBLOCK), 'the unticked part is the folder\'s own');
    check(same(await H.readAt('零件/削邊銷.3dbx'), packed['零件/削邊銷.3dbx']), 'the missing part is back');
    await H.waitFor(() => H.drw()?.fileName === '治具組.3dbd', 30000, 'the drawing to open');

    // ---- 2. left ticked: replaced by the package's
    await (await H.root.getDirectoryHandle('零件')).removeEntry('削邊銷.3dbx');
    await unpack();
    dialog = await H.waitFor(() => document.querySelector('[data-unpack]'), 10000, 'the list again');
    dialog.querySelector('[data-unpack-ok]').click();
    await H.waitFor(() => notice().includes('已解開'), 30000, 'the second unpack');
    check(notice().includes('新增 1、取代 1、略過 2'), `added 1, replaced 1, skipped 2: ${notice()}`);
    check(same(await H.readAt('定位板.3dbx'), packed['定位板.3dbx']), 'the ticked part is the package\'s');

    // ---- 3. 「取消」: nothing is written
    await change();
    await unpack();
    dialog = await H.waitFor(() => document.querySelector('[data-unpack]'), 10000, 'the list a third time');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === '取消').click();
    await H.waitFor(() => !document.querySelector('[data-unpack]'), 5000, 'the list to close');
    await H.wait(300);
    check(same(await H.readAt('定位板.3dbx'), VBLOCK) && !(await exists('零件/削邊銷.3dbx')), 'cancelled: the folder is as it was');

    // ---- packing with a part gone is refused, naming it
    await H.writeAt('零件/削邊銷.3dbx', packed['零件/削邊銷.3dbx']);
    await H.open('治具組.3dba');
    await (await H.root.getDirectoryHandle('零件')).removeEntry('削邊銷.3dbx');
    download = null;
    store.dismissNotice();
    await H.action('檔案', '打包成單一檔…');
    await H.waitFor(() => notice().includes('打包失敗'), 10000, 'the refusal');
    out.refused = notice();
    check(notice().includes('零件/削邊銷.3dbx') && download === null, `the missing part is named and nothing is downloaded: ${notice()}`);
    out.pass = true;
    return out;
  } finally {
    HTMLAnchorElement.prototype.click = anchorClick;
    await H.tidy();
  }
} };
