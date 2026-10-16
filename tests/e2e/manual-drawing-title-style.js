// ADR 0150: the title block's text — the height of a cell's field name, of the text under it, of the drawing's own title, and the shrink when a text is too wide for its cell.
// Nothing is taken from what the panel was told: a height is read off what the sheet draws (the scene's millimetres and the SVG's own font size), and fitting is judged by
// the browser's own laid-out width of the drawn text — the font on the screen is the browser's, the budget is the cell's. Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-title-style.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingTitleStyle.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const { titleCells, TITLE_FIT_MIN } = await import(`${root}packages/drawing/src/index.ts`);
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingTitleStyle = {});

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await window.__shot?.(name);
  steps.push({ name, pass: r?.pass === true, measured: r, detail: r?.pass === true ? undefined : r });
  return r;
};
const drw = () => store.getState().drw;
const d = () => store.drawingStore;
const allLines = () => drw() && drw().doc.views.every((v) => drw().lines.get(v.id));
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const setNumber = async (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(30);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.wait(200);
};
/** The millimetres a title block text is drawn at, and how wide the browser laid it out (the sheet's viewBox is millimetres, so a bounding box is in mm). */
const drawn = (text) => {
  const items = d().scene().scene.items.filter((i) => i.kind === 'text' && i.text === text);
  if (items.length !== 1) throw new Error(`drawn once expected, found ${items.length}: ${text}`);
  const node = [...document.querySelectorAll('[data-svg] svg text')].find((t) => t.textContent === text);
  if (!node) throw new Error(`not on the page: ${text}`);
  return { h: items[0].height, mm: node.getBBox().width, fontSize: Number(node.getAttribute('font-size')) };
};
/** The page writes a text's height as 1.4 times it: `as` is what the box should say, given how the numbers are kept. */
const writtenAs = (x, h) => Math.abs(x - h * 1.4) < 1e-9;
/** The width a cell leaves its text: what `fit` shrinks to (ADR 0150: a 2 mm inset and 1 mm before the far line). */
const budget = (field) => titleCells().find((c) => c.field === field).w - 3;
const TITLE_TEXT = 'C.3 檢具';
const LONG_TITLE = '組合件底盤與支撐架之檢具（第三角投影）';

