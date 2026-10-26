// Native stepped-contour extension origins, scene/export agreement and saved drawing reopening.
// await __drawingExtensionOrigins.run();
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
window.__drawingExtensionOrigins = { run: async () => {
  const steps = [], notes = [];
  async function step(name, fn) { await fn(); steps.push({ name, pass: true }); await window.__shot?.(name); }
  try {
    await step('1 real stepped plate whose top is narrower than its view bounding box', async () => {
      H.ready(); await H.project({});
      const points = [[0, 0], [40, 0], [40, 20], [20, 20], [20, 30], [0, 30]];
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
    await step('2 select two real ledges and place a vertical dimension', async () => {
      [...document.querySelectorAll('.command-bar .tabs > .menu > .tab')].find(b => b.textContent === '註記').click(); await H.wait(100);
      document.querySelector('[data-split-toggle="drw-dimension"]').click(); await H.wait(100);
      document.querySelector('[data-split="drw-dimension"] .split-menu [data-help="drw-dim-vertical"]').click(); await H.wait(100);
      await click(sheet(view, [8, 30])); await click(sheet(view, [27, 20]));
      must(s().tool?.picks.length === 2, 'both native ledges acquired');
      await click(sheet(view, [48, 25]));
      await H.waitFor(() => pg().dimensions.length === 1 && d().scene().dimensions.get(pg().dimensions[0].id)?.value !== undefined, 10000, 'native ledge distance');
      d().setTool(null);
    });
    function check() {
      const result = d().scene().dimensions.get(pg().dimensions[0].id);
      must(result && !('error' in result) && Math.abs(result.value - 10) < 1e-7, 'native step height remains ten');
      const a = sheet(view, [20, 30]), b = sheet(view, [40, 20]);
      const starts = result.items.filter(i => i.kind === 'polyline').slice(0, 2);
      for (const [i, p] of [a, b].entries()) must(Math.abs(starts[i].points[0] - p[0] - D.GAP) < 1e-7 && Math.abs(starts[i].points[1] - p[1]) < 1e-7, 'each extension starts at its own contour plus paper gap');
      must(result.dxf.geometry.kind === 'linear' && result.dxf.geometry.a.every((v, i) => Math.abs(v - a[i]) < 1e-7) && result.dxf.geometry.b.every((v, i) => Math.abs(v - b[i]) < 1e-7), 'DXF source points agree with visible extension origins');
    }
    await step('3 upper extension reaches its narrower ledge instead of floating at the overall box edge', async () => { check(); });
    await step('4 scale changes preserve model attachments and paper-space gap', async () => {
      d().setView(view.id, { scale: [2, 1] }); await H.wait(100); check();
    });
    await step('5 saved drawing reopens with the same contour origins', async () => {
      H.next.save = 'step-dimension.3dbd'; await H.action('檔案', '儲存檔案');
      await H.waitFor(() => !s().dirty, 10000, 'saved drawing');
      await H.action('檔案', '新零件'); await H.open('step-dimension.3dbd');
      await H.waitFor(() => s()?.fileName === 'step-dimension.3dbd' && d().scene().dimensions.get(pg().dimensions[0]?.id)?.value !== undefined, 30000, 'reopened native dimension');
      check();
    });
    return { pass: true, steps };
  } catch (error) { return { pass: false, steps, error: String(error?.stack ?? error) }; }
} };
