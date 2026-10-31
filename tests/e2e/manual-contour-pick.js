// G10 (P3, 區域式建模入口): the closed regions a boss or cut can be made from are picked on the canvas, as the contour list picks them —
// a rectangle with a round hole and two separate rectangles: 「在畫布選取」 fills every region (the hole stays unfilled), the region under the
// cursor is lit in the list, a click takes only that one, Ctrl adds or takes one away (never none), a click in the hole is no region and
// takes nothing, Esc ends the picking and Esc again cancels the feature; the volume follows each choice, and the choice is in the file.
// Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-contour-pick.js?' + Date.now());   // in a freshly loaded page
//   await __contourPick.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/manual-support.js?` + Date.now());
const { sameContour } = await import(`${root}packages/sketch/src/profiles.ts`);
const { H, store, step } = window.__man;
const P = (window.__contourPick = {});

const state = () => store.getState();
const pm = () => document.querySelector('.property-manager');
const near = (a, b, tol = 1e-3) => a !== null && a !== undefined && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const extrude = () => state().doc.features.find((f) => f.type === 'extrude');
const volume = () => state().result.mass?.volume ?? null;
/** The closed regions of the sketch, as the contour list numbers them (the same order the fills are made in). */
const choices = () => state().contourPick?.choices ?? [];
const picked = () => state().contourPick ?? null;
const featureContours = () => {
  const f = extrude();
  return f && 'contours' in f ? f.contours ?? null : null;
};
/** The indices of the regions that are chosen (null is all of them, as the checkboxes show it). */
const chosenIdx = () => {
  const want = featureContours();
  return choices().flatMap((c, i) => (want === null || want.some((w) => sameContour(w, c.ids)) ? [i] : []));
};
const idxAt = (x, y) => choices().findIndex((c) => Math.hypot(c.center[0] - x, c.center[1] - y) < 1);
const rows = () => [...pm().querySelectorAll('.pm-row[data-contour]')];

/** The sketch plane's frame of the feature being made, and a point of it on the screen (client pixels). */
const frame = () => state().result.frames.get(extrude().sketch);
const at = (u, v) => {
  const r = H.canvas().getBoundingClientRect();
  const p = store.viewer.screenOf(frame(), [u, v]);
  return { x: r.left + p.x, y: r.top + p.y };
};
const clickAt = async (u, v, extra = {}) => {
  await H.clickXY(at(u, v), extra);
  await H.settle();
};
const moveTo = async (u, v) => {
  const p = at(u, v);
  H.ptr('pointermove', p.x, p.y);
  await H.wait(120);
};
/** The picture on the screen, and how many pixels changed in a small square around a point of the sketch plane. */
const picture = async () => {
  const blob = await store.viewer.snapshot();
  if (!blob) throw new Error('no picture of the view');
  const image = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(image, 0, 0);
  image.close();
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
};
const squareAt = (img, u, v, half = 5) => {
  const r = H.canvas().getBoundingClientRect();
  const p = store.viewer.screenOf(frame(), [u, v]);
  const x = Math.round((p.x * img.w) / r.width);
  const y = Math.round((p.y * img.h) / r.height);
  return { x0: x - half, y0: y - half, x1: x + half, y1: y + half };
};
const changed = (a, b, box) => {
  let n = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const i = (y * a.w + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 8) n++;
    }
  }
  return n;
};
/** Looks straight at the sketch, and moves it to the part of the view the PropertyManager does not cover: every region is in plain sight. */
const topView = async () => {
  store.viewer.setView('top');
  await H.wait(200);
  const r = H.rect();
  const p = at(30, 15);
  await H.dragView(r.left + r.width * 0.32 - p.x, r.top + r.height / 2 - p.y, { ctrlKey: true });
};

// the sketch: a 40 × 20 rectangle with a Ø10 hole, and two 10 × 10 rectangles apart from it
const BIG = (800 - 25 * Math.PI) * 10;
const SMALL = 100 * 10;

