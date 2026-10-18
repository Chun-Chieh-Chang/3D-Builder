// D-I5 (ADR 0143): stepped and aligned sections drawn on the sheet. The section tool's 「階梯剖面」: click the first cut's two ends, then a click for each jog and
// cut, the last point clicked again (or Enter) to finish; 「對正剖面」: one end, the bend, the other end. The line is carried across the view, the section is
// placed with a click, its cut is hatched; a stepped line is moved whole; the file keeps them. Replayed in the app's page (http://127.0.0.1:5391, 1280×720;
// `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-stepped-section.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingSteppedSection.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingSteppedSection = {});

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
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const placed = (id) => d().scene().placed.get(id);
const viewOf = (dir) => page()?.views.find((v) => v.direction === dir);
const canvas = () => document.querySelector('[data-drawing-canvas]');
const toClient = ([x, y]) => {
  const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
  return [r.left + (x / 420) * r.width, r.top + ((297 - y) / 297) * r.height];
};
const send = (type, at, init = {}) => {
  const [cx, cy] = toClient(at);
  canvas().dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 51, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...init }));
};
const hoverAt = async (at, init = {}) => {
  const [cx, cy] = toClient(at);
  canvas().dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true, pointerId: 51, button: 0, buttons: 0, ...init }));
  await H.wait(60);
};
const click = async (at, init = {}) => {
  await hoverAt(at, init);
  send('pointerdown', at, init);
  await H.wait(60);
  send('pointerup', at, init);
  await H.wait(200);
};
const drag = async (from, to) => {
  await hoverAt(from);
  send('pointerdown', from);
  for (let i = 1; i <= 6; i++) {
    send('pointermove', [from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6]);
    await H.wait(30);
  }
  send('pointerup', to);
  await H.wait(300);
};
const key = async (k) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  await H.wait(200);
};
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const mode = async (action) => {
  if (drw().tool?.kind !== 'section') panel('[data-action="toolSection"]').click();
  await H.wait(150);
  document.querySelector(`[data-section-type] [data-action="${action}"]`).click();
  await H.wait(150);
};
const toSheetOf = (id, [x, y]) => {
  const p = placed(id);
  return [p.at[0] + (x - p.centre[0]) * p.scale, p.at[1] + (y - p.centre[1]) * p.scale];
};
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));

