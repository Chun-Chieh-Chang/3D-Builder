// Phase 3b-4a: the parts list in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-bom.js?' + Date.now());
//   await __bom.run();
//
// It builds on phase3-subassembly.js (the 夾具 of two 定位組 in an OPFS project folder).

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const bom = (window.__bom = {});

const table = () => [...document.querySelectorAll('[data-bom] tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));

bom.run = async () => {
  await __sub.open();
  await H.action('組合件', '零件表…');
  await H.waitFor(() => document.querySelector('[data-bom]'), 5000, 'the parts list');
  const flat = table();
  H.check(JSON.stringify(flat.map((r) => [r[1], r[2]])) === JSON.stringify([['定位板', '2'], ['削邊銷', '4']]), `flat: ${JSON.stringify(flat)}`);
  // indented
  [...document.querySelectorAll('.modal button')].find((b) => b.textContent.startsWith('縮排')).click();
  await H.wait(200);
  const indented = table();
  H.check(JSON.stringify(indented.map((r) => [r[0], r[1], r[2]])) === JSON.stringify([['1', '定位組', '2'], ['1.1', '定位板', '1'], ['1.2', '削邊銷', '2']]), `indented: ${JSON.stringify(indented)}`);
  // suppressing a component takes its parts out; a pattern adds
  store.assembly.setComponentState(['s1'], 'suppressed', true);
  await H.wait(500);
  H.check(JSON.stringify(table().map((r) => [r[1], r[2]])) === JSON.stringify([['定位組', '1'], ['定位板', '1'], ['削邊銷', '2']]), `after suppressing: ${JSON.stringify(table())}`);
  store.assembly.undo();
  await H.wait(500);
  // CSV: the download is captured
  let saved = null;
  const create = URL.createObjectURL;
  URL.createObjectURL = (blob) => {
    saved = blob;
    return create.call(URL, blob);
  };
  [...document.querySelectorAll('.modal button')].find((b) => b.textContent === '輸出 CSV').click();
  await H.wait(300);
  URL.createObjectURL = create;
  H.check(saved && saved.type.startsWith('text/csv'), 'a CSV was offered');
  const bytes = new Uint8Array(await saved.arrayBuffer());
  H.check(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, 'with a byte order mark');
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
  H.check(text.startsWith('項次,名稱,數量,廠商,料號,檔案\r\n'), `the headings: ${text.split('\r\n')[0]}`);
  document.querySelector('.modal button:last-child').click();
  return { flat, indented, csv: text };
};
