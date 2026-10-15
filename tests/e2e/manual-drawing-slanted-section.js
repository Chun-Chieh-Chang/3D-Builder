// D-I5 slice 1: a section line at any angle, drawn on the sheet as SolidWorks's auxiliary cutting line is. The section tool's third choice, 「斜向剖面線」: a drag
// on a view sets the line's direction (or two clicks: a point on it, then its direction), the line runs across the whole view, then a click places the section.
// A line moved off the part is said to cut nothing; the slanted lines are kept by the file. Replayed in the app's page (http://127.0.0.1:5391, 1280×720;
// `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-slanted-section.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingSlantedSection.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingSlantedSection = {});

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
  canvas().dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 41, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...init }));
};
const hoverAt = async (at, init = {}) => {
  const [cx, cy] = toClient(at);
  canvas().dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true, pointerId: 41, button: 0, buttons: 0, ...init }));
  await H.wait(60);
};
const click = async (at, init = {}) => {
  await hoverAt(at, init);
  send('pointerdown', at, init);
  await H.wait(60);
  send('pointerup', at, init);
  await H.wait(200);
};
/** A drag that is seen half way (the dashed slanted line drawn over the view) before it is let go. */
const drag = async (from, to) => {
  await hoverAt(from);
  send('pointerdown', from);
  let seen = false;
  for (let i = 1; i <= 6; i++) {
    send('pointermove', [from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6]);
    await H.wait(40);
    if (i === 3) seen = !!document.querySelector('[data-slant-preview]');
  }
  send('pointerup', to);
  await H.wait(250);
  return seen;
};
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const slantOn = async () => {
  if (drw().tool?.kind !== 'section') panel('[data-action="toolSection"]').click();
  await H.wait(150);
  document.querySelector('[data-section-type] [data-action="sectionSlant"]').click();
  await H.wait(150);
  return drw().tool?.kind === 'section' && drw().tool.slant === true;
};
const degrees = (a, b) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));

