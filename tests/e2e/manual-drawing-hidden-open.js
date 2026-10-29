// A drawing opened while its pane has no size (the window or the app's pane hidden): the sheet's 最適比例 used to be worked out from a width and height of 0, a
// negative zoom, and the SVG of the sheet then threw 「SVG strokeScale must be finite and positive」 — uncaught, so the whole page went blank. The fit now waits
// until the pane has a size, and comes when it is shown. The page is hidden here with display: none, the 0×0 a hidden pane gives. Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it, and fails the row on any console error). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-hidden-open.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingHiddenOpen.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingHiddenOpen = {});

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
const allLines = () => drw() && H.page(drw().doc)?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3;
/** What went uncaught on the page since the script began (the render error never reaches the store). */
const thrown = [];
window.addEventListener('error', (e) => thrown.push(String(e.error?.message ?? e.message)));
/** The sheet as it is on the screen: the zoom of the stage and the size of the paper in pixels. */
const onScreen = () => {
  const stage = document.querySelector('.drawing-stage');
  const zoom = stage ? Number(/scale\(([^)]+)\)/.exec(stage.style.transform)?.[1]) : NaN;
  const paper = document.querySelector('[data-drawing-canvas] [data-svg] svg')?.getBoundingClientRect();
  const pane = document.querySelector('[data-drawing-canvas]')?.getBoundingClientRect();
  return { zoom, paper: paper && { w: Math.round(paper.width), h: Math.round(paper.height) }, pane: pane && { w: Math.round(pane.width), h: Math.round(pane.height) } };
};
/** Fitted (最適比例): a finite, positive zoom, the paper inside the pane and filling it one way or the other. */
const fitted = (v) => !!v?.paper && !!v.pane && v.pane.w > 0 && Number.isFinite(v.zoom) && v.zoom > 0 && v.paper.w <= v.pane.w && v.paper.h <= v.pane.h && (v.paper.w >= v.pane.w * 0.5 || v.paper.h >= v.pane.h * 0.5);
const appRoot = () =>document.getElementById('root');

M.run = async () => {
  await step('1 the part, then the page hidden (0×0) and a new drawing with the three views made in it: nothing thrown', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    appRoot().style.display = 'none';
    await H.action('檔案', '新工程圖');
    await H.waitFor(() => store.drawingStore && drw(), 20000, 'the new drawing');
    const button = await H.waitFor(() => {
      const b = document.querySelector('[data-action="standardViews"]');
      return b && !b.disabled ? b : null;
    }, 30000, 'the standard 3 views button');
    button.click();
    await H.waitFor(allLines, 30000, 'the three views');
    await store.drawingStore.fitSettled();
    await H.wait(300);
    const hidden = onScreen();
    return { pass: thrown.length === 0 && !!document.querySelector('[data-drawing-canvas]') && hidden.pane?.w === 0, thrown: [...thrown], hidden };
  });
  await step('2 the page shown again: the sheet is fitted to the pane (zoom finite and positive, the paper inside the pane and most of it)', async () => {
    appRoot().style.display = '';
    let last = null;
    const s = await H.waitFor(() => {
      const v = (last = onScreen());
      return fitted(v) ? v : null;
    }, 10000, 'the sheet fitted to the pane').catch(() => last);
    return { pass: thrown.length === 0 && fitted(s), thrown: [...thrown], shown: s };
  });
  await step('3 zoomed in by hand, hidden and shown again: the zoom is the user\'s, not fitted again; nothing thrown', async () => {
    const pane = document.querySelector('[data-drawing-canvas]');
    const r = pane.getBoundingClientRect();
    const before = onScreen().zoom;
    pane.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    await H.wait(200);
    const zoomed = onScreen().zoom;
    appRoot().style.display = 'none';
    await H.wait(200);
    appRoot().style.display = '';
    await H.wait(300);
    const after = onScreen().zoom;
    return { pass: thrown.length === 0 && zoomed > before && after === zoomed, thrown: [...thrown], before, zoomed, after };
  });
  const pass = steps.every((s) => s.pass);
  return { name: 'manual-drawing-hidden-open', steps, pass };
};
