// Imported engineering drawings: real DXF -> editable 2D entities -> save/reopen -> editable DXF.
// Runs via npm run verify:ui -- --only manual-drawing-cad
//   await __manualDrawingCad.run();
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const { cadScene, toDxf, readDxf } = await import(`${root}packages/drawing/src/index.ts`);
const H = window.__ui2;
const { store } = H;
const M = window.__manualDrawingCad = {};
const wait = () => H.wait(120);
const input = async (el, value) => {
  if (!el) throw new Error('missing editor control');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  await wait();
};
M.run = async () => {
  H.ready();
  const steps = [];
  const step = async (name, fn) => {
    try { await fn(); steps.push({ name, pass: true }); }
    catch (e) { steps.push({ name, pass: false, error: String(e.message ?? e) }); }
    await window.__shot?.(name);
  };
  const source = toDxf({ width: 180, height: 100, items: [
    { kind: 'polyline', style: 'visible', points: [20, 20, 140, 20, 140, 70], color: '#DC2626' },
    { kind: 'text', at: [25, 55], text: '匯入工程圖 Ø12', height: 4, color: '#2563EB' },
    { kind: 'polyline', style: 'dimension', points: [20, 20, 20, 35, 140, 35, 140, 20], group: 'd1' },
    { kind: 'text', at: [80, 37], text: '120', height: 3.5, group: 'd1' },
  ], dimensions: [{ id: 'd1', text: '120', textAt: [80, 37], geometry: { kind: 'linear', a: [20, 20], b: [140, 20], line: [20, 35], rotation: 0 } }] });
  await H.project({});
  await H.writeAt('import.dxf', new TextEncoder().encode(source));
  await step('import real DXF as an editable drawing', async () => {
    H.next.open = 'import.dxf';
    await H.action('檔案', '匯入 DWG／DXF 工程圖…');
    await H.waitFor(() => document.querySelector('[data-cad-canvas]'), 10000, 'CAD editor');
    H.check(store.getState().drw.doc.pages[0].cad.entities.length === 3, 'three editable objects, not an image');
    H.check(document.querySelector('[data-cad-canvas] text')?.textContent.includes('匯入工程圖'), 'Chinese drawn');
    H.check(document.querySelector('[data-action="exportDwg"]').disabled, 'browser explains desktop-only DWG conversion');
  });
  await step('select and edit Chinese text and exact RGB with DOM controls', async () => {
    const text = [...document.querySelectorAll('[data-cad-canvas] text')].find((n) => n.textContent.includes('匯入工程圖'));
    text.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: text.getBoundingClientRect().x, clientY: text.getBoundingClientRect().y }));
    text.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0 }));
    await wait();
    const id = store.getState().drw.doc.pages[0].cad.entities.find((e) => e.kind === 'text').id;
    await input(document.querySelector('[data-field="cadEntity"]'), id);
    await input(document.querySelector('[data-field="cadText"]'), '修改工程圖 Ø16');
    document.querySelector('[data-action="cadApplyText"]').click(); await wait();
    await input(document.querySelector('[data-field="cadColor"]'), '#12ab34');
    const e = store.getState().drw.doc.pages[0].cad.entities.find((e) => e.id === id);
    H.check(e.text === '修改工程圖 Ø16' && e.color.toLowerCase() === '#12ab34', 'text/color saved in model');
    H.check([...document.querySelectorAll('[data-cad-canvas] text')].some((n) => n.textContent === e.text), 'edited label drawn');
  });
  await step('edit actual line vertices, undo and redo', async () => {
    const e = store.getState().drw.doc.pages[0].cad.entities.find((e) => e.kind === 'polyline');
    await input(document.querySelector('[data-field="cadEntity"]'), e.id);
    await input(document.querySelector('[data-field="cadPoints"]'), '40, 30\n150, 30\n150, 80');
    document.querySelector('[data-action="cadApplyPoints"]').click(); await wait();
    H.check(store.getState().drw.doc.pages[0].cad.entities.find((i) => i.id === e.id).points[0] === 40, 'geometry changed');
    store.drawingStore.undo(); await wait();
    H.check(store.getState().drw.doc.pages[0].cad.entities.find((i) => i.id === e.id).points[0] !== 40, 'undo restores geometry');
    store.drawingStore.redo(); await wait();
    H.check(store.getState().drw.doc.pages[0].cad.entities.find((i) => i.id === e.id).points[0] === 40, 'redo restores edit');
  });
  await step('native dimensions and edited colors survive .3dbd save/reopen and DXF export', async () => {
    await H.save('edited-cad.3dbd');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.waitFor(() => store.getState().drw?.fileName === 'edited-cad.3dbd' && !store.getState().drw.dirty, 10000, 'drawing save');
    await H.action('檔案', '新零件');
    await H.waitFor(() => store.getState().active === 'part', 10000, 'leaving saved drawing');
    await H.open('edited-cad.3dbd');
    const cad = store.getState().drw.doc.pages[0].cad;
    H.check(cad.entities.some((e) => e.kind === 'dimension' && e.text === '120'), 'dimension remains editable');
    const back = readDxf(toDxf(store.drawingStore.scene().scene));
    H.check(back.entities.some((e) => e.type === 'DIMENSION'), 'dimension remains a CAD dimension');
    H.check(back.entities.some((e) => e.type === 'TEXT' && e.text === '修改工程圖 Ø16' && e.pairs.some(([c, v]) => c === 420 && Number(v) === 0x12ab34)), 'text and exact RGB survive');
  });
  await step('dragging uses screen coordinates and keeps geometry inside the expanded canvas', async () => {
    const cad = store.getState().drw.doc.pages[0].cad;
    const entity = cad.entities.find((e) => e.kind === 'polyline');
    const scene = cadScene(cad);
    const drawn = scene.items.find((e) => e.owner === entity.id);
    const svg = document.querySelector('[data-cad-canvas] svg');
    const x = (drawn.points[0] + drawn.points[2]) / 2, y = (drawn.points[1] + drawn.points[3]) / 2;
    const a = new DOMPoint(x, scene.height - y).matrixTransform(svg.getScreenCTM());
    const b = new DOMPoint(x + 5, scene.height - y - 6).matrixTransform(svg.getScreenCTM());
    const target = document.querySelector(`[data-cad-id="${entity.id}"] polyline`);
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2, clientX: a.x, clientY: a.y })); await wait();
    svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 2, clientX: b.x, clientY: b.y })); await wait();
    svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 2, clientX: b.x, clientY: b.y })); await wait();
    const after = store.getState().drw.doc.pages[0].cad.entities.find((e) => e.id === entity.id);
    H.check(Math.abs(after.points[0] - entity.points[0] - 5) < 1e-8 && Math.abs(after.points[1] - entity.points[1] - 6) < 1e-8, 'drag changed actual coordinates by 5, 6 mm');
    const expanded = cadScene(store.getState().drw.doc.pages[0].cad);
    const visible = expanded.items.find((e) => e.owner === entity.id);
    H.check(visible.points.every((v, i) => v >= 0 && v <= (i % 2 ? expanded.height : expanded.width)), 'edited geometry is not clipped');
    store.drawingStore.undo(); await wait();
  });
  return { name: 'editable imported CAD drawing', steps, pass: steps.every((s) => s.pass) };
};
