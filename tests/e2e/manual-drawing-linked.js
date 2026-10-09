// Drawing views move and scale together, with the mouse: dragging the front view takes the arrangement with it; dragging the top or the right view changes the distance to the
// front view only (it stays in line), Shift lets it go anywhere; the handle at the corner of a chosen view changes the scale, and the views that take it scale with it; 自動排版
// puts a view (or, for the front view, the whole arrangement) back; save and open again. Asked for by the user while looking at the three views. Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-linked.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingLinked.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingLinked = {});

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
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const placed = () => store.drawingStore.scene().placed;
const viewOf = (dir) => drw().doc.views.find((v) => v.direction === dir);
const at = (dir) => placed().get(viewOf(dir).id).at;
const canvas = () => document.querySelector('[data-drawing-canvas]');
/** Sheet mm (from the lower left) on the screen: the SVG is the sheet, whatever the pan and the zoom. */
const toClient = ([x, y]) => {
  const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
  return [r.left + (x / 420) * r.width, r.top + ((297 - y) / 297) * r.height];
};
const fire = (type, [cx, cy], init = {}) =>
  canvas().dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, pointerId: 11, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...init }));
/** A drag with the left button from a point of the sheet by (dx, dy) mm, in a few moves, as a hand does it. */
const drag = async (from, [dx, dy], init = {}, target = canvas()) => {
  const start = toClient(from);
  const end = toClient([from[0] + dx, from[1] + dy]);
  const send = (type, [cx, cy]) => target.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, pointerId: 11, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...init }));
  send('pointerdown', start);
  for (let i = 1; i <= 6; i++) {
    send('pointermove', [start[0] + ((end[0] - start[0]) * i) / 6, start[1] + ((end[1] - start[1]) * i) / 6]);
    await H.wait(25);
  }
  send('pointerup', end);
  await H.wait(250);
};
const panelButton = () => document.querySelector('[data-drawing-panel] [data-action="resetPosition"]');
const select = (dir) => store.drawingStore.select(viewOf(dir).id);

