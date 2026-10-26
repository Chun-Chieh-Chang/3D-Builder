// Actual conical shaft chamfer in shaded drawing: selection, associative value, leader side and persistence.
// await __drawingConeChamfer.run();
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
window.__drawingConeChamfer = { run: async () => {
 const steps = []; let part, view, profile;
 async function step(name, fn) { await fn(); steps.push({ name, pass: true }); await window.__shot?.(name); }
 try {
  await step('1 build a real cylinder and a native face-selected chamfer', async () => {
   H.ready(); await H.project({}); part = M.createEmptyPart();
   part = M.applyCommand(part, { type: 'insertFeature', index: 0, feature: { id: 's', name: 'circle', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [{ id: 'c', type: 'point', x: 0, y: 0 }, { id: 'circle', type: 'circle', center: 'c', radius: 10 }], constraints: [{ id: 'o', type: 'coincident', a: 'c', b: '@origin' }, { id: 'r', type: 'radius', circle: 'circle', value: '10' }] } });
   part = M.applyCommand(part, { type: 'insertFeature', index: 1, feature: { id: 'e', name: 'shaft', type: 'extrude', suppressed: false, sketch: 's', op: 'boss', dir1: { type: 'blind', depth: '20' } } });
   await H.writeAt('shaft.3dbx', await IO.writePartFile(part)); await H.open('shaft.3dbx');
   await H.waitFor(() => store.getState().result?.mesh, 20000, 'native cylinder');
   const native = store.getState().result, index = native.faceFingerprints.findIndex(f => f.type === 'plane');
   must(index >= 0, 'native cap exists');
   part = M.applyCommand(part, { type: 'insertFeature', index: 2, feature: { id: 'ch', type: 'chamfer', name: 'shaft chamfer', suppressed: false, faces: [{ kind: 'face', name: native.faceNames[index], fingerprint: native.faceFingerprints[index] }], edges: [], mode: 'distanceDistance', distance: '0.5', second: '0.5' } });
   await H.writeAt('shaft.3dbx', await IO.writePartFile(part)); await H.action('檔案', '新零件'); await H.open('shaft.3dbx');
   await H.waitFor(() => store.getState().result?.features.length === 3 && !store.getState().rebuilding, 20000, 'native conical chamfer');
   must(store.getState().result.features.every(f => f.status === 'ok'), 'actual model chamfer succeeded');
   await H.newDrawing(['top']);
   await H.waitFor(() => pg().views.length === 1 && s().features.has(pg().views[0].id), 30000, 'side view with native features');
   view = pg().views[0]; d().setView(view.id, { display: 'shadedEdges' });
   await H.waitFor(() => s().lines.get(view.id)?.shade, 30000, 'actual shaded side view');
   const profiles = s().features.get(view.id).filter(f => f.type === 'slant' && f.cone);
   must(profiles.length === 2, 'both circular cone silhouette references exist');
   profile = profiles.reduce((a,b) => a.at[0] > b.at[0] ? a : b);
  });
  await step('2 public chamfer dropdown selects the short conical silhouette and creates C0.5', async () => {
   [...document.querySelectorAll('.command-bar .tabs > .menu > .tab')].find(b => b.textContent === '註記').click(); await H.wait(100);
   document.querySelector('[data-split-toggle="drw-dimension"]').click(); await H.wait(100);
   document.querySelector('[data-split="drw-dimension"] .split-menu [data-help="drw-dim-chamfer"]').click(); await H.wait(100);
   await click(sheet(view, profile.at));
   must(s().tool?.picks.length === 1 && s().tool.picks[0].feature.cone, 'pointer selected a genuine conical profile');
   await click(sheet(view, [profile.at[0]+7, profile.at[1]-5]));
   await H.waitFor(() => pg().dimensions.length === 1 && d().scene().dimensions.get(pg().dimensions[0].id)?.value !== undefined, 10000, 'associative cone dimension');
   const dim = pg().dimensions[0], outcome = d().scene().dimensions.get(dim.id);
   must(dim.kind === 'chamfer' && dim.coneSide === profile.cone.side && outcome.text === 'C0.5' && Math.abs(outcome.value-0.5)<1e-7, 'actual cone C0.5');
   must(outcome.items.some(i => i.kind === 'text' && i.text === 'C0.5' && i.at[0] > 0 && i.at[0] < 420 && i.at[1] > 0 && i.at[1] < 297), 'actual callout lies inside the sheet');
   must(outcome.handle.centre.every((v,i) => Math.abs(v-sheet(view,profile.at)[i])<1e-7), 'leader touches the selected silhouette, not the cone centre');
   must(document.querySelector('[data-field="dimChamferSize"]').disabled && document.querySelector('[data-field="dimChamferAngleVal"]').disabled, 'model dimensions are read-only');
   d().setTool(null);
  });
  await step('3 save then change the actual model chamfer to one millimetre and cold-reopen the drawing', async () => {
   H.next.save = 'shaft-drawing.3dbd'; await H.action('檔案','儲存檔案'); await H.waitFor(() => !s().dirty,10000,'saved drawing');
   const changed = structuredClone(part); changed.features.at(-1).distance = '1'; changed.features.at(-1).second = '1';
   await H.writeAt('shaft.3dbx', await IO.writePartFile(changed));
   await H.action('檔案','新零件'); store.restartWorker();
   await H.waitFor(() => store.getState().bootMs !== null && !store.getState().rebuilding,20000,'fresh native worker');
   await H.open('shaft-drawing.3dbd');
   await H.waitFor(() => s()?.fileName === 'shaft-drawing.3dbd' && d().scene().dimensions.get(pg().dimensions[0]?.id)?.value !== undefined,30000,'native cone reevaluation');
   const dim = pg().dimensions[0], outcome = d().scene().dimensions.get(dim.id);
   must(Math.abs(dim.size-0.5)<1e-7 && Math.abs(outcome.value-1)<1e-7 && outcome.text==='C1','saved old number is not used as model truth');
  });
  return { pass: true, steps };
 } catch(error) { return { pass:false, steps, error:String(error?.stack??error) }; }
} };
