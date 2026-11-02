// The snap holds the candidate it is already showing while the cursor stays near it (G04, ADR 0223): a hand tremor no longer flips between two candidates
// that are almost equally near, Ctrl and Esc let go at once, a candidate of a higher class still takes over at once, and a new tool starts clean.
// Measured without the hold: 8 flips in 200 moves between two points 0.15 mm apart, 40 between two parallel lines 0.1 mm apart, 7 between two concentric
// circles — the tie regime this replay works in.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-snap-hold.js?' + Date.now());
//   await __sketchSnapHold.run();

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui, { store } = H;
const check = (ok, message) => { if (!ok) throw new Error(message); };
const flips = (xs) => xs.filter((x, i) => i > 0 && x !== xs[i - 1]).length;
const T = (window.__sketchSnapHold = {});

T.run = async () => {
  H.ready();
  store.newPart();
  if (store.getState().unsaved) await store.answerUnsaved('discard');
  await H.settle();
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(15, 5, 18);
  const options = store.getState().options;
  const metrics = {};
  try {
    // Two lines 0.15 mm apart (2.7 px at 18 px/mm, well inside the 7 px reach), placed with the snaps off so the gap is exactly the tie regime: a
    // tremor of ±0.01 mm decides which line the cursor is nearer, and a drag of ±1 mm along them does not.
    store.setOptions({ automaticRelations: false, snap: { ...options.snap, enabled: false, grid: false } });
    for (const y of [5, 5.15]) {
      await H.tool('直線');
      await H.sk(8, y);
      await H.sk(22, y);
      await H.selectTool();
      await H.solved();
    }
    store.setOptions({ automaticRelations: options.automaticRelations, snap: { ...options.snap, enabled: true, grid: false } });
    await H.solved();
    const lines = [...H.geom()]
      .filter(([, g]) => g.type === 'line' && Math.abs(g.a[1] - g.b[1]) < 1e-6)
      .map(([id, g]) => ({ id, y: g.a[1] }))
      .sort((a, b) => a.y - b.y);
    check(lines.length === 2, `two horizontal lines (got ${lines.length})`);
    const [low, high] = lines;
    const gap = high.y - low.y;
    check(Math.abs(gap - 0.15) < 1e-6, `the lines are 0.15 mm apart (got ${gap})`);
    metrics.gap = gap;
    const mid = (low.y + high.y) / 2;
    const nearLow = mid - 0.01;
    const nearHigh = mid + 0.01;
    const move = async (u, v, extra = {}) => { const c = H.toClient(u, v); H.ptr('pointermove', c.x, c.y, extra); await H.wait(40); };
    /** What the snaps alone would take: the nearer of the two lines (both are curves, so the class order plays no part). */
    const nearerLine = (v) => (Math.abs(v - low.y) <= Math.abs(v - high.y) ? low.id : high.id);
    const shown = () => H.view().snap?.id ?? null;
    const held = () => (H.view().hint || '').includes('保持吸附');

    await H.tool('直線');
    await move(11, nearLow);
    check(H.view().snap?.kind === 'curve' && shown() === low.id, `the nearer line is taken first (${H.view().snap?.kind} ${shown()})`);
    await move(11, nearHigh);
    check(shown() === low.id, `the line already shown is held while the cursor is still near it (${shown()})`);
    check(held(), `the hint says the snap is held: ${H.view().hint}`);

    // The tremor: the cursor crosses the tie 40 times (nearer line alternates), dragging ±1 mm along the lines as a hand does.
    const seen = [];
    const nearest = [];
    for (let i = 0; i < 40; i++) {
      const v = i % 2 === 0 ? nearLow : nearHigh;
      await move(11 + Math.sin(i), v);
      seen.push(shown());
      nearest.push(nearerLine(v));
    }
    metrics.tremorCrossings = flips(nearest);
    metrics.shownChanges = flips(seen);
    check(metrics.tremorCrossings >= 20, `the tremor really crosses the tie (the nearer line changed ${metrics.tremorCrossings} times)`);
    check(metrics.shownChanges === 0, `the shown candidate never changed (it changed ${metrics.shownChanges} times)`);
    check(seen.every((id) => id === low.id), 'it stayed the candidate that was shown when the tremor began');

    // Ctrl: nothing snaps, and the hold ends with it.
    await move(11, nearHigh, { ctrlKey: true });
    check(H.view().snap?.kind === 'free', `Ctrl turns the snaps off (${H.view().snap?.kind})`);
    check(!held(), 'and the hold ends with it');
    await move(11, nearLow);
    await move(11, nearHigh);
    check(shown() === low.id, `after Ctrl a new hold begins from what is nearest (${shown()})`);

    // Esc while a segment is in progress: the hold ends, the tool stays for the next one.
    await H.sk(4, 9);
    await move(11, nearLow);
    await move(11, nearHigh);
    check(shown() === low.id && held(), 'held again while drawing');
    await H.key('Escape');
    await move(11, nearHigh);
    check(H.view().tool === 'line', `Escape ends the segment, not the tool (${H.view().tool})`);
    check(shown() === high.id, `after Escape the nearest one is taken again (${shown()})`);
    check(!held(), 'and nothing is said to be held');

    // A higher class still takes over at once: a midpoint over anywhere on a curve, a point over a midpoint.
    // Leaving the reach of the held line (0.39 mm at 18 px/mm) lets go of it, so walking away and back picks the nearest again.
    await move(11, 4.7);
    check(shown() === low.id, `out of reach of the upper line, the lower one is taken (${shown()})`);
    await move(11, nearLow);
    check(shown() === low.id, `holding the lower line again (${shown()})`);
    await move(15, nearLow); // the middle of that line
    check(H.view().snap?.kind === 'midpoint', `a midpoint takes over from the curve at once (${H.view().snap?.kind})`);
    await move(22, nearLow); // its end
    check(H.view().snap?.kind === 'point', `a point takes over from the midpoint at once (${H.view().snap?.kind})`);

    // A new tool starts with no hold carried over.
    await move(11, nearLow);
    await move(11, nearHigh);
    check(shown() === low.id, 'held before the tool changes');
    await H.tool('圓');
    await move(11, nearHigh);
    check(shown() === high.id, `a new tool starts with no hold (${shown()})`);
    check(!held(), 'and says nothing about holding');

    return { name: 'a snap holds its candidate under a tremor, still hands over by class, and lets go on Ctrl, Esc and a new tool', metrics, pass: true };
  } finally {
    store.setOptions({ automaticRelations: options.automaticRelations, snap: options.snap });
    for (let i = 0; i < 4 && H.view()?.tool !== 'select'; i++) await H.key('Escape');
    store.newPart();
    if (store.getState().unsaved) await store.answerUnsaved('discard');
    await H.settle();
  }
};
