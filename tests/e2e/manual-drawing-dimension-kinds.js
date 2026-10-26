// ADR 0177: the kinds of dimension on a drawing, and the right-click menu that offers them. The CommandManager's 智慧型尺寸 has a drop-down (▾) of the kinds
// asked for by name (水平, 垂直, 對齊, 角度, 半徑, 直徑); a line pointed at alone is its length; the right button on a line, a vertex, a circle or an arc lists
// the kinds that start from it, and on a view or the sheet the 尺寸 and 註記 submenus — the same commands as the 註記 tab. Every number is checked against what the
// model says of the elements (the worker's features and edges of the view), never written in. Replayed in the app's page (http://127.0.0.1:5391, 1280×720;
// `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-dimension-kinds.js?' + Date.now());   // in a freshly loaded page
//   await __drawingDimensionKinds.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const K = (window.__drawingDimensionKinds = {});

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
const viewOf = (dir) => page()?.views.find((v) => v.direction === dir);
const canvas = () => document.querySelector('[data-drawing-canvas]');
const placedOf = (id) => d().scene().placed.get(id);
/** A point of a view (its own coordinates) on the sheet (mm). */
const sheetOf = (id, x, y) => {
  const p = placedOf(id);
  return [p.at[0] + (x - p.centre[0]) * p.scale, p.at[1] + (y - p.centre[1]) * p.scale];
};
const toClient = ([x, y]) => {
  const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
  return [r.left + (x / 420) * r.width, r.top + ((297 - y) / 297) * r.height];
};
const send = (type, at, button, buttons) => {
  const [cx, cy] = toClient(at);
  canvas().dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, pointerId: 21, button, buttons, isPrimary: true }));
};
const leftClick = async (at) => {
  send('pointermove', at, 0, 0);
  await H.wait(60);
  send('pointerdown', at, 0, 1);
  send('pointerup', at, 0, 0);
  await H.wait(180);
};
const rightClick = async (at) => {
  send('pointermove', at, 0, 0);
  await H.wait(60);
  send('pointerdown', at, 2, 2);
  send('pointerup', at, 2, 0);
  await H.wait(200);
};
const menu = () => document.querySelector('[data-drawing-menu]');
/** The menu's own items (not those of a submenu), by their data-action. */
const topItems = () => [...(menu()?.querySelectorAll(':scope > li[data-action], :scope > * > li[data-action]') ?? [])].filter((li) => !li.closest('.submenu')).map((li) => li.dataset.action);
const menuItem = (action) => menu()?.querySelector(`[data-action="${action}"]`);
const esc = async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await H.wait(100);
};
const tabButton = (label) => [...document.querySelectorAll('.command-bar .tabs > .menu > .tab')].find((b) => b.textContent === label);
const notices = [];
const listen = () => {
  const was = d().notifyInfo.bind(d());
  d().notifyInfo = (m) => {
    notices.push(m);
    return was(m);
  };
};
/** The newest dimension and what the sheet worked out for it. */
const newest = () => {
  const dims = page().dimensions;
  const x = dims[dims.length - 1];
  const o = x && d().scene().dimensions.get(x.id);
  return { dim: x, value: o && !('error' in o) ? o.value : undefined, error: o && 'error' in o ? o.error : undefined, n: dims.length };
};
const settle = () => H.waitFor(() => newest().value !== undefined || newest().error, 15000, 'the dimension worked out');
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

