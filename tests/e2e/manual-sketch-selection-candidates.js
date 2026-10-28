// await __sketchCandidates.run();
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui, { store } = H;
const check = (ok, message) => { if (!ok) throw new Error(message); };
window.__sketchCandidates = { run: async () => {
  H.ready(); await H.action('檔案', '新零件'); await H.treeClick('前基準面'); await H.action('草圖', '草圖');
  await H.frameSketch(15, 10, 18);
  const options = store.getState().options;
  store.setOptions({ automaticRelations: false, snap: { ...options.snap, enabled: false } });
  try {
    for (const [a, b] of [[[10,10],[20,10]], [[10,10],[20,10]], [[10,10.2],[10.3,10.2]]]) {
      await H.tool('直線'); await H.sk(...a); await H.sk(...b); await H.solved(); await H.selectTool();
    }
    const lines = H.sketch().entities.filter(e => e.type === 'line');
    check(lines.length === 3, 'three actual native-solved lines');
    const original = JSON.stringify(H.sketch());
    const at = H.toClient(15, 10); H.ptr('pointermove', at.x, at.y); await H.wait(100);
    check(document.querySelectorAll('[data-sketch-candidate]').length === 2, 'visible candidates for two overlapping lines');
    await H.key('Tab'); check(H.view().hover === lines[1].id, 'Tab previews second overlapping line');
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', shiftKey:true, bubbles:true, cancelable:true}));
    check(H.view().hover === lines[0].id, 'Shift+Tab reverses candidates');
    await H.key('Tab');
    await H.sk(15,10); check(H.view().selection[0] === lines[1].id, 'canvas click commits explicit candidate');
    check(JSON.stringify(H.sketch()) === original, 'selection never modifies geometry');
    const near = H.toClient(10.15,10.2); H.ptr('pointermove', near.x, near.y); await H.wait(100);
    const button = document.querySelector(`[data-sketch-candidate="${lines[2].id}"]`);
    check(button, 'short edge remains available beside endpoints');
    H.canvas().dispatchEvent(new PointerEvent('pointerleave', { clientX: near.x, clientY: near.y, bubbles: true }));
    button.scrollIntoView({ block: 'nearest' }); await H.wait(60);
    const box = button.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
    check(getComputedStyle(button).visibility === 'visible' && box.width > 0 && box.height > 0, 'candidate is visibly rendered');
    check(button.contains(document.elementFromPoint(x, y)), 'candidate is pointer-accessible, not hidden by CSS');
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX:x, clientY:y }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX:x, clientY:y })); await H.wait(100);
    check(H.view().selection[0] === lines[2].id, 'panel chooses the actual short edge');
    await H.key('Delete'); await H.solved(); check(!H.sketch().entities.some(e => e.id === lines[2].id), 'delete applies only to chosen short edge');
    store.undo(); await H.solved(); check(JSON.stringify(H.sketch()) === original, 'one undo restores geometry and constraints');
    const from = H.toClient(20,10), to = H.toClient(22,12);
    H.ptr('pointermove', from.x, from.y); H.ptr('pointerdown', from.x, from.y);
    H.ptr('pointermove', to.x, to.y, {buttons:1}); await H.wait(120);
    await H.key('Escape'); H.ptr('pointerup', to.x, to.y); await H.solved();
    check(JSON.stringify(H.sketch()) === original, 'Escape while dragging never commits on release');
    const restored = store.getState().sketchSolve.geometry.get(lines[0].p2);
    check(Math.abs(restored.p[0]-20)<1e-6 && Math.abs(restored.p[1]-10)<1e-6, 'real Worker restores cancelled preview');
    await H.tool('直線'); await H.sk(25,15); await H.key('Escape');
    check(H.view().tool === 'line', 'first Escape cancels current point only');
    await H.key('Escape'); check(H.view().tool === 'select', 'second Escape returns to selection');
    check(document.querySelector('[data-sketch-tool-status]')?.textContent.includes(H.sketch().name), 'tool status identifies current sketch');
    check(JSON.stringify(H.sketch()) === original, 'cancelled segment adds nothing');
    H.ptr('pointermove', near.x, near.y); await H.wait(100);
    check(document.querySelector(`[data-sketch-candidate="${lines[2].id}"]`), 'final candidate panel visible');
    return { pass: true };
  } finally { store.setOptions({ automaticRelations: options.automaticRelations, snap: options.snap }); }
}};
