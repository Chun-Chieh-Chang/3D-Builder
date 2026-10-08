// Manual checklist C19 (docs/manual-verification.html): the feature tree with the mouse (a drag of a sketch above a feature, a drag refused because it would put a feature before its own
// sketch, rename, 註解與標籤, 放進新資料夾, a drag into the folder, fold, rename and dissolve the folder, the filter), 「新零件（範本）…」 and 「快速鍵…」, replayed the way a person
// does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The drags are DragEvents with a DataTransfer, which is what the
// browser sends for a drag of a draggable row.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c19.js?' + Date.now());   // in a freshly loaded page
//   await __manualC19.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC19 = {});

const order = () => state().doc.features.map((f) => f.name);
const rowOf = (name) => [...document.querySelectorAll('[data-feature-row]')].find((r) => r.querySelector('.name, input.rename')?.textContent.replace(/^\([-+f?]\) /, '') === name);
/** A person's drag from one row to the upper or lower half of another. */
async function drag(from, to, half) {
  const a = rowOf(from);
  const b = rowOf(to);
  if (!a || !b) throw new Error(`no row ${a ? to : from}`);
  const data = new DataTransfer();
  const fire = (el, type, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: el.getBoundingClientRect().left + 20, clientY: y }));
  const box = b.getBoundingClientRect();
  const y = half === 'upper' ? box.top + box.height * 0.25 : box.top + box.height * 0.75;
  fire(a, 'dragstart', a.getBoundingClientRect().top + 5);
  await H.wait(60);
  fire(b, 'dragenter', y);
  fire(b, 'dragover', y);
  await H.wait(60);
  fire(b, 'drop', y);
  fire(a, 'dragend', y);
  await H.settle();
}
const menu = async (name, item) => {
  const row = rowOf(name);
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 8, button: 2 }));
  await H.wait(150);
  const labels = [...document.querySelectorAll('.context-menu li')].map((x) => x.textContent);
  const li = [...document.querySelectorAll('.context-menu li')].find((x) => x.textContent === item);
  if (!li) throw new Error(`no menu item ${item}: ${labels.join(' | ')}`);
  li.click();
  await H.settle();
  return labels;
};

