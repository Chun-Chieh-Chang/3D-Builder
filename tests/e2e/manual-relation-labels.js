// G12 (P4, 診斷、關係與參照): relation markers in a small area. Three 10×6 rectangles side by side, tied by two 「相等」 and pinned by four
// dimensions, make 15 relations whose symbols crowd a strip about 114 × 18 screen pixels. Selecting an edge lights the relations that name it and
// folds the ones that do not (the panel still lists every one of them); selecting a relation — its symbol on the canvas, or its row in the panel's
// list — lights the geometry it names, on the far rectangle too; no symbol is placed on another, so every one stays on clear ground and clickable;
// Esc gives the picture back. Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-relation-labels.js?' + Date.now());   // in a freshly loaded page
//   await __relationLabels.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/manual-support.js?` + Date.now());
const { H, store, step } = window.__man;
const P = (window.__relationLabels = {});

const state = () => store.getState();
const sketch = () => H.sketch();
const pm = () => document.querySelector('.property-manager');
const DIMENSIONS = ['distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'arcLength', 'angle'];
const relations = () => sketch().constraints.filter((c) => !DIMENSIONS.includes(c.type));
const dims = () => sketch().constraints.filter((c) => DIMENSIONS.includes(c.type));
const byId = (id) => sketch().constraints.find((c) => c.id === id);
/** The marker of one relation, by the key the overlay gives its label (`rel:<id>`). */
const markerOf = (id) => document.querySelector(`.overlay-label.relation[data-key="rel:${id}"]`);
const markers = () => [...document.querySelectorAll('.overlay-label.relation')];
const classes = (id) => markerOf(id)?.className ?? null;

// ---------------------------------------------------------------- the picture: one pixel of the sketch plane
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
/** The most saturated pixel in a small square round a point of the sketch plane: the line itself, not the gray behind it. */
const sample = (img, u, v, half = 2) => {
  const r = H.canvas().getBoundingClientRect();
  const p = store.viewer.screenOf(H.frame(), [u, v]);
  const cx = Math.round((p.x * img.w) / r.width);
  const cy = Math.round((p.y * img.h) / r.height);
  let out = [0, 0, 0];
  let score = -1;
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const i = (y * img.w + x) * 4;
      const rgb = [img.data[i], img.data[i + 1], img.data[i + 2]];
      const s = Math.max(...rgb) - Math.min(...rgb);
      if (s > score) {
        score = s;
        out = rgb;
      }
    }
  }
  return out;
};
/** The lit colour of a relation's geometry (the amber of hover/related): red far above blue. Black, blue and teal all fail this. */
const isAmber = ([r, g, b]) => r > b + 60 && r > 110;

// ---------------------------------------------------------------- the markers on clear ground
const boxes = () =>
  markers().map((el) => ({ key: el.dataset.key ?? `?${el.textContent}`, r: el.getBoundingClientRect() }));
/** How many pairs of marker boxes lie on each other, and how many are covered whole by the other (nothing left to click). */
const overlaps = (list) => {
  let pairs = 0;
  let covered = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].r;
      const b = list[j].r;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0 && h > 0) {
        pairs++;
        const within = (x, y) => x.left >= y.left - 0.5 && x.right <= y.right + 0.5 && x.top >= y.top - 0.5 && x.bottom <= y.bottom + 0.5;
        if (within(a, b) || within(b, a)) covered++;
      }
    }
  }
  return { pairs, covered };
};
/** The 「現有限制條件」 rows of the panel (the list that must survive the highlighting). */
const listed = () => {
  const head = [...pm().querySelectorAll('h4')].find((h) => h.textContent === '現有限制條件');
  return head ? [...head.nextElementSibling.querySelectorAll('li')].map((li) => li.textContent) : [];
};

