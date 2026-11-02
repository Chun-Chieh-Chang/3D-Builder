// await __sketchDiameter.run();
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase2-assembly.js?' + Date.now());
const H = window.__ui2, { store } = H;
window.__sketchDiameter = { run: async () => {
  H.ready();
  await H.project({ 'plate.3dbx': H.GOLDEN + 'locating-plate.3dbx' });
  await H.open('plate.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.newDrawing();
  const state = () => store.getState().drw;
  const d = store.drawingStore;
  await H.waitFor(() => H.page()?.views.length === 3 && state().sketchCircles.size === 3, 30000, 'sketch circles');
  let view, select;
  for (const v of H.page().views) {
    document.querySelector(`[data-view="${v.id}"]`).click();
    await H.wait(100);
    select = document.querySelector('[data-field="sketchDiameter"]');
    if (select?.options.length) { view = v; break; }
  }
  if (!view) throw Error('no sketch circle choice on any standard view');
  const refName = select.selectedOptions[0].textContent;
  const detail = document.querySelector('[data-group="sketchDiameter"]');
  detail.open = true;
  document.querySelector('[data-action="addSketchDiameter"]').click();
  await H.waitFor(() => H.page().dimensions.length > 0, 5000, 'new sketch diameter');
  const dimension = H.page().dimensions.at(-1);
  if (dimension.kind !== 'linear' && dimension.kind !== 'diameter') throw Error('wrong dimension kind');
  const ref = dimension.kind === 'linear' ? dimension.a : dimension.ref;
  if (ref.kind !== 'sketch' || !refName.includes(ref.name.split(':')[1])) throw Error('incorrect selected sketch');
  await H.waitFor(() => d.scene().dimensions.get(dimension.id)?.value > 0, 30000, 'resolved sketch dimension');
  const outcome = d.scene().dimensions.get(dimension.id);
  const expected = state().sketchCircles.get(view.id).find(x => x.ref.name === ref.name).facts.radius * 2;
  if (Math.abs(outcome.value - expected) > 1e-8 || !outcome.text.startsWith('Ø')) throw Error('sketch value or prefix incorrect');
  d.setSheet({ unit: 'in' });
  await H.wait(100);
  if (Math.abs(d.scene().dimensions.get(dimension.id).value - expected) > 1e-8 || d.scene().dimensions.get(dimension.id).text === outcome.text) throw Error('unit conversion changed the model value or did not change the text');
  H.next.save = 'sketch-diameter.3dbd';
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => !state().dirty, 10000, 'saved drawing');
  await H.open('sketch-diameter.3dbd');
  await H.waitFor(() => state()?.elements.has(dimension.id), 30000, 'reopened reference');
  const restored = store.drawingStore.scene().dimensions.get(dimension.id);
  if (!restored || 'error' in restored || Math.abs(restored.value - expected) > 1e-8) throw Error('sketch diameter did not survive reopen');
  return { pass: true };
} };
