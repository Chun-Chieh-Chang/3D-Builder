// D-I1b (ADR 0141): a drawing's commands and menus as SolidWorks has them. The CommandManager shows the drawing's tabs (視圖配置, 註記, 檔案) instead of the part's;
// its buttons turn the drawing tools on and off. The right button opens the menu of what is under it: a dimension (reference, delete, for all that are chosen),
// a view (hidden lines), the empty sheet; the tree has each view's dimensions and annotations in folders, with the same menus. Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-menus.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingMenus.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingMenus = {});

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
const drw = () => store.getState().drw;
const page = () => H.page(drw()?.doc);
const d = () => store.drawingStore;
const viewOf = (dir) => page()?.views.find((v) => v.direction === dir);
const canvas = () => document.querySelector('[data-drawing-canvas]');
const toClient = ([x, y]) => {
  const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
  return [r.left + (x / 420) * r.width, r.top + ((297 - y) / 297) * r.height];
};
const rightClick = async (sheetPoint, mods = {}) => {
  const [cx, cy] = toClient(sheetPoint);
  const send = (type, buttons) => canvas().dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, pointerId: 14, button: 2, buttons, ...mods }));
  send('pointerdown', 2);
  send('pointerup', 0);
  await H.wait(200);
};
const menu = () => document.querySelector('[data-drawing-menu]');
const menuItem = (action) => menu()?.querySelector(`[data-action="${action}"]`);
const esc = async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await H.wait(100);
};
const tabs = () => [...document.querySelectorAll('.command-bar .tabs > .menu > .tab')].map((b) => b.textContent);
const tabButton = (label) => [...document.querySelectorAll('.command-bar .tabs > .menu > .tab')].find((b) => b.textContent === label);
const command = (label) => [...document.querySelectorAll('.command-bar .menu-panel button')].find((b) => b.textContent === label);
/** Where a dimension's text is drawn on the sheet. */
const textOf = (id) => store.drawingStore.scene().dimensions.get(id).items.find((i) => i.kind === 'text').at;

