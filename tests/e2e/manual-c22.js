// Manual checklist C22 (docs/manual-verification.html): 「系統選項…」: the language (English and back), 自動存檔 and its seconds, the template of 「新零件」 (鋁件 gives 鋁合金 6061),
// the pick filter a new part starts with (頂點 off), and, in English, a walk through the screens of part editing looking for Chinese text that is still there; replayed the way
// a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c22.js?' + Date.now());   // in a freshly loaded page
//   await __manualC22.run();   // -> { name, steps: [{ name, pass }], pass }
//   after loading the page again:  await import(...);  await __manualC22.optionOff();
//   after loading the page again:  await import(...);  await __manualC22.startedOff();

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC22 = {});

const CJK = /[㐀-鿿＀-￯　-〿]+/g;
const HAS_CJK = new RegExp(CJK.source); // without the g flag: `test` of a global pattern keeps a position between calls
const dialog = () => document.querySelector('.modal');
const grid = () => dialog().querySelector('.options-grid');
const optionsRow = (label) => {
  const labels = [...grid().querySelectorAll(':scope > label')];
  const l = labels.find((x) => x.textContent === label) ?? labels.find((x) => x.textContent.startsWith(label));
  return l?.nextElementSibling;
};
/** 「檔案」→「新零件」 the way a person presses it (the unsaved part is not kept). */
const newPart = async () => {
  await H.action('檔案', '新零件');
  if (store.getState().unsaved) await store.answerUnsaved('discard');
  await H.settle();
};
const openOptions = async () => {
  await H.action('工具', '系統選項…');
  return dialog();
};
const closeDialog = async () => {
  [...dialog().querySelectorAll('button')].find((b) => b.classList.contains('primary') || /關閉|Close/.test(b.textContent)).click();
  await H.wait(200);
};
/** What is Chinese in the visible parts of the page: the ribbon, the tree, the panel, the dialog, the status bar. */
const chinese = () => {
  const found = new Map();
  for (const sel of ['.tabs', '.tools', '.feature-tree', '.property-manager', '.modal', '.status-bar', '.view-options', '.heads-up', '.tree-part']) {
    for (const el of document.querySelectorAll(sel)) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent.trim();
        if (!text || n.parentElement?.closest('code, .mono')) continue;
        const hit = text.match(CJK);
        if (hit) found.set(text.slice(0, 60), sel);
      }
      for (const a of el.querySelectorAll('[title], [aria-label], [placeholder]')) {
        for (const k of ['title', 'aria-label', 'placeholder']) {
          const v = a.getAttribute(k);
          if (v && HAS_CJK.test(v)) found.set(`@${k}: ${v.slice(0, 50)}`, sel);
        }
      }
    }
  }
  return [...found.entries()].map(([text, where]) => `${where}: ${text}`);
};

