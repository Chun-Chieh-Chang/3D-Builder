// The dimension preview says what it will measure before the click (G14, ADR 0223): the entities, 「圓心」 where a circle is measured from its centre
// rather than from its edge, and which sector of an angle it is in — two of the four sectors show the same value (vertical angles) but make different
// constraints, so the value alone cannot tell them apart.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-dimension-preview.js?' + Date.now());
//   await __dimensionPreview.run();

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui, { store } = H;
const check = (ok, message) => { if (!ok) throw new Error(message); };
const T = (window.__dimensionPreview = {});

T.run = async () => {
  H.ready();
  store.newPart();
  if (store.getState().unsaved) await store.answerUnsaved('discard');
  await H.settle();
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(6, 5, 14);
  const options = store.getState().options;
  const metrics = {};
  try {
    // Exact geometry, placed with the snaps off so the angle is the 60° it is meant to be.
    store.setOptions({ automaticRelations: false, snap: { ...options.snap, enabled: false, grid: false } });
    await H.tool('直線');
    await H.sk(0, 0);
    await H.sk(20, 0);
    await H.selectTool();
    await H.solved();
    const up = 10 * Math.sqrt(3); // exactly 60° above +x: 17.3205…, not 17.32, which the label would show as 59.9993°
    await H.tool('直線');
    await H.sk(0, 0);
    await H.sk(10, up);
    await H.selectTool();
    await H.solved();
    await H.tool('圓');
    await H.sk(10, 5);
    await H.sk(13, 5);
    await H.selectTool();
    await H.solved();

    const label = () => document.querySelector('.overlay-label.dimension.preview')?.textContent ?? '';
    const move = async (u, v) => { const c = H.toClient(u, v); H.ptr('pointermove', c.x, c.y); await H.wait(60); };

    // The angle: picked, then placed in one sector after another. The value is 60° or 120°, and the sector number says which of the two 60° ones it is.
    const valueOf = (text) => Number.parseFloat(/^\s*(-?[\d.]+)/.exec(text)?.[1] ?? 'NaN');
    await H.tool('智慧型尺寸');
    await H.sk(10, 0); // the line along +x
    await H.sk(2.5, (2.5 * up) / 10); // on the 60° line, and far from its end
    await move(6, 2);
    metrics.sector1 = label();
    check(Math.abs(valueOf(metrics.sector1) - 60) < 5e-3 && metrics.sector1.includes('第 1 象限'), `first sector: ${metrics.sector1}`);
    await move(-3, 3);
    metrics.sector2 = label();
    check(Math.abs(valueOf(metrics.sector2) - 120) < 5e-3 && metrics.sector2.includes('第 2 象限'), `second sector: ${metrics.sector2}`);
    await move(-6, -2);
    metrics.sector3 = label();
    check(Math.abs(valueOf(metrics.sector3) - 60) < 5e-3 && metrics.sector3.includes('第 3 象限'), `third sector: ${metrics.sector3}`);
    // the two 60° sectors are told apart by the number beside them, which the value alone cannot do
    check(metrics.sector1 !== metrics.sector3, `the two 60° sectors read differently (${metrics.sector1} / ${metrics.sector3})`);

    // What the label says is what the click makes: the third sector stores the vertical angle (both rays reversed), which is a different constraint
    // from the first sector's 60° even though the number is the same.
    await H.sk(-6, -2);
    const input = await H.waitFor(() => document.querySelector('.modify-box input'), 5000, 'Modify box for the angle');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await H.waitFor(() => !document.querySelector('.modify-box'), 5000, 'Modify box to close');
    await H.solved();
    const angle = H.sketch().constraints.find((c) => c.type === 'angle');
    metrics.angle = angle && { value: angle.value, flip: angle.flip ?? null };
    check(angle && Math.abs(Number(angle.value) - 60) < 5e-3, `the stored angle is the 60° the preview showed: ${JSON.stringify(angle)}`);
    check(angle.flip === 'both', `and it is the vertical one, as the third sector said: ${JSON.stringify(angle)}`);

    // A circle is measured from its centre, and the label says so: 5 mm from the centre to the line, 2 mm from the near edge.
    await H.tool('智慧型尺寸');
    await H.sk(13, 5); // the circle, on its rim
    await H.sk(10, 0); // the line along +x
    await move(10, -6);
    metrics.distance = label();
    const value = valueOf(metrics.distance);
    // 5 mm from the centre; from the near edge it would be 2 mm, which is what the label must not say
    check(Math.abs(value - 5) < 5e-3, `the distance is from the centre: ${metrics.distance}`);
    check(metrics.distance.includes('圓心'), `and the label says so: ${metrics.distance}`);
    check(!metrics.distance.includes('2 ·'), `not from the near edge: ${metrics.distance}`);

    return { name: 'the dimension preview names what it measures, including the sector of an angle and a circle measured from its centre', metrics, pass: true };
  } finally {
    store.setOptions({ automaticRelations: options.automaticRelations, snap: options.snap });
    for (let i = 0; i < 4 && H.view()?.tool !== 'select'; i++) await H.key('Escape');
    store.newPart();
    if (store.getState().unsaved) await store.answerUnsaved('discard');
    await H.settle();
  }
};
