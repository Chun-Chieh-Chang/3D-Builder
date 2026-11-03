// await __browserProjects.run();
// ADR 0233: a project kept in the browser, used as Firefox and Safari would: the page has no folder picker and no system file dialogs (they are taken
// away for the run). A project is made in 「檔案 → 瀏覽器內專案…」; an assembly of two parts is made, saved and its drawing too, all through the program's
// own dialog; the assembly is opened again from it; a part is saved the way Safari without `createWritable` does it (through the worker); the project is
// exported as a ZIP and imported back, the project-folder dialog offers only browser projects, and a project in use cannot be deleted.
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
const root = here.replace(/tests\/e2e\/$/, '');
await import(here + 'phase2-assembly.js?' + Date.now());
const H = window.__ui2, { store } = H;
const appModule = (path) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(path)));
const BP = await appModule('/src/browserProjects.ts');
const IO = await import(root + 'packages/io/src/index.ts');
const check = (ok, why) => { if (!ok) throw new Error(why); };
const setInput = (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const notice = () => store.getState().notice?.text ?? '';
const waitNotice = (part, what) => H.waitFor(() => notice().includes(part), 20000, what ?? `notice ${part}`);
const fileDialog = (mode) => H.waitFor(() => document.querySelector(`[data-project-file="${mode}"]`), 10000, `the ${mode} dialog of the project`);
const NAME = '瀏覽器專案測試';
const IMPORTED = '瀏覽器專案測試-匯入';

window.__browserProjects = { run: async () => {
  const out = {};
  H.ready();
  for (const n of await BP.listBrowserProjects()) if (n.startsWith(NAME)) await BP.deleteBrowserProject(n);
  // what Firefox and Safari have: no folder picker, no open or save dialog of the system
  const pickers = { showDirectoryPicker: window.showDirectoryPicker, showOpenFilePicker: window.showOpenFilePicker, showSaveFilePicker: window.showSaveFilePicker };
  const createWritable = FileSystemFileHandle.prototype.createWritable;
  const anchorClick = HTMLAnchorElement.prototype.click;
  const inputClick = HTMLInputElement.prototype.click;
  for (const k of Object.keys(pickers)) window[k] = undefined;
  const dialogsBefore = H.dialogs.length;
  try {
    // ---- make the project in 「檔案 → 瀏覽器內專案…」
    await H.action('檔案', '瀏覽器內專案…');
    const manager = await H.waitFor(() => document.querySelector('[data-browser-projects-dialog]'), 5000, 'the browser projects dialog');
    check(manager.textContent.includes('清除這個網站的資料'), 'the dialog says what clearing the site data does');
    setInput(manager.querySelector('[data-new-name]'), 'a/b');
    await H.wait(100);
    check(manager.querySelector('[data-create]').disabled && manager.querySelector('.error-text'), 'a name with "/" is refused before anything is made');
    setInput(manager.querySelector('[data-new-name]'), NAME);
    await H.wait(100);
    manager.querySelector('[data-create]').click();
    await waitNotice(`目前的專案：瀏覽器內的「${NAME}」`);
    check(store.getState().projectInBrowser && store.getState().projectName === NAME, 'the new project is the project');
    const project = await BP.browserProject(NAME);
    // the parts come into the project (a person would use 「從電腦加入專案…」, a dialog of the system a script cannot answer)
    for (const [path, url] of [['定位板.3dbx', `${H.GOLDEN}locating-plate.3dbx`], ['零件/削邊銷.3dbx', `${H.GOLDEN}diamond-pin.3dbx`]]) {
      const parts = path.split('/');
      let dir = project;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
      await BP.writeBrowserFile(await dir.getFileHandle(parts.at(-1), { create: true }), new Uint8Array(await (await fetch(url)).arrayBuffer()));
    }

    // ---- an assembly of the two parts, saved in the program's own dialog
    await H.action('檔案', '新組合件');
    check(!store.getState().folderRequest, 'the browser project is the project folder: nothing is asked');
    await H.insert('定位板.3dbx');
    await H.insert('零件/削邊銷.3dbx', [0.62, 0.5]);
    await H.action('檔案', '儲存檔案');
    let dialog = await fileDialog('save');
    check(dialog.textContent.includes(`存到「${NAME}」`), 'the save dialog names the project');
    setInput(dialog.querySelector('[data-file-name]'), '治具組');
    dialog.querySelector('[data-save]').click();
    await H.waitFor(() => H.asm()?.fileName === '治具組.3dba' && !H.asm().dirty, 10000, 'the assembly to be saved');
    check((await IO.readAnyDocumentFile(new Uint8Array(await (await (await project.getFileHandle('治具組.3dba')).getFile()).arrayBuffer()))).kind === 'assembly', 'the assembly file is in the project');

    // saved again under the same name: the dialog asks before replacing
    await H.action('檔案', '另存新檔');
    dialog = await fileDialog('save');
    setInput(dialog.querySelector('[data-file-name]'), '治具組.3dba');
    dialog.querySelector('[data-save]').click();
    await H.waitFor(() => dialog.querySelector('[data-replace]'), 5000, 'the question whether to replace');
    check(dialog.textContent.includes('「治具組.3dba」已經存在'), 'it says which file is there');
    dialog.querySelector('[data-replace]').click();
    await H.waitFor(() => !document.querySelector('[data-project-file]') && !H.asm().dirty, 10000, 'the replaced save');

    // ---- its drawing, saved in the project too
    await H.newDrawing();
    await H.waitFor(() => H.page()?.views.length === 3, 30000, 'the three views');
    await H.action('檔案', '儲存檔案');
    dialog = await fileDialog('save');
    setInput(dialog.querySelector('[data-file-name]'), '工程圖/治具組');
    dialog.querySelector('[data-save]').click();
    await H.waitFor(() => H.drw()?.fileName === '治具組.3dbd' && !H.drw().dirty, 10000, 'the drawing to be saved');
    await (await project.getDirectoryHandle('工程圖')).getFileHandle('治具組.3dbd');

    // ---- open the assembly again from the project: its parts are found by their paths in it
    await H.action('檔案', '開啟舊檔');
    dialog = await fileDialog('open');
    const listed = [...dialog.querySelectorAll('[data-file]')].map((b) => b.dataset.file);
    out.listed = listed;
    check(['治具組.3dba', '工程圖/治具組.3dbd', '定位板.3dbx', '零件/削邊銷.3dbx'].every((f) => listed.includes(f)), `the open dialog lists the project's files: ${listed}`);
    dialog.querySelector('[data-file="治具組.3dba"]').click();
    await waitNotice('已開啟 治具組.3dba');
    await H.loaded();
    check(H.asm().doc.components.length === 2 && [...H.asm().files.values()].every((s) => s.status === 'ok'), 'both parts of the reopened assembly are read');

    // ---- a part saved the way Safari without createWritable does: through the worker
    await H.action('檔案', '開啟舊檔');
    (await fileDialog('open')).querySelector('[data-file="定位板.3dbx"]').click();
    await waitNotice('已開啟 定位板.3dbx');
    await H.settle();
    const plate = await project.getFileHandle('定位板.3dbx');
    const original = new Uint8Array(await (await plate.getFile()).arrayBuffer());
    await BP.writeBrowserFile(plate, new TextEncoder().encode('broken on purpose'));
    delete FileSystemFileHandle.prototype.createWritable;
    check(typeof plate.createWritable !== 'function', 'the handle can no longer be written from the page');
    try {
      check(await store.save(), 'the part saved without createWritable');
    } finally {
      FileSystemFileHandle.prototype.createWritable = createWritable;
    }
    const written = new Uint8Array(await (await plate.getFile()).arrayBuffer());
    check((await IO.readAnyDocumentFile(written)).kind === 'part' && written.length > 1000, `the worker wrote the whole part (${written.length} bytes, was ${original.length})`);
    const scratch = [];
    for await (const [n] of project.entries()) if (n.endsWith('.writing')) scratch.push(n);
    check(scratch.length === 0, `no scratch file is left: ${scratch}`);

    // ---- export the project as a ZIP and import it back
    let zip = null;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download?.endsWith('.zip')) zip = fetch(this.href).then((r) => r.arrayBuffer()).then((b) => ({ name: this.download, bytes: new Uint8Array(b) }));
      else anchorClick.call(this);
    };
    await H.action('檔案', '瀏覽器內專案…');
    const row = await H.waitFor(() => document.querySelector(`[data-browser-projects-dialog] [data-browser-project="${NAME}"]`), 5000, 'the project row');
    check(row.textContent.includes('從未匯出'), 'it says the project was never exported');
    row.querySelector('[data-export]').click();
    await waitNotice(`已匯出「${NAME}」`);
    const exported = await zip;
    const entries = (await IO.readZip(exported.bytes)).map((e) => e.name).sort();
    out.exported = entries;
    check(exported.name === `${NAME}.zip` && ['定位板.3dbx', '工程圖/治具組.3dbd', '治具組.3dba', '零件/削邊銷.3dbx'].every((f) => entries.includes(f)) && entries.length === 4, `the ZIP holds the project's files at their paths: ${entries}`);
    check(BP.lastExport(NAME) !== null && !BP.exportDue(NAME), 'the export date is kept');
    await H.waitFor(() => document.querySelector(`[data-browser-project="${NAME}"]`)?.textContent.includes('上次匯出'), 5000, 'the row to say when it was exported');

    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file' && this.accept.includes('.zip')) {
        const t = new DataTransfer();
        t.items.add(new File([exported.bytes], `${IMPORTED}.zip`, { type: 'application/zip' }));
        this.files = t.files;
        this.dispatchEvent(new Event('change'));
      } else inputClick.call(this);
    };
    document.querySelector('[data-browser-projects-dialog] [data-import]').click();
    // imported, it is the project (the notice of that comes right after the one of the import)
    await H.waitFor(() => store.getState().projectName === IMPORTED && store.getState().projectInBrowser, 20000, 'the imported project to be the project');
    const back = (await BP.filesOf(await BP.browserProject(IMPORTED))).map((e) => e.name).sort();
    check(JSON.stringify(back) === JSON.stringify(entries), `the imported project has the same files: ${back}`);
    check(!BP.exportDue(IMPORTED), 'an imported project is on the computer already: no reminder to export it');

    // ---- a project in use is not deleted; another one is, after the second press
    await H.action('檔案', '瀏覽器內專案…');
    (await H.waitFor(() => document.querySelector(`[data-browser-projects-dialog] [data-browser-project="${NAME}"] [data-use]`), 5000, 'the row of the first project')).click();
    await H.waitFor(() => store.getState().projectName === NAME, 5000, 'the first project to be the project again');
    await H.action('檔案', '開啟舊檔'); // open the assembly so that NAME is its project
    (await fileDialog('open')).querySelector('[data-file="治具組.3dba"]').click();
    await waitNotice('已開啟 治具組.3dba');
    await H.loaded();
    await H.action('檔案', '瀏覽器內專案…');
    let nameRow = await H.waitFor(() => document.querySelector(`[data-browser-projects-dialog] [data-browser-project="${NAME}"]`), 5000, 'the row');
    nameRow.querySelector('[data-delete]').click();
    (await H.waitFor(() => nameRow.querySelector('[data-delete-yes]'), 2000, 'the confirmation')).click();
    await waitNotice('請先關閉它們再刪除');
    check((await BP.listBrowserProjects()).includes(NAME), 'the project in use is still there');
    const importedRow = document.querySelector(`[data-browser-project="${IMPORTED}"]`);
    importedRow.querySelector('[data-delete]').click();
    (await H.waitFor(() => importedRow.querySelector('[data-delete-yes]'), 2000, 'the confirmation')).click();
    await waitNotice(`已刪除瀏覽器內專案「${IMPORTED}」`);
    check(!(await BP.listBrowserProjects()).includes(IMPORTED), 'the other project is deleted');
    store.openDialog(null);

    // ---- the project-folder dialog of such a browser: no 「選擇資料夾…」, the browser projects instead
    const asked = store.askForFolder('test: which project?');
    const folderModal = await H.waitFor(() => [...document.querySelectorAll('.modal')].find((m) => m.textContent.includes('test: which project?')), 5000, 'the project-folder dialog');
    check(![...folderModal.querySelectorAll('button')].some((b) => b.textContent === '選擇資料夾…'), 'no folder picker is offered');
    check(folderModal.textContent.includes('這個瀏覽器不能開啟電腦上的資料夾'), 'it says why');
    folderModal.querySelector(`[data-browser-project="${NAME}"] [data-use]`).click();
    const answered = await asked;
    check(answered && (await BP.browserProjectName(answered)) === NAME, '「使用」 answers the dialog with the project');

    check(H.dialogs.length === dialogsBefore, `no system dialog was used: ${JSON.stringify(H.dialogs.slice(dialogsBefore))}`);
    out.pass = true;
    return out;
  } finally {
    // the project is remembered as the one to use next time: gone, the scripts that follow pick their own folder again
    for (const n of await BP.listBrowserProjects()) if (n.startsWith(NAME)) await BP.deleteBrowserProject(n).catch(() => {});
    Object.assign(window, pickers);
    FileSystemFileHandle.prototype.createWritable = createWritable;
    HTMLAnchorElement.prototype.click = anchorClick;
    HTMLInputElement.prototype.click = inputClick;
  }
} };