P.run = async () => {
  let ids = {};
  await step('1 three 10×6 rectangles tied by two 「相等」 and four dimensions: more than twelve relations crowd a strip, none conflicting', async () => {
    await window.__man.fresh();
    await H.treeClick('上基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(19, 3, 3);
    for (const [x0, x1] of [[0, 10], [14, 24], [28, 38]]) {
      await H.tool('直線');
      for (const [u, v] of [[x0, 0], [x1, 0], [x1, 6], [x0, 6], [x0, 0]]) {
        await H.sk(u, v);
        await H.solved();
      }
      await H.selectTool();
    }
    const lineAt = (x0, y0, x1, y1) =>
      H.lineWhere((g) => {
        const d = (a, b) => Math.hypot(g[a][0] - b[0], g[a][1] - b[1]);
        return Math.min(d('a', [x0, y0]) + d('b', [x1, y1]), d('a', [x1, y1]) + d('b', [x0, y0])) < 0.5;
      });
    ids = {
      r1bottom: lineAt(0, 0, 10, 0),
      r1left: lineAt(0, 6, 0, 0),
      r1top: lineAt(0, 6, 10, 6),
      r2top: lineAt(14, 6, 24, 6),
      r2right: lineAt(24, 0, 24, 6),
      r3top: lineAt(28, 6, 38, 6),
    };
    await H.dim([ids.r1bottom], [5, -3], 10);
    await H.dim([ids.r1left], [-3, 3], 6);
    await H.dim([H.pointAt(10, 0), H.pointAt(14, 0)], [12, -3], 4);
    await H.dim([H.pointAt(24, 0), H.pointAt(28, 0)], [26, -3], 4);
    await H.rel([ids.r1top, ids.r2top], '相等');
    await H.rel([ids.r2top, ids.r3top], '相等');
    await H.selectTool();
    const rel = relations().length;
    const dim = dims().length;
    const bad = state().sketchSolve?.conflicting ?? [];
    return { pass: rel >= 12 && dim >= 3 && bad.length === 0 && !!(ids.r1top && ids.r2top && ids.r3top), rel, dim, bad };
  });

  await step('2 no marker lies on another: every relation symbol is on clear ground, none covered whole', async () => {
    const list = boxes();
    const { pairs, covered } = overlaps(list);
    return { pass: list.length === relations().length && pairs === 0 && covered === 0, markers: list.length, pairs, covered };
  });

  await step('3 selecting the first rectangle\'s top edge lights exactly the relations that name it (the panel lists them) and folds every other one', async () => {
    await H.sk(5, 6);
    await H.wait(150);
    const rel = relations();
    const g = H.geom().get(ids.r1top);
    /** The ids a constraint names (the same fields `constraintRefs` reads). */
    const refsOf = (c) => [c.a, c.b, c.point, c.line, c.curve, c.axis, c.circle, c.entity, ...(c.points ?? [])].filter((x) => typeof x === 'string');
    // what the selection is about, worked out here from the model: the edge, its two end points, and every relation naming any of them
    const about = new Set([ids.r1top, g.p1, g.p2]);
    const want = rel.filter((c) => refsOf(c).some((r) => about.has(r))).map((c) => c.id);
    const lit = rel.filter((c) => markerOf(c.id)?.classList.contains('related')).map((c) => c.id);
    const folded = rel.filter((c) => markerOf(c.id)?.classList.contains('dim')).length;
    const rows = listed();
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    return {
      pass: want.length >= 2 && same(lit, want) && folded === rel.length - want.length
        && rows.length === want.length && rows.some((r) => r.includes('相等')),
      want,
      lit,
      folded,
      rows,
      selection: H.view().selection,
    };
  });

  await step('4 clicking the 「相等」 symbol on the canvas lights both edges it names — the far rectangle\'s too — and leaves the third alone', async () => {
    const equal1 = relations().find((c) => c.type === 'equal' && [c.a, c.b].includes(ids.r1top));
    const m = markerOf(equal1.id);
    if (!m) throw new Error(`no marker for the relation ${equal1.id}`);
    m.click();
    await H.wait(200);
    const pic = await picture();
    const a = sample(pic, 5, 6);
    const b = sample(pic, 19, 6);
    const c = sample(pic, 33, 6);
    return {
      pass: H.view().selection.includes(equal1.id) && isAmber(a) && isAmber(b) && !isAmber(c),
      selection: H.view().selection,
      first: a,
      second: b,
      third: c,
    };
  });

  await step('5 clicking the 「相等」 row of the panel\'s list does the same from the list', async () => {
    await H.sk(5, 6);
    await H.wait(150);
    const equal1 = relations().find((c) => c.type === 'equal' && [c.a, c.b].includes(ids.r1top));
    const head = [...pm().querySelectorAll('h4')].find((h) => h.textContent === '現有限制條件');
    const row = head ? [...head.nextElementSibling.querySelectorAll('li')].find((li) => li.textContent.includes('相等')) : null;
    if (!row) throw new Error('no 「相等」 row in the list');
    row.click();
    await H.wait(200);
    const pic = await picture();
    const b = sample(pic, 19, 6);
    const cls = markerOf(equal1.id)?.className ?? '';
    return {
      pass: H.view().selection.includes(equal1.id) && cls.includes('selected') && isAmber(b),
      selection: H.view().selection,
      marker: cls,
      second: b,
    };
  });

  await step('6 Esc clears the selection: no marker folded or lit, the picture as it was, and the markers still clear of each other', async () => {
    await H.key('Escape');
    await H.wait(150);
    const folded = document.querySelectorAll('.overlay-label.relation.dim').length;
    const lit = document.querySelectorAll('.overlay-label.relation.related').length;
    const pic = await picture();
    const b = sample(pic, 19, 6);
    const { pairs, covered } = overlaps(boxes());
    return { pass: folded === 0 && lit === 0 && !isAmber(b) && pairs === 0 && covered === 0, folded, lit, second: b, pairs, covered };
  });

  return window.__man.result('relation-labels');
};
