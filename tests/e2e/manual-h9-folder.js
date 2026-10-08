// Manual checklist H9, step 1 (docs/manual-verification.html): a new assembly takes the project folder the user chooses, not the one remembered or chosen before. The panel's
// 「更換資料夾…」 asks for another folder and reads the part list from it; once a component is placed the button is gone. Found by the user: the folder dialog never came back after
// the first choice ("test"), so 塑膠件 could not be picked. Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-h9-folder.js?' + Date.now());   // in a freshly loaded page
//   await __manualH9Folder.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualH9Folder = {});

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await window.__shot?.(name);
  steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r });
  return r;
};
const panel = () => document.querySelector('.property-manager')?.innerText ?? '';
const listed = () => [...document.querySelectorAll('.file-list li')].map((li) => li.title);
const changeButton = () => document.querySelector('.property-manager [data-change-folder]');

M.run = async () => {
  let answer = null;
  await step('1 the first folder chosen is "test"; the panel lists its parts and offers 更換資料夾…', async () => {
    H.ready();
    await H.project({ 'test/V型塊.3dbx': `${H.GOLDEN}v-block.3dbx`, '塑膠件/定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    window.showDirectoryPicker = async () => answer;
    answer = await H.root.getDirectoryHandle('test');
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.waitFor(() => H.asm()?.insert?.files, 10000, 'the part list');
    return { pass: panel().includes('專案資料夾：test') && listed().join() === 'V型塊.3dbx' && !!changeButton(), panel: panel().slice(0, 120), listed: listed() };
  });
  await step('2 更換資料夾… asks again; choosing 塑膠件 replaces the folder and the list', async () => {
    answer = await H.root.getDirectoryHandle('塑膠件');
    changeButton().click();
    await H.modalButton('選擇資料夾…');
    await H.waitFor(() => store.getState().projectName === '塑膠件' && listed().join() === '定位板.3dbx', 10000, 'the new folder');
    return { pass: panel().includes('專案資料夾：塑膠件') && !panel().includes('專案資料夾：test'), panel: panel().slice(0, 120), listed: listed() };
  });
  await step('3 cancelling the folder dialog changes nothing', async () => {
    answer = null;
    changeButton().click();
    await H.waitFor(() => store.getState().folderRequest, 5000, 'the dialog');
    await H.modalButton('取消');
    await H.wait(200);
    return { pass: store.getState().projectName === '塑膠件' && listed().join() === '定位板.3dbx' && !store.getState().folderRequest, project: store.getState().projectName };
  });
  await step('4 a part of the new folder is placed; the button is gone and the panel says why', async () => {
    await H.insert('定位板.3dbx');
    await H.action('組合件', '插入零組件');
    await H.waitFor(() => H.asm()?.insert?.files, 10000, 'the part list');
    return { pass: H.asm().doc.components.length === 1 && !changeButton() && panel().includes('不能再換'), components: H.asm().doc.components.length, panel: panel().slice(0, 160) };
  });
  return { name: 'H9-folder', steps, pass: steps.every((s) => s.pass) };
};
