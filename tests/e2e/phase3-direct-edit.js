// Phase 3a-2 (C10.1, C10.2, F2.2): direct editing through the UI, in the app's page (http://127.0.0.1:5391, 1280×720).
// Not a Vitest test. Like the other scripts here, every step is a click or a typed value; the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-direct-edit.js?' + Date.now());
//   const r = await __d3.all();   // [{ name, pass, ... }]
//
// 「刪除面」 takes the R2 fillet off the demo block; 「移動面」 pushes its end face by 3 mm; the imported-body panel
// shows the diagnostics and sews a file that only has surfaces (needs the two samples served on 127.0.0.1:5393 by a
// read-only static server: faces-only.step and gapped.step, made by tests/support/stepSamples.ts; without it that
// step is left out).

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const D3 = (window.__d3 = {});

/** A point on a face of the model on screen: the middle of one of its triangles (always on the surface). */
H.facePoint = (name) => {
  const r = store.getState().result;
  const i = r.faceNames.indexOf(name);
  if (i < 0) throw new Error(`no face ${name} on screen`);
  const m = r.mesh;
  for (let k = 0; k < m.faceRanges.length; k += 3) {
    if (m.faceRanges[k + 2] !== i) continue;
    const s = m.faceRanges[k] + 3 * Math.floor(m.faceRanges[k + 1] / 3 / 2);
    return [0, 1, 2].map((c) => [m.indices[s], m.indices[s + 1], m.indices[s + 2]].reduce((a, v) => a + m.positions[v * 3 + c], 0) / 3);
  }
  throw new Error(`face ${name} has no triangles`);
};
const volume = () => store.getState().result.mass.volume;
const failed = () => store.getState().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed');

async function freshDemo() {
  await H.waitFor(() => store.getState().bootMs !== null, 90000, 'kernel boot');
  store.newDemo();
  if (store.getState().unsaved) await store.answerUnsaved('discard'); // the part of the last flow is not saved
  await H.settle();
  H.tab('特徵');
  await H.wait(100);
}

/** The steps of taking the fillet off the demo block (the page shows the demo block). */
async function takeFilletOff() {
  const before = { faces: store.getState().result.faceNames.length, volume: volume() };
  const fillet = store.getState().result.faceNames.find((n) => n.startsWith('fillet1'));
  H.btn('刪除面');
  await H.settle();
  const hint = document.querySelector('.pick-hint')?.innerText;
  await H.at(H.facePoint(fillet)); // the model before the feature is on screen while it is edited
  const listed = [...document.querySelectorAll('.property-manager .selection-box li code')].map((c) => c.textContent);
  await H.pmOk();
  const after = { faces: store.getState().result.faceNames.length, volume: volume(), failed: failed().map((f) => f.id) };
  const square = 20 * 10 * 5; // the block the fillet was cut from
  return { name: 'delete the fillet', hint, listed, before, after, pass: listed[0] === fillet && after.faces === 6 && Math.abs(after.volume - square) < 1e-6 && after.failed.length === 0 };
}

D3.deleteFillet = async () => {
  await freshDemo();
  return takeFilletOff();
};

/** A face with a fillet beside it cannot be moved (see below): the fillet goes first, as the message says. */
D3.moveFace = async () => {
  await freshDemo();
  if (!(await takeFilletOff()).pass) throw new Error('the fillet could not be taken off');
  const end = 'extrude1:side:sketch1.l2';
  const v0 = volume();
  H.btn('移動面');
  await H.settle();
  await H.at(H.facePoint(end));
  const picked = store.getState().doc.features.find((f) => f.type === 'moveFace')?.face.name;
  await H.pmInput('距離', '3');
  await H.pmOk();
  const after = { volume: volume(), failed: failed().map((f) => f.id), faces: store.getState().result.faceNames.length };
  // the end face of the fillet-less block is 10 × 5: three millimetres more length is 150 mm³ (less what the fillet had left of it)
  return { name: 'move a face', picked, v0, after, pass: picked === end && after.failed.length === 0 && Math.abs(after.volume - v0 - 3 * 5 * 10) < 1e-6 };
};

/** The face the fillet is on is tangent to the fillet: refused with a reason, and the way out is to delete the fillet first. */
D3.refuseNextToFillet = async () => {
  await freshDemo();
  const top = 'extrude1:cap:end';
  H.btn('移動面');
  await H.settle();
  await H.at(H.facePoint(top));
  await H.pmOk();
  const f = store.getState().result.features.find((x) => x.id.startsWith('moveface'));
  return { name: 'refuse a face with a fillet beside it', status: f?.status, message: f?.message, pass: f?.status === 'error' && /相切/.test(f.message) };
};

D3.importRepair = async (base = globalThis.__samplesOrigin ?? 'http://127.0.0.1:5393/') => {
  let facesOnly;
  let gapped;
  try {
    facesOnly = new Uint8Array(await (await fetch(base + 'faces-only.step')).arrayBuffer());
    gapped = new Uint8Array(await (await fetch(base + 'gapped.step')).arrayBuffer());
  } catch {
    return { name: 'import repair', skipped: 'the sample server is not running', pass: true };
  }
  await freshDemo();
  store.newPart();
  if (store.getState().unsaved) await store.answerUnsaved('discard');
  await H.settle();
  await store.importData('faces-only.step', facesOnly);
  await H.settle();
  const sewn = store.getState().result.features.find((f) => f.id === 'import1');
  await store.importData('gapped.step', gapped);
  await H.settle();
  const refused = store.getState().result.features.find((f) => f.id === 'import2');
  store.beginEdit('import2');
  await H.settle();
  await H.pmInput('縫合容差', '0.1');
  const closed = store.getState().result.features.find((f) => f.id === 'import2');
  const report = document.querySelector('.property-manager')?.innerText ?? '';
  await H.pmOk();
  return {
    name: 'import repair',
    sewn: sewn?.diagnostics,
    refused: refused?.message,
    closed: closed?.diagnostics,
    pass: sewn?.status === 'ok' && sewn.diagnostics.sewn === true && refused?.status === 'error' && /加大縫合容差/.test(refused.message) && closed?.status === 'ok' && closed.diagnostics.sewTolerance === 0.1 && /診斷報告/.test(report),
  };
};

D3.all = async () => [await D3.deleteFillet(), await D3.moveFace(), await D3.refuseNextToFillet(), await D3.importRepair()];