M.run = async () => {
  await step('1 a block, 工具 → 系統選項…: the language is changed to English: the ribbon, the buttons and the dialog are English', async () => {
    await S.box(20, 20, 20);
    await openOptions();
    const select = optionsRow('介面語言');
    await S.select(select, 'en');
    await H.wait(500);
    const tabs = [...document.querySelectorAll('.tabs .tab')].map((x) => x.textContent);
    const title = dialog().querySelector('h3').textContent;
    await shot('1-english-options');
    // the name of the language itself stays in its own language
    const text = dialog().textContent.replace('繁體中文', '');
    return { tabs, title, cjk: text.match(CJK), pass: tabs.join() === 'Features,Sheet Metal,Sketch,Tools,File,View' && !HAS_CJK.test(title) && !HAS_CJK.test(text) };
  });
  await step('2 English: every command of the ribbon and the dialogs of part editing: what is still Chinese is listed', async () => {
    await closeDialog();
    const left = new Map();
    const note = (where) => chinese().forEach((c) => left.set(c, where));
    const tabs = [...document.querySelectorAll('.tabs .tab')];
    for (const [i, tab] of tabs.entries()) {
      tab.click();
      await H.wait(120);
      note(`tab ${i}`);
    }
    // the dialogs
    for (const dlg of ['equations', 'properties', 'appearance', 'stepOptions', 'shortcuts', 'template', 'options']) {
      store.openDialog(dlg);
      await H.wait(250);
      note(`dialog ${dlg}`);
      store.openDialog(null);
      await H.wait(150);
    }
    // the features opened one by one from the ribbon: the panel, then cancelled
    const names = [];
    for (const [i, tab] of [...document.querySelectorAll('.tabs .tab')].entries()) {
      if (i > 1) continue;
      tab.click();
      await H.wait(120);
      const count = document.querySelectorAll('.tools button').length;
      for (let k = 0; k < count; k++) {
        tab.click();
        await H.wait(80);
        const b = document.querySelectorAll('.tools button')[k];
        if (!b || b.disabled) continue;
        b.click();
        await H.wait(450);
        names.push(b.textContent);
        note(`${i}:${b.textContent}`);
        for (let e = 0; e < 3; e++) {
          document.querySelector('.property-manager .pm-cancel')?.click();
          document.querySelector('.modal .primary, .modal-actions button')?.click();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await H.wait(150);
        }
      }
    }
    // The names the document itself carries (零件1, 草圖1, 伸長1, … were made when the part was begun in Chinese) and the name of the language are data, not text of the program.
    const NAMES = /(零件|伸長|草圖|圓角|導角|薄殼|拔模|實體|基準面|基準軸|參考點|座標系統|鏡射|複製排列|異型孔|掃出|疊層拉伸|肋材|繁體中文)\d*/g;
    const list = [...left.entries()].map(([c, w]) => `${c}  <- ${w}`).filter((c) => HAS_CJK.test(c.replace(NAMES, '')));
    return { buttons: names.length, left: list, pass: names.length > 20 && list.length === 0 };
  });
  await step('3 back to 繁體中文: the ribbon is Chinese again', async () => {
    store.openDialog('options');
    await H.wait(250);
    await S.select(optionsRow('Interface language') ?? optionsRow('Language'), 'zh-TW');
    await H.wait(400);
    const tabs = [...document.querySelectorAll('.tabs .tab')].map((x) => x.textContent);
    await closeDialog();
    return { tabs, pass: tabs.join() === '特徵,鈑金,草圖,工具,檔案,檢視' };
  });
  await step('4 自動存檔 unticked and ticked again, the seconds made 10 and back to 5 (the options take effect at once)', async () => {
    await openOptions();
    const box = optionsRow('自動存檔');
    box.click();
    await H.wait(150);
    const off = store.getState().options.autosave;
    box.click();
    await H.wait(150);
    const on = store.getState().options.autosave;
    await S.type(optionsRow('最後一次變更後幾秒存檔'), '10', { enter: false });
    const ten = store.getState().options.autosaveSeconds;
    await S.type(optionsRow('最後一次變更後幾秒存檔'), '5', { enter: false });
    const five = store.getState().options.autosaveSeconds;
    return { off, on, ten, five, pass: off === false && on === true && ten === 10 && five === 5 };
  });
  await step('5 「新零件」 使用的範本 鋁件: 「新零件」 makes aluminium 6061; back to 空白', async () => {
    await S.select(optionsRow('「新零件」使用的範本'), 'aluminium');
    await closeDialog();
    await newPart();
    await H.action('工具', '檔案屬性');
    const mat = dialog().querySelector('.props-material select').selectedOptions[0].textContent;
    await S.modalButton('關閉');
    await openOptions();
    await S.select(optionsRow('「新零件」使用的範本'), 'blank');
    await closeDialog();
    return { mat, pass: /鋁合金 6061/.test(mat) && store.getState().options.defaultTemplate === 'blank' };
  });
  return S.result('C22');
};

// 開始時可以點選的元素 is what the filter is when the program STARTS (it is read once, when the page loads); the checklist (before 2026-10-08) said a 「新零件」 does it. Two loads:
// the option is changed (頂點 unticked), and the page loaded again starts with 頂點 off in 選擇濾器; then the option is put back.
M.optionOff = async () => {
  H.ready();
  await openOptions();
  const row = optionsRow('開始時可以點選的元素');
  const vertex = [...row.querySelectorAll('label')].find((l) => l.textContent.trim() === '頂點').querySelector('input');
  vertex.click();
  await H.wait(150);
  const off = store.getState().options.pickFilter.vertices === false;
  await closeDialog();
  await newPart();
  return { name: '頂點 unticked in 開始時可以點選的元素; a 「新零件」 does not change the filter of the page that is open', off, stillOn: store.getState().pickFilter.vertices === true, pass: off && store.getState().pickFilter.vertices === true };
};
M.startedOff = async () => {
  H.ready();
  const started = store.getState().pickFilter.vertices;
  const box = [...document.querySelectorAll('.pick-filter label')].find((l) => l.textContent.trim() === '頂點').querySelector('input');
  await shot('6-vertex-off-at-the-start');
  await openOptions();
  const row = optionsRow('開始時可以點選的元素');
  [...row.querySelectorAll('label')].find((l) => l.textContent.trim() === '頂點').querySelector('input').click();
  await H.wait(150);
  await closeDialog();
  return { name: 'loaded again: 頂點 is off in 選擇濾器 from the start; the option is put back', started, ticked: box.checked, pass: started === false && box.checked === false && store.getState().options.pickFilter.vertices === true };
};
