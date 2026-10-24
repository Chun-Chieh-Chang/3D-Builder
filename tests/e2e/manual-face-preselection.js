// await __facePreselection.fillet();
// await __facePreselection.chamfer();
// Real viewport face clicks, modifier selection and model-volume verification; no synthetic geometry facts.
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui, { store } = H;
const check = (ok, message) => { if (!ok) throw new Error(message); };
const state = () => store.getState();
async function block() {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面'); await H.action('草圖', '草圖');
  await H.frameSketch(20, 15, 8); await H.tool('邊角矩形');
  await H.sk(0, 0); await H.sk(40, 30); await H.solved();
  const name = H.sketch().name;
  await H.exitSketch(); await H.treeClick(name); await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '12'); await H.pmOk(); await H.action('檢視', '等角');
}
async function run(type) {
  await block();
  const base = state().result;
  const top = base.faceFingerprints.findIndex(f => f.type === 'plane' && Math.abs(f.center[1] - 12) < 1e-6);
  check(top >= 0, 'real top face exists');
  const center = base.faceFingerprints[top].center;
  const visible = i => { const p = H.worldToClient(base.faceFingerprints[i].center); return store.viewer.pickOrder(p.x, p.y).face === i; };
  check(visible(top), 'top-face click hits actual face');
  const side = base.faceFingerprints.findIndex((f, i) => i !== top && f.type === 'plane' && visible(i));
  check(side >= 0, 'second visible face exists');
  const label = type === 'fillet' ? '圓角' : '導角';
  store.select(null);
  await H.action('特徵', label);
  document.querySelector('.pm-ok').click(); await H.wait(60);
  check(state().editing?.kind === 'feature', 'empty selection cannot be committed');
  check(state().notice?.text?.includes('邊線或面') || state().notice?.message?.includes('邊線或面'), 'empty selection explains that faces are accepted');
  store.cancelEdit(); await H.settle();
  await H.at(center);
  check(state().selectedFace?.name === base.faceNames[top], 'single face selected before command');
  await H.action('特徵', label);
  check(state().doc.features.at(-1).faces?.[0]?.name === base.faceNames[top], 'single preselected face enters feature');
  store.cancelEdit(); await H.settle();
  await H.at(center);
  await H.at(base.faceFingerprints[side].center, { ctrlKey: true });
  check(state().selectedElements.filter(r => r.kind === 'face').length === 2, 'Ctrl preserves first face and adds second');
  await H.at(center, { ctrlKey: true });
  check(state().selectedElements.length === 1 && state().selectedElements[0].name === base.faceNames[side], 'Ctrl toggles face off');
  await H.at(center, { shiftKey: true });
  check(state().selectedElements.length === 2, 'Shift adds face');
  await H.at(base.faceFingerprints[side].center, { ctrlKey: true });
  await H.action('特徵', label);
  const feature = state().doc.features.at(-1);
  check(feature.faces?.length === 1 && feature.faces[0].name === base.faceNames[top], 'multi-selection faces enter feature');
  // Add the same face and one of its actual boundary edges together: no duplicated face or double-cut edge.
  const edge = base.edgeFingerprints.findIndex(edge => edge.type === 'line' && Math.abs(edge.center[1] - 12) < 1e-6);
  check(edge >= 0, 'actual adjacent edge exists');
  store.pickMany([{ kind: 'face', name: base.faceNames[top], fingerprint: base.faceFingerprints[top] }, { kind: 'edge', name: base.edgeNames[edge], fingerprint: base.edgeFingerprints[edge] }]);
  check(state().doc.features.at(-1).faces.length === 1 && state().doc.features.at(-1).edges.length === 1, 'mixed batch preserves faces and deduplicates');
  await H.settle();
  // Picking after starting the tool still toggles a face, independently of explicit edge selection.
  await H.at(center); check(!state().doc.features.at(-1).faces?.length, 'face toggles off while editing');
  await H.at(center); check(state().doc.features.at(-1).faces?.length === 1, 'face toggles back on');
  if (type === 'chamfer') {
    const select = document.querySelector('.property-manager select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'distanceDistance');
    select.dispatchEvent(new Event('change', { bubbles: true })); await H.settle();
    await H.pmInput('距離 1', '2'); await H.pmInput('距離 2', '2');
  }
  await H.pmOk();
  const failed = state().result.features.filter(f => f.status !== 'ok' && f.status !== 'suppressed');
  check(failed.length === 0, JSON.stringify(failed));
  const removed = type === 'fillet' ? (1 - Math.PI / 4) * 4 * 140 - 64 * (5 / 6 - Math.PI / 4) : 2 * 140 - 64 / 6;
  const expected = 14400 - removed, volume = state().result.mass.volume;
  check(Math.abs(volume - expected) < 1e-5, `actual volume ${volume}, expected ${expected}`);
  store.undo(); await H.settle();
  check(!state().doc.features.some(f => f.id === feature.id), 'one undo removes feature');
  check(Math.abs(state().result.mass.volume - 14400) < 1e-6, 'undo restores real solid');
  return { pass: true, type, volume, expected };
}
window.__facePreselection = { fillet: () => run('fillet'), chamfer: () => run('chamfer') };
