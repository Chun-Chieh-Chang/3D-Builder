// await __dimensionStepped.run();
// The case the user drew: a three-step turned part, its middle step recessed (Ø20 / Ø12 / Ø20, 10 long each). The Ø12 is dimensioned with its line on the
// view across the recess (ADR 0227) and its number dragged out beyond the outline. The arrows touch the recess's silhouettes (no extension line: they cross the
// line), and the dimension line is drawn on under the number to its far end, so the number is not left standing apart from its dimension.
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
const root = here.replace(/tests\/e2e\/$/, '');
await import(here + 'phase1-demo-parts.js?' + Date.now());
await import(here + 'phase2-assembly.js?' + Date.now());
const D = await import(root + 'packages/drawing/src/index.ts');
const U = window.__ui, H = window.__ui2, { store } = H;
const check = (ok, why) => { if (!ok) throw new Error(why); };
window.__dimensionStepped = { run: async () => {
  // the part, from a sketch revolved about its centre line, as the user built it
  U.ready();
  await H.project({});
  await U.action('檔案', '新零件');
  await U.treeClick('前基準面');
  await U.action('草圖', '草圖');
  await U.frameSketch(5, 15, 12);
  await U.tool('中心線');
  await U.chain([[0, -2], [0, 32]]);
  await U.selectTool();
  await U.tool('直線');
  await U.chain([[0, 0], [10, 0], [10, 10], [6, 10], [6, 20], [10, 20], [10, 30], [0, 30], [0, 0]]);
  await U.selectTool();
  await U.exitSketch();
  await U.treeClick('草圖1');
  await U.action('特徵', '旋轉填料/基材');
  await U.pmOk();
  await H.waitFor(() => store.getState().result?.mass, 20000, 'the turned part');
  const volume = Math.PI * (100 * 10 * 2 + 36 * 10);
  check(Math.abs(store.getState().result.mass.volume - volume) < 1e-6 * volume, `the part is Ø20 / Ø12 / Ø20 × 10 each (volume ${store.getState().result.mass.volume})`);
  // a drawing is made of a saved part
  await H.save('stepped.3dbx');

  await H.newDrawing();
  const d = store.drawingStore, page = () => H.page(), state = () => store.getState().drw;
  await H.waitFor(() => page()?.views.length === 3 && [...state().lines.values()].filter(Boolean).length === 3, 30000, 'views');
  const view = page().views.find((v) => v.direction === 'front');
  document.querySelector(`[data-view="${view.id}"]`).click();
  await H.waitFor(() => state().features.get(view.id), 30000, 'actual model facts');
  const placed = () => d.scene().placed.get(view.id);
  const S = (x, y) => D.toSheet(placed(), x, y);
  const svg = () => document.querySelector('[data-svg] svg');
  const client = (p) => { const r = svg().getBoundingClientRect(), b = svg().viewBox.baseVal; return [r.left + (p[0] - b.x) / b.width * r.width, r.top + (b.height - (p[1] - b.y)) / b.height * r.height]; };
  const canvas = () => document.querySelector('[data-drawing-canvas]');
  const send = (type, p, buttons) => canvas().dispatchEvent(new PointerEvent(type, { clientX: p[0], clientY: p[1], button: 0, buttons, pointerId: 23, bubbles: true }));
  const click = async (p) => { const c = client(p); for (const type of ['pointermove', 'pointerdown', 'pointerup']) { send(type, c, type === 'pointerdown' ? 1 : 0); await H.wait(80); } };
  const drag = async (from, to) => { const a = client(from), b = client(to); send('pointerdown', a, 1); for (let i = 1; i <= 6; i++) { send('pointermove', [a[0] + (b[0] - a[0]) * i / 6, a[1] + (b[1] - a[1]) * i / 6], 1); await H.wait(25); } send('pointerup', b, 0); await H.wait(250); };

  // Smart Dimension: the two silhouettes of the recess, then a click in the middle of the recess puts the line there, on the view
  const before = page().dimensions.length;
  d.setTool({ kind: 'dimension', picks: [] });
  await H.wait(100);
  await click(S(-6, 13));
  await click(S(6, 13));
  await click(S(0, -15));
  await H.wait(500);
  const dim = page().dimensions.slice(before)[0];
  check(dim && dim.kind === 'linear' && dim.orientation === 'horizontal', 'a horizontal dimension across the recess');
  d.setTool(null);
  d.setDimension(dim.id, { insideAt: 15 });
  await H.wait(300);
  const outcome = () => d.scene().dimensions.get(dim.id);
  check(outcome().text === 'Ø12', `the recess is Ø12 (${outcome().text})`);

  // the visible lines of the view on the sheet, to measure the arrows against
  const segs = [];
  for (const p of state().lines.get(view.id).visible) for (let i = 0; i + 3 < p.length; i += 2) segs.push([S(p[i], p[i + 1]), S(p[i + 2], p[i + 3])]);
  const toSeg = (q, [a, b]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; const k = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L)); return Math.hypot(a[0] + k * dx - q[0], a[1] + k * dy - q[1]); };
  const nearest = (q) => Math.min(...segs.map((s) => toSeg(q, s)));
  const open = () => outcome().items.filter((i) => i.kind === 'polyline' && !i.closed);
  const tips = () => outcome().items.filter((i) => i.filled).map((i) => [i.points[0], i.points[1]]);
  check(tips().length === 2 && tips().every((t) => nearest(t) < 0.01), 'the arrows touch the silhouettes of the recess');
  check(open().length === 1, 'no extension line: the silhouettes cross the line');

  // drag the number out to the right, beyond the outline of the Ø20 steps
  const text = outcome().items.find((i) => i.kind === 'text');
  await drag([text.at[0], text.at[1] + 1], [S(16, 0)[0], text.at[1] + 1]);
  const moved = page().dimensions.find((x) => x.id === dim.id);
  check((moved.slide ?? 0) > 0 && moved.insideAt === 15, `the number slid along the line, the line still on the view (slide ${moved.slide}, insideAt ${moved.insideAt})`);
  const label = outcome().items.find((i) => i.kind === 'text');
  check(label.at[0] > S(10, 0)[0], 'the number is beyond the outline of the part');
  const width = D.dimensionTextItems(['Ø12'], [0, 0], D.DIM_TEXT, 'center').width;
  const lines = open();
  check(lines.length === 1, 'still one line: the dimension line');
  const reach = Math.max(lines[0].points[0], lines[0].points[2]);
  check(Math.abs(reach - (label.at[0] + width / 2)) < 0.01, `the dimension line runs on under the number to its far end (${reach.toFixed(2)} vs ${(label.at[0] + width / 2).toFixed(2)})`);
  check(tips().every((t) => nearest(t) < 0.01), 'the arrows still touch the silhouettes');
  return { pass: true, text: outcome().text, slide: moved.slide };
} };
