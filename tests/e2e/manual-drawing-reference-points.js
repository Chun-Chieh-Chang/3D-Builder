// Native reference-point snaps and cold reopening real legacy drawing archives.
// await __drawingReferencePoints.run();
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(root + 'tests/e2e/phase2-assembly.js?' + Date.now());
const H = window.__ui2, { store } = H;
const M = await import(root + 'packages/model/src/index.ts');
const IO = await import(root + 'packages/io/src/index.ts');
const D = await import(root + 'packages/drawing/src/index.ts');
const s = () => store.getState().drw, pg = () => H.page(s().doc), d = () => store.drawingStore;
const must = (ok, text) => { if (!ok) throw new Error(text); };
const canvas = () => document.querySelector('[data-drawing-canvas]');
const client = point => { const r = document.querySelector('[data-svg] svg').getBoundingClientRect(); return [r.left + point[0] / 420 * r.width, r.top + (297 - point[1]) / 297 * r.height]; };
const pointOnSheet = (id, x, y) => D.toSheet(d().scene().placed.get(id), x, y);
async function move(point) { const [x, y] = client(point); canvas().dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId: 45, button: 0, buttons: 0, bubbles: true })); await H.wait(60); }
async function click(point) { await move(point); const [x, y] = client(point); for (const type of ['pointerdown', 'pointerup']) { canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 45, button: 0, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true })); await H.wait(60); } }
async function save() { await H.action('檔案', '儲存檔案'); await H.waitFor(() => !s().dirty, 10000, 'saved drawing'); }
async function coldOpen(path) {
  if (s()?.dirty) await save();
  await H.action('檔案', '新零件'); await H.wait(100);
  store.restartWorker();
  await H.waitFor(() => store.getState().bootMs !== null && !store.getState().rebuilding, 20000, 'fresh native worker');
  await H.open(path);
  await H.waitFor(() => s()?.fileName === path && pg().views.every(v => s().lines.get(v.id) && s().edges.has(v.id) && s().features.has(v.id)), 30000, 'legacy model and selection data');
  must(s().problems.size === 0, 'legacy file geometry and sources must really load');
}
async function valueOfLast(expected) {
  const dim = pg().dimensions.at(-1);
  await H.waitFor(() => { const o = dim && d().scene().dimensions.get(dim.id); return o && !('error' in o); }, 10000, 'native dimension evaluation');
  const o = d().scene().dimensions.get(dim.id);
  must(Math.abs(o.value - expected) < 1e-6, `native value must be ${expected}, got ${o.value}`);
  return dim;
}
window.__drawingReferencePoints = { run: async () => {
  const steps = [];
  const step = async (name, fn) => { try { await fn(); steps.push({ name, pass: true }); await window.__shot?.(name); } catch (error) { steps.push({ name, pass: false, error: String(error?.stack ?? error) }); throw error; } };
  try {
    await step('1 create an actual cylindrical model and legacy assembly drawing archives', async () => {
      H.ready(); await H.project({});
      let part = M.createEmptyPart();
      const sketch = { id: 's1', type: 'sketch', name: 'circle', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [{ id: 'c', type: 'point', x: 0, y: 0 }, { id: 'ci', type: 'circle', center: 'c', radius: 4 }], constraints: [{ id: 'co', type: 'coincident', a: 'c', b: '@origin' }, { id: 'r', type: 'radius', circle: 'ci', value: '4' }] };
      part = M.applyCommand(part, { type: 'insertFeature', feature: sketch, index: 0 });
      part = M.applyCommand(part, { type: 'insertFeature', feature: { id: 'e1', type: 'extrude', name: 'cylinder', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth: '20' } }, index: 1 });
      await H.writeAt('round.3dbx', await IO.writePartFile(part));
      let asm = M.createEmptyAssembly();
      for (let i = 0; i < 2; i++) asm = M.applyAssemblyCommand(asm, { type: 'insertComponent', ...(i === 0 ? { file: { id: 'file1', path: 'round.3dbx' } } : {}), component: { id: `part${i + 1}`, file: 'file1', instance: i + 1, fixed: true, placement: { position: [20 * i, 0, 0], rotation: [0, 0, 0, 1] } } });
      await H.writeAt('rounds.3dba', await IO.writeAssemblyFile(asm)); await H.open('rounds.3dba'); await H.loaded();
      await H.newDrawing(['top', 'front']);
      await H.waitFor(() => pg().views.length === 2 && [...s().lines.values()].filter(Boolean).length === 2, 30000, 'native cylinder projections');
      const original = JSON.parse(M.serializeDrawing(s().doc));
      for (const assembly of [false, true]) for (const version of [24, 30, 31]) {
        const raw = structuredClone(original); raw.schemaVersion = version;
        raw.pages[0].sheet.projection = 'first';
        if (!assembly) for (const v of raw.pages[0].views) v.source = 'round.3dbx';
        if (version < 25) { Object.assign(raw, raw.pages[0]); delete raw.pages; delete raw.id; delete raw.name; }
        await H.writeAt(`legacy${assembly ? "" : "Part"}${version}.3dbd`, await IO.writeDrawingFile(raw));
      }
      H.next.save = 'initial.3dbd'; await save();
    });
    for (const assembly of [false, true]) for (const version of [24, 30, 31]) await step(`2 legacy ${assembly ? 'assembly' : 'part'} v${version} cold-open: visible cylinder side outlines are selectable and dimensionable`, async () => {
      await coldOpen(`legacy${assembly ? "" : "Part"}${version}.3dbd`);
      must(pg().sheet.projection === 'first', 'saved projection must survive migration');
      const top = pg().views.find(v => v.direction === 'top'), box = s().lines.get(top.id).box;
      const at = pointOnSheet(top.id, box.min[0], (box.min[1] + box.max[1]) / 2);
      d().setTool({ kind: 'dimension', picks: [] }); await H.wait(100); await click(at);
      must(s().tool?.picks.length === 1, 'legacy cylindrical silhouette has a real selectable reference');
      const first = s().tool.picks[0].feature;
      must(assembly ? first.ref.in === 'part1' : first.ref.in === undefined, 'selected silhouette retains the correct part ownership');
      await click(pointOnSheet(top.id, box.min[0] - 10, box.min[1] - 10));
      const diameter = await valueOfLast(8);
      must(diameter.kind === 'linear' && diameter.prefix === 'Ø', 'single silhouette keeps the diameter workflow');
      d().setTool(null); await save();
    });
    await step('3 midpoint snaps distinguish identically named faces in different components', async () => {
      const top = pg().views.find(v => v.direction === 'top'), box = s().lines.get(top.id).box;
      const y = (box.min[1] + box.max[1]) / 2;
      d().setTool({ kind: 'dimension', picks: [], mode: 'horizontal' }); await H.wait(100);
      const a = pointOnSheet(top.id, box.min[0], y), b = pointOnSheet(top.id, box.min[0] + 20, y);
      await move(a); must(document.querySelector('[data-dimension-snap="midpoint"]'), 'silhouette midpoint marker'); await click(a);
      const first = s().tool.picks[0].feature.ref;
      await click(b); must(s().tool?.picks.length === 2, 'same-name points in two components are two selections');
      const second = s().tool.picks[1].feature.ref;
      must(first.name === second.name && first.in !== second.in && first.point === second.point, 'the test truly exercises distinct instances of one named element');
      await click(pointOnSheet(top.id, (box.min[0] + box.max[0]) / 2, box.min[1] - 15));
      await valueOfLast(20); d().setTool(null);
    });
    await step('4 circle quadrants, centres and silhouette endpoints show actual point markers', async () => {
      const front = pg().views.find(v => v.direction === 'front');
      const circle = s().features.get(front.id).find(f => f.type === 'circle' && f.full && f.ref.in === 'part1');
      must(circle, 'native placed circular feature');
      d().setTool({ kind: 'dimension', picks: [], mode: 'horizontal' }); await H.wait(100);
      await move(pointOnSheet(front.id, ...circle.centre)); must(document.querySelector('[data-dimension-snap="centre"]'), 'circle centre marker');
      for (let q = 0; q < 4; q++) {
        const x = circle.centre[0] + (q === 0 ? circle.radius : q === 2 ? -circle.radius : 0), y = circle.centre[1] + (q === 1 ? circle.radius : q === 3 ? -circle.radius : 0);
        await move(pointOnSheet(front.id, x, y)); must(document.querySelector('[data-dimension-snap="quadrant"]'), `quadrant ${q} marker`);
      }
      await click(pointOnSheet(front.id, circle.centre[0] + circle.radius, circle.centre[1]));
      await click(pointOnSheet(front.id, circle.centre[0] - circle.radius, circle.centre[1]));
      must(s().tool?.picks.length === 2, 'two quadrants of one circle remain distinct references');
      await click(pointOnSheet(front.id, circle.centre[0], circle.centre[1] - 10));
      const qdim = await valueOfLast(8); must(qdim.a.point === 'quadrant0' && qdim.b.point === 'quadrant2', 'quadrants persist as model selections');
      const top = pg().views.find(v => v.direction === 'top');
      const axis = s().features.get(top.id).find(f => f.type === 'axis' && f.ref.in === 'part1');
      const outline = D.outlinesOf([axis])[0];
      d().setTool({ kind: 'dimension', picks: [] }); await H.wait(100);
      await move(pointOnSheet(top.id, ...outline.from)); must(document.querySelector('[data-dimension-snap="vertex"]'), 'cylinder silhouette endpoint marker');
      d().setTool(null);
    });
    await step('5 point references survive save, native-worker restart and reopening', async () => {
      const saved = pg().dimensions.filter(x => x.a?.point || x.b?.point).map(x => [x.id, d().scene().dimensions.get(x.id).value]);
      must(saved.length >= 2, 'real reference-point dimensions exist');
      await save(); await coldOpen('legacy31.3dbd');
      await H.waitFor(() => saved.every(([id]) => d().scene().dimensions.get(id)?.value !== undefined), 10000, 'restored native dimensions');
      for (const [id, value] of saved) must(Math.abs(d().scene().dimensions.get(id).value - value) < 1e-6, 'reopened point dimensions retain native values');
    });
    return { pass: true, steps };
  } catch (error) { return { pass: false, steps, error: String(error?.message ?? error) }; }
}};
