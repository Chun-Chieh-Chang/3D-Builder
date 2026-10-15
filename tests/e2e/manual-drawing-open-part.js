// D-I7(a) (ADR 0140): 「開啟零件」 from a view of the drawing, as SolidWorks's right-click menu has it, and back. The right button let go where it was pressed opens
// the view's menu (dragged, it still pans); 「開啟零件」 opens the part, 「返回工程圖」 reopens the drawing, and its views show the part as it was saved meanwhile (the
// plate made 150 wide instead of 120). A drawing with changes is asked about first. Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run
// verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-open-part.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingOpenPart.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingOpenPart = {});

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
const viewOf = (dir) => drw().doc.views.find((v) => v.direction === dir);
const canvas = () => document.querySelector('[data-drawing-canvas]');
/** Sheet mm (from the lower left) on the screen: the SVG is the sheet, whatever the pan and the zoom. */
const toClient = ([x, y]) => {
  const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
  const s = drw().doc.sheet.size === 'A4' ? [297, 210] : [420, 297];
  return [r.left + (x / s[0]) * r.width, r.top + ((s[1] - y) / s[1]) * r.height];
};
const right = async ([cx, cy], move = [0, 0]) => {
  const send = (type, x, y, buttons) => canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 12, button: 2, buttons }));
  send('pointerdown', cx, cy, 2);
  for (let i = 1; i <= 4; i++) {
    send('pointermove', cx + (move[0] * i) / 4, cy + (move[1] * i) / 4, 2);
    await H.wait(20);
  }
  send('pointerup', cx + move[0], cy + move[1], 0);
  await H.wait(200);
};
const frontAt = () => store.drawingStore.scene().placed.get(viewOf('front').id).at;
/** How wide the front view's lines are, in the part's millimetres. */
const frontWidth = () => {
  const b = drw().lines.get(viewOf('front').id)?.box;
  return b ? b.max[0] - b.min[0] : null;
};
const menu = () => document.querySelector('[data-view-menu]');
const allLines = () => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3;

M.run = async () => {
  await step('1 the plate and a drawing of it with the three views, saved: the front view is 120 wide', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.newDrawing();
    await H.waitFor(allLines, 30000, 'the three views');
    H.next.save = '定位板.3dbd';
    await H.action('檔案', '儲存檔案');
    await H.waitFor(() => !drw().dirty && drw().fileName === '定位板.3dbd', 10000, 'the save');
    const w = frontWidth();
    return { pass: Math.abs(w - 120) < 0.05, w };
  });
  await step('2 the right button dragged pans the sheet and opens no menu', async () => {
    const before = document.querySelector('.drawing-stage').style.transform;
    await right(toClient(frontAt()), [40, 25]);
    const after = document.querySelector('.drawing-stage').style.transform;
    return { pass: before !== after && !menu(), before, after };
  });
  await step('3 the right button let go where it was pressed on the front view: its menu, with 「開啟零件（定位板.3dbx）」; the view is chosen; Esc closes it', async () => {
    await right(toClient(frontAt()));
    const m = menu();
    const item = m?.querySelector('[data-action="openViewPart"]');
    const chosen = drw().selected === viewOf('front').id;
    const label = item?.textContent;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await H.wait(100);
    return { pass: !!item && /定位板\.3dbx/.test(label) && chosen && !menu(), label, chosen };
  });
  await step('4 the views of the FeatureManager tree have the same menu', async () => {
    const row = document.querySelector(`[data-drawing-panel] [data-view="${viewOf('top').id}"]`);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200 }));
    await H.wait(150);
    const ok = !!menu()?.querySelector('[data-action="openViewPart"]') && drw().selected === viewOf('top').id;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await H.wait(100);
    return { pass: ok && !menu() };
  });
  await step('5 a drawing with changes is asked about first: 「取消」 stays in the drawing', async () => {
    store.drawingStore.setSheet({ shift: [5, 5] });
    await H.wait(150);
    await right(toClient(frontAt()));
    menu().querySelector('[data-action="openViewPart"]').click();
    await H.wait(200);
    const asked = !!store.getState().unsaved;
    await store.answerUnsaved('cancel');
    await H.wait(150);
    const stayed = store.getState().active === 'drawing';
    store.undo();
    await H.wait(200);
    return { pass: asked && stayed && !drw().dirty, asked, stayed, dirty: drw().dirty };
  });
  await step('6 「開啟零件」: the part is the open document, with 「返回工程圖「定位板」」 above its tree', async () => {
    await right(toClient(frontAt()));
    menu().querySelector('[data-action="openViewPart"]').click();
    await H.waitFor(() => store.getState().active === 'part' && store.getState().result?.mesh, 20000, 'the part to open');
    await H.settle();
    const back = await H.waitFor(() => document.querySelector('[data-action="returnBack"]'), 5000, 'the return bar');
    const r = store.getState().returnTo;
    return { pass: r?.kind === 'drawing' && /返回工程圖/.test(back.textContent) && store.getState().fileName === '定位板.3dbx', returnTo: r, text: back.textContent };
  });
  await step('7 the plate made 150 wide and saved', async () => {
    const s = store.getState();
    const doc = s.doc;
    const sketch = doc.features.find((f) => f.type === 'sketch' && f.constraints?.some((c) => /^120(\s*mm)?$/.test(String(c.value ?? ''))));
    const width = sketch?.constraints.find((c) => /^120(\s*mm)?$/.test(String(c.value ?? '')));
    if (!sketch || !width) return { pass: false, why: 'no 120 dimension', s: s.fileName };
    store.execute({ type: 'setDimension', featureId: sketch.id, constraintId: width.id, value: '150' });
    await H.settle();
    await H.save('定位板.3dbx');
    return { pass: !store.getState().dirty };
  });
  await step('8 「返回工程圖」: the drawing opens again and its front view is 150 wide, as the part was saved', async () => {
    document.querySelector('[data-action="returnBack"]').click();
    await H.waitFor(() => store.getState().active === 'drawing' && drw()?.fileName === '定位板.3dbd' && allLines(), 30000, 'the drawing to open again');
    await H.waitFor(() => Math.abs(frontWidth() - 150) < 0.05, 30000, 'the front view of the part as saved');
    return { pass: Math.abs(frontWidth() - 150) < 0.05 && store.getState().returnTo === null, w: frontWidth() };
  });
  const pass = steps.every((s) => s.pass);
  return { name: 'manual-drawing-open-part', steps, pass };
};
