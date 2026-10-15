// ADR 0146: the six things the user found missing on a drawing of a part (A3, third angle), each done as SolidWorks does it — (1) 「開啟零件」 always in sight on the
// drawing's tree and in the 檔案 menu, and back; (2) the display styles of a view, shading among them; (6) a view projected off a corner is the isometric from
// that corner; (3) 「解除對齊」 lets a section go anywhere and 「預設對齊」 puts it back; (4, 5) the drawing's dimension style and a dimension's own — text
// height, arrows, line width. Everything is measured on the page or on the scene it is drawn from. Replayed in the app's page (http://127.0.0.1:5391,
// 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-sw-parity.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingSwParity.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const { axesOf, cornerAxes, viewVectors } = await import(`${root}packages/model/src/index.ts`);
const { slideAxis } = await import(`${root}packages/drawing/src/index.ts`);
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingSwParity = {});

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
const d = () => store.drawingStore;
const viewOf = (dir) => drw().doc.views.find((v) => v.direction === dir);
const placedOf = (id) => d().scene().placed.get(id);
const canvas = () => document.querySelector('[data-drawing-canvas]');
/** Sheet mm (from the lower left) on the screen: the SVG is the sheet, whatever the pan and the zoom. */
const toClient = ([x, y]) => {
  const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
  return [r.left + (x / 420) * r.width, r.top + ((297 - y) / 297) * r.height];
};
const send = (type, [cx, cy], button = 0, init = {}) =>
  canvas().dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, pointerId: 13, button, buttons: type === 'pointerup' ? 0 : button === 2 ? 2 : 1, ...init }));
