// Manual checklist D4 (docs/manual-verification.html): 「零件表…」 of the 夾具 (two 定位組): 「只列零件」, 「縮排（含次組合件）」, a component suppressed (not listed) and hidden (listed), the vendor
// and the part number added to a part file in 「檔案屬性」 and saved, the assembly opened again, the parts list with them, and 「輸出 CSV」; replayed the way a person does it in the app's
// page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. What only a person can do is to open the CSV in Excel.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-d4.js?' + Date.now());   // in a freshly loaded page
//   await __manualD4.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualD4 = {});
const shot = (label) => window.__shot?.(label);

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await shot(name);
  steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r });
  return r;
};
const table = () => [...document.querySelectorAll('[data-bom] tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
const bomText = () => document.querySelector('.modal')?.textContent ?? '';
const openBom = async () => {
  await H.action('組合件', '零件表…');
  await H.waitFor(() => document.querySelector('[data-bom]'), 5000, 'the parts list');
  await H.wait(200);
};
const closeBom = async () => {
  document.querySelector('.modal button:last-child').click(); // the last button of the window (as in phase3-bom.js)
  await H.wait(200);
};
const openAsm = async (path) => {
  document.querySelector('.status-bar .notice')?.click();
  H.next.open = path;
  await H.action('檔案', '開啟舊檔');
  await H.wait(300);
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => store.getState().notice?.text === `已開啟 ${path.split('/').pop()}`, 20000, `${path} to open`);
  if (H.asm()) await H.loaded();
  else await H.settle();
};
const contextMenu = async (id, item) => {
  document.querySelector(`[data-component-row="${id}"]`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 200 }));
  await H.wait(150);
  [...document.querySelectorAll('.context-menu li')].find((x) => x.textContent === item).click();
  await H.wait(500);
};

M.run = async () => {
  await step('1 the 夾具 opened: 零件表… in 只列零件 mode: 定位板 2, 削邊銷 4, with the columns 項次, 名稱, 數量, 廠商, 料號, 檔案 and the count line', async () => {
    await window.__sub.open();
    await openBom();
    const flat = table();
    const heads = [...document.querySelectorAll('[data-bom] thead th')].map((th) => th.textContent);
    return { heads, flat, line: bomText().match(/共 \d+ 列[^。]*/)?.[0], pass: heads.join() === '項次,名稱,數量,廠商,料號,檔案' && JSON.stringify(flat.map((r) => [r[1], r[2]])) === JSON.stringify([['定位板', '2'], ['削邊銷', '4']]) && /共 2 列，6 個零件/.test(bomText()) };
  });
  await step('2 縮排（含次組合件）: 定位組 2 with its 定位板 and 削邊銷 under it', async () => {
    [...document.querySelectorAll('.modal button')].find((b) => b.textContent.startsWith('縮排')).click();
    await H.wait(250);
    const rows = table();
    return { rows: rows.map((r) => [r[0], r[1], r[2]]), pass: JSON.stringify(rows.map((r) => [r[0], r[1], r[2]])) === JSON.stringify([['1', '定位組', '2'], ['1.1', '定位板', '1'], ['1.2', '削邊銷', '2']]) };
  });
  await step('3 關閉; 定位組<2> suppressed: it is not listed; made visible again and hidden: it is', async () => {
    await closeBom();
    await contextMenu('s1', '抑制');
    await H.wait(1000);
    await openBom();
    [...document.querySelectorAll('.modal button')].find((b) => b.textContent.startsWith('只列')).click();
    await H.wait(200);
    const suppressed = table().map((r) => [r[1], r[2]]);
    await closeBom();
    await contextMenu('s1', '恢復抑制');
    await contextMenu('s1', '隱藏');
    await H.wait(800);
    await openBom();
    [...document.querySelectorAll('.modal button')].find((b) => b.textContent.startsWith('只列')).click();
    await H.wait(200);
    const hidden = table().map((r) => [r[1], r[2]]);
    await closeBom();
    await contextMenu('s1', '顯示');
    return { suppressed, hidden, pass: JSON.stringify(suppressed) === JSON.stringify([['定位板', '1'], ['削邊銷', '2']]) && JSON.stringify(hidden) === JSON.stringify([['定位板', '2'], ['削邊銷', '4']]) };
  });
  await step('4 the part file 定位板 opened, 工具 → 檔案屬性: 廠商 and 料號 added and the file saved; the assembly opened again: the parts list has them', async () => {
    await openAsm('定位板.3dbx');
    await H.action('工具', '檔案屬性');
    const dlg = document.querySelector('.modal');
    const add = async (name, value) => {
      const [n, v] = [...dlg.querySelectorAll('.eq-table tr:last-child input')];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, name);
      n.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(v, value);
      v.dispatchEvent(new Event('input', { bubbles: true }));
      await H.wait(60);
      [...dlg.querySelectorAll('button')].find((b) => b.textContent === '新增').click();
      await H.wait(200);
    };
    await add('廠商', '甲公司');
    await add('料號', 'LP-120');
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === '關閉').click();
    await H.wait(200);
    await H.save('定位板.3dbx');
    await openAsm('夾具.3dba');
    await H.waitFor(() => H.asm().solution, 10000, 'the solution');
    await openBom();
    [...document.querySelectorAll('.modal button')].find((b) => b.textContent.startsWith('只列')).click();
    await H.wait(200);
    const plate = table().find((r) => r[1] === '定位板');
    await shot('4-bom-with-vendor');
    return { plate, pass: plate?.[3] === '甲公司' && plate?.[4] === 'LP-120' };
  });
  await step('5 輸出 CSV: …-零件表.csv with a byte order mark (so that Excel reads the Chinese) and the same rows', async () => {
    let saved = null;
    let name = null;
    const create = URL.createObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => {
      saved = blob;
      return create.call(URL, blob);
    };
    HTMLAnchorElement.prototype.click = function () {
      name = this.download;
    };
    [...document.querySelectorAll('.modal button')].find((b) => b.textContent === '輸出 CSV').click();
    await H.wait(400);
    URL.createObjectURL = create;
    HTMLAnchorElement.prototype.click = click;
    const bytes = new Uint8Array(await saved.arrayBuffer());
    const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
    await closeBom();
    return { name, head: text.split('\r\n')[0], rows: text.split('\r\n').slice(1, 3), pass: /-零件表\.csv$/.test(name ?? '') && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && text.startsWith('項次,名稱,數量,廠商,料號,檔案') && text.includes('甲公司') && text.includes('LP-120') };
  });
  return { name: 'D4', steps, pass: steps.every((s) => s.pass) };
};
