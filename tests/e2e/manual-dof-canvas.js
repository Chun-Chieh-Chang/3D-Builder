// G13 (P4, 診斷、關係與參照): the solver's own answers on the canvas. A line pinned to the origin that can only slide, and one that can
// only turn: running the analysis for a selected point draws the feasible motions it probed (one arrow per axis, from the solver's actual
// displacement, never guessed from a colour) beside the point. A fix of an over-defined sketch — two dimensions that disagree — is previewed
// before it is applied: the geometry that would move is dashed on the canvas (a fix that moves nothing says so), and applying it lands exactly
// on the preview, one Undo back. Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-dof-canvas.js?' + Date.now());   // in a freshly loaded page
//   await __dofCanvas.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/manual-support.js?` + Date.now());
const { H, store, step } = window.__man;
const P = (window.__dofCanvas = {});

const state = () => store.getState();
const solve = () => state().sketchSolve;
const lineAt = (x0, y0, x1, y1) => {
  const near = (g) => {
    const d = (a, b) => Math.hypot(g[a][0] - b[0], g[a][1] - b[1]);
    return Math.min(d('a', [x0, y0]) + d('b', [x1, y1]), d('a', [x1, y1]) + d('b', [x0, y0])) < 0.5;
  };
  try {
    return H.lineWhere(near);
  } catch (e) {
    const lines = [...H.geom()].filter(([, g]) => g.type === 'line').map(([id, g]) => `${id}:(${g.a[0].toFixed(2)},${g.a[1].toFixed(2)})-(${g.b[0].toFixed(2)},${g.b[1].toFixed(2)})`);
    const cons = H.sketch().constraints.map((c) => `${c.type}(${JSON.stringify({ a: c.a, b: c.b, point: c.point, line: c.line, value: c.value })})`);
    throw new Error(`no line near (${x0},${y0})-(${x1},${y1}); have ${lines.join(' ')}; constraints: ${cons.join(' | ')}`);
  }
};
/** The analysis button of the selected point, and the motion rows it produces. */
const analysisButton = () => document.querySelector('.constraint-analysis button');
const motionRows = () => [...document.querySelectorAll('.constraint-analysis ul li')].map((li) => li.textContent);
const motionLabels = () => [...document.querySelectorAll('.overlay-label.motion')].map((el) => el.textContent);
/** The rows of the diagnosis box, each with its 套用 button. */
const fixRows = () => {
  const head = [...document.querySelectorAll('.pm-group h4')].find((h) => h.textContent.includes('診斷'));
  return head ? [...head.closest('.pm-group').querySelectorAll('.relation-list li')] : [];
};

// ---------------------------------------------------------------- the picture
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
/** How many pixels of the box (in sketch-plane mm) differ between two pictures. */
const changed = (a, b, u0, v0, u1, v1) => {
  const r = H.canvas().getBoundingClientRect();
  const corner = (u, v) => {
    const p = store.viewer.screenOf(H.frame(), [u, v]);
    return [Math.round((p.x * a.w) / r.width), Math.round((p.y * a.h) / r.height)];
  };
  const [x0, y0] = corner(u0, v0);
  const [x1, y1] = corner(u1, v1);
  let n = 0;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      const i = (y * a.w + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 8) n++;
    }
  }
  return n;
};
/** Looks straight at the sketch and puts it in the part of the view the PropertyManager does not cover. */
const topView = async () => {
  store.viewer.setView('top');
  await H.wait(200);
  const r = H.rect();
  const p = store.viewer.screenOf(H.frame(), [15, 10]);
  await H.dragView(r.left + r.width * 0.3 - p.x, r.top + r.height / 2 - p.y, { ctrlKey: true });
};
/** Runs the analysis for the point at (u, v) and waits for its arrows on the canvas. */
const analyze = async (u, v, labels) => {
  await H.selectTool(); // a H.dim leaves the dimension tool active: a click would pick, not select
  await H.sk(u, v);
  await H.wait(120);
  const b = analysisButton();
  if (!b) throw new Error('no 分析自由度／拘束 button for the point');
  b.click();
  await H.waitFor(() => document.querySelectorAll('.overlay-label.motion').length === labels, 10000, `${labels} motion arrows`);
  await H.wait(150);
};