/** A left drag on the sheet from a point by (dx, dy) mm, in a few moves. */
const drag = async (from, [dx, dy]) => {
  const start = toClient(from);
  const end = toClient([from[0] + dx, from[1] + dy]);
  send('pointerdown', start);
  for (let i = 1; i <= 6; i++) {
    send('pointermove', [start[0] + ((end[0] - start[0]) * i) / 6, start[1] + ((end[1] - start[1]) * i) / 6]);
    await H.wait(25);
  }
  send('pointerup', end);
  await H.wait(250);
};
/** The right button pressed and let go at a point of the sheet: the menu of what is there. */
const rightClick = async (at) => {
  const p = toClient(at);
  send('pointerdown', p, 2);
  send('pointerup', p, 2);
  await H.wait(200);
  return document.querySelector('[data-drawing-menu]');
};
const closeMenu = async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await H.wait(100);
};
const setSelect = async (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(150);
};
const setNumber = async (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(30);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.wait(200);
};
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const close = (a, b, tol = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const allLines = () => drw() && drw().doc.views.every((v) => drw().lines.get(v.id));
/** What the scene draws for a dimension: its texts' heights, its lines' widths, whether any is filled. */
const drawnOf = (id) => {
  const items = d().scene().scene.items.filter((i) => i.group === id);
  return { heights: items.filter((i) => i.kind === 'text').map((i) => i.height), widths: [...new Set(items.filter((i) => i.kind === 'polyline').map((i) => i.width ?? 0.25))], filled: items.some((i) => i.kind === 'polyline' && i.filled) };
};

M.run = async () => {
  await step('0 the plate and a drawing of it in third angle with the three views, saved', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.newDrawing();
    await H.waitFor(() => drw() && drw().doc.views.length === 3 && allLines(), 30000, 'the three views');
    // a new drawing fits its scale once what its views can be dimensioned from is known; saved before that, the fit comes after the save and leaves the
    // drawing changed (a slow kernel in a batch of scripts shows it)
    await H.waitFor(() => drw().features.size === 3, 30000, 'the features of the three views');
    await H.wait(300);
    d().setSheet({ projection: 'third' });
    await H.waitFor(allLines, 30000, 'the views in third angle');
    await H.waitFor(() => drw().features.size === 3, 30000, 'the features in third angle');
    H.next.save = '定位板.3dbd';
    await H.action('檔案', '儲存檔案');
    await H.waitFor(() => !drw().dirty && drw().fileName === '定位板.3dbd', 10000, 'the save');
    return { pass: drw().doc.sheet.projection === 'third' };
  });

  await step('1a 「開啟零件」 is always on the drawing\'s tree, naming the part, and in the 檔案 menu', async () => {
    document.querySelector('[data-drawing-panel] [data-tab="tree"]').click();
    await H.wait(150);
    const bar = panel('[data-action="openDrawingPart"]');
    H.tab('檔案');
    await H.wait(80);
    const inMenu = [...document.querySelectorAll('.tools button')].find((b) => b.textContent === '開啟零件');
    H.tab('檔案');
    await H.wait(80);
    return { pass: !!bar && /定位板\.3dbx/.test(bar.textContent) && !!inMenu && !inMenu.disabled, bar: bar?.textContent, menu: !!inMenu };
  });
  await step('1b the bar opens the part, with 「返回工程圖」 above its tree; that comes back to the drawing and its three views', async () => {
    panel('[data-action="openDrawingPart"]').click();
    await H.waitFor(() => store.getState().active === 'part' && store.getState().result?.mesh, 20000, 'the part to open');
    const r = store.getState().returnTo;
    const back = await H.waitFor(() => document.querySelector('[data-action="returnBack"]'), 5000, 'the return bar');
    back.click();
    await H.waitFor(() => store.getState().active === 'drawing' && drw()?.fileName === '定位板.3dbd' && drw().doc.views.length === 3 && allLines(), 30000, 'the drawing again');
    return { pass: r?.kind === 'drawing' && store.getState().active === 'drawing', returnTo: r };
  });
  await step('1c the 檔案 menu\'s 「開啟零件」 does the same', async () => {
    await H.action('檔案', '開啟零件');
    await H.waitFor(() => store.getState().active === 'part' && store.getState().result?.mesh, 20000, 'the part to open');
    const r = store.getState().returnTo;
    document.querySelector('[data-action="returnBack"]').click();
    await H.waitFor(() => store.getState().active === 'drawing' && drw()?.doc.views.length === 3 && allLines(), 30000, 'the drawing again');
    return { pass: r?.kind === 'drawing' && store.getState().active === 'drawing', returnTo: r };
  });

  let iso;
  await step('2a the front view in 「帶邊線塗彩」 from its properties: its faces are shaded under its lines, an image on the page', async () => {
    const front = viewOf('front');
    d().select(front.id);
    await H.wait(200);
    const visibleBefore = d().scene().scene.items.filter((i) => i.kind === 'polyline' && i.style === 'visible').length;
    await setSelect(panel('[data-field="display"]'), 'shadedEdges');
    await H.waitFor(() => drw().lines.get(front.id)?.shade, 30000, 'the shading of the front view');
    await H.wait(200);
    const images = d().scene().scene.images ?? [];
    const onPage = document.querySelectorAll('[data-svg] svg image').length;
    const visibleAfter = d().scene().scene.items.filter((i) => i.kind === 'polyline' && i.style === 'visible').length;
    const img = images.find((x) => x.view === front.id);
    const p = placedOf(front.id);
    // the image covers the view's box (and a pixel of margin): its middle is the view's
    const mid = img && [img.at[0] + img.w / 2, img.at[1] + img.h / 2];
    return { pass: !!img && onPage >= 1 && visibleAfter === visibleBefore && Math.abs(mid[0] - p.at[0]) < 0.5 && Math.abs(mid[1] - p.at[1]) < 0.5, images: images.length, onPage, visibleBefore, visibleAfter, mid, at: p.at };
  });
  await step('2b its menu ticks the style; 「塗彩」 from the menu leaves its edges out', async () => {
    const front = viewOf('front');
    const lines = drw().lines.get(front.id);
    const menu = await rightClick(placedOf(front.id).at);
    const ticked = menu?.querySelector('[data-action="menuDisplay-shadedEdges"]')?.textContent.startsWith('✓');
    const before = d().scene().scene.items.filter((i) => i.kind === 'polyline' && i.style === 'visible').length;
    menu.querySelector('[data-action="menuDisplay-shaded"]').click();
    await H.wait(250);
    const after = d().scene().scene.items.filter((i) => i.kind === 'polyline' && i.style === 'visible').length;
    const still = (d().scene().scene.images ?? []).some((x) => x.view === front.id);
    return { pass: ticked && viewOf('front').display === 'shaded' && before - after === lines.visible.length && still, ticked, before, after, own: lines.visible.length };
  });

  await step('6a the projection tool off the upper right of the front view (third angle): the isometric from front, right and top — the part\'s own isometric', async () => {
    const front = viewOf('front');
    const p = placedOf(front.id);
    const at = [Math.min(395, p.at[0] + p.w / 2 + 45), Math.min(270, p.at[1] + p.h / 2 + 40)];
    d().setTool({ kind: 'project', parent: front.id });
    await H.wait(100);
    send('pointermove', toClient(at));
    await H.wait(150);
    send('pointerdown', toClient(at));
    send('pointerup', toClient(at));
    await H.wait(300);
    iso = drw().doc.views.find((v) => v.kind === 'projected' && v.side === 'upRight');
    const axes = iso && axesOf(drw().doc.views, 'third', iso);
    const want = viewVectors('isometric').dir.map((x) => x / Math.sqrt(3));
    return { pass: !!iso && close(axes.dir, want, 1e-12) && Math.abs(iso.at[0] - at[0]) <= 0.01 && Math.abs(iso.at[1] - at[1]) <= 0.01 && iso.display === 'shadedEdges', iso, axes };
  });
  await step('6b off the lower left: the isometric from front, left and bottom — another direction, as the corner asks; shaded with its edges', async () => {
    const front = viewOf('front');
    const p = placedOf(front.id);
    const at = [Math.max(25, p.at[0] - p.w / 2 - 45), Math.max(70, p.at[1] - p.h / 2 - 40)];
    send('pointermove', toClient(at));
    await H.wait(150);
    send('pointerdown', toClient(at));
    send('pointerup', toClient(at));
    await H.wait(300);
    d().setTool(null);
    const low = drw().doc.views.find((v) => v.kind === 'projected' && v.side === 'downLeft');
    const axes = low && axesOf(drw().doc.views, 'third', low);
    const want = cornerAxes(viewVectors('front'), 'downLeft', 'third');
    await H.waitFor(() => drw().lines.get(low.id)?.shade, 30000, 'the shading of the corner view');
    const dot = axes.dir.reduce((s, v, i) => s + v * axesOf(drw().doc.views, 'third', iso).dir[i], 0);
    return { pass: !!low && close(axes.dir, want.dir, 1e-12) && Math.abs(dot - -1 / 3) < 1e-9, low, dot };
  });

  let sec;
  await step('3a a section through the front view sits in line with it: dragged, it only slides along that line', async () => {
    const front = viewOf('front');
    const box = drw().lines.get(front.id).box;
    const x = (box.min[0] + box.max[0]) / 2;
    d().execute({ type: 'insertViews', views: [{ id: 'view90', name: 'B-B', kind: 'section', parent: front.id, line: [[x, box.min[1] - 5], [x, box.max[1] + 5]], label: 'B' }] });
    await H.waitFor(() => drw().lines.get('view90'), 30000, 'the section');
    await H.wait(200);
    sec = () => drw().doc.views.find((v) => v.id === 'view90');
    const at0 = placedOf('view90').at;
    await drag(at0, [20, -35]);
    const at1 = placedOf('view90').at;
    const axis = slideAxis(drw().doc, sec());
    // in line: only the slide's way moved
    const moved = axis === 0 ? [at1[0] - at0[0], at1[1] - at0[1]] : [at1[1] - at0[1], at1[0] - at0[0]];
    return { pass: axis !== null && Math.abs(moved[1]) <= 0.01 && !sec().at, axis, at0, at1 };
  });
  await step('3b 「解除對齊」 from its menu: dragged anywhere, off its line both ways, it is where it is let go', async () => {
    const menu = await rightClick(placedOf('view90').at);
    const item = menu?.querySelector('[data-action="menuBreakAlignment"]');
    item.click();
    await H.wait(250);
    const at0 = placedOf('view90').at;
    await drag(at0, [-23.5, 31.25]);
    const at1 = placedOf('view90').at;
    return { pass: !!sec().at && Math.abs(at1[0] - (at0[0] - 23.5)) <= 0.01 && Math.abs(at1[1] - (at0[1] + 31.25)) <= 0.01 && slideAxis(drw().doc, sec()) === null, at0, at1 };
  });
  await step('3c 「預設對齊」 puts it back in line with the front view', async () => {
    const menu = await rightClick(placedOf('view90').at);
    menu.querySelector('[data-action="menuDefaultAlignment"]').click();
    await H.wait(250);
    const f = placedOf(viewOf('front').id).at;
    const s = placedOf('view90').at;
    return { pass: !sec().at && (Math.abs(s[0] - f[0]) < 1e-6 || Math.abs(s[1] - f[1]) < 1e-6), f, s };
  });

  let dims;
  await step('4/5a the drawing\'s dimension style from the sheet\'s properties: text 5 mm, open arrows, lines 0.35 mm — every dimension drawn so', async () => {
    d().autoDimension(viewOf('top').id, { overall: true, holes: false, callouts: false, positions: false, ordinate: false });
    await H.waitFor(() => drw().doc.dimensions.length > 0 && drw().doc.dimensions.every((x) => d().scene().dimensions.get(x.id) && !('error' in d().scene().dimensions.get(x.id))), 30000, 'the dimensions');
    d().clearSelection();
    document.querySelector('[data-drawing-panel] [data-tab="props"]').click();
    await H.wait(200);
    const group = panel('[data-group="dimStyle-sheet"]');
    await setNumber(group.querySelector('[data-field="dimStyleText"]'), 5);
    await setSelect(group.querySelector('[data-field="dimStyleArrowStyle"]'), 'open');
    await setNumber(group.querySelector('[data-field="dimStyleLine"]'), 0.35);
    dims = drw().doc.dimensions.map((x) => x.id);
    const drawn = dims.map(drawnOf);
    const svgText = [...document.querySelectorAll('[data-svg] svg text[stroke="#ffffff"]')].map((t) => Number(t.getAttribute('font-size')));
    return { pass: JSON.stringify(drw().doc.sheet.dimStyle) === JSON.stringify({ text: 5, arrowStyle: 'open', line: 0.35 }) && drawn.every((x) => x.heights.every((h) => h === 5) && x.widths.length === 1 && x.widths[0] === 0.35 && !x.filled) && svgText.length > 0 && svgText.every((s) => Math.abs(s - 7) < 1e-9), style: drw().doc.sheet.dimStyle, drawn, svgText };
  });
  await step('4/5b a size out of its limits is refused and said; the style stays as it was', async () => {
    const group = panel('[data-group="dimStyle-sheet"]');
    await setNumber(group.querySelector('[data-field="dimStyleText"]'), 0);
    const notice = store.getState().notice;
    return { pass: drw().doc.sheet.dimStyle.text === 5 && notice?.kind === 'error' && /文字高度/.test(notice.text), notice };
  });
  await step('4/5c one dimension with its own style: text 7 mm, filled arrows — the others keep the drawing\'s', async () => {
    const id = dims[0];
    d().pick([{ kind: 'dimension', id }], 'replace');
    d().selectDimension(id);
    await H.wait(250);
    panel('[data-field="dimStyleOwn"]').click();
    await H.wait(200);
    const group = panel('[data-group="dimStyle-dimension"]');
    await setNumber(group.querySelector('[data-field="dimStyleText"]'), 7);
    await setSelect(group.querySelector('[data-field="dimStyleArrowStyle"]'), 'filled');
    const own = drawnOf(id);
    const others = dims.slice(1).map(drawnOf);
    return { pass: own.heights.every((h) => h === 7) && own.filled && others.every((x) => x.heights.every((h) => h === 5) && !x.filled), own, others, style: drw().doc.dimensions[0].style };
  });

  const pass = steps.every((s) => s.pass);
  return { name: 'manual-drawing-sw-parity', steps, pass };
};
