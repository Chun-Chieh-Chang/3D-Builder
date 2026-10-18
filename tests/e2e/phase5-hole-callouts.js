// Phase 5, the hole callouts (D-1, docs/drawing-callouts-plan.md): in the browser, through the drawing panel. Run it in a freshly loaded app page
// (http://127.0.0.1:5391, 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-hole-callouts.js?' + Date.now());
//   await __callouts.run();
//
// The part is tests/fixtures/parts/hole-callouts.3dbx (a plate 120 × 80 × 15, written by `npm run make:kit`): M6 through, M8 blind 12, a countersink, a counterbore,
// a dowel hole with a chamfer at its mouth and a plain blind hole. In a new drawing the front view is dimensioned with the callouts and given a hole table.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const x = (window.__callouts = {});

const drw = () => store.getState().drw;
const page = () => H.page(drw()?.doc);
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const click = async (el) => {
  el.click();
  await H.wait(150);
};
const check = async (el, on) => {
  if (el.checked !== on) await click(el);
};
const texts = () => [...store.drawingStore.scene().dimensions.values()].map((o) => ('error' in o ? 'ERROR ' + o.error : o.text));

x.run = async () => {
  H.ready();
  await H.project({ '孔標註.3dbx': `${root}tests/fixtures/parts/hole-callouts.3dbx` });
  await H.open('孔標註.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.newDrawing();
  await H.waitFor(() => drw() && page()?.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
  const front = page()?.views.find((v) => v.direction === 'front');
  await click(panel(`[data-view="${front.id}"]`));
  await H.waitFor(() => drw().features.get(front.id), 30000, 'the features of the front view');
  await check(panel('[data-field="auto-overall"]'), false);
  await check(panel('[data-field="auto-positions"]'), false);
  await check(panel('[data-field="auto-holes"]'), true);
  await check(panel('[data-field="auto-callouts"]'), true);
  await click(panel('[data-action="autoDimension"]'));
  await H.waitFor(() => page()?.dimensions.length >= 6 && drw().elements.size === page()?.dimensions.length && !texts().some((t) => t.includes('…')), 30000, 'the hole callouts');
  const got = texts().sort();
  // the model calls six circles holes; the wall of the counterbore (Ø11) is a circle too, and is dimensioned as one
  const want = ['Ø9 深 8', 'M6 貫穿（底孔 Ø5）', 'M8 深 12（底孔 Ø6.8）', 'Ø6 貫穿 錐孔 Ø12 90°', 'Ø6.6 貫穿 沉頭 Ø11 深 6.5', 'Ø6 貫穿'].sort();
  H.check(JSON.stringify(got) === JSON.stringify([...want, 'Ø11'].sort()), `callouts: ${got.join(' | ')}`);

  // the holes are 20 to 30 mm apart and their notes longer: the panel says the texts lie over each other and what to do
  await H.waitFor(() => panel('[data-field="overlap"]'), 5000, 'the warning of overlapping texts');
  const warning = panel('[data-field="overlap"]').textContent;
  H.check(/互相蓋住/.test(warning) && /孔表/.test(warning), `the panel warns: ${warning}`);

  // the hole table says the same
  await click(panel('[data-action="addHoleTable"]'));
  await H.waitFor(() => (page()?.tables ?? []).some((t) => t.kind === 'holes') && [...store.drawingStore.scene().tables.values()].some((rows) => rows.length === 6), 30000, 'the hole table');
  const rows = [...store.drawingStore.scene().tables.values()].flat().map((r) => r.size).sort();
  H.check(JSON.stringify(rows) === JSON.stringify(want), `table: ${rows.join(' | ')}`);
  return { callouts: got, table: rows };
};
