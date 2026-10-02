// Phase 3b-3c: importing an assembly STEP in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-step-import.js?' + Date.now());
//   await __imp.run();
//
// It writes the STEP of the 夾具 of phase3-subassembly.js (two 定位組, a nested assembly), then imports that file into an empty folder with the
// system dialogs replaced by stand-ins (the file and the folder answered from OPFS), and checks the project that comes out.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const imp = (window.__imp = {});

imp.run = async () => {
  // the source: the STEP the app itself writes of the 夾具
  await __sub.open();
  const req = store.assembly.stepRequest();
  const text = await store.api.exportAssemblyStep(req);
  const original = [...new Set([...text.matchAll(/PRODUCT\('([^']*)'/g)].map((m) => m[1]))].sort();
  await H.writeAt('in/夾具.step', new TextEncoder().encode(text));
  const out = await H.root.getDirectoryHandle('out', { create: true });
  window.showDirectoryPicker = async (o) => {
    H.dialogs.push(['folder', o?.id, o?.mode]);
    return out;
  };

  // 「檔案」→「輸入 STEP 組合件…」: the file, then the folder dialog, then the project
  document.querySelector('.status-bar .notice')?.click();
  H.next.open = 'in/夾具.step';
  const started = performance.now();
  await H.action('檔案', '輸入 STEP 組合件…');
  await H.waitFor(() => store.getState().folderRequest, 30000, 'the folder dialog');
  H.check(H.dialogs.length >= 0 && /個零件/.test(store.getState().folderRequest), `the dialog says what is coming: ${store.getState().folderRequest}`);
  H.check(store.getState().folderWrite === true, 'the folder is picked with write access');
  H.check(!document.querySelector('.modal button.primary')?.textContent.includes('使用'), 'no remembered folder is offered');
  await H.modalButton('選擇資料夾…');
  H.check(H.dialogs.at(-1)[2] === 'readwrite', `the picker was asked for write access: ${JSON.stringify(H.dialogs.at(-1))}`);
  await H.waitFor(() => store.getState().notice?.text?.startsWith('已輸入'), 60000, 'the import');
  await H.loaded();
  await H.wait(1500);
  const ms = performance.now() - started;
  const notice = store.getState().notice.text;

  // the files
  const names = [];
  const list = async (dir, prefix) => {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') await list(h, `${prefix}${name}/`);
      else names.push(`${prefix}${name}`);
    }
  };
  await list(out, '');
  names.sort();
  H.check(JSON.stringify(names) === JSON.stringify(['夾具.3dba', '組件/定位組.3dba', '零件/定位板.3dbx', '零件/削邊銷.3dbx'].sort()), `the files: ${names}`);

  // the project: opened, its parts drawn where the file had them, no problems
  const a = H.asm();
  H.check(a && a.fileName === '夾具.3dba' && store.getState().projectName === 'out', `the assembly is open: ${a?.fileName}, ${store.getState().projectName}`);
  H.check([...a.files.values()].every((s) => s.status === 'ok'), 'every file was read');
  H.check(a.doc.components.length === 2 && a.doc.mates.length === 0, 'two components of the sub-assembly, no mates');
  await H.waitFor(() => store.viewer.instances.size === 6, 10000, 'six parts drawn');
  const before = 6;
  H.check(store.assembly.leaves().length === before, 'six leaves');

  // written out again it is what it came from
  await H.waitFor(() => H.asm().solution, 10000, 'solved');
  const again = await store.api.exportAssemblyStep(store.assembly.stepRequest());
  const products = [...new Set([...again.matchAll(/PRODUCT\('([^']*)'/g)].map((m) => m[1]))].sort();
  const usages = (again.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g) ?? []).length;
  const usagesBefore = (text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g) ?? []).length;
  H.check(usages === usagesBefore, `the same number of components: ${usages} vs ${usagesBefore}`);
  H.check(JSON.stringify(products.filter((p) => p !== '夾具-排列' && p !== '夾具')) === JSON.stringify(original.filter((p) => p !== '夾具-排列' && p !== '夾具')), `the same products: ${products} vs ${original}`);
  return { notice, ms: Math.round(ms), names, products, usages };
};
