// Dimensions and sections are made and moved on the sheet itself, as in SolidWorks, not from lists and numbers in a panel: the Smart Dimension tool (point at an element of a
// view, at a second one, then where the dimension goes; a circle alone is a diameter), a dimension is chosen by clicking it, its line is dragged (how far it is from the view),
// its text is dragged along the line, a double click goes to its text, the panel edits what is written (decimals, prefix, suffix, a text of its own), Delete takes it away;
// the section tool selects a vertical or horizontal cut position (or drags a custom cut), then places the view with a click; the detail tool draws a circle with two clicks (or a drag), then places the view with a click. Asked for by the user. Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-annotate.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingAnnotate.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingAnnotate = {});

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
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const placed = (id) => d().scene().placed.get(id);
const viewOf = (dir) => drw().doc.views.find((v) => v.direction === dir);
const canvas = () => document.querySelector('[data-drawing-canvas]');
const sheetOf = (id, x, y) => {
  const p = placed(id);
  return [p.at[0] + (x - p.centre[0]) * p.scale, p.at[1] + (y - p.centre[1]) * p.scale];
};
const toClient = ([x, y]) => {
  const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
  return [r.left + (x / 420) * r.width, r.top + ((297 - y) / 297) * r.height];
};
const send = (type, at, init = {}) => {
  const [cx, cy] = toClient(at);
  canvas().dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 31, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...init }));
};
/** A move of the pointer (nothing pressed), as the hand does it before the click. */
const hoverAt = async (at) => {
  const [cx, cy] = toClient(at);
  canvas().dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true, pointerId: 31, button: 0, buttons: 0 }));
  await H.wait(60);
};
const click = async (at) => {
  await hoverAt(at);
  send('pointerdown', at);
  await H.wait(60); // a hand takes longer than a frame to let go
  send('pointerup', at);
  await H.wait(200);
};
const drag = async (from, to) => {
  await hoverAt(from);
  send('pointerdown', from);
  for (let i = 1; i <= 6; i++) {
    send('pointermove', [from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6]);
    await H.wait(25);
  }
  send('pointerup', to);
  await H.wait(250);
};
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
/** Sets a select the way a person does (the value, then the change React listens to). Missing since 1ce9501 (10-12), which used it in steps 10 and 11. */
const choose = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
};
const dimOf = (id) => drw().doc.dimensions.find((x) => x.id === id);
const textOf = (id) => d().scene().dimensions.get(id)?.text;
const itemsOf = (id) => d().scene().scene.items.filter((i) => i.group === id);
const setField = async (field, value) => {
  const el = panel(`[data-field="${field}"]`);
  if (el.tagName === 'SELECT') Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  else Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  if (el.tagName !== 'SELECT') {
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  await H.wait(300);
};
/** JSON with the keys in order: what is saved is not written in the order it was made in. */
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
const key = async (k) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  await H.wait(200);
};

