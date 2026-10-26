// Focused replay of the two context-menu failures: actual submenu, preselection and solved movement.
// await __contextTransform.run();
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store } = S;
window.__contextTransform = { run: async () => {
  S.steps.length = 0;
  let line, before;
  const menu = () => document.querySelector('[data-graphics-menu]');
  const press = async id => {
    const button = menu()?.querySelector(`button[data-action="${id}"]`);
    if (!button || button.disabled) throw new Error(`Unavailable context command: ${id}`);
    button.click();
    await H.wait(150);
  };
  await S.step('1 draw a free slanted line in a real sketch', async () => {
    await S.fresh();
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(15, 10, 8);
    await H.tool('直線');
    await H.sk(5, 5, { ctrlKey: true });
    await H.sk(15, 9, { ctrlKey: true });
    await H.selectTool();
    await H.solved();
    line = H.sketch().entities.find(e => e.type === 'line')?.id;
    before = H.geom().get(line);
    return { pass: !!line && before?.type === 'line' && store.getState().editing?.kind === 'sketch' };
  });
  await S.step('2 right click lists stretch and move; move keeps the clicked line as its target', async () => {
    const [u, v] = H.onEntity(line, 0.5), { x, y } = H.toClient(u, v);
    H.ptr('pointermove', x, y);
    H.canvas().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
    await H.wait(200);
    await press('transform-entities');
    const ids = [...menu().querySelectorAll('button[data-action]')].map(b => b.dataset.action);
    const want = ['tool-stretchEntities', 'tool-moveEntities', 'tool-copyEntities', 'tool-rotateEntities', 'tool-scaleEntities', 'tool-linearPattern', 'tool-circularPattern', 'tool-mirror'];
    const listed = JSON.stringify(ids) === JSON.stringify(want);
    await press('tool-moveEntities');
    return { pass: listed && H.view().tool === 'moveEntities' && JSON.stringify(H.view().picks) === JSON.stringify([line]), ids, tool: H.view().tool, picks: H.view().picks };
  });
  await S.step('3 two pointer clicks translate both solved endpoints by the requested vector', async () => {
    await H.sk(0, -5, { ctrlKey: true });
    await H.sk(7, -2, { ctrlKey: true });
    await H.solved();
    const moved = H.geom().get(line);
    const expected = p => [p[0] + 7, p[1] + 3];
    const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
    return { pass: close(moved.a, expected(before.a)) && close(moved.b, expected(before.b)) && H.view().tool === 'select', moved, status: store.getState().sketchSolve.status };
  });
  const result = S.result('context-transform');
  await S.fresh();
  return result;
} };
