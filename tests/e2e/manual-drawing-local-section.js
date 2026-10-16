// B1 (2026-10-16): local (partial) section view. The 「局部剖視」 tool: set the depth, drag a rectangle on the view, release,
// then click to place it; only what lies inside the outline is cut to that depth (hatched), the rest of the view stays as it was;
// the parent keeps the outline with its letter and the A–A title. A depth beyond the part is refused with a said reason, not
// clamped. Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-local-section.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingLocalSection.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingLocalSection = {});

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
const localOn = async () => {
  if (drw().tool?.kind !== 'sectionLocal') {
    panel('[data-action="toolLocalSection"]').click();
    await H.wait(150);
  }
};
const setDepth = async (v) => {
  const el = panel('[data-field="localSectionDepth"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(80);
};
const toSheetOf = (id, [x, y]) => {
  const p = placed(id);
  return [p.at[0] + (x - p.centre[0]) * p.scale, p.at[1] + (y - p.centre[1]) * p.scale];
};
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));

M.run = async () => {
  let top;
  let local;
  await step('1 a new drawing of the plate; the local section tool and its depth field are offered, and the hint says what it does', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.newDrawing();
    await H.waitFor(() => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
    await H.wait(300);
    top = viewOf('top').id;
    const offered = !!panel('[data-action="toolLocalSection"]') && !!panel('[data-field="localSectionDepth"]') && panel('[data-field="localSectionDepth"]').value === '5';
    await localOn();
    const on = drw().tool?.kind === 'sectionLocal' && drw().tool.depth === 5;
    const said = (document.querySelector('[data-hint]')?.textContent ?? '').includes('局部剖視');
    return { pass: offered && on && said, offered, on, said };
  });

  await step('2 a rectangle dragged on the top view is placed below it: only inside the outline is cut to the depth and hatched', async () => {
    await localOn();
    const p = placed(top);
    const a = [p.at[0] - p.w * 0.3, p.at[1] - p.h * 0.25];
    const b = [p.at[0] + p.w * 0.05, p.at[1] + p.h * 0.05];
    const before = drw().doc.views.length;
    await drag(a, b);
    const waiting = (document.querySelector('[data-hint]')?.textContent ?? '').includes('放置');
    const placeAt = [p.at[0] + 10, p.at[1] - p.h / 2 - 60];
    await click(placeAt);
    await H.waitFor(() => drw().doc.views.length === before + 1 && drw().lines.get(drw().doc.views.at(-1).id), 30000, 'the local section');
    await H.wait(200);
    const v = drw().doc.views.at(-1);
    local = v.id;
    const box = drw().lines.get(top).box;
    const inBox = v.outline.p0[0] >= box.min[0] && v.outline.p1[0] <= box.max[0] && v.outline.p0[1] >= box.min[1] && v.outline.p1[1] <= box.max[1];
    const cut = (drw().lines.get(v.id)?.cut ?? []).length;
    return { pass: waiting && v.kind === 'sectionLocal' && v.outline.kind === 'rectangle' && v.depth === 5 && v.label === 'A' && inBox && cut > 0 && !drw().problems.has(v.id), waiting, kind: v.kind, depth: v.depth, label: v.label, inBox, cut, problem: drw().problems.get(v.id) };
  });

  await step('3 the parent carries the closed outline, its letter A beside it, and the A–A title under the local section', async () => {
    const v = drw().doc.views.find((x) => x.id === local);
    const p = placed(top);
    const want = [v.outline.p0, [v.outline.p1[0], v.outline.p0[1]], v.outline.p1, [v.outline.p0[0], v.outline.p1[1]]].map(([x, y]) => toSheetOf(top, [x, y]));
    const items = d().scene().scene.items;
    const closed = items.filter((i) => i.kind === 'polyline' && i.closed && i.points.length === 8);
    const hit = closed.some((i) => {
      const pts = [];
      for (let k = 0; k < i.points.length; k += 2) pts.push([i.points[k], i.points[k + 1]]);
      return want.every((q) => pts.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) <= 0.5));
    });
    const letter = items.some((i) => i.kind === 'text' && i.text === 'A');
    const title = items.some((i) => i.kind === 'text' && i.text === 'A-A');
    const own = placed(local);
    return { pass: hit && letter && title && !!own, hit, letter, title, placed: !!own, near: Math.hypot(own?.at[0] - p.at[0] - 10, own?.at[1] - p.at[1] + p.h / 2 + 60) <= 0.5 };
  });

  await step('4 a depth beyond the part is refused with a said reason: the view is made but its problem says the depth must reach the part', async () => {
    await localOn();
    await setDepth(999);
    const p = placed(top);
    const a = [p.at[0] - p.w * 0.2, p.at[1] - p.h * 0.15];
    const b = [p.at[0] + p.w * 0.15, p.at[1] + p.h * 0.1];
    const before = drw().doc.views.length;
    await drag(a, b);
    const placeAt = [p.at[0] - 60, p.at[1] - p.h / 2 - 60];
    await click(placeAt);
    await H.waitFor(() => drw().doc.views.length === before + 1, 10000, 'the refused view');
    await H.waitFor(() => drw().problems.has(drw().doc.views.at(-1).id), 10000, 'the refusal');
    const v = drw().doc.views.at(-1);
    const problem = drw().problems.get(v.id) ?? '';
    const kept = v.depth === 999; // not silently clamped
    return { pass: /深度/.test(problem) && kept, problem, kept };
  });

  await step('5 Esc lets go: a rectangle dragged and let go, then Esc before placing, makes no view', async () => {
    const before = drw().doc.views.length;
    await localOn();
    await setDepth(5);
    const p = placed(top);
    await drag([p.at[0] - p.w * 0.15, p.at[1] - p.h * 0.1], [p.at[0] + p.w * 0.1, p.at[1] + p.h * 0.05]);
    const waiting = (document.querySelector('[data-hint]')?.textContent ?? '').includes('放置');
    await key('Escape');
    const none = drw().doc.views.length === before && (document.querySelector('[data-hint]')?.textContent ?? '').includes('局部剖視');
    return { pass: waiting && none, waiting, none };
  });

  await step('6 the file keeps it: saved and opened again, the local section is as it was', async () => {
    const was = stable(drw().doc.views.find((x) => x.id === local));
    H.next.save = '定位板-局部剖視.3dbd';
    await H.action('檔案', '儲存檔案');
    await H.waitFor(() => !drw().dirty, 10000, 'the save');
    await H.open('定位板-局部剖視.3dbd');
    await H.waitFor(() => drw() && drw().fileName === '定位板-局部剖視.3dbd' && [...drw().lines.values()].filter(Boolean).length >= 4, 30000, 'the drawing to open');
    await H.wait(300);
    const now = stable(drw().doc.views.find((x) => x.id === local));
    const same = now === was;
    return { pass: same && drw().doc.schemaVersion >= 21, same, schema: drw().doc.schemaVersion };
  });
  return { name: 'drawing-local-section', steps, pass: steps.every((s) => s.pass) };
};