M.run = async () => {
  await step('0 a drawing of 定位板, with the title block filled in as the user fills his', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.newDrawing();
    await H.waitFor(() => drw() && drw().doc.views.length === 3 && allLines(), 30000, 'the three views');
    for (const [field, value] of [['company', 'Mouldex'], ['drawingName', TITLE_TEXT], ['drawingNo', 'Test'], ['revision', 'A'], ['material', 'Starvax'], ['generalTolerance', '+/- 0.01'], ['drafter', 'Wesley Chang'], ['date', '2026-10-16']]) d().setTitle(field, value);
    await H.wait(250);
    d().clearSelection();
    document.querySelector('[data-drawing-panel] [data-tab="props"]').click();
    await H.waitFor(() => panel('[data-group="titleStyle"]'), 5000, 'the title style fields');
    return { pass: drw().doc.schemaVersion === 20 && !('titleStyle' in drw().doc.sheet), schema: drw().doc.schemaVersion, fields: ['titleStyleLabel', 'titleStyleValue', 'titleStyleTitle', 'titleStyleFit'].every((f) => !!panel(`[data-field="${f}"]`)) && !!panel('[data-action="titleStyleReset"]') };
  });

  await step('1 with no style: names 2.2, texts 3.5, the title 6 — and the page writes them at 1.4 times that', async () => {
    const label = drawn('公司');
    const value = drawn('Mouldex');
    const title = drawn(TITLE_TEXT);
    return {
      pass: label.h === 2.2 && value.h === 3.5 && title.h === 6 && writtenAs(label.fontSize, 2.2) && writtenAs(value.fontSize, 3.5) && writtenAs(title.fontSize, 6),
      label,
      value,
      title,
    };
  });

  await step('2 「標題字高」 9.5 from the panel: the title is drawn 9.5, the rest as they were (its sum with the name is exactly the 11.7 allowed)', async () => {
    await setNumber(panel('[data-field="titleStyleTitle"]'), 9.5);
    const title = drawn(TITLE_TEXT);
    const others = ['公司', '圖名', '日期'].map(drawn);
    const values = ['Mouldex', 'Wesley Chang'].map(drawn);
    return {
      pass: title.h === 9.5 && others.every((x) => x.h === 2.2) && values.every((x) => x.h === 3.5) && JSON.stringify(drw().doc.sheet.titleStyle) === JSON.stringify({ title: 9.5 }),
      title,
      style: drw().doc.sheet.titleStyle,
    };
  });

  await step('3 「欄位名稱字高」 4 mm: the box is asked of the same rules the command uses, marked with the reason, and nothing is sent', async () => {
    store.set({ notice: null });
    await setNumber(panel('[data-field="titleStyleLabel"]'), 4);
    const box = panel('[data-field="titleStyleLabel"]');
    const clean = panel('[data-field="titleStyleValue"]');
    const reason = panel('[data-field-reason="titleStyleLabel"]');
    const label = drawn('公司');
    // what the browser actually resolves, not just the class: a marked frame reads different from its clean neighbour. Geometry is not asserted here — the runner's
    // page does not lay the panel's subtree out at all (its offsetParent is null), so rects read zero; the reason taking a line of its own is checked by eye on screen.
    const painted = { border: getComputedStyle(box).borderTopColor, cleanBorder: getComputedStyle(clean).borderTopColor, background: getComputedStyle(box).backgroundColor, cleanBackground: getComputedStyle(clean).backgroundColor };
    const marked = box.classList.contains('invalid') && painted.border !== painted.cleanBorder && painted.background !== painted.cleanBackground;
    return {
      pass:
        marked &&
        box.getAttribute('aria-invalid') === 'true' &&
        !!reason &&
        /欄位名稱字高/.test(reason.textContent) &&
        /合計/.test(reason.textContent) &&
        store.getState().notice === null &&
        label.h === 2.2 &&
        JSON.stringify(drw().doc.sheet.titleStyle) === JSON.stringify({ title: 9.5 }),
      marked,
      painted,
      reason: reason?.textContent,
      notice: store.getState().notice,
      box: box.value,
      labelHeight: label.h,
      style: drw().doc.sheet.titleStyle,
    };
  });

  await step('3b 2.3 mm is refused too — with the 9.5 mm title it is 0.1 over the 11.7 the cell leaves — and 2.2 clears the mark', async () => {
    await setNumber(panel('[data-field="titleStyleLabel"]'), 2.3);
    const over = { box: panel('[data-field="titleStyleLabel"]').value, invalid: panel('[data-field="titleStyleLabel"]').classList.contains('invalid'), reason: !!panel('[data-field-reason="titleStyleLabel"]'), drawn: drawn('公司').h };
    await setNumber(panel('[data-field="titleStyleLabel"]'), 2.2);
    const box = panel('[data-field="titleStyleLabel"]');
    const back = { box: box.value, invalid: box.classList.contains('invalid'), reason: !!panel('[data-field-reason="titleStyleLabel"]'), drawn: drawn('公司').h };
    return { pass: over.invalid && over.reason && over.drawn === 2.2 && back.box === '2.2' && !back.invalid && !back.reason && back.drawn === 2.2, over, back };
  });

  await step('4 「數值字高」 4.8 (its sum with the name is exactly the 7 allowed): a date too wide for its cell is drawn shrunk, and the browser fits it', async () => {
    await setNumber(panel('[data-field="titleStyleValue"]'), 4.8);
    const date = drawn('2026-10-16');
    const fit = drawn('+/- 0.01');
    const avail = budget('date');
    return {
      pass: date.h < 4.8 && date.h > TITLE_FIT_MIN && date.mm <= avail * 1.015 && date.mm >= avail * 0.9 && fit.h === 4.8 && drawn('Mouldex').h === 4.8,
      avail,
      date,
      fitText: '+/- 0.01 放得下',
      fits: fit,
      notShrunk: drawn('Mouldex'),
      ratio: date.h / 4.8,
    };
  });

  await step('5 「超出儲存格時自動縮小」 off: the same date is drawn at the full 4.8 mm and overflows its cell', async () => {
    panel('[data-field="titleStyleFit"]').click();
    await H.wait(250);
    const date = drawn('2026-10-16');
    const avail = budget('date');
    return { pass: date.h === 4.8 && date.mm > avail && drw().doc.sheet.titleStyle.fit === false, avail, date, style: drw().doc.sheet.titleStyle };
  });
  await step('5b back on: the full height is asked again, and the shrink comes back with it', async () => {
    panel('[data-field="titleStyleFit"]').click();
    await H.wait(250);
    const date = drawn('2026-10-16');
    return { pass: date.h < 4.8 && drw().doc.sheet.titleStyle.fit !== false, date };
  });

  await step('6 nineteen full-width characters of title: shrunk to what the cell leaves, and the browser keeps it inside the line', async () => {
    d().setTitle('drawingName', LONG_TITLE);
    await H.wait(250);
    const title = drawn(LONG_TITLE);
    const avail = budget('drawingName');
    return { pass: title.h < 9.5 && title.h > TITLE_FIT_MIN && title.mm <= avail * 1.015, chars: [...LONG_TITLE].length, avail, title, slackMm: avail * 1.015 - title.mm };
  });

  await step('7 「恢復預設」 takes the style away: no titleStyle in the file, and every text is drawn at ISO 7200 again', async () => {
    d().setTitle('drawingName', TITLE_TEXT);
    await H.wait(200);
    panel('[data-action="titleStyleReset"]').click();
    await H.wait(250);
    const label = drawn('公司');
    const value = drawn('Mouldex');
    const title = drawn(TITLE_TEXT);
    const boxes = { label: panel('[data-field="titleStyleLabel"]').value, value: panel('[data-field="titleStyleValue"]').value, title: panel('[data-field="titleStyleTitle"]').value };
    return {
      pass:
        !('titleStyle' in drw().doc.sheet) &&
        label.h === 2.2 &&
        value.h === 3.5 &&
        title.h === 6 &&
        writtenAs(title.fontSize, 6) &&
        panel('[data-action="titleStyleReset"]').disabled &&
        boxes.label === '2.2' &&
        boxes.value === '3.5' &&
        boxes.title === '6',
      label,
      value,
      title,
      // every box says what is drawn, including the one that was refused in step 3 — the box no longer keeps a number the sheet does not show
      boxes,
    };
  });

  await step('8 a field with no guard of its own: when the command refuses, the box goes back to what is drawn (the shared NumberBox, so every panel field)', async () => {
    const box = document.querySelector('[data-drawing-panel] [data-group="dimStyle-sheet"] [data-field="dimStyleText"]');
    if (!box) throw new Error('the sheet\'s dimension style group is not on the panel');
    const before = box.value;
    store.set({ notice: null });
    await setNumber(box, 0);
    const notice = store.getState().notice;
    const style = drw().doc.sheet.dimStyle;
    return { pass: box.value === before && notice?.kind === 'error' && /文字高度/.test(notice.text) && !(style && 'text' in (style ?? {})), before, after: box.value, notice, style };
  });

  const pass = steps.every((s) => s.pass);
  return { name: 'manual-drawing-title-style', steps, pass };
};
