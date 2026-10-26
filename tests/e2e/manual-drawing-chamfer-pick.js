// Short native chamfer selection through the public dimension dropdown.
// await __drawingChamferPick.run();
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(root + 'tests/e2e/phase2-assembly.js?' + Date.now());
const H = window.__ui2, { store } = H;
const M = await import(root + 'packages/model/src/index.ts');
const IO = await import(root + 'packages/io/src/index.ts');
const D = await import(root + 'packages/drawing/src/index.ts');
const s = () => store.getState().drw, d = () => store.drawingStore, pg = () => H.page(s().doc);
const must = (ok, text) => { if (!ok) throw new Error(text); };
const canvas = () => document.querySelector('[data-drawing-canvas]');
const sheet = (view, p) => D.toSheet(d().scene().placed.get(view.id), ...p);
async function click(p) {
  const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
  const x = r.left + p[0] / 420 * r.width, y = r.top + (297 - p[1]) / 297 * r.height;
  for (const type of ['pointermove', 'pointerdown', 'pointerup']) {
    canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 66, button: 0, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true })); await H.wait(60);
  }
}
window.__drawingChamferPick = { run: async () => {
  const steps = [], notes = [];
  async function step(name, fn) { await fn(); steps.push({ name, pass: true }); await window.__shot?.(name); }
  try {
    await step('1 real native plate with a half millimetre corner chamfer', async () => {
      H.ready(); await H.project({});
      const points = [[0, 0], [40, 0], [40, 29.5], [39.5, 30], [0, 30]];
      let part = M.createEmptyPart();
      const constraints = points.flatMap(([x, y], i) => x === 0 && y === 0 ? [{ id: `o${i}`, type: 'coincident', a: `p${i}`, b: '@origin' }] : [x === 0 ? { id: `x${i}`, type: 'vertical', a: `p${i}`, b: '@origin' } : { id: `x${i}`, type: 'distanceX', a: '@origin', b: `p${i}`, value: String(x) }, y === 0 ? { id: `y${i}`, type: 'horizontal', a: `p${i}`, b: '@origin' } : { id: `y${i}`, type: 'distanceY', a: '@origin', b: `p${i}`, value: String(y) }]);
      part = M.applyCommand(part, { type: 'insertFeature', index: 0, feature: { id: 's1', name: 'chamfer profile', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [...points.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y })), ...points.map((_, i) => ({ id: `l${i}`, type: 'line', p1: `p${i}`, p2: `p${(i + 1) % points.length}` }))], constraints } });
      part = M.applyCommand(part, { type: 'insertFeature', index: 1, feature: { id: 'e1', name: 'plate', type: 'extrude', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth: '10' } } });
      await H.writeAt('chamfer.3dbx', await IO.writePartFile(part)); await H.open('chamfer.3dbx');
      await H.waitFor(() => store.getState().result?.mesh, 20000, 'native plate');
      await H.newDrawing(['front']); d().setSheet({ scale: [1, 1] });
      await H.waitFor(() => pg().views.length === 1 && s().edges.has(pg().views[0].id), 30000, 'native drawing references');
      const original = d().notifyInfo.bind(d()); d().notifyInfo = text => { notes.push(text); original(text); };
    });
    const view = pg().views[0];
    await step('2 annotation dimension dropdown exposes chamfer mode', async () => {
      [...document.querySelectorAll('.command-bar .tabs > .menu > .tab')].find(b => b.textContent === '註記').click(); await H.wait(100);
      document.querySelector('[data-split-toggle="drw-dimension"]').click(); await H.wait(100);
      const button = document.querySelector('[data-split="drw-dimension"] .split-menu [data-help="drw-dim-chamfer"]');
      must(button, 'chamfer dimension is present in the public dropdown'); button.click(); await H.wait(100);
      must(s().tool?.mode === 'chamfer', 'dropdown activates chamfer mode');
    });
    await step('3 short chamfer selects a line and creates C0.5 instead of selecting its endpoints', async () => {
      const features = s().features.get(view.id), lines = s().lines.get(view.id);
      const seen = D.visibleElements(lines, s().edges.get(view.id), features);
      const at = [39.75, 29.75];
      must(D.featureAt(lines, features, at, 1, seen)?.type === 'vertex', 'the real small chamfer overlaps the original vertex target area');
      await click(sheet(view, at));
      must(s().tool?.picks.length === 1 && s().tool.picks[0].feature.type !== 'vertex', 'actual pointer selects the chamfer line');
      await click(sheet(view, [48, 20]));
      await H.waitFor(() => pg().dimensions.length === 1 && d().scene().dimensions.get(pg().dimensions[0].id)?.value !== undefined, 10000, 'chamfer dimension');
      const dim = pg().dimensions[0], result = d().scene().dimensions.get(dim.id);
      must(dim.kind === 'chamfer' && Math.abs(result.value - 0.5) < 1e-7 && result.text === 'C0.5', 'actual native half millimetre chamfer callout');
      must(result.items.some(item => item.kind === 'text' && item.text === 'C0.5' && item.at[0] > 0 && item.at[0] < 420 && item.at[1] > 0 && item.at[1] < 297), 'callout text is drawn inside the sheet');
    });
    await step('4 unsupported horizontal edge gives feedback on first click and keeps selection empty', async () => {
      await click(sheet(view, [20, 0]));
      must(s().tool?.picks.length === 0, 'invalid source does not leave an unusable selection');
      must(notes.some(n => n.includes('導角直邊')), 'immediate explicit explanation');
      must(pg().dimensions.length === 1, 'no fabricated chamfer added');
      d().setTool(null);
    });
    return { pass: true, steps };
  } catch (error) { return { pass: false, steps, error: String(error?.stack ?? error) }; }
} };