M.run = async () => {
  let top;
  let stepped;
  await step('1 a new drawing of the plate; the section tool offers a stepped and an aligned section, each saying how it is drawn', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.newDrawing();
    await H.waitFor(() => drw() && page()?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
    await H.wait(300);
    top = viewOf('top').id;
    await mode('sectionStepped');
    const steppedOn = drw().tool?.path === 'stepped' && (document.querySelector('[data-hint]')?.textContent ?? '').includes('階梯剖面');
    await mode('sectionAligned');
    const alignedOn = drw().tool?.path === 'aligned' && (document.querySelector('[data-hint]')?.textContent ?? '').includes('對正剖面');
    return { pass: steppedOn && alignedOn, steppedOn, alignedOn };
  });

  await step('2 stepped: two clicks for the first cut (snapped level), one for a jog and the next cut, the last point again to finish; placed below, its cut hatched', async () => {
    await mode('sectionStepped');
    const p = placed(top);
    const a = [p.at[0] - p.w * 0.35, p.at[1] - p.h * 0.15];
    const b = [p.at[0] - p.w * 0.05, p.at[1] - p.h * 0.15 + 0.3]; // 1–2° off level: snapped
    const c = [p.at[0] + p.w * 0.3, p.at[1] + p.h * 0.2];
    const before = page()?.views.length;
    await click(a);
    await click(b);
    await hoverAt(c);
    const previewed = document.querySelector('[data-path-preview="stepped"] polyline')?.getAttribute('points')?.split(' ').length === 4;
    await click(c);
    await click(c); // the last point again: finished
    const waits = page()?.views.length === before && drw().tool?.kind === 'section';
    const placeAt = [p.at[0] + 10, p.at[1] - p.h / 2 - 60];
    await hoverAt(placeAt);
    await click(placeAt);
    await H.waitFor(() => page()?.views.length === before + 1 && drw().lines.get(page()?.views.at(-1).id), 30000, 'the stepped section');
    await H.wait(200);
    const v = page()?.views.at(-1);
    stepped = v.id;
    const L = v.line;
    const box = drw().lines.get(top).box;
    const shape = L.length === 4 && L[0][1] === L[1][1] && L[1][0] === L[2][0] && L[2][1] === L[3][1] && L[1][1] !== L[2][1];
    const across = near(L[0][0], box.min[0] - 5) && near(L[3][0], box.max[0] + 5);
    const cut = (drw().lines.get(v.id)?.cut ?? []).length;
    return { pass: previewed && waits && v.kind === 'section' && !v.aligned && shape && across && cut > 0 && !drw().problems.has(v.id), previewed, waits, line: L, box, cut, problem: drw().problems.get(v.id) };
  });

  await step('3 aligned: one end, the bend, the other end — the third click finishes; placed with Ctrl where the pointer is, its cut hatched', async () => {
    await mode('sectionAligned');
    const p = placed(top);
    const a = [p.at[0] - p.w * 0.35, p.at[1] + 1];
    const bend = [p.at[0], p.at[1] + 1];
    const c = [p.at[0] + p.w * 0.25, p.at[1] + 1 + p.h * 0.3];
    const before = page()?.views.length;
    await click(a);
    await click(bend);
    await hoverAt(c);
    const previewed = !!document.querySelector('[data-path-preview="aligned"]');
    await click(c);
    const waits = page()?.views.length === before && drw().tool?.kind === 'section';
    const placeAt = [p.at[0] + p.w / 2 + 80, p.at[1] + 10];
    await click(placeAt, { ctrlKey: true });
    await H.waitFor(() => page()?.views.length === before + 1 && drw().lines.get(page()?.views.at(-1).id), 30000, 'the aligned section');
    await H.wait(200);
    const v = page()?.views.at(-1);
    const cut = (drw().lines.get(v.id)?.cut ?? []).length;
    return { pass: previewed && waits && v.kind === 'section' && v.aligned === true && v.line.length === 3 && near(v.at[0], placeAt[0], 0.2) && cut > 0 && !drw().problems.has(v.id), previewed, waits, line: v.line, at: v.at, cut, problem: drw().problems.get(v.id) };
  });

  await step('4 Enter finishes a stepped line too, and Esc then lets go of it: no section is made', async () => {
    await mode('sectionStepped');
    const p = placed(top);
    const before = page()?.views.length;
    await click([p.at[0] - p.w * 0.3, p.at[1] - p.h * 0.3]);
    await click([p.at[0], p.at[1] - p.h * 0.3]);
    await key('Enter');
    const placing = (document.querySelector('[data-hint]')?.textContent ?? '').includes('放置');
    await key('Escape');
    await key('Escape');
    return { pass: placing && page()?.views.length === before, placing };
  });

  await step('5 a stepped line taken hold of by its first cut is moved whole: every point the same way, the steps as they were', async () => {
    const was = page()?.views.find((v) => v.id === stepped).line;
    const s = placed(top).scale;
    const mid = toSheetOf(top, [(was[0][0] + was[1][0]) / 2, was[0][1]]);
    await drag(mid, [mid[0], mid[1] + 6]);
    const now = page()?.views.find((v) => v.id === stepped).line;
    const by = now[0][1] - was[0][1];
    const whole = now.length === 4 && now.every((q, i) => near(q[0], was[i][0], 1e-9) && near(q[1] - was[i][1], by, 0.011));
    return { pass: whole && near(by, 6 / s, 0.06), was, now, by, want: 6 / s };
  });

  await step('6 the file keeps them: saved and opened again, the stepped and aligned lines are as they were', async () => {
    const sections = stable(page()?.views.filter((v) => v.kind === 'section'));
    H.next.save = '定位板-階梯.3dbd';
    await H.action('檔案', '儲存檔案');
    await H.waitFor(() => !drw().dirty, 10000, 'the save');
    await H.open('定位板-階梯.3dbd');
    await H.waitFor(() => drw() && drw().fileName === '定位板-階梯.3dbd' && [...drw().lines.values()].filter(Boolean).length >= 5, 30000, 'the drawing to open');
    await H.wait(300);
    const same = stable(page()?.views.filter((v) => v.kind === 'section')) === sections;
    return { pass: same && drw().doc.schemaVersion >= 18, same, schema: drw().doc.schemaVersion };
  });
  return { name: 'drawing-stepped-section', steps, pass: steps.every((s) => s.pass) };
};
