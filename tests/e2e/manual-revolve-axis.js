// Selected rotation axis visibility during Revolve editing (2026-11-28): the chosen axis is drawn over the solid
// and extends past it, updates when switching axes, stays visible when the revolve fails, does not drift 「全部顯示」,
// and disappears along with the absorbed sketch once confirmed. Replayed in the app's page (1280×720). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-revolve-axis.js?' + Date.now());
//   await __manualRevolveAxis.run();

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near } = S;
const M = (window.__manualRevolveAxis = {});

async function capturePixels(viewer) {
  const blob = await viewer.snapshot();
  if (!blob || blob.size === 0) throw new Error('viewer.snapshot() returned empty blob');
  const image = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  image.close();
  return {
    width: canvas.width,
    height: canvas.height,
    data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
  };
}

function isWarmAxisPixel(r, g, b, a) {
  // Theme `--warn` (oklch(53% 0.13 62)) / fallback 0xf08c00: strongly warm orange/amber (R > G > B, R - B large).
  return a > 200 && r > 120 && r - b > 75 && g > b + 35 && r >= g;
}

function hasWarmAxisNear(img, viewer, worldPoint, radiusPx = 10) {
  const rect = H.rect();
  const pt = viewer.screenPoint(worldPoint);
  const scaleX = img.width / rect.width;
  const scaleY = img.height / rect.height;
  const cx = Math.round((pt[0] - rect.left) * scaleX);
  const cy = Math.round((pt[1] - rect.top) * scaleY);
  const rScaled = Math.ceil(radiusPx * Math.max(scaleX, scaleY));
  let hits = 0;
  let sample = null;
  for (let dy = -rScaled; dy <= rScaled; dy++) {
    for (let dx = -rScaled; dx <= rScaled; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const idx = (y * img.width + x) * 4;
      const r = img.data[idx];
      const g = img.data[idx + 1];
      const b = img.data[idx + 2];
      const a = img.data[idx + 3];
      if (dx === 0 && dy === 0) sample = [r, g, b, a];
      if (isWarmAxisPixel(r, g, b, a)) hits++;
    }
  }
  return { hits, cx, cy, sample };
}

M.run = async () => {
  S.steps = [];
  await S.fresh();

  let axis0Id;
  let crossingId;

  await step('1 draw a 20×30 rectangle on front plane with centerline on x=0 and a crossing centerline on x=10, then start Revolve', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(10, 15, 7);

    await H.tool('邊角矩形');
    await H.sk(0, 0, { ctrlKey: true });
    await H.sk(20, 30, { ctrlKey: true });
    await H.key('Escape');
    await H.solved();

    // First centerline along x = 0 (newRevolve picks the first construction line)
    await H.tool('中心線');
    await H.sk(0, -2, { ctrlKey: true });
    await H.sk(0, 32, { ctrlKey: true });
    await H.key('Escape');
    await H.solved();

    // Second centerline along x = 10 (crosses the 0..20 rectangle -> triggers revolve error when selected)
    await H.tool('中心線');
    await H.sk(10, -2, { ctrlKey: true });
    await H.sk(10, 32, { ctrlKey: true });
    await H.key('Escape');
    await H.solved();

    const centerlines = H.sketch().entities.filter((e) => e.type === 'line' && e.construction);
    axis0Id = centerlines[0]?.id;
    crossingId = centerlines[1]?.id;

    const sketchName = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();

    await H.treeClick(sketchName);
    await H.action('特徵', '旋轉填料/基材');
    await S.iso();
    await H.settle();

    const rev = state().doc.features.find((f) => f.type === 'revolve');
    const img = await capturePixels(store.viewer);
    // Interior of cylinder (0, 15, 0) AND protruding outside bottom/top ends (0, -6, 0) & (0, 36, 0)
    const midHit = hasWarmAxisNear(img, store.viewer, [0, 15, 0]);
    const botHit = hasWarmAxisNear(img, store.viewer, [0, -6, 0]);
    const topHit = hasWarmAxisNear(img, store.viewer, [0, 36, 0]);

    return {
      axis: rev?.axis,
      axis0Id,
      crossingId,
      volume: S.volume(),
      midHit,
      botHit,
      topHit,
      pass:
        !!axis0Id &&
        !!crossingId &&
        rev?.axis === axis0Id &&
        near(S.volume(), Math.PI * 20 * 20 * 30, 1e-3) &&
        midHit.hits > 0 &&
        botHit.hits > 0 &&
        topHit.hits > 0,
    };
  });

  await step('2 switching Revolve axis to @axisH moves the emphasized orange axis to y=0 and clears (0, 36, 0)', async () => {
    await H.pmSelect('@axisH', 0);
    await H.wait(120);
    const img = await capturePixels(store.viewer);
    const hExtHit = hasWarmAxisNear(img, store.viewer, [-8, 0, 0]);
    const hMidHit = hasWarmAxisNear(img, store.viewer, [10, 0, 0]);
    const oldTopHit = hasWarmAxisNear(img, store.viewer, [0, 36, 0]);
    return {
      hExtHit,
      hMidHit,
      oldTopHit,
      pass: hExtHit.hits > 0 && hMidHit.hits > 0 && oldTopHit.hits === 0,
    };
  });

  await step('3 selecting a crossing axis (x=10) triggers a revolve error yet still draws the orange axis over the sketch', async () => {
    await H.pmSelect(crossingId, 0);
    await H.wait(120);
    const failed = S.failed();
    const img = await capturePixels(store.viewer);
    const crossMidHit = hasWarmAxisNear(img, store.viewer, [10, 15, 0]);
    const crossExtHit = hasWarmAxisNear(img, store.viewer, [10, -6, 0]);
    return {
      failed,
      crossMidHit,
      crossExtHit,
      pass: failed.length > 0 && crossMidHit.hits > 0 && crossExtHit.hits > 0,
    };
  });

  await step('4 restoring x=0 and invoking 「全部顯示」 twice does not zoom out', async () => {
    await H.pmSelect(axis0Id, 0);
    await H.wait(120);
    await H.hud('全部顯示');
    const px1 = store.viewer.pixelSize();
    await H.hud('全部顯示');
    const px2 = store.viewer.pixelSize();
    const drift = Math.abs(px2 - px1) / px1;
    return { px1, px2, drift, pass: S.failed().length === 0 && drift < 0.02 };
  });

  await step('5 confirming Revolve clears the active axis highlight and hides the absorbed sketch', async () => {
    await H.pmOk();
    await H.wait(120);
    const img = await capturePixels(store.viewer);
    const topAfter = hasWarmAxisNear(img, store.viewer, [0, 36, 0]);
    const midAfter = hasWarmAxisNear(img, store.viewer, [0, 15, 0]);
    const sketchGroup = store.viewer.sketchGroup;
    const sketchShown = !!sketchGroup && sketchGroup.children.length > 0;
    return {
      topAfter,
      midAfter,
      sketchShown,
      editing: state().editing,
      pass: state().editing === null && !sketchShown && topAfter.hits === 0 && midAfter.hits === 0,
    };
  });

  return S.result('manual-revolve-axis');
};