M.run = async () => {
  await step('1 a drawing of the plate: the CommandManager has the tabs of a drawing (視圖配置, 註記, 檔案), not those of a part', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    const partTabs = tabs();
    await H.newDrawing();
    await H.waitFor(() => drw() && page()?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
    await H.wait(200);
    const t = tabs();
    return { pass: partTabs.includes('特徵') && JSON.stringify(t) === JSON.stringify(['視圖配置', '註記', '檔案']), partTabs, t };
  });
  await step('2 註記 → 智慧型尺寸 turns the dimension tool on (the button shows it), pressing it again turns it off; 視圖配置 → 剖面 the same', async () => {
    tabButton('註記').click();
    await H.wait(150);
    command('智慧型尺寸').click();
    await H.wait(150);
    const on = drw().tool?.kind === 'dimension';
    tabButton('註記').click();
    await H.wait(150);
    const shown = command('智慧型尺寸')?.classList.contains('active');
    command('智慧型尺寸').click();
    await H.wait(150);
    const off = drw().tool === null;
    tabButton('視圖配置').click();
    await H.wait(150);
    command('剖面').click();
    await H.wait(150);
    const section = drw().tool?.kind === 'section';
    d().setTool(null);
    await H.wait(100);
    return { pass: on && shown && off && section, on, shown, off, section };
  });
  let dims;
  await step('3 the top view dimensioned: in the tree, under the view, a folder 尺寸（n）, closed; opened, a row for each, and a click on one chooses it', async () => {
    const top = viewOf('top');
    d().select(top.id);
    await H.waitFor(() => drw().features.get(top.id), 30000, 'the features of the top view');
    d().autoDimension(top.id, { overall: true, holes: false, callouts: false, positions: false });
    await H.waitFor(() => page()?.dimensions.length >= 2 && page()?.dimensions.every((x) => d().scene().dimensions.get(x.id)), 30000, 'the dimensions');
    dims = page()?.dimensions.filter((x) => x.view === top.id).map((x) => x.id);
    const key = `${top.id}:dimension`;
    const folder = document.querySelector(`[data-tree-folder="${key}"]`);
    const closedFirst = !document.querySelector(`[data-tree-dim="${dims[0]}"]`);
    folder.click();
    await H.wait(150);
    const rows = dims.map((id) => document.querySelector(`[data-tree-dim="${id}"]`));
    rows[1].click();
    await H.wait(150);
    const chosen = drw().selection.length === 1 && drw().selection[0].id === dims[1];
    return { pass: !!folder && closedFirst && folder.textContent.includes(`尺寸（${dims.length}）`) && rows.every(Boolean) && /120|80/.test(rows[0].textContent) && chosen, text: folder?.textContent, row: rows[0]?.textContent, chosen };
  });
  await step('4 the right button on a dimension\'s text: it is chosen and its menu offers 參考尺寸, which makes it one; undo takes it back', async () => {
    d().clearSelection();
    await rightClick(textOf(dims[0]));
    const chosen = drw().selection.length === 1 && drw().selection[0].kind === 'dimension' && drw().selection[0].id === dims[0];
    const kind = menu()?.getAttribute('data-drawing-menu');
    menuItem('menuReference').click();
    await H.wait(150);
    const made = page()?.dimensions.find((x) => x.id === dims[0]).reference === true;
    store.undo();
    await H.wait(150);
    const back = !page()?.dimensions.find((x) => x.id === dims[0]).reference;
    return { pass: chosen && kind === 'dimension' && made && back && !menu(), chosen, kind, made, back };
  });
  await step('5 two dimensions chosen, the right button on one of them keeps both chosen; 刪除 deletes both in one step, undone in one', async () => {
    d().pick([{ kind: 'dimension', id: dims[0] }, { kind: 'dimension', id: dims[1] }], 'replace');
    await H.wait(100);
    await rightClick(textOf(dims[1]));
    const kept = drw().selection.length === 2;
    menuItem('menuDelete').click();
    await H.wait(200);
    const gone = !page()?.dimensions.some((x) => dims.slice(0, 2).includes(x.id));
    store.undo();
    await H.wait(200);
    const back = dims.slice(0, 2).every((id) => page()?.dimensions.some((x) => x.id === id));
    return { pass: kept && gone && back, kept, gone, back };
  });
  await step('6 the right button on the front view (away from its lines): its menu; 「移除隱藏線」 (one of the display styles, ADR 0146) takes its hidden lines away', async () => {
    const front = viewOf('front');
    const pl = d().scene().placed.get(front.id);
    const hiddenOf = () => d().scene().scene.items.filter((i) => i.kind === 'polyline' && i.style === 'hidden').length;
    const was = hiddenOf();
    await rightClick([pl.at[0] + pl.w * 0.3, pl.at[1]]);
    const kind = menu()?.getAttribute('data-drawing-menu');
    menuItem('menuDisplay-hiddenRemoved').click();
    await H.wait(200);
    const now = hiddenOf();
    const display = viewOf('front').display;
    store.undo();
    await H.wait(150);
    // the front view's own hidden lines go; those of the other views stay
    const own = drw().lines.get(front.id).hidden.length;
    return { pass: kind === 'view' && display === 'hiddenRemoved' && own > 0 && was - now === own, kind, was, now, own, display };
  });
  await step('7 the right button on the empty sheet: the sheet\'s menu (標準三視圖, 最適比例, 自動排列尺寸, 輸出 PDF), nothing chosen', async () => {
    d().clearSelection();
    await rightClick([380, 270]);
    const kind = menu()?.getAttribute('data-drawing-menu');
    const items = ['menuStandard', 'menuAutoScale', 'menuArrange', 'menuPdf'].every((a) => !!menuItem(a));
    await esc();
    return { pass: kind === 'sheet' && items && drw().selection.length === 0 && !menu(), kind, items };
  });
  await step('8 a note on the top view: the tree has 註記（1） under it, and its menu there deletes it', async () => {
    const top = viewOf('top');
    const pl = d().scene().placed.get(top.id);
    d().addAnnotation({ kind: 'note', view: top.id, at: [pl.centre[0] + 10, pl.centre[1] + 10], text: '去毛邊' });
    await H.wait(200);
    const key = `${top.id}:annotation`;
    const folder = document.querySelector(`[data-tree-folder="${key}"]`);
    folder.click();
    await H.wait(150);
    const id = page()?.annotations[0].id;
    const row = document.querySelector(`[data-tree-annotation="${id}"]`);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 150, clientY: 300 }));
    await H.wait(150);
    const kind = menu()?.getAttribute('data-drawing-menu');
    menuItem('menuDelete').click();
    await H.wait(200);
    return { pass: folder.textContent.includes('註記（1）') && row.textContent.includes('去毛邊') && kind === 'annotation' && (page()?.annotations ?? []).length === 0, folder: folder.textContent, row: row.textContent, kind };
  });
  const pass = steps.every((s) => s.pass);
  return { name: 'manual-drawing-menus', steps, pass };
};
