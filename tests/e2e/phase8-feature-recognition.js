// Feature recognition (F2.4, ADR 0239) through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test: the buttons are
// clicked and the store is only read.
//
//   await import('/@fs/<checkout>/tests/e2e/phase8-feature-recognition.js?' + Date.now());
//   const r = await __fr.run();
//
// A new part imports tests/fixtures/step/plate-with-hole.step (40 × 30 × 10, an R4 hole through it; served on 127.0.0.1:5393 by verify:ui), its
// panel is opened for editing, then (after an undo) by a double-click on the tree row, then the tree row's right-click menu is used; 「辨識特徵」 is pressed each time. The import goes, sketches, an extrusion and a hole come, the
// solid is the same; one undo brings the import back. Without the sample server the run is left out (`skipped`, which is no pass).

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const FR = (window.__fr = {});

const PLATE = 40 * 30 * 10 - Math.PI * 4 * 4 * 10;
const volume = () => store.getState().result.mass.volume;
const failed = () => store.getState().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}: ${f.message}`);
const types = () => store.getState().doc.features.map((f) => f.type);
const rows = () => [...document.querySelectorAll('.feature-tree .tree-row')].map((r) => (r.querySelector('.name')?.textContent ?? r.textContent).trim());

FR.run = async (base = globalThis.__samplesOrigin ?? 'http://127.0.0.1:5393/') => {
  let bytes;
  try {
    bytes = new Uint8Array(await (await fetch(base + 'plate-with-hole.step')).arrayBuffer());
  } catch {
    return { name: 'recognize features', skipped: 'the sample server is not running' };
  }
  await H.waitFor(() => store.getState().bootMs !== null, 90000, 'kernel boot');
  store.newPart();
  if (store.getState().unsaved) await store.answerUnsaved('discard');
  await H.settle();
  await store.importData('plate-with-hole.step', bytes);
  await H.settle();
  const imported = { types: types(), volume: volume(), failed: failed() };

  /** Presses 「辨識特徵」 in the import's panel once it is open, and reads what came of it. */
  const press = async (find = () => document.querySelector('.property-manager button[data-field="recognizeFeatures"]')) => {
    const button = find();
    const offered = { found: !!button, label: button?.textContent, disabled: button?.disabled ?? false, editing: store.getState().editing?.featureId ?? null };
    const was = store.getState().notice;
    button?.click();
    await H.waitFor(() => store.getState().notice !== was && /^已辨識|無法|不同|找不到/.test(store.getState().notice?.text ?? ''), 120000, 'the recognition');
    await H.settle();
    const doc = store.getState().doc;
    const hole = doc.features.find((f) => f.type === 'hole');
    return {
      offered,
      notice: store.getState().notice?.text,
      types: types(),
      rows: rows(),
      volume: volume(),
      failed: failed(),
      editing: store.getState().editing,
      blobs: doc.blobs.length,
      hole: hole && { kind: hole.kind, diameter: hole.diameter, end: hole.end.type },
      // every sketch fully defined (ADR 0239 §6): each size is a dimension to change
      sketches: store.getState().result.features.filter((f) => f.sketch).map((f) => `${f.sketch.status}/${f.sketch.dof}`),
    };
  };

  // 1. the panel open for editing (as 「編輯特徵」 opens it, and as phase3-direct-edit.js does): the edit is closed as OK closes it, then the recognition runs
  store.beginEdit('import1');
  await H.settle();
  const editing = await press();
  // one undo is the whole recognition
  store.undo();
  await H.settle();
  const undone = { types: types(), volume: volume(), failed: failed(), blobs: store.getState().doc.blobs.length };
  // 2. the panel a double-click on the tree row shows
  const row = [...document.querySelectorAll('.feature-tree .tree-row')].find((r) => /輸入1/.test(r.textContent));
  row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await H.settle();
  const shown = await press();
  store.undo();
  await H.settle();
  // 3. the tree's right-click menu
  const row3 = [...document.querySelectorAll('.feature-tree .tree-row')].find((r) => /輸入1/.test(r.textContent));
  const box = row3?.getBoundingClientRect();
  row3?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: (box?.left ?? 0) + 20, clientY: (box?.top ?? 0) + 5 }));
  await H.wait(150);
  const menu = await press(() => document.querySelector('li[data-action="recognize-features"]'));
  store.undo();
  await H.settle();
  // the menu of a feature that is not an imported body does not offer it
  store.redo();
  await H.settle();
  const other = [...document.querySelectorAll('.feature-tree .tree-row')].find((r) => /伸長1/.test(r.textContent));
  other?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }));
  await H.wait(150);
  const offeredOnExtrude = !!document.querySelector('li[data-action="recognize-features"]');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await H.wait(100);
  store.undo();
  await H.settle();
  store.redo();
  await H.settle();
  const redone = { types: types(), volume: volume() };

  const same = (v) => Math.abs(v - PLATE) / PLATE < 1e-6;
  const good = (r) =>
    r.offered.found && r.offered.disabled === false && r.offered.label === '辨識特徵' &&
    /^已辨識/.test(r.notice ?? '') && !r.types.includes('importedBody') && r.types.includes('extrude') && r.types.includes('hole') &&
    r.hole?.kind === 'straight' && r.hole.diameter === '8' && r.hole.end === 'throughAll' &&
    r.failed.length === 0 && r.sketches.length === 2 && r.sketches.every((x) => x === 'fully/0') && r.editing === null && r.blobs === 0 && same(r.volume) && r.rows.some((x) => /孔1/.test(x));
  return {
    name: 'recognize features',
    imported,
    editing,
    undone,
    shown,
    menu,
    offeredOnExtrude,
    redone,
    pass:
      JSON.stringify(imported.types) === '["importedBody"]' && same(imported.volume) &&
      editing.offered.editing === 'import1' && good(editing) &&
      JSON.stringify(undone.types) === '["importedBody"]' && undone.blobs === 1 && undone.failed.length === 0 && same(undone.volume) &&
      good(shown) &&
      good(menu) && offeredOnExtrude === false &&
      JSON.stringify(redone.types) === JSON.stringify(shown.types) && same(redone.volume),
  };
};