P.run = async () => {
  let ids = {};
  await step('1 a line that can only slide and one that can only turn: the sketch has two degrees of freedom, nothing conflicts', async () => {
    await window.__man.fresh();
    await H.treeClick('上基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(15, 10, 6);
    await H.tool('直線');
    await H.sk(0, 0);
    await H.solved();
    await H.sk(30, 0);
    await H.solved();
    await H.selectTool();
    await H.tool('直線');
    await H.sk(0, 0);
    await H.solved();
    // a 3-4-5 slope on purpose: no horizontal/vertical inference fires, and the length is a clean 30
    // (Ctrl suspends the snaps: the grid would pull the point onto a node)
    await H.sk(18, 24, { ctrlKey: true });
    await H.solved();
    await H.selectTool();
    await H.dim([lineAt(0, 0, 18, 24)], [-4, 26], 30); // the second line's length: it can only turn about the origin now
    await topView();
    ids = { slide: lineAt(0, 0, 30, 0), turn: lineAt(0, 0, 18, 24), slideEnd: H.pointAt(30, 0), turnEnd: H.pointAt(18, 24) };
    return { pass: solve()?.status === 'under' && solve()?.dof === 2 && !!(ids.slideEnd && ids.turnEnd), status: solve()?.status, dof: solve()?.dof };
  });

  await step('2 the sliding point: the analysis draws one arrow of the solver\'s own answer beside it, along X, and the panel says the same', async () => {
    const before = await picture();
    await analyze(30, 0, 1);
    const after = await picture();
    const rows = motionRows().filter((r) => r.includes('探測'));
    const labels = motionLabels();
    const pixels = changed(before, after, 30.5, -2, 34.5, 2);
    return {
      pass: rows.length === 1 && rows[0].includes('X 探測') && labels.length === 1 && labels[0].includes('X') && pixels > 30 && !!state().dofMotion,
      rows,
      labels,
      pixels,
      dofMotion: state().dofMotion ? state().dofMotion.probes.map((p) => p.axis) : null,
    };
  });

  await step('3 the turning point: two probed motions, X and Y, each its own arrow — the panel still says they are not independent', async () => {
    await analyze(18, 24, 2);
    const rows = motionRows().filter((r) => r.includes('探測'));
    const labels = motionLabels();
    const hint = document.querySelector('.constraint-analysis .hint')?.textContent ?? '';
    return {
      pass: rows.length === 2 && rows.some((r) => r.includes('X 探測')) && rows.some((r) => r.includes('Y 探測'))
        && labels.length === 2 && labels.some((l) => l.includes('X')) && labels.some((l) => l.includes('Y')) && hint.includes('獨立'),
      rows,
      labels,
      hint: hint.slice(0, 40),
    };
  });

  await step('4 Esc clears the selection and with it the arrows: no probe result stays on the canvas or in the state', async () => {
    await H.key('Escape');
    await H.waitFor(() => !state().dofMotion, 5000, 'the arrows to clear with the selection');
    const labels = document.querySelectorAll('.overlay-label.motion').length;
    return { pass: labels === 0 && state().dofMotion === null, labels };
  });

  await step('5 a contradictory length in the document (30 and 40 driving on one edge): the diagnosis offers fixes, and hovering one dashes the geometry it would move — leaving takes it back', async () => {
    await H.dim([ids.slide], [15, -4], 30);
    // every creation path protects the sketch (an over-defining dimension is demoted to a reference, a refused relation says why, a
    // dimension made driving again takes the measured value), so the contradiction arrives the way a document would carry it in:
    // written under the feature, and the sketch is opened on it
    const name = H.sketch().name;
    const sketchId = H.sketch().id;
    await H.selectTool();
    await H.exitSketch();
    store.execute({ type: 'editSketch', featureId: sketchId, add: { entities: [], constraints: [{ id: 'd40', type: 'distance', a: ids.slide, value: '40', driving: true }] } });
    await H.settle();
    if (solve() && solve().status !== undefined) throw new Error('still holding a solve of the closed session');
    await window.__man.treeEdit(name);
    await H.waitFor(() => solve()?.status === 'over', 20000, 'the sketch to open over-defined').catch(() => {
      const st = solve();
      throw new Error(`not over: status=${st?.status} conflicting=[${st?.conflicting}] redundant=[${st?.redundant}]`);
    });
    await H.waitFor(() => fixRows().length >= 1, 20000, 'the fix rows').catch(() => {
      const st = solve();
      const box = [...document.querySelectorAll('.pm-group')].map((g) => g.textContent?.slice(0, 80)).join(' § ');
      throw new Error(`no fix rows: status=${st?.status} conflicting=[${st?.conflicting}] redundant=[${st?.redundant}] constraints=${H.sketch().constraints.length} panels=${box}`);
    });
    const before = await picture();
    // hover each row: at least one previews geometry that moves; any that moves nothing says so instead of drawing a ghost
    let movedRow = -1;
    let movedPixels = 0;
    let movedLabel = '';
    let staticLabel = '';
    let drivenRow = false;
    for (let i = 0; i < fixRows().length; i++) {
      fixRows()[i].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await H.wait(400);
      const preview = state().fixPreview;
      const texts = [...document.querySelectorAll('.overlay-label')].map((el) => el.textContent);
      if (preview?.moved) {
        movedRow = i;
        const during = await picture();
        movedPixels = changed(before, during, 30.5, -2, 39.5, 2);
        movedLabel = texts.find((t) => t.includes('修復預覽')) ?? '';
      } else if (preview && !preview.moved) {
        staticLabel = texts.find((t) => t.includes('不改變幾何')) ?? '';
      }
      if (fixRows()[i].textContent.includes('從動')) drivenRow = true; // a dimension is turned driven, never silently deleted
      fixRows()[i].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      await H.wait(300);
    }
    const after = await picture();
    const gone = changed(before, after, 30.5, -2, 39.5, 2);
    const rowsText = fixRows().map((li) => li.textContent);
    return {
      pass: movedRow >= 0 && movedPixels > 30 && movedLabel.includes('修復預覽') && (staticLabel === '' || staticLabel.includes('不改變幾何')) && gone <= 5 && drivenRow,
      movedRow,
      movedPixels,
      movedLabel,
      staticLabel,
      gone,
      rowsText,
      status: solve()?.status,
    };
  });

  await step('6 applying the previewed fix lands exactly on it — the edge takes the driving 40 — and one Undo puts the conflict back', async () => {
    // find the fix whose preview moves geometry, then apply that very row
    let target = -1;
    for (let i = 0; i < fixRows().length; i++) {
      fixRows()[i].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await H.wait(400);
      if (state().fixPreview?.moved) target = i;
      fixRows()[i].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      await H.wait(200);
      if (target >= 0) break;
    }
    if (target < 0) throw new Error('no fix previews a moved geometry');
    const apply = [...fixRows()[target].querySelectorAll('button')].find((b) => b.textContent.includes('套用'));
    if (!apply) throw new Error('no 套用 button on the fix row');
    apply.click();
    await H.waitFor(() => solve()?.status !== 'over', 10000, 'the conflict to clear');
    await H.settle();
    const applied = { status: solve()?.status, x: H.geom().get(ids.slideEnd)?.p?.[0] ?? null };
    const undo = [...document.querySelectorAll('button')].filter((b) => b.textContent === '復原').pop();
    if (!undo) throw new Error('no 復原 button');
    undo.click();
    await H.settle();
    const undone = { status: solve()?.status, x: H.geom().get(ids.slideEnd)?.p?.[0] ?? null };
    return {
      pass: applied.status === 'under' && applied.x !== null && Math.abs(applied.x - 40) < 1e-6 && undone.status === 'over' && undone.x !== null && Math.abs(undone.x - 30) < 1e-6,
      applied,
      undone,
    };
  });

  return window.__man.result('dof-canvas');
};