M.run = async () => {
  let top;
  let dragged; // the section made by a drag
  await step('1 a new drawing of the plate; the section tool offers a slanted line besides vertical and horizontal, and says how it is drawn', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.newDrawing();
    await H.waitFor(() => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3 && drw().features.size === 3, 30000, 'the three views and their elements');
    await H.wait(300);
    top = viewOf('top').id;
    const on = await slantOn();
    const hint = document.querySelector('[data-hint]')?.textContent ?? '';
    const active = document.querySelector('[data-section-type] [data-action="sectionSlant"]')?.classList.contains('active');
    return { pass: on && active && hint.includes('斜向剖面'), on, active, hint };
  });

  await step('2 a drag across the top view: the dashed line follows it, then the line runs across the whole view at the drag\'s angle and waits for the section to be placed', async () => {
    const p = placed(top);
    const from = [p.at[0] - p.w * 0.3, p.at[1] - p.h * 0.25];
    const to = [p.at[0] + p.w * 0.3, p.at[1] + p.h * 0.25];
    const before = drw().doc.views.length;
    const previewed = await drag(from, to);
    const waits = drw().doc.views.length === before && drw().tool?.kind === 'section';
    // below the top view: above it is the front view (first angle)
    const placeAt = [p.at[0] + 10, p.at[1] - p.h / 2 - 60];
    await hoverAt(placeAt);
    // no standard view looks the slanted way: its preview is asked of the worker, and drawn when it comes
    const ghost = await H.waitFor(() => document.querySelector('[data-ghost]'), 15000, 'the preview of the slanted section').then(() => true, () => false);
    await click(placeAt);
    await H.waitFor(() => drw().lines.get(drw().doc.views.at(-1).id), 30000, 'the section lines');
    await H.wait(200);
    const v = drw().doc.views.at(-1);
    dragged = v.id;
    const [a, b] = v.line;
    const slanted = Math.abs(b[0] - a[0]) > 1 && Math.abs(b[1] - a[1]) > 1;
    const angle = degrees(a, b);
    const want = degrees(from, to);
    const box = drw().lines.get(top).box;
    // across the whole view: each end is on the box grown by 5 mm
    const onEdge = (q) => near(q[0], box.min[0] - 5, 0.02) || near(q[0], box.max[0] + 5, 0.02) || near(q[1], box.min[1] - 5, 0.02) || near(q[1], box.max[1] + 5, 0.02);
    const lines = drw().lines.get(v.id);
    const cut = (lines?.cut ?? []).length;
    return {
      pass: previewed && waits && ghost && v.kind === 'section' && v.parent === top && slanted && near(angle, want, 0.1) && onEdge(a) && onEdge(b) && cut > 0 && !drw().problems.has(v.id) && drw().tool === null,
      previewed,
      waits,
      ghost,
      line: v.line,
      angle,
      want,
      cut,
      problem: drw().problems.get(v.id),
    };
  });

  await step('3 two clicks (a point, then the direction) make a slanted line too; placed with Ctrl it goes where the pointer is', async () => {
    const on = await slantOn();
    const p = placed(top);
    const first = [p.at[0] - 8, p.at[1] - 4];
    const second = [p.at[0] + 8, p.at[1] + 14];
    const before = drw().doc.views.length;
    await click(first);
    const waitsForDirection = drw().doc.views.length === before && drw().tool?.kind === 'section';
    await hoverAt(second);
    const previewed = !!document.querySelector('[data-slant-preview]');
    await click(second);
    const placeAt = [p.at[0] + p.w / 2 + 70, p.at[1] - 20];
    await click(placeAt, { ctrlKey: true });
    await H.waitFor(() => drw().doc.views.length === before + 1 && drw().lines.get(drw().doc.views.at(-1).id), 30000, 'the second section');
    await H.wait(200);
    const v = drw().doc.views.at(-1);
    const [a, b] = v.line;
    const angle = degrees(a, b);
    const want = degrees(first, second);
    const cut = (drw().lines.get(v.id)?.cut ?? []).length;
    return { pass: on && waitsForDirection && previewed && v.kind === 'section' && near(angle, want, 0.1) && !!v.at && near(v.at[0], placeAt[0], 0.2) && near(v.at[1], placeAt[1], 0.2) && cut > 0, on, waitsForDirection, previewed, angle, want, at: v.at, cut };
  });

  await step('4 a slanted line moved off the part cuts nothing, and the view says so instead of failing or drawing an empty section', async () => {
    const was = drw().doc.views.find((v) => v.id === dragged).line;
    d().setView(dragged, { line: [[1000, 1000], [1010, 1012]] });
    await H.waitFor(() => drw().problems.get(dragged), 30000, 'the problem of the section');
    const problem = drw().problems.get(dragged);
    d().setView(dragged, { line: was });
    await H.waitFor(() => !drw().problems.has(dragged) && (drw().lines.get(dragged)?.cut ?? []).length > 0, 30000, 'the section back');
    return { pass: problem.includes('沒有切到零件') && !problem.includes('Bnd_Box'), problem };
  });

  await step('5 the file keeps the slanted sections: saved and opened again, their lines are as they were', async () => {
    const sections = stable(drw().doc.views.filter((v) => v.kind === 'section'));
    H.next.save = '定位板-斜剖.3dbd';
    await H.action('檔案', '儲存檔案');
    await H.waitFor(() => !drw().dirty, 10000, 'the save');
    await H.open('定位板-斜剖.3dbd');
    await H.waitFor(() => drw() && drw().fileName === '定位板-斜剖.3dbd' && [...drw().lines.values()].filter(Boolean).length >= 5, 30000, 'the drawing to open');
    await H.wait(300);
    const same = stable(drw().doc.views.filter((v) => v.kind === 'section')) === sections;
    return { pass: same && drw().doc.schemaVersion === 17, same, schema: drw().doc.schemaVersion };
  });
  return { name: 'drawing-slanted-section', steps, pass: steps.every((s) => s.pass) };
};