P.run = async () => {
  let name;
  await step('1 a 40 × 20 rectangle with a Ø10 hole and two 10 × 10 rectangles: the boss of all three is 9214.6 mm3, and the list has three contours', async () => {
    await window.__man.fresh();
    await H.treeClick('上基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(30, 15, 8);
    for (const [a, b, c, d] of [[0, 0, 40, 20], [50, 0, 60, 10], [50, 20, 60, 30]]) {
      await H.tool('邊角矩形');
      await H.sk(a, b);
      await H.sk(c, d);
      await H.solved();
    }
    await H.tool('圓');
    await H.sk(20, 10);
    await H.sk(25, 10);
    await H.solved();
    name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(name);
    await H.action('特徵', '伸長填料/基材');
    await H.pmInput('深度', '10');
    await H.waitFor(() => rows().length === 3, 20000, 'the three contours in the list');
    const listed = rows().map((r) => r.textContent);
    return { pass: near(volume(), BIG + 2 * SMALL) && listed.length === 3 && failed().length === 0, volume: volume(), listed, failed: failed() };
  });

  await step('2 在畫布選取: the regions are filled on the canvas — a real pixel of the big region changes, the middle of its hole does not', async () => {
    await topView();
    const button = window.__man.pmButton('在畫布選取');
    if (!button) throw new Error('no 「在畫布選取」 button');
    button.click();
    await H.waitFor(() => picked() && picked().choices.length === 3, 10000, 'picking');
    // the cursor is off the regions, so no region is lit
    H.ptr('pointerleave', 0, 0);
    await H.wait(120);
    const filled = await picture();
    window.__man.pmButton('結束選取').click();
    await H.waitFor(() => !picked(), 5000, 'picking to end');
    await H.wait(200);
    const bare = await picture();
    const inside = changed(filled, bare, squareAt(filled, 5, 5));
    const inHole = changed(filled, bare, squareAt(filled, 20, 10));
    const small = changed(filled, bare, squareAt(filled, 55, 5));
    return { pass: inside > 50 && small > 50 && inHole <= 2, inside, small, inHole };
  });

  await step('3 the region under the cursor is lit in the list, and the middle of a hole is no region', async () => {
    window.__man.pmButton('在畫布選取').click();
    await H.waitFor(() => picked() !== null, 10000, 'picking');
    await moveTo(5, 5);
    const onBig = state().contourHover;
    const lit = rows().findIndex((r) => r.classList.contains('contour-hover'));
    await moveTo(20, 10); // the hole
    const inHole = state().contourHover;
    const noneLit = rows().every((r) => !r.classList.contains('contour-hover'));
    await moveTo(55, 25);
    const onSmall = state().contourHover;
    return { pass: onBig === idxAt(20, 10) && lit === onBig && inHole === null && noneLit && onSmall === idxAt(55, 25), onBig, lit, inHole, noneLit, onSmall };
  });

  await step('4 a click takes only the region clicked: the volume is the big region alone (7214.6), the list shows only it, no face is picked', async () => {
    await clickAt(5, 5);
    await H.waitFor(() => volume() !== null && near(volume(), BIG), 20000, 'the volume of the big region');
    const chosen = chosenIdx();
    const checked = rows().map((r) => r.querySelector('input').checked);
    return { pass: chosen.length === 1 && chosen[0] === idxAt(20, 10) && checked.filter(Boolean).length === 1 && checked[idxAt(20, 10)] === true && state().selectedFace === null && failed().length === 0, volume: volume(), chosen, checked };
  });

  await step('5 Ctrl-click adds the second region (8214.6); Ctrl-click adds the third, which is all of them, so none is remembered', async () => {
    await clickAt(55, 5, { ctrlKey: true });
    await H.waitFor(() => near(volume(), BIG + SMALL), 20000, 'the volume of two regions');
    const two = chosenIdx();
    await clickAt(55, 25, { ctrlKey: true });
    await H.waitFor(() => near(volume(), BIG + 2 * SMALL), 20000, 'the volume of all three');
    const all = featureContours();
    const checked = rows().every((r) => r.querySelector('input').checked);
    return { pass: two.length === 2 && !two.includes(idxAt(55, 25)) && all === null && checked && failed().length === 0, two, all, checked, volume: volume() };
  });

  await step('6 with all of them chosen, Ctrl-click takes the third one away (8214.6); a plain click in its hole takes nothing', async () => {
    await clickAt(55, 25, { ctrlKey: true });
    await H.waitFor(() => near(volume(), BIG + SMALL), 20000, 'two regions again');
    const two = chosenIdx();
    const before = JSON.stringify(featureContours());
    await clickAt(20, 10); // the hole in the big region: not part of it, and not inside any other
    const after = JSON.stringify(featureContours());
    return { pass: two.length === 2 && !two.includes(idxAt(55, 25)) && before === after && near(volume(), BIG + SMALL), two, before, after };
  });

  await step('7 the list and the canvas are one choice: unchecking the second region there changes the volume here', async () => {
    const row = rows()[idxAt(55, 5)];
    row.querySelector('input').click();
    await H.waitFor(() => near(volume(), BIG), 20000, 'the big region alone again');
    const chosen = chosenIdx();
    return { pass: chosen.length === 1 && chosen[0] === idxAt(20, 10) && !rows()[idxAt(55, 5)].querySelector('input').checked, chosen, volume: volume() };
  });

  await step('8 the view still turns with the middle button while picking, and the picking goes on afterwards', async () => {
    const cube0 = store.viewer.cubeMatrix().join();
    const pic0 = await picture();
    await H.dragView(60, 20);
    const turned = store.viewer.cubeMatrix().join() !== cube0;
    const pic1 = await picture();
    let visible = 0;
    for (let i = 0; i < pic0.data.length; i += 4) {
      if (Math.abs(pic0.data[i] - pic1.data[i]) + Math.abs(pic0.data[i + 1] - pic1.data[i + 1]) + Math.abs(pic0.data[i + 2] - pic1.data[i + 2]) > 8) visible++;
    }
    await topView();
    await moveTo(55, 25);
    const hovered = state().contourHover;
    await clickAt(55, 25, { ctrlKey: true });
    await H.waitFor(() => near(volume(), BIG + SMALL), 20000, 'two regions after the turn');
    return { pass: turned && visible > 2000 && hovered === idxAt(55, 25) && picked() !== null, turned, visible, hovered };
  });

  await step('9 Esc ends the picking and leaves the PropertyManager open; Esc again cancels the boss, so it is not in the document', async () => {
    await H.key('Escape');
    const stopped = picked() === null;
    const stillEditing = state().editing !== null && extrude() !== undefined;
    await H.key('Escape');
    await H.waitFor(() => state().editing === null, 5000, 'the PropertyManager to close');
    await H.settle();
    return { pass: stopped && stillEditing && extrude() === undefined && state().result.bodies.length === 0, stopped, stillEditing, features: state().doc.features.map((f) => f.type), bodies: state().result.bodies.length };
  });

  await step('10 the second region alone is chosen on the canvas, the boss is 1000 mm3, and saved and opened again it is still only that region', async () => {
    await H.treeClick(name);
    await H.action('特徵', '伸長填料/基材');
    await H.pmInput('深度', '10');
    await H.waitFor(() => rows().length === 3, 20000, 'the contour list again');
    await topView();
    window.__man.pmButton('在畫布選取').click();
    await H.waitFor(() => picked() !== null, 10000, 'picking again');
    await clickAt(55, 25);
    await H.waitFor(() => near(volume(), SMALL), 20000, 'the small region alone');
    await window.__man.pmButton('結束選取').click();
    await H.waitFor(() => picked() === null, 5000, 'picking to end');
    const saved = featureContours();
    await H.pmOk();
    const file = await H.saveAs('contours.3dbx');
    const bytes = Uint8Array.from(atob(file), (c) => c.charCodeAt(0));
    window.showOpenFilePicker = async () => [{ name: 'contours.3dbx', kind: 'file', getFile: async () => new File([bytes], 'contours.3dbx') }];
    await H.action('檔案', '開啟舊檔');
    await H.waitFor(() => state().fileName === 'contours.3dbx', 20000, 'the part to open');
    await H.settle();
    const reopened = featureContours();
    const again = state().doc.features.find((f) => f.type === 'extrude');
    return {
      pass: saved?.length === 1 && reopened?.length === 1 && sameContour(reopened[0], saved[0]) && near(volume(), SMALL) && failed().length === 0,
      saved,
      reopened,
      volume: volume(),
      again: again ? again.id : null,
    };
  });

  return window.__man.result('contour-pick');
};