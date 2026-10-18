// A new drawing saved before its 最適比例 has happened (ADR 0147): the scale is fitted once what the views can be dimensioned from is known, which a slow kernel
// (a batch of scripts: 5.4 s to load) brings well after the three views are drawn. Saved in between, the fit used to come after the save and left the drawing
// changed (*), so 「開啟零件」 was then held up by 「要儲存變更嗎？」. The worker's answer about the features is held back here until the save has been asked for
// — the slow kernel made certain, not waited out. Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-save-before-fit.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingSaveBeforeFit.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const { readAnyDocumentFile } = await import(`${root}packages/io/src/index.ts`);
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingSaveBeforeFit = {});

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
const page = (d = drw()?.doc) => H.page(d);
const allLines = () => drw() && page()?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3;
const sheetOf = (doc) => {
  const s = doc?.sheet ?? H.page(doc)?.sheet;
  return JSON.stringify({ scale: s?.scale, shift: s?.shift ?? null });
};

/** The worker's answers about what the views can be dimensioned from, held until `release()`: the kernel that has not got there yet. */
let release = () => {};
const holdFeatures = () => {
  const host = store.drawingStore.host;
  const api = host.api;
  const gate = new Promise((r) => (release = r));
  host.api = new Proxy(api, { get: (t, k) => (k === 'drawingFeatures' ? async (...a) => (await gate, t.drawingFeatures(...a)) : t[k]) });
};

M.run = async () => {
  let unfitted = null;
  await step('1 a new drawing of the plate with the three views drawn, what they are dimensioned from not known yet: not fitted', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.action('檔案', '新工程圖');
    await H.waitFor(() => store.drawingStore && drw(), 20000, 'the new drawing');
    holdFeatures();
    const button = await H.waitFor(() => {
      const b = document.querySelector('[data-action="standardViews"]');
      return b && !b.disabled ? b : null;
    }, 30000, 'the standard 3 views button');
    button.click();
    await H.waitFor(allLines, 30000, 'the three views');
    unfitted = sheetOf(drw().doc);
    return { pass: drw().features.size === 0 && drw().dirty, features: drw().features.size, sheet: unfitted };
  });
  await step('2 「儲存檔案」 then: the file is chosen at once (the dialog needs the click), and written only once the scale is fitted', async () => {
    H.next.save = '定位板.3dbd';
    await H.action('檔案', '儲存檔案');
    const asked = H.dialogs.at(-1)?.[0] === 'save' && H.dialogs.at(-1)?.[1] === '定位板.3dbd';
    const held = drw().fileName === null && drw().features.size === 0;
    // the stand-in for the dialog makes the file, empty, as the system dialog does
    const written = (await H.readAt('定位板.3dbd')).length;
    return { pass: asked && held && written === 0, asked, held, written, dialogs: H.dialogs };
  });
  await step('3 the features come: saved fitted, nothing left unsaved (no *)', async () => {
    release();
    await H.waitFor(() => drw().features.size === 3 && drw().fileName === '定位板.3dbd', 30000, 'the features of the three views and the save');
    await store.drawingStore.fitSettled(); // a fit still to come (after the save) has come once this resolves
    const fitted = sheetOf(drw().doc);
    const file = await readAnyDocumentFile(await H.readAt('定位板.3dbd'));
    const saved = sheetOf(file.doc);
    const title = document.title;
    return {
      pass: !drw().dirty && fitted !== unfitted && saved === fitted && store.drawingStore.arrangementCentred() && !/\*/.test(title),
      dirty: drw().dirty,
      unfitted,
      fitted,
      saved,
      title,
    };
  });
  await step('4 the fit is part of placing the views, not a step of its own: one 「復原」 takes the views and the fit, 「取消復原」 brings both back, unchanged since the save', async () => {
    const fitted = sheetOf(drw().doc);
    store.drawingStore.undo();
    await H.wait(100);
    const undone = { views: page()?.views.length, sheet: sheetOf(drw().doc), canUndo: drw().canUndo };
    store.drawingStore.redo();
    await H.waitFor(allLines, 30000, 'the three views again');
    const redone = { views: page()?.views.length, sheet: sheetOf(drw().doc), dirty: drw().dirty };
    return { pass: undone.views === 0 && undone.sheet === unfitted && !undone.canUndo && redone.views === 3 && redone.sheet === fitted && !redone.dirty, undone, redone, fitted, unfitted };
  });
  await step('5 「開啟零件」 opens the part without asking about changes', async () => {
    const front = page()?.views.find((v) => v.direction === 'front');
    store.openPartOfDrawing(store.drawingStore.viewSourcePath(front.id));
    await H.wait(200);
    const asked = !!store.getState().unsaved;
    if (asked) await store.answerUnsaved('cancel');
    await H.waitFor(() => asked || (store.getState().active === 'part' && store.getState().result?.mesh), 20000, 'the part to open');
    return { pass: !asked && store.getState().active === 'part' && store.getState().fileName === '定位板.3dbx', asked, active: store.getState().active };
  });
  const pass = steps.every((s) => s.pass);
  return { name: 'manual-drawing-save-before-fit', steps, pass };
};
