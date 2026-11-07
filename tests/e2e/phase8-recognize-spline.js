// A spline outline made of biarcs (ADR 0243) through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test: the boxes and buttons are
// clicked and the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase8-recognize-spline.js?' + Date.now());
//   const r = await __frs.run();
//
// A new part imports tests/fixtures/step/spline-outline.step (a spline outline 28.72 wide extruded by 20; served on 127.0.0.1:5393 by verify:ui). The box in its panel is off: pressing
// 「辨識特徵」 is refused as before, and the refusal names the box. Then the box is ticked and pressed: the notice says it is approximate, with the bound and what was measured, the features
// are a sketch of arcs and an extrusion, in the real job worker. One undo brings the import back; the box is off again when the panel comes back. Without the sample server the run is left
// out (`skipped`, which is no pass).

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const FRS = (window.__frs = {});

const VOLUME = 17016.96014762222;
const volume = () => store.getState().result.mass.volume;
const failed = () => store.getState().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}: ${f.message}`);
const types = () => store.getState().doc.features.map((f) => f.type);
const box = () => document.querySelector('.property-manager input[data-field="recognizeApproximate"]');
const button = () => document.querySelector('.property-manager button[data-field="recognizeFeatures"]');

const openPanel = async () => {
  store.beginEdit('import1');
  await H.settle();
  await H.waitFor(() => button(), 10000, 'the panel');
};
const press = async () => {
  const was = store.getState().notice;
  button().click();
  await H.waitFor(() => store.getState().notice !== was && /^已辨識|無法|不同|差太多/.test(store.getState().notice?.text ?? ''), 120000, 'the recognition').catch((e) => {
    throw new Error(`${e.message}; the notice says: ${store.getState().notice?.text}`);
  });
  await H.settle();
  return store.getState().notice.text;
};

FRS.run = async (base = globalThis.__samplesOrigin ?? 'http://127.0.0.1:5393/') => {
  let bytes;
  try {
    bytes = new Uint8Array(await (await fetch(base + 'spline-outline.step')).arrayBuffer());
  } catch {
    return { name: 'recognize a spline outline', skipped: 'the sample server is not running' };
  }
  await H.waitFor(() => store.getState().bootMs !== null, 90000, 'kernel boot');
  store.newPart();
  if (store.getState().unsaved) await store.answerUnsaved('discard');
  await H.settle();
  await store.importData('spline-outline.step', bytes);
  await H.settle();
  const imported = { types: types(), volume: volume(), failed: failed() };

  // off by default: refused, and the refusal says what to tick
  await openPanel();
  const offAtFirst = box()?.checked;
  const label = box()?.closest('label')?.textContent;
  const refusal = await press();
  const afterRefusal = types();

  // ticked
  await openPanel();
  box().click();
  await H.settle();
  const ticked = box().checked;
  const notice = await press();
  const doc = store.getState().doc;
  const sketch = doc.features.find((f) => f.type === 'sketch');
  const rebuilt = {
    types: types(),
    volume: volume(),
    failed: failed(),
    arcs: sketch?.entities.filter((e) => e.type === 'arc').length ?? 0,
    splines: sketch?.entities.filter((e) => e.type === 'spline').length ?? 0,
    sketches: store.getState().result.features.filter((f) => f.sketch).map((f) => `${f.sketch.status}/${f.sketch.dof}`),
  };
  // the numbers the notice gives, read back
  const said = notice.match(/誤差上界 ([\d.]+) mm，實測距離 ([\d.]+) mm/);
  const [bound, distance] = said ? [Number(said[1]), Number(said[2])] : [NaN, NaN];

  // one undo is the whole of it; a new look at the panel starts off again
  store.undo();
  await H.settle();
  const undone = { types: types(), volume: volume(), failed: failed() };
  await openPanel();
  const offAgain = box()?.checked;
  store.cancelEdit?.();
  await H.settle();

  const close = (v, to, by) => Math.abs(v - to) <= by;
  return {
    name: 'recognize a spline outline',
    imported,
    offAtFirst,
    label,
    refusal,
    afterRefusal,
    ticked,
    notice,
    rebuilt,
    bound,
    distance,
    undone,
    offAgain,
    pass:
      JSON.stringify(imported.types) === '["importedBody"]' && close(imported.volume, VOLUME, 1e-3) && imported.failed.length === 0 &&
      offAtFirst === false && /樣條輪廓用雙圓弧近似/.test(label ?? '') &&
      /自由曲面/.test(refusal) && /樣條輪廓用雙圓弧近似/.test(refusal) && JSON.stringify(afterRefusal) === '["importedBody"]' &&
      ticked === true &&
      /^已辨識/.test(notice) && /近似/.test(notice) && /不完全相同/.test(notice) &&
      bound > 0 && bound <= 0.01 && distance > 0 && distance <= bound &&
      JSON.stringify(rebuilt.types) === '["sketch","extrude"]' && rebuilt.arcs > 4 && rebuilt.splines === 0 && rebuilt.failed.length === 0 &&
      rebuilt.sketches.every((x) => x === 'fully/0') &&
      // close by what it says, and not the same
      close(rebuilt.volume, VOLUME, bound * 40 * 20) && rebuilt.volume !== VOLUME &&
      JSON.stringify(undone.types) === '["importedBody"]' && close(undone.volume, VOLUME, 1e-3) && undone.failed.length === 0 &&
      offAgain === false,
  };
};
