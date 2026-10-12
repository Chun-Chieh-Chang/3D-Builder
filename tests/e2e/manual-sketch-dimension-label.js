// Sketch dimension labels can be dragged to any sketch position without changing their numeric value or constraint.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-dimension-label.js?' + Date.now());
//   await __sketchDimensionLabel.run();

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const T = (window.__sketchDimensionLabel = {});

T.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 8);
  await H.tool('邊角矩形');
  await H.sk(-12, -6);
  await H.sk(12, 6);
  await H.solved();

  const bottom = H.lineWhere((g) => Math.abs(g.a[1] - g.b[1]) < 1e-4 && g.a[1] < 0);
  await H.dim([bottom], [0, -12], 24);
  const dimension = H.sketch().constraints.find((c) => c.type === 'distance' && c.a === bottom);
  const label = await H.waitFor(() => document.querySelector(`.overlay-label.dimension`), 5000, 'dimension label');
  const beforeValue = dimension?.value;
  const r = label.getBoundingClientRect();
  const target = H.toClient(18, 16);
  label.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: target.x, clientY: target.y, button: 0, buttons: 1, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: target.x, clientY: target.y, button: 0, buttons: 0, bubbles: true }));
  await H.waitFor(() => {
    const c = H.sketch().constraints.find((x) => x.id === dimension?.id);
    return Array.isArray(c?.labelPosition);
  }, 5000, 'stored dimension label position');

  const after = H.sketch().constraints.find((c) => c.id === dimension?.id);
  const position = after?.labelPosition;
  const fixedPosition = !!position && Math.abs(position[0] - 18) < 0.8 && Math.abs(position[1] - 16) < 0.8;
  const stillDrives = after?.value === beforeValue && store.getState().sketchSolve?.status !== 'failed';
  return { name: 'dragging a sketch dimension stores an arbitrary label position without changing its value', position, beforeValue, afterValue: after?.value, fixedPosition, stillDrives, pass: fixedPosition && stillDrives };
};
