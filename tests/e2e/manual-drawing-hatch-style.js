// Real native section hatches: UI spacing/angle, rejection/recovery, inheritance and persistence.
// await __manualDrawingHatchStyle.controls();
// await __manualDrawingHatchStyle.persistence();
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const D = await import(`${root}packages/drawing/src/index.ts`);
const H = window.__ui2;
const { store } = H;
const M = window.__manualDrawingHatchStyle = {};
const drw = () => store.getState().drw;
const d = () => store.drawingStore;
const pg = () => H.page(drw().doc);
const view = id => pg().views.find(v => v.id === id);
const must = (ok, why) => { if (!ok) throw new Error(why); };
const stable = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const near = (a, b) => Math.abs(a - b) < 1e-6;
async function select(id) {
  d().select(id);
  await H.wait(100);
  const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'PropertyManager');
  tab?.click();
  await H.wait(100);
}
async function input(field, text) {
  const el = document.querySelector(`[data-field="${field}"]`);
  must(el, `missing ${field}`);
  el.scrollIntoView({ block: 'nearest' });
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(50);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.wait(120);
  return el;
}
async function setup() {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
  await H.open('定位板.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'native part');
  await H.newDrawing();
  await H.waitFor(() => drw() && pg().views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'base views');
  const top = pg().views.find(v => v.direction === 'top');
  const b = drw().lines.get(top.id).box;
  const y = (b.min[1] + b.max[1]) / 2;
  must(d().execute({ type: 'insertViews', views: [{ id: 'hs', kind: 'section', name: 'Hatch section', parent: top.id, label: 'A', line: [[b.min[0] - 5, y], [b.max[0] + 5, y]], at: [240, 95] }] }), 'insert section');
  await H.waitFor(() => drw().lines.get('hs')?.cut?.length > 0, 30000, 'native cut');
  await select('hs');
}
function hatchItems(id) {
  const v = view(id), p = d().scene().placed.get(id);
  const lines = D.resolveLines(drw().doc, drw().lines).get(id);
  return D.viewItems(v, { ...lines, visible: [], hidden: [], tangent: [], tangentHidden: [] }, p).filter(i => i.style === 'thin' && i.points.length === 4);
}
function rendered(items) {
  const height = d().scene().scene.height;
  const rounded = x => String(Math.round(x * 1000) / 1000 + 0);
  const paths = new Set([...document.querySelectorAll('[data-svg] svg polyline')].map(e => e.getAttribute('points')));
  return items.every(l => paths.has(`${rounded(l.points[0])},${rounded(height - l.points[1])} ${rounded(l.points[2])},${rounded(height - l.points[3])}`));
}
M.controls = async () => {
  await setup();
  const before = hatchItems('hs');
  must(before.length > 0 && rendered(before), 'initial hatches rendered');
  await input('hatchSpacing', '1.25');
  await input('hatchAngle', '30');
  const dense = hatchItems('hs');
  must(dense.length > before.length && rendered(dense), 'density changes actual SVG');
  must(view('hs').hatch.spacing === 1.25 && view('hs').hatch.angle === 30, 'model style');
  for (const l of dense) must(near((l.points[3] - l.points[1]) / (l.points[2] - l.points[0]), Math.tan(Math.PI / 6)), 'actual angle');
  const invalid = await input('hatchSpacing', '0');
  must(invalid.getAttribute('aria-invalid') === 'true' && view('hs').hatch.spacing === 1.25 && store.getState().notice?.kind === 'error', 'invalid spacing rejected visibly');
  await input('hatchSpacing', '1.25');
  must(document.querySelector('[data-field="hatchSpacing"]').getAttribute('aria-invalid') === 'false' && !store.getState().notice, 'same-value error recovery');
  const blank = await input('hatchAngle', '');
  must(blank.getAttribute('aria-invalid') === 'true' && view('hs').hatch.angle === 30, 'blank angle rejected');
  await input('hatchAngle', '-60');
  d().undo(); await H.wait(100); must(view('hs').hatch.angle === 30, 'undo angle');
  d().redo(); await H.wait(100); must(view('hs').hatch.angle === -60, 'redo angle');
  const count = hatchItems('hs').length;
  must(d().execute({ type: 'setView', viewId: 'hs', patch: { scale: [2, 1] } }), 'scale');
  await H.wait(150);
  const scaled = hatchItems('hs');
  must(scaled.length > count && rendered(scaled), 'paper spacing keeps density on rescale');
  await input('hatchAngle', '30');
  await window.__shot?.('hatch-spacing-angle-controls');
  document.querySelector('[data-action="resetHatch"]').click(); await H.wait(100);
  must(!view('hs').hatch && document.querySelector('[data-field="hatchSpacing"]').value === '3' && document.querySelector('[data-field="hatchAngle"]').value === '45', 'reset defaults');
  return { name: 'hatch controls', pass: true, before: before.length, dense: dense.length, scaled: scaled.length };
};
M.persistence = async () => {
  await setup();
  await input('hatchSpacing', '2.5'); await input('hatchAngle', '-30');
  const box = drw().lines.get('hs').box;
  const centre = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];
  must(d().execute({ type: 'insertViews', views: [{ id: 'hd', kind: 'detail', name: 'Detail', parent: 'hs', label: 'B', centre, radius: Math.max(3, (box.max[0] - box.min[0]) / 3), at: [330, 95], scale: [2, 1] }] }), 'detail');
  await select('hd');
  await H.waitFor(() => document.querySelector('[data-field="hatchSpacing"]')?.value === '2.5', 10000, 'inherit spacing');
  must(document.querySelector('[data-field="hatchAngle"]').value === '-30', 'inherit angle');
  await input('hatchAngle', '75');
  must(view('hs').hatch.angle === -30 && view('hd').hatch.angle === 75, 'independent override');
  const styles = stable(pg().views.filter(v => ['hs', 'hd'].includes(v.id)));
  H.next.save = '剖面線.3dbd';
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => !drw().dirty, 10000, 'save');
  await H.open('剖面線.3dbd');
  await H.waitFor(() => drw()?.fileName === '剖面線.3dbd' && drw().lines.get('hs')?.cut?.length > 0, 30000, 'reload native section');
  must(stable(pg().views.filter(v => ['hs', 'hd'].includes(v.id))) === styles && drw().doc.schemaVersion >= 29, 'persisted styles');
  await select('hd');
  const resolved = D.resolveLines(drw().doc, drw().lines).get('hd');
  must(resolved?.cut?.length > 0 && resolved.hatchClip.length === 1, 'detail hatch survives regeneration');
  must(document.querySelector('[data-field="hatchAngle"]').value === '75', 'reloaded UI');
  await window.__shot?.('hatch-styles-reopened');
  document.querySelector('[data-action="resetHatch"]').click(); await H.wait(100);
  must(!view('hd').hatch && document.querySelector('[data-field="hatchAngle"]').value === '-30', 'detail reset inherits');
  return { name: 'hatch persistence and inheritance', pass: true, schema: drw().doc.schemaVersion };
};