M.run = async () => {
  let f0;
  let t0;
  let r0;
  await step('1 a new drawing of the plate: front, top and right in line, the first angle', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.action('檔案', '新工程圖');
    await H.waitFor(() => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
    await H.wait(300);
    [f0, t0, r0] = [at('front'), at('top'), at('right')];
    return { pass: near(t0[0], f0[0]) && near(r0[1], f0[1]) && t0[1] < f0[1] && r0[0] < f0[0], f0, t0, r0 };
  });
  await step('2 dragging the front view takes the top and the right view with it, by the same amount; no view gets a position of its own', async () => {
    await drag(f0, [30, 20]);
    const [f, t, r] = [at('front'), at('top'), at('right')];
    const same = near(f[0] - f0[0], 30) && near(f[1] - f0[1], 20) && near(t[0] - t0[0], 30) && near(t[1] - t0[1], 20) && near(r[0] - r0[0], 30) && near(r[1] - r0[1], 20);
    const doc = drw().doc;
    return { pass: same && near(doc.sheet.shift?.[0], 30) && near(doc.sheet.shift?.[1], 20) && doc.views.every((v) => !v.at && !v.slide), shift: doc.sheet.shift, f, t, r };
  });
  await step('3 dragging the top view down changes the distance to the front view only: it stays in line (same x), the others stay', async () => {
    const [f1, r1] = [at('front'), at('right')];
    const t1 = at('top');
    await drag(t1, [17, -30]); // the sideways 17 mm of the hand is not followed
    const [f, t, r] = [at('front'), at('top'), at('right')];
    return { pass: near(t[0], t1[0]) && near(t[1], t1[1] - 30) && near(f[0], f1[0]) && near(f[1], f1[1]) && near(r[0], r1[0]) && near(r[1], r1[1]) && near(viewOf('top').slide, -30), t, t1, slide: viewOf('top').slide };
  });
  await step('4 dragging the right view to the left: same height as the front view, only the distance changes', async () => {
    const r1 = at('right');
    const f1 = at('front');
    await drag(r1, [-20, 14]);
    const r = at('right');
    return { pass: near(r[1], r1[1]) && near(r[0], r1[0] - 20) && near(at('front')[0], f1[0]) && near(viewOf('right').slide, -20), r, r1 };
  });
  await step('5 moving the front view again carries the slid views with it (their distance stays)', async () => {
    const [f1, t1, r1] = [at('front'), at('top'), at('right')];
    await drag(f1, [-10, -5]);
    const [f, t, r] = [at('front'), at('top'), at('right')];
    return { pass: near(f[0] - f1[0], -10) && near(t[0] - t1[0], -10) && near(t[1] - t1[1], -5) && near(r[0] - r1[0], -10) && near(r[1] - r1[1], -5), f, t, r };
  });
  await step('6 with Shift held the top view goes where it is let go (out of line, a position of its own); the front view no longer takes it along', async () => {
    const t1 = at('top');
    await drag(t1, [25, -12], { shiftKey: true });
    const t = at('top');
    const own = viewOf('top');
    const f1 = at('front');
    await drag(f1, [5, 5]);
    return { pass: near(t[0], t1[0] + 25) && near(t[1], t1[1] - 12) && !!own.at && own.slide === undefined && near(at('top')[0], t[0]) && near(at('top')[1], t[1]), t, own: own.at };
  });
  await step('7 自動排版 puts the top view back in line under the front view; for the front view it puts the whole arrangement back in the middle', async () => {
    select('top');
    await H.wait(150);
    panelButton().click();
    await H.wait(250);
    const backInLine = near(at('top')[0], at('front')[0]) && !viewOf('top').at && !viewOf('top').slide;
    select('front');
    await H.wait(150);
    panelButton().click();
    await H.wait(250);
    const centred = near(at('front')[0], f0[0]) && near(at('front')[1], f0[1]) && !drw().doc.sheet.shift;
    return { pass: backInLine && centred && !panelButton().disabled === false, backInLine, centred, front: at('front'), f0 };
  });
  let before;
  await step('8 the handle at the corner of the chosen front view: dragging it outward makes the scale bigger, and the top and right views scale with it (the sheet takes the scale)', async () => {
    before = [at('front'), at('top'), at('right')].map((p) => p.slice());
    select('front');
    await H.wait(200);
    const handle = document.querySelector('[data-scale-handle]');
    if (!handle) return { pass: false, why: 'no handle' };
    const placedFront = placed().get(viewOf('front').id);
    // the corner at the lower right of the front view; drag it away from the middle by 20% of the distance to it
    const corner = [placedFront.at[0] + placedFront.w / 2, placedFront.at[1] - placedFront.h / 2];
    const away = [(corner[0] - placedFront.at[0]) * 0.2, (corner[1] - placedFront.at[1]) * 0.2];
    await drag(corner, away, {}, handle);
    const s = drw().doc.sheet.scale;
    const ratios = ['front', 'top', 'right'].map((d) => placed().get(viewOf(d).id).scale);
    return { pass: s[0] / s[1] > 1.1 && ratios.every((x) => near(x, s[0] / s[1], 1e-9)) && drw().doc.views.every((v) => !v.scale), scale: s, ratios };
  });
  await step('9 dragging it in again to about half: the scale snaps to 1:2, and the views draw smaller together; undo takes the scale back', async () => {
    const placedFront = placed().get(viewOf('front').id);
    const handle = document.querySelector('[data-scale-handle]');
    const ratio0 = placedFront.scale;
    const corner = [placedFront.at[0] + placedFront.w / 2, placedFront.at[1] - placedFront.h / 2];
    const dist = Math.hypot(corner[0] - placedFront.at[0], corner[1] - placedFront.at[1]);
    const unit = [(corner[0] - placedFront.at[0]) / dist, (corner[1] - placedFront.at[1]) / dist];
    const wanted = 0.5 / ratio0 - 1; // the corner at half the distance it has now, for the ratio 1:2
    await drag(corner, [unit[0] * dist * -(1 - 0.5 / ratio0), unit[1] * dist * -(1 - 0.5 / ratio0)], {}, handle);
    const s = drw().doc.sheet.scale;
    const half = s[0] === 1 && s[1] === 2;
    const smaller = placed().get(viewOf('top').id).scale === 0.5;
    store.undo();
    await H.wait(200);
    const back = drw().doc.sheet.scale;
    return { pass: half && smaller && !(back[0] === 1 && back[1] === 2), s, back, wanted };
  });
  await step('10 the shift and the slides are in the file: saved, opened again, the views are where they were', async () => {
    store.drawingStore.setSheet({ scale: [1, 1] });
    store.drawingStore.setView(viewOf('top').id, { slide: -18 });
    store.drawingStore.setSheet({ shift: [12, -4] });
    await H.wait(200);
    const [f, t, r] = [at('front'), at('top'), at('right')];
    H.next.save = '定位板.3dbd';
    await H.action('檔案', '儲存檔案');
    await H.waitFor(() => !drw().dirty, 10000, 'the save');
    await H.open('定位板.3dbd');
    await H.waitFor(() => drw() && drw().fileName === '定位板.3dbd' && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the drawing to open');
    await H.wait(300);
    return { pass: near(at('front')[0], f[0]) && near(at('front')[1], f[1]) && near(at('top')[1], t[1]) && near(at('right')[0], r[0]) && drw().doc.sheet.shift?.[0] === 12 && viewOf('top').slide === -18, f, t, r };
  });
  await step('11 with the dimensions drawn on the views and a scale that is too big, 最適比例 picks the scale at which the lines and the dimensions are all inside the area of the sheet', async () => {
    const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
    for (const dir of ['front', 'top']) {
      panel(`[data-view="${viewOf(dir).id}"]`).click();
      await H.waitFor(() => drw().features.get(viewOf(dir).id), 30000, `the features of the ${dir} view`);
      await H.wait(150);
      panel('[data-action="autoDimension"]').click();
      await H.waitFor(() => drw().doc.dimensions.some((x) => x.view === viewOf(dir).id) && drw().elements.size >= drw().doc.dimensions.length, 30000, `the dimensions of the ${dir} view`);
    }
    store.drawingStore.setSheet({ scale: [2, 1], shift: null });
    await H.wait(250);
    const tooBig = (() => {
      const items = store.drawingStore.scene().scene.items.filter((i) => i.group);
      return items.length > 0;
    })();
    panel('[data-action="autoScale"]').click();
    await H.wait(500);
    const sheet = drw().doc.sheet;
    const { scene } = store.drawingStore.scene();
    // the lines of the views and the dimensions (not the frame and the title block)
    const pts = [];
    for (const i of scene.items) {
      if (i.kind === 'polyline' && (i.style === 'visible' || i.style === 'hidden' || i.style === 'dimension' || i.style === 'center')) for (let k = 0; k + 1 < i.points.length; k += 2) pts.push([i.points[k], i.points[k + 1]]);
    }
    const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
    const [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
    // the area of an A3: x 28 to 402, y 66 to 279
    const inside = x0 >= 28 - 0.01 && x1 <= 402 + 0.01 && y0 >= 66 - 0.01 && y1 <= 279 + 0.01;
    return { pass: tooBig && inside && !(sheet.scale[0] === 2 && sheet.scale[1] === 1) && pts.length > 0, scale: sheet.scale, shift: sheet.shift, box: [x0, y0, x1, y1] };
  });
  return { name: 'drawing-linked', steps, pass: steps.every((s) => s.pass) };
};