M.run = async () => {
  let front;
  let top;
  let made; // the dimension made first
  await step('1 a new drawing of the plate with the lines and the elements of its views known; the Smart Dimension tool starts from the panel and says what to do', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.action('檔案', '新工程圖');
    await H.waitFor(() => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3 && drw().features.size === 3, 30000, 'the three views and their elements');
    await H.wait(300);
    front = viewOf('front').id;
    top = viewOf('top').id;
    panel('[data-action="toolDimension"]').click();
    await H.wait(150);
    return { pass: drw().tool?.kind === 'dimension' && drw().tool.picks.length === 0 && !!document.querySelector('[data-hint]') && document.querySelector('[data-hint]').textContent.includes('智慧型尺寸') };
  });
  await step('2 pointing at the left side of the front view and at its right side (the picked ones are drawn blue), then above it: a horizontal dimension of 120, its line where the pointer is, in one step', async () => {
    const p = placed(front);
    const mid = p.at[1];
    await click([p.at[0] - p.w / 2, mid]);
    const one = drw().tool.picks.length === 1;
    await click([p.at[0] + p.w / 2, mid]);
    const two = drw().tool.picks.length === 2;
    await hoverAt([p.at[0], p.at[1] + p.h / 2 + 18]);
    const previewed = !!document.querySelector('[data-overlay] polyline') && document.querySelector('[data-hint]').textContent.includes('移動滑鼠'); // drawn blue on the overlay while the pointer chooses the place
    const before = drw().doc.dimensions.length;
    await click([p.at[0], p.at[1] + p.h / 2 + 18]);
    const dim = drw().doc.dimensions.at(-1);
    made = dim?.id;
    return {
      pass: one && two && previewed && drw().doc.dimensions.length === before + 1 && dim.kind === 'linear' && dim.orientation === 'horizontal' && near(dim.offset, 18, 0.1) && drw().tool.picks.length === 0 && drw().dimension === made,
      dim,
      text: textOf(made),
    };
  });
  await step('3 the text says 120 and the dimension is chosen (drawn blue); one undo takes it away whole', async () => {
    const said = textOf(made);
    const hl = !!document.querySelector('[data-overlay] polyline');
    store.undo();
    await H.wait(200);
    const gone = !dimOf(made);
    store.redo();
    await H.wait(250);
    return { pass: said === '120' && hl && gone && !!dimOf(made), said };
  });
  await step('4 a circle alone: pointing at a hole of the top view and then at empty paper beside it makes its diameter, the leader the way the pointer is', async () => {
    const c = drw().features.get(top).find((f) => f.type === 'circle' && f.full);
    const at = sheetOf(top, c.centre[0] + c.radius, c.centre[1]);
    await click(at);
    const picked = drw().tool.picks.length === 1;
    const out = sheetOf(top, c.centre[0] + c.radius + 15, c.centre[1] + 8);
    const before = drw().doc.dimensions.length;
    await click(out);
    const dim = drw().doc.dimensions.at(-1);
    return { pass: picked && drw().doc.dimensions.length === before + 1 && dim.kind === 'diameter' && near(dim.angle, (Math.atan2(8, 15 + c.radius) * 180) / Math.PI, 3) && (textOf(dim.id) ?? '').startsWith('Ø'), dim, text: textOf(dim.id) };
  });
  await step('5 a plane and a circle: along the plane\'s axis; and Esc lets go of the tool', async () => {
    const f = drw().features.get(top);
    const c = f.find((x) => x.type === 'circle' && x.full);
    const left = f.filter((x) => x.type === 'plane' && x.axis === 'x').sort((a, b) => a.coord - b.coord)[0];
    const p = placed(top);
    await click(sheetOf(top, left.coord, c.centre[1] + 3)); // the left side of the top view
    await click(sheetOf(top, c.centre[0] + c.radius, c.centre[1]));
    const two = drw().tool.picks.length === 2;
    const before = drw().doc.dimensions.length;
    await click([p.at[0], p.at[1] + p.h / 2 + 15]);
    const dim = drw().doc.dimensions.at(-1);
    await key('Escape'); // the picks are over
    await key('Escape'); // the tool
    return { pass: two && drw().doc.dimensions.length === before + 1 && dim.kind === 'linear' && dim.orientation === 'horizontal' && drw().tool === null, dim };
  });
  await step('6 clicking the line of a dimension chooses it; dragging it 12 mm further from the view moves it by 12 (offset), as one step', async () => {
    d().selectDimension(null);
    const items = itemsOf(made).filter((i) => i.kind === 'polyline' && i.points.length === 4 && Math.abs(i.points[1] - i.points[3]) < 1e-6 && Math.abs(i.points[0] - i.points[2]) > 30);
    const line = items[0];
    const y = line.points[1];
    const x = (line.points[0] + line.points[2]) / 2 - 25; // away from the text
    const offset0 = dimOf(made).offset;
    await click([x, y]);
    const chosen = drw().dimension === made;
    await drag([x, y], [x, y + 12]);
    return { pass: chosen && near(dimOf(made).offset, offset0 + 12, 0.06) && dimOf(made).slide === undefined, offset0, now: dimOf(made).offset };
  });
  await step('7 dragging its text 15 mm along the line slides the text (slide) and leaves the line where it is', async () => {
    const offset = dimOf(made).offset;
    const text = itemsOf(made).find((i) => i.kind === 'text');
    const at = [text.at[0], text.at[1] + 1.7];
    await drag(at, [at[0] + 15, at[1] + 6]); // sideways only counts: it slides along the line
    return { pass: near(dimOf(made).slide, 15, 0.1) && dimOf(made).offset === offset, slide: dimOf(made).slide };
  });
  await step('8 a double click on the dimension goes to its text in the panel; the panel writes decimals, a prefix, a suffix and a text of its own; clearing the text takes it back', async () => {
    const text = itemsOf(made).find((i) => i.kind === 'text');
    const at = [text.at[0], text.at[1] + 1.7];
    const [cx, cy] = toClient(at);
    canvas().dispatchEvent(new MouseEvent('dblclick', { clientX: cx, clientY: cy, bubbles: true }));
    await H.wait(200);
    const focused = document.activeElement?.getAttribute('data-field') === 'dimText';
    await setField('dimPrefix', '最大 ');
    await setField('dimSuffix', ' 兩處');
    const both = textOf(made) === '最大 120 兩處';
    await setField('dimText', '約 <DIM>');
    const own = textOf(made) === '約 120';
    await setField('dimText', '');
    await setField('dimPrefix', '');
    await setField('dimSuffix', '');
    await setField('dimPrecision', '1');
    const decimals = textOf(made) === '120';
    await setField('dimPrecision', '');
    return { pass: focused && both && own && decimals && textOf(made) === '120', focused, both, own, decimals };
  });
  await step('9 Delete takes the chosen dimension away; undo brings it back', async () => {
    const before = drw().doc.dimensions.length;
    await key('Delete');
    const after = drw().doc.dimensions.length;
    store.undo();
    await H.wait(250);
    return { pass: after === before - 1 && drw().doc.dimensions.length === before, before, after };
  });
  let section;
  // Since ADR 0131 (D-V) a section is placed as SolidWorks places it: in line with its parent on the side the pointer is, slid along that line to the
  // pointer (no position of its own); only with Ctrl does it go anywhere. The points are clear of the views the first angle puts round the front view.
  await step('10 the section tool: two clicks draw a vertical cut, then a click places the section view in line with its parent, at the pointer along the line', async () => {
    panel('[data-action="toolSection"]').click();
    await H.wait(150);
    await choose(panel('[data-field="sectionAxis"]'), 'v');
    const p = placed(front);
    const on = [p.at[0] + 15, p.at[1]];
    const before = drw().doc.views.length;
    await click(on);
    const geometryWaitsForPlacement = drw().doc.views.length === before && drw().tool?.kind === 'section' && document.querySelector('[data-hint]')?.textContent.includes('放置');
    const placeAt = [p.at[0] + p.w / 2 + 60, on[1] + 20];
    await hoverAt(placeAt);
    const previewedPlacement = !!document.querySelector('[data-overlay] path') && !!document.querySelector('[data-ghost]');
    await click(placeAt);
    await H.waitFor(() => drw().lines.get(drw().doc.views.at(-1).id), 20000, 'the section lines');
    await H.wait(200);
    const v = drw().doc.views.at(-1);
    section = v?.id;
    const x = (on[0] - p.at[0]) / p.scale + p.centre[0];
    // in line (no position of its own), its middle where the pointer was along the line
    const placedAtPointer = !v.at && near(placed(v.id).at[0], placeAt[0], 0.3);
    return { pass: geometryWaitsForPlacement && previewedPlacement && placedAtPointer && drw().doc.views.length === before + 1 && v.kind === 'section' && v.parent === front && near(v.line[0][0], x, 0.02) && v.line[0][0] === v.line[1][0] && drw().tool === null, geometryWaitsForPlacement, previewedPlacement, placedAtPointer, at: v.at, line: v.line, x };
  });
  await step('11 selecting horizontal and clicking sets a horizontal cut; a section line can still be dragged across its parent', async () => {
    panel('[data-action="toolSection"]').click();
    await H.wait(150);
    await choose(panel('[data-field="sectionAxis"]'), 'h');
    const selectedHorizontal = drw().tool?.kind === 'section' && drw().tool.vertical === false;
    const p = placed(top);
    const from = [p.at[0] - 20, p.at[1] + 5];
    const before = drw().doc.views.length;
    await click(from);
    const geometryWaitsForPlacement = drw().doc.views.length === before && drw().tool?.kind === 'section';
    // below the top view: above it is the front view (first angle)
    const placeAt = [p.at[0] + 10, p.at[1] - p.h / 2 - 60];
    await hoverAt(placeAt);
    const previewedPlacement = !!document.querySelector('[data-overlay] path');
    await click(placeAt);
    await H.waitFor(() => drw().lines.get(drw().doc.views.at(-1).id), 20000, 'the section lines');
    await H.wait(200);
    const v = drw().doc.views.at(-1);
    const horizontal = v.kind === 'section' && v.parent === top && v.line[0][1] === v.line[1][1];
    // the first section's line is on the front view: take hold of it and move it
    const sec = drw().doc.views.find((x) => x.id === section);
    const fp = placed(front);
    const lineAt = [fp.at[0] + (sec.line[0][0] - fp.centre[0]) * fp.scale, fp.at[1]];
    const x0 = sec.line[0][0];
    await drag(lineAt, [lineAt[0] + 8, lineAt[1]]);
    return { pass: selectedHorizontal && geometryWaitsForPlacement && previewedPlacement && !v.at && near(placed(v.id).at[1], placeAt[1], 0.3) && horizontal && near(drw().doc.views.find((x) => x.id === section).line[0][0], x0 + 8 / fp.scale, 0.06), selectedHorizontal, geometryWaitsForPlacement, previewedPlacement, horizontal, at: v.at, x0, now: drw().doc.views.find((x) => x.id === section).line[0][0] };
  });
  await step('12 the detail tool: click the circle centre and radius, then click to place the detail view', async () => {
    panel('[data-action="toolDetail"]').click();
    await H.wait(150);
    const c = drw().features.get(top).find((f) => f.type === 'circle' && f.full);
    const centre = sheetOf(top, c.centre[0], c.centre[1]);
    const before = drw().doc.views.length;
    await click(centre);
    await click([centre[0] + 10, centre[1]]);
    const geometryWaitsForPlacement = drw().doc.views.length === before && drw().tool?.kind === 'detail' && document.querySelector('[data-hint]')?.textContent.includes('放置');
    const placeAt = [centre[0] - 50, centre[1] + 20];
    await hoverAt(placeAt);
    const previewedPlacement = !!document.querySelector('[data-overlay] path');
    await click(placeAt);
    const v = drw().doc.views.at(-1);
    const placedAtPointer = near(v.at[0], placeAt[0], 0.2) && near(v.at[1], placeAt[1], 0.2);
    return { pass: geometryWaitsForPlacement && previewedPlacement && placedAtPointer && drw().doc.views.length === before + 1 && v.kind === 'detail' && near(v.radius, 10 / placed(top).scale, 0.05) && near(v.centre[0], c.centre[0], 0.05) && drw().tool === null, geometryWaitsForPlacement, previewedPlacement, placedAtPointer, v };
  });
  await step('13 the file keeps all of it: saved and opened again, the dimensions with their offset and slide, the text, and the section are as they were', async () => {
    const dims = stable(drw().doc.dimensions);
    const views = stable(drw().doc.views.filter((v) => v.kind === 'section' || v.kind === 'detail'));
    H.next.save = '定位板.3dbd';
    await H.action('檔案', '儲存檔案');
    await H.waitFor(() => !drw().dirty, 10000, 'the save');
    await H.open('定位板.3dbd');
    await H.waitFor(() => drw() && drw().fileName === '定位板.3dbd' && [...drw().lines.values()].filter(Boolean).length >= 3, 30000, 'the drawing to open');
    await H.wait(300);
    const sameDims = stable(drw().doc.dimensions) === dims;
    const sameViews = stable(drw().doc.views.filter((v) => v.kind === 'section' || v.kind === 'detail')) === views;
    return { pass: sameDims && sameViews, sameDims, sameViews, was: sameDims ? undefined : dims.slice(0, 600), now: sameDims ? undefined : stable(drw().doc.dimensions).slice(0, 600) };
  });
  return { name: 'drawing-annotate', steps, pass: steps.every((s) => s.pass) };
};
