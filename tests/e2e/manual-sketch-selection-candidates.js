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
    const statusText = document.querySelector('[data-sketch-tool-status]')?.textContent ?? '';
    check(statusText.includes(H.sketch().name) && statusText.includes('前基準面'), 'tool status identifies current sketch and work plane');
    check(JSON.stringify(H.sketch()) === original, 'cancelled segment adds nothing');
    H.ptr('pointermove', near.x, near.y); await H.wait(100);
    check(document.querySelector(`[data-sketch-candidate="${lines[2].id}"]`), 'final candidate panel visible');

    // A04 / A05 / E03: 3 zoom levels (25%, 100%, 400%) x 2 DPRs (1, 2) + right-click candidate/multi-selection preservation
    for (const dpr of [1, 2]) {
      await window.__setDpr?.(dpr);
      await H.wait(80);
      for (const pxmm of [4.5, 18, 72]) {
        await H.frameSketch(15, 10, pxmm);
        await H.key('Escape');
        await H.key('Escape');
        const pt = H.toClient(15, 10);
        H.ptr('pointermove', pt.x, pt.y);
        await H.wait(80);
        check(document.querySelectorAll('[data-sketch-candidate]').length === 2, `2 overlapping candidates at dpr=${dpr} pxmm=${pxmm}`);
        await H.key('Tab');
        check(H.view().hover === lines[1].id, `Tab selects second candidate at dpr=${dpr} pxmm=${pxmm}`);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        await H.wait(40);
        check(H.view().hover === lines[0].id, `Shift+Tab selects first candidate at dpr=${dpr} pxmm=${pxmm}`);
        await H.key('Tab');
        await H.sk(15, 10);
        check(H.view().selection[0] === lines[1].id, `left click commits candidate at dpr=${dpr} pxmm=${pxmm}`);
        await H.key('Escape');
        await H.key('Escape');
        H.ptr('pointermove', pt.x, pt.y);
        await H.wait(60);
        await H.key('Tab');
        check(H.view().hover === lines[1].id, `Tab locks second candidate before right-click at dpr=${dpr} pxmm=${pxmm}`);
        H.canvas().dispatchEvent(new MouseEvent('contextmenu', { clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true }));
        await H.wait(60);
        check(H.view().selection[0] === lines[1].id, `right-click preserves locked Tab candidate at dpr=${dpr} pxmm=${pxmm}`);
        window.dispatchEvent(new MouseEvent('mousedown', { clientX: 5, clientY: 5, bubbles: true }));
        await H.wait(40);
      }
    }
    await window.__setDpr?.(1);
    await H.frameSketch(15, 10, 18);
    await H.key('Escape');
    await H.key('Escape');
    // Right-click preserves existing multi-selection even near shared endpoint
    store.sketcher.select([lines[0].id, lines[2].id]);
    const endPt = H.toClient(10, 10);
    H.ptr('pointermove', endPt.x, endPt.y);
    await H.wait(60);
    H.canvas().dispatchEvent(new MouseEvent('contextmenu', { clientX: endPt.x, clientY: endPt.y, bubbles: true, cancelable: true }));
    await H.wait(60);
    check(
      H.view().selection.length === 2 && H.view().selection.includes(lines[0].id) && H.view().selection.includes(lines[2].id),
      'right-click preserves multi-selection near endpoint',
    );
    window.dispatchEvent(new MouseEvent('mousedown', { clientX: 5, clientY: 5, bubbles: true }));
    await H.wait(40);
    await H.key('Escape');
    await H.key('Escape');

    // A02 / B04: Dimension modify-box IME Enter/Escape guard + normal Escape cancel
    await H.tool('智慧型尺寸');
    await H.sk(15, 10);
    await H.sk(15, 6);
    const dimInput = await H.waitFor(() => document.querySelector('.modify-box input'), 5000, 'Modify box for IME/Escape check');
    dimInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true, cancelable: true }));
    dimInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, keyCode: 229, bubbles: true, cancelable: true }));
    await H.wait(80);
    check(!!document.querySelector('.modify-box input') && !!store.editedSketch(), 'IME composition Enter/Escape never closes modify box or exits sketch');
    dimInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await H.waitFor(() => !document.querySelector('.modify-box'), 5000, 'Modify box closes on normal Escape');
    check(!!store.editedSketch(), 'normal Escape in modify box stays in sketch');
    await H.selectTool();
    store.undo();
    await H.solved();
    check(JSON.stringify(H.sketch()) === original, 'undo after cancelled dimension restores original sketch');

    // E02: 100 and 1000 entity browser Worker solve + DOF diagnosis + pointer move p50/p95
    await H.exitSketch();
    const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    const round3 = (n) => Math.round(n * 1000) / 1000;
    const metrics = {};
    for (const count of [100, 1000]) {
      const circles = count / 2;
      const cols = Math.ceil(Math.sqrt(circles));
      store.newPart();
      if (store.getState().unsaved) await store.answerUnsaved('discard');
      await H.settle();
      await H.treeClick('前基準面');
      await H.action('草圖', '草圖');
      const entities = [];
      for (let i = 0; i < circles; i++) {
        const x = (i % cols) * 12;
        const y = Math.floor(i / cols) * 12;
        entities.push({ id: `p${i}`, type: 'point', x, y });
        entities.push({ id: `c${i}`, type: 'circle', center: `p${i}`, radius: 3 });
      }
      const added = store.execute({ type: 'addSketchItems', featureId: H.sketch().id, entities, constraints: [] });
      check(added, `addSketchItems for ${count} entities`);
      await H.solved();
      await H.frameSketch((cols * 12) / 2, (cols * 12) / 2, 4);
      const tSolve0 = performance.now();
      const updated = store.execute({
        type: 'setSketchGeometry',
        featureId: H.sketch().id,
        points: [],
        radii: [{ id: 'c0', radius: 3.1 }],
      });
      check(updated, `setSketchGeometry for ${count} entities`);
      await H.waitFor(
        () => {
          const sv = store.getState().sketchSolve;
          return Math.abs((sv?.geometry?.get('c0')?.r ?? 0) - 3.1) < 1e-6 && sv?.entityFreedom?.size === count && sv?.status === 'under';
        },
        15000,
        `${count} entity solve + DOF diagnosis`,
      );
      const workerRoundTripMs = round3(performance.now() - tSolve0);
      const measureTool = async (tool, snapEnabled) => {
        store.setOptions({ automaticRelations: false, snap: { ...options.snap, enabled: snapEnabled } });
        if (tool === 'select') await H.selectTool();
        else await H.tool('直線');
        const samples = [];
        for (let i = 0; i < 60; i++) {
          const idx = (i * 7) % circles;
          const u = (idx % cols) * 12 + 3 * Math.cos(i * 0.3);
          const v = Math.floor(idx / cols) * 12 + 3 * Math.sin(i * 0.3);
          const c = H.toClient(u, v);
          const t0 = performance.now();
          H.ptr('pointermove', c.x, c.y);
          samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        return { p50: round3(quantile(samples, 0.5)), p95: round3(quantile(samples, 0.95)), max: round3(samples.at(-1) ?? 0) };
      };
      const selectLat = await measureTool('select', false);
      const lineSnapLat = await measureTool('line', true);
      await H.selectTool();
      check(selectLat.p95 <= 8, `${count} entities browser select p95 <= 8ms (got ${selectLat.p95}ms)`);
      check(lineSnapLat.p95 <= 8, `${count} entities browser line snap p95 <= 8ms (got ${lineSnapLat.p95}ms)`);
      metrics[`entities_${count}`] = { workerRoundTripMs, select: selectLat, lineSnap: lineSnapLat };
      await H.exitSketch();
    }
    store.newPart();
    if (store.getState().unsaved) await store.answerUnsaved('discard');
    await H.settle();
    return { pass: true, metrics };
  } finally {
    await window.__setDpr?.(1);
    store.setOptions({ automaticRelations: options.automaticRelations, snap: options.snap });
  }
}};