M.run = async () => {
  await step('1 two blocks: 草圖1、伸長1、草圖2、伸長2 in the tree', async () => {
    await S.box(20, 20, 10);
    const s2 = await S.rectSketch('前基準面', 20, 20);
    await S.extrude(s2, 10);
    return { order: order(), pass: order().join() === '草圖1,伸長1,草圖2,伸長2' };
  });
  await step('2 草圖2 dragged to the upper half of 伸長1: the order is 草圖1, 草圖2, 伸長1, 伸長2', async () => {
    await drag('草圖2', '伸長1', 'upper');
    return { order: order(), pass: order().join() === '草圖1,草圖2,伸長1,伸長2' && S.failed().length === 0 };
  });
  await step('3 伸長1 dragged above 草圖1: refused, with the reason', async () => {
    await drag('伸長1', '草圖1', 'upper');
    const notice = S.notice();
    await shot('3-drag-refused');
    return { order: order(), notice, pass: order().join() === '草圖1,草圖2,伸長1,伸長2' && /不能放在/.test(notice) && /草圖1/.test(notice) };
  });
  await step('4 the right-hand menu of 伸長2 lists 重新命名…, 註解與標籤…, 放進新資料夾, 刪除…, 回溯; 重新命名… gives it a new name', async () => {
    const labels = await menu('伸長2', '重新命名…');
    const input = document.querySelector('[data-feature-row] input.rename');
    input.value = '主體';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '主體');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await H.settle();
    return { labels, order: order(), pass: ['重新命名…', '註解與標籤…', '放進新資料夾', '刪除…', '回溯（到此特徵之前）'].every((x) => labels.includes(x)) && order().includes('主體') };
  });
  await step('5 註解與標籤…: a tag shows beside the row and the comment on hover', async () => {
    await menu('主體', '註解與標籤…');
    const dlg = document.querySelector('[aria-label^="註解與標籤"]');
    await S.type(dlg.querySelector('textarea'), '這是測試註解', { enter: false });
    await S.type(dlg.querySelector('input'), '重要', { enter: false });
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === '儲存').click();
    await H.settle();
    const row = rowOf('主體');
    await shot('5-tag-and-note');
    return { tag: row.querySelector('.tag')?.textContent, title: row.title, mark: !!row.querySelector('.note-mark'), pass: row.querySelector('.tag')?.textContent === '重要' && /這是測試註解/.test(row.title) };
  });
  await step('6 草圖2 into a new folder, 伸長1 dragged onto the folder name: both are inside; fold; rename; dissolve', async () => {
    await menu('草圖2', '放進新資料夾');
    const head = () => [...document.querySelectorAll('.tree-row.folder-head')].find((r) => /資料夾/.test(r.textContent));
    const name = head().textContent.replace(/^[▸▾]\s*/, '');
    const inFolder = () => state().doc.features.filter((f) => f.folder === name).map((f) => f.name);
    const first = inFolder();
    // 伸長1 onto the folder's row
    const a = rowOf('伸長1');
    const b = head();
    const data = new DataTransfer();
    const at = b.getBoundingClientRect();
    a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
    await H.wait(60);
    b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data, clientY: at.top + at.height / 2 }));
    b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientY: at.top + at.height / 2 }));
    a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    await H.settle();
    const second = inFolder();
    await shot('6-folder');
    head().click();
    await H.wait(150);
    const folded = !rowOf('草圖2') || rowOf('草圖2').offsetParent === null || document.querySelectorAll('.tree-row.in-folder').length === 0;
    head().click();
    await H.wait(150);
    return { name, first, second, folded, order: order(), pass: first.join() === '草圖2' && second.sort().join() === '伸長1,草圖2' && folded };
  });
  await step('7 the folder renamed with a double click, then dissolved from its menu', async () => {
    const head = () => [...document.querySelectorAll('.tree-row.folder-head')].find((r) => r.textContent.length > 0);
    head().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await H.wait(150);
    const input = head().querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '零件組');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.blur();
    await H.settle();
    const renamed = state().doc.features.some((f) => f.folder === '零件組');
    const r = head().getBoundingClientRect();
    head().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 8, button: 2 }));
    await H.wait(150);
    const items = [...document.querySelectorAll('.context-menu li')].map((x) => x.textContent);
    [...document.querySelectorAll('.context-menu li')].find((x) => /解散/.test(x.textContent)).click();
    await H.settle();
    return { renamed, items, left: state().doc.features.filter((f) => f.folder).length, pass: renamed && items.some((x) => /解散/.test(x)) && state().doc.features.every((f) => !f.folder) };
  });
  await step('8 the filter: 伸長 leaves the extrusions, an empty field brings everything back', async () => {
    const box = document.querySelector('.feature-tree input[type=text], .feature-tree input:not([type]), input[placeholder^="過濾"]');
    await S.type(box, '伸長', { enter: false });
    await H.wait(200);
    const some = [...document.querySelectorAll('[data-feature-row] .name')].map((x) => x.textContent);
    await S.type(box, '', { enter: false });
    await H.wait(200);
    const all = [...document.querySelectorAll('[data-feature-row] .name')].map((x) => x.textContent);
    // the filter looks at the type too: 主體 is the renamed 伸長2, still an extrusion; the sketches are gone
    return { some, all, pass: some.join() === '伸長1,主體' && all.length === state().doc.features.length };
  });
  await step('9 新零件（範本）…: 鋁件 gives 鋁合金 6061, 塑膠件 ABS, CNS 製圖 carbon steel with the CNS standard and 2 decimals', async () => {
    const seen = {};
    for (const [label, expect] of [['鋁件', /鋁合金 6061/], ['塑膠件', /ABS/], ['CNS 製圖', /碳鋼/]]) {
      store.newPart();
      if (store.getState().unsaved) await store.answerUnsaved('discard');
      await H.settle();
      await H.action('檔案', '新零件（範本）…');
      const b = [...document.querySelectorAll('.template-list button')].find((x) => x.textContent.includes(label));
      b.click();
      await H.settle();
      await H.action('工具', '檔案屬性');
      const dlg = document.querySelector('.modal');
      const mat = dlg.querySelector('.props-material select').selectedOptions[0].textContent;
      const std = [...dlg.querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent === '製圖標準')?.querySelector('select')?.value;
      const dec = [...dlg.querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent === '尺寸小數位數')?.querySelector('input')?.value;
      seen[label] = { mat, std, dec, ok: expect.test(mat) };
      await S.modalButton('關閉');
    }
    return { seen, pass: Object.values(seen).every((v) => v.ok) && seen['CNS 製圖'].std === 'CNS' && seen['CNS 製圖'].dec === '2' };
  });
  await step('10 快速鍵…: Ctrl+Shift+E put on 新示範件 and pressed makes the demo part; 還原預設 takes it back', async () => {
    await H.action('工具', '快速鍵…');
    const input = document.querySelector('.modal [aria-label="新示範件"]');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await H.wait(150);
    const shown = document.querySelector('.modal [aria-label="新示範件"]').value;
    await shot('10-shortcut-set');
    await S.modalButton('關閉');
    store.newPart();
    if (store.getState().unsaved) await store.answerUnsaved('discard');
    await H.settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await H.settle();
    await H.wait(500);
    const volume = S.volume();
    await H.action('工具', '快速鍵…');
    const reset = [...document.querySelectorAll('.modal button')].find((b) => b.textContent === '還原預設');
    reset?.click();
    await H.wait(150);
    const after = document.querySelector('.modal [aria-label="新示範件"]').value;
    await S.modalButton('關閉');
    return { shown, volume, after, pass: /Ctrl\+Shift\+E/i.test(shown) && near(volume, 991.416, 1e-4) && !/Ctrl\+Shift\+E/i.test(after) };
  });
  return S.result('C19');
};