K.run = async () => {
  let top;
  let F;
  await step('1 a drawing of the locating plate: three views, with their features and edges from the worker', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.newDrawing();
    await H.waitFor(() => drw() && page()?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
    top = viewOf('top');
    await H.waitFor(() => drw().features.get(top.id) && drw().edges.get(top.id), 30000, 'the features and edges of the top view');
    F = drw().features.get(top.id);
    listen();
    return { pass: F.some((f) => f.type === 'plane' && f.axis === 'y') && F.some((f) => f.type === 'circle' && f.full) && F.some((f) => f.type === 'circle' && !f.full) };
  });
  // the model's own elements of the top view: its far side (the plane at the largest y), its left side, a hole and a rounded corner
  const far = () => F.filter((f) => f.type === 'plane' && f.axis === 'y').reduce((a, b) => (b.coord > a.coord ? b : a));
  const left = () => F.filter((f) => f.type === 'plane' && f.axis === 'x').reduce((a, b) => (b.coord < a.coord ? b : a));
  const hole = () => F.filter((f) => f.type === 'circle' && f.full).reduce((a, b) => (b.radius > a.radius ? b : a));
  const corner = () => F.find((f) => f.type === 'circle' && !f.full);
  const onCircle = (c, angle) => sheetOf(top.id, c.centre[0] + c.radius * Math.cos(angle), c.centre[1] + c.radius * Math.sin(angle));
  /** A point on an arc: halfway round the part of it that is drawn (the corner arcs face outward from the plate's middle). */
  const onArc = (c) => onCircle(c, Math.atan2(c.centre[1], c.centre[0]));
  const above = () => sheetOf(top.id, 0, far().coord + 25);

  await step('2 註記 → ▾ beside 智慧型尺寸 drops down the six kinds; 水平尺寸 turns the dimension tool on as horizontal, and the button shows it', async () => {
    tabButton('註記').click();
    await H.wait(150);
    const toggle = document.querySelector('[data-split-toggle="drw-dimension"]');
    toggle.click();
    await H.wait(150);
    const kinds = [...document.querySelectorAll('[data-split="drw-dimension"] .split-menu button')].map((b) => b.dataset.help);
    document.querySelector('[data-split="drw-dimension"] .split-menu [data-help="drw-dim-horizontal"]').click();
    await H.wait(150);
    const tool = drw().tool;
    tabButton('註記').click();
    await H.wait(150);
    document.querySelector('[data-split-toggle="drw-dimension"]').click();
    await H.wait(150);
    const shown = document.querySelector('[data-split="drw-dimension"] .split-menu [data-help="drw-dim-horizontal"]').classList.contains('active');
    tabButton('註記').click();
    await H.wait(100);
    d().setTool(null);
    await H.wait(100);
    const want = ['drw-dim-horizontal', 'drw-dim-vertical', 'drw-dim-aligned', 'drw-dim-angle', 'drw-dim-radius', 'drw-dim-diameter', 'drw-dim-chamfer'];
    return { pass: JSON.stringify(kinds) === JSON.stringify(want) && tool?.kind === 'dimension' && tool.mode === 'horizontal' && shown, kinds, tool, shown };
  });

  await step('3 智慧型尺寸: a line pointed at alone, then a click on the paper, is its length (the edge the model has there, end to end)', async () => {
    d().setTool({ kind: 'dimension', picks: [] });
    await H.wait(100);
    const n = page().dimensions.length;
    await leftClick(sheetOf(top.id, 0, far().coord));
    const acquired = drw().tool.picks[0]?.feature;
    const pick = acquired?.source ?? acquired;
    const along = pick?.type === 'edge' ? pick : pick?.along;
    await leftClick(above());
    await settle();
    const got = newest();
    const truth = along && Math.hypot(along.b[0] - along.a[0], along.b[1] - along.a[1]);
    return { pass: got.n === n + 1 && (pick?.type === 'plane' || (acquired?.snap === 'midpoint' && pick?.type === 'edge')) && !!along && got.dim.kind === 'linear' && got.dim.orientation === 'horizontal' && close(got.value, truth), got, truth };
  });

  await step('4 垂直尺寸 on a horizontal line is refused with the reason, and nothing is added', async () => {
    d().setTool({ kind: 'dimension', picks: [], mode: 'vertical' });
    await H.wait(100);
    const n = page().dimensions.length;
    notices.length = 0;
    await leftClick(sheetOf(top.id, 0, far().coord));
    await leftClick(sheetOf(top.id, placedOf(top.id).w, far().coord));
    return { pass: page().dimensions.length === n && notices.length === 1 && drw().tool?.mode === 'vertical', notices: [...notices] };
  });

  await step('5 半徑尺寸 on the largest hole: R, its radius; 直徑尺寸 on a rounded corner: Ø, twice its radius', async () => {
    d().setTool({ kind: 'dimension', picks: [], mode: 'radius' });
    await H.wait(100);
    const h = hole();
    await leftClick(onCircle(h, Math.PI / 4));
    await leftClick(sheetOf(top.id, h.centre[0] + h.radius + 15, h.centre[1] + h.radius + 15));
    await settle();
    const r = newest();
    d().setTool({ kind: 'dimension', picks: [], mode: 'diameter' });
    await H.wait(100);
    const c = corner();
    await leftClick(onArc(c));
    const [ux, uy] = [Math.sign(c.centre[0]) || 1, Math.sign(c.centre[1]) || 1];
    await leftClick(sheetOf(top.id, c.centre[0] + ux * (c.radius + 15), c.centre[1] + uy * (c.radius + 15)));
    await settle();
    const dd = newest();
    return { pass: r.dim.kind === 'radius' && close(r.value, h.radius) && dd.dim.kind === 'diameter' && close(dd.value, 2 * c.radius), radius: r, diameter: dd, h: h.radius, c: c.radius };
  });

  await step('6 角度尺寸 between the left side and the far side: the angle between the two planes, from their axes', async () => {
    d().setTool({ kind: 'dimension', picks: [], mode: 'angle' });
    await H.wait(100);
    await leftClick(sheetOf(top.id, left().coord, 0));
    await leftClick(sheetOf(top.id, 0, far().coord));
    await leftClick(sheetOf(top.id, left().coord - 12, far().coord + 12));
    await settle();
    const a = newest();
    // the planes are square to x and to y: the angle between them is the one between their normals
    const truth = (Math.acos(0) * 180) / Math.PI;
    d().setTool(null);
    return { pass: a.dim.kind === 'angle' && close(Math.min(a.value, 180 - a.value), truth, 1e-6), a, truth };
  });

  await step('7 right-click a line: the kinds that start from it (no radius, no diameter); 垂直尺寸 there, then a click, is the line’s length up the sheet', async () => {
    await rightClick(sheetOf(top.id, left().coord, 0));
    const items = topItems();
    const offered = items.filter((x) => x.startsWith('cmd-drw-dim') || x === 'cmd-drw-dimension');
    const want = ['cmd-drw-dimension', 'cmd-drw-dim-horizontal', 'cmd-drw-dim-vertical', 'cmd-drw-dim-aligned', 'cmd-drw-dim-angle', 'cmd-drw-dim-chamfer'];
    menuItem('cmd-drw-dim-vertical').click();
    await H.wait(150);
    const tool = drw().tool;
    const along = tool?.picks[0]?.feature.along;
    await leftClick(sheetOf(top.id, left().coord - 20, 0));
    await settle();
    const got = newest();
    const truth = along && Math.abs(along.b[1] - along.a[1]);
    return { pass: JSON.stringify(offered) === JSON.stringify(want) && tool?.mode === 'vertical' && tool.picks.length === 1 && got.dim.orientation === 'vertical' && close(got.value, truth), offered, got, truth };
  });

  await step('8 right-click a hole: 直徑, 半徑 and 中心記號 first; 半徑尺寸 from there is its radius', async () => {
    const h = hole();
    await rightClick(onCircle(h, (3 * Math.PI) / 4));
    const items = topItems();
    // the tool of the step before is still on (it stays the kind it is, as SolidWorks's): 結束目前的工具 comes first, then the kinds of the hole
    const first = items.filter((x) => x !== 'menuEndTool').slice(0, 2);
    const mark = items.includes('cmd-drw-centre-mark');
    menuItem('cmd-drw-dim-radius').click();
    await H.wait(150);
    await leftClick(sheetOf(top.id, h.centre[0] - h.radius - 15, h.centre[1] + h.radius + 15));
    await settle();
    const got = newest();
    return { pass: JSON.stringify(first) === JSON.stringify(['cmd-drw-dim-diameter', 'cmd-drw-dim-radius']) && mark && got.dim.kind === 'radius' && close(got.value, h.radius), items, got };
  });

  await step('9 right-click a vertex (where a rounded corner meets a side): distances only, no radius', async () => {
    d().setTool(null);
    await H.wait(100);
    // the corner nothing has been dimensioned at (the near right one): the end of its arc on the right side, the arc's centre moved right by its radius
    const c = F.filter((f) => f.type === 'circle' && !f.full).reduce((a, b) => (b.centre[0] - b.centre[1] > a.centre[0] - a.centre[1] ? b : a));
    const at = [c.centre[0] + c.radius, c.centre[1]];
    await rightClick(sheetOf(top.id, at[0], at[1]));
    const items = topItems().filter((x) => x.startsWith('cmd-drw-dim') || x === 'cmd-drw-dimension');
    await esc();
    return { pass: JSON.stringify(items) === JSON.stringify(['cmd-drw-dimension', 'cmd-drw-dim-horizontal', 'cmd-drw-dim-vertical', 'cmd-drw-dim-aligned']), items };
  });

  await step('10 right-click inside a view where nothing is: 剖面, 細部, the 尺寸 and 註記 submenus (the 註記 tab’s commands), 屬性, 刪除', async () => {
    const p = placedOf(top.id);
    // inside the view, away from every line: between the middle hole and the far side
    await rightClick([p.at[0] + p.w * 0.12, p.at[1] + p.h * 0.3]);
    const kind = menu()?.dataset.drawingMenu;
    const items = topItems();
    const needed = ['cmd-drw-section', 'cmd-drw-detail', 'menuDimensions', 'menuAnnotations', 'menuProperties', 'menuDelete'];
    menuItem('menuDimensions').click();
    await H.wait(100);
    const dims = [...menuItem('menuDimensions').querySelectorAll('.submenu [data-action]')].map((x) => x.dataset.action);
    menuItem('menuAnnotations').click();
    await H.wait(100);
    const anns = [...menuItem('menuAnnotations').querySelectorAll('.submenu [data-action]')].map((x) => x.dataset.action);
    menuItem('cmd-drw-note').click();
    await H.wait(150);
    const tool = drw().tool;
    d().setTool(null);
    await H.wait(100);
    const wantDims = ['cmd-drw-dimension', 'cmd-drw-dim-horizontal', 'cmd-drw-dim-vertical', 'cmd-drw-dim-aligned', 'cmd-drw-dim-radius', 'cmd-drw-dim-diameter', 'cmd-drw-dim-angle', 'cmd-drw-dim-chamfer', 'cmd-drw-ordinate', 'cmd-drw-baseline', 'cmd-drw-arrange'];
    return {
      pass: kind === 'view' && needed.every((x) => items.includes(x)) && !items.some((x) => x.startsWith('cmd-drw-dim')) && JSON.stringify(dims) === JSON.stringify(wantDims) && anns.includes('cmd-drw-note') && anns.includes('cmd-drw-centre-mark') && tool?.kind === 'annotate' && tool.what === 'note',
      kind,
      items,
      dims,
      anns,
      tool,
    };
  });

  await step('11 屬性… on a view chooses that view alone (its properties are what the panel shows)', async () => {
    const front = viewOf('front');
    const p = placedOf(front.id);
    d().clearSelection();
    await H.wait(100);
    await rightClick([p.at[0] + p.w * 0.3, p.at[1]]);
    const hasProps = !!menuItem('menuProperties');
    menuItem('menuProperties').click();
    await H.wait(200);
    const sel = drw().selection;
    return { pass: hasProps && drw().selected === front.id && sel.length === 1 && sel[0].kind === 'view' && sel[0].id === front.id, sel };
  });

  await step('12 with a tool on, the menu of the sheet starts with 結束目前的工具, which ends it; without one it has no such item', async () => {
    d().setTool({ kind: 'dimension', picks: [], mode: 'aligned' });
    await H.wait(100);
    await rightClick([400, 20]);
    const first = topItems()[0];
    const sheet = menu()?.dataset.drawingMenu;
    menuItem('menuEndTool').click();
    await H.wait(100);
    const ended = drw().tool === null;
    await rightClick([400, 20]);
    const none = !menuItem('menuEndTool') && !!menuItem('menuDimensions') && !!menuItem('menuAnnotations');
    await esc();
    return { pass: sheet === 'sheet' && first === 'menuEndTool' && ended && none, first, sheet, ended, none };
  });

  await step('13 the dimensions made are kept: saved values worked out again after undo and redo of the last one', async () => {
    const n = page().dimensions.length;
    const last = newest();
    store.undo();
    await H.wait(200);
    const undone = page().dimensions.length === n - 1;
    store.redo();
    await H.waitFor(() => page().dimensions.length === n, 5000, 'redo');
    await settle();
    const again = newest();
    return { pass: undone && again.dim.id === last.dim.id && close(again.value, last.value), n, last, again };
  });

  await step('14 visible circle centre acquires a persistent reference with a thin snap marker; endpoints keep priority', async () => {
    d().setTool({ kind: 'dimension', picks: [] });
    await H.wait(100);
    const { visibleElements } = await import(root + 'packages/drawing/src/viewEdges.ts');
    const { dimensionReferenceAt, toView } = await import(root + 'packages/drawing/src/pick.ts');
    // Views can overlap. Test a native hole centre whose visible topmost hit belongs to this view.
    const h = F.filter(f => f.type === 'circle' && f.full).find(f => {
      const p = sheetOf(top.id, ...f.centre);
      for (const v of [...page().views].reverse()) {
        const placed = placedOf(v.id);
        const features = drw().features.get(v.id) ?? [];
        const lines = drw().lines.get(v.id);
        const seen = visibleElements(lines, drw().edges.get(v.id), features);
        const hit = dimensionReferenceAt(lines, features, toView(placed, p), 6 / (document.querySelector('[data-svg] svg').getBoundingClientRect().width / 420) / placed.scale, seen);
        if (hit) return v.id === top.id && hit.ref.name === f.ref.name;
      }
      return false;
    });
    if (!h) throw new Error('unobscured native circular centre required');
    const at = sheetOf(top.id, h.centre[0], h.centre[1]);
    send('pointermove', at, 0, 0);
    await H.wait(100);
    const marker = !!document.querySelector('[data-dimension-snap="centre"]');
    const highlight = document.querySelector('[data-pick="circle"]');
    const pixelWidth = node => Number(node?.getAttribute('stroke-width')) * document.querySelector('[data-overlay]').getBoundingClientRect().width / 420;
    const thin = Math.abs(pixelWidth(highlight) - 1.5) < 0.01;
    const paperLinePx = () => Number(document.querySelector('[data-svg] polyline').getAttribute('stroke-width')) * document.querySelector('[data-svg] svg').getBoundingClientRect().width / 420;
    const lineBeforeZoom = paperLinePx();
    const [cx, cy] = toClient(at);
    canvas().dispatchEvent(new WheelEvent('wheel', { clientX: cx, clientY: cy, deltaY: -120, bubbles: true, cancelable: true }));
    await H.wait(150);
    send('pointermove', at, 0, 0); await H.wait(100);
    const paperWidthStable = Math.abs(paperLinePx() - lineBeforeZoom) < 0.01;
    const thinAfterZoom = Math.abs(pixelWidth(document.querySelector('[data-pick="circle"]')) - 1.5) < 0.01;
    await leftClick(at);
    const acquiredRef = drw().tool?.picks[0]?.feature.ref;
    const selectedAfterCentre = drw().dimension;
    const acquired = acquiredRef?.name === h.ref.name;
    // Worker vertices have `point`, not all are visible. Use the pure visibility filter on the real native projection.
    const seen = visibleElements(drw().lines.get(top.id), drw().edges.get(top.id), F);
    if (!seen.vertices.length) throw new Error('native visible endpoint required');
    const endpoint = seen.vertices[0];
    d().setTool({ kind: 'dimension', picks: [] });
    await H.wait(100);
    send('pointermove', sheetOf(top.id, ...endpoint.at), 0, 0);
    await H.wait(100);
    const endpointMarker = !!document.querySelector('[data-dimension-snap="vertex"]');
    await leftClick(sheetOf(top.id, ...endpoint.at));
    const endpointRef = drw().tool?.picks[0]?.feature.ref.name === endpoint.ref.name;
    await esc(); await esc();
    return { pass: marker && thin && thinAfterZoom && paperWidthStable && acquired && endpointMarker && endpointRef, marker, thin, thinAfterZoom, paperWidthStable, acquired, acquiredRef, wanted: h.ref, selectedAfterCentre, endpointMarker, endpointRef };
  });

  await step('15 an automatic radius switches to diameter via the property panel and doubles the native measurement', async () => {
    d().setTool(null);
    d().deleteDimensions(page().dimensions.filter(x => x.view === top.id).map(x => x.id));
    const before = new Set(page().dimensions.map(x => x.id));
    d().autoDimension(top.id, { overall: false, holes: true, positions: false });
    await H.wait(150);
    const rad = page().dimensions.find(x => x.kind === 'radius' && !before.has(x.id));
    if (!rad) throw new Error('automatic native radius required');
    d().selectDimension(rad.id);
    await H.waitFor(() => d().scene().dimensions.get(rad.id)?.value !== undefined, 15000, 'automatic native radius');
    const value = d().scene().dimensions.get(rad.id).value;
    await H.wait(100);
    const input = document.querySelector('[data-field="dimDisplayKind"]');
    if (!input) throw new Error('dimension display selector missing');
    input.value = 'diameter'; input.dispatchEvent(new Event('change', { bubbles: true }));
    await H.waitFor(() => page().dimensions.find(x => x.id === rad.id)?.kind === 'diameter', 5000, 'diameter conversion');
    const got = d().scene().dimensions.get(rad.id);
    const refKept = page().dimensions.find(x => x.id === rad.id).ref.name === rad.ref.name;
    const doubled = close(got.value, 2 * value) && got.text.includes('Ø');
    const count = page().dimensions.length;
    const added = d().autoDimension(top.id, { overall: false, holes: true, positions: false });
    const noDuplicates = added === 0 && count === page().dimensions.length;
    d().undo(); await H.wait(100);
    const undone = page().dimensions.find(x => x.id === rad.id).kind === 'radius';
    return { pass: refKept && doubled && undone && noDuplicates, refKept, doubled, undone, noDuplicates };
  });

  const pass = steps.every((s) => s.pass);
  return { name: 'drawing dimension kinds and right-click menu (ADR 0177)', steps, pass };
};
