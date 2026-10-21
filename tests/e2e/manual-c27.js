// Manual checklist C27 (docs/manual-verification.html, ADR 0177): 移動／複製／旋轉／縮放圖元 and the linear and circular sketch patterns, each tool used with real
// pointer events in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it): the right-click menu 移動／複製 ▸, the clicks on the base,
// target and center points (on existing points, so that they are exact), the values and 套用 of the PropertyManager. After each, the document is read: where
// every point is, compared with the transform applied to where it was (the truth is the matrix, worked out here, never written down), the relations kept,
// split, swapped or copied, and that a value that cannot be used is refused with its reason and changes nothing. Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c27.js?' + Date.now());   // in a freshly loaded page
//   await __manualC27.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step } = S;
const M = (window.__manualC27 = {});

const EXACT = 1e-6; // the solver's own tolerance in the app, for points that only the transform moved
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pointsNow = () => {
  const out = new Map();
  for (const [id, g] of H.geom()) if (g.type === 'point') out.set(id, g.p);
  return out;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const translate = (d) => (p) => [p[0] + d[0], p[1] + d[1]];
const rotate = (c, deg) => (p) => {
  const a = (deg * Math.PI) / 180;
  const [x, y] = [p[0] - c[0], p[1] - c[1]];
  return [c[0] + Math.cos(a) * x - Math.sin(a) * y, c[1] + Math.sin(a) * x + Math.cos(a) * y];
};
const scaleAbout = (c, k) => (p) => [c[0] + k * (p[0] - c[0]), c[1] + k * (p[1] - c[1])];
const entity = (id) => H.sketch().entities.find((e) => e.id === id);
/** Every point in `ids` is where `m` takes it from `before`. */
const allMoved = (ids, before, m, after = pointsNow()) => ids.every((id) => after.has(id) && dist(after.get(id), m(before.get(id))) < EXACT);
/** The new points match the expected places one to one. */
const sameSet = (actual, expected) => {
  if (actual.length !== expected.length) return false;
  const left = [...actual];
  for (const e of expected) {
    const i = left.findIndex((a) => dist(a, e) < EXACT);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
};

// ---------------------------------------------------------------- the right-click menu (as manual-context-menus.js opens it)
const gmenu = () => document.querySelector('[data-graphics-menu]');
const gids = () => [...(gmenu()?.querySelectorAll('button[data-action]') ?? [])].map((b) => b.dataset.action);
const gclick = async (action) => {
  const b = gmenu()?.querySelector(`button[data-action="${action}"]`);
  if (!b) throw new Error(`no menu line ${action}: ${gids().join(' | ')}`);
  if (b.disabled) throw new Error(`menu line ${action} is greyed out`);
  b.click();
  await H.wait(150);
};
const rightAt = async ({ x, y }) => {
  H.canvas().dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: 0 }));
  await H.wait(80);
  H.canvas().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  await H.wait(200);
};

/** Clicks a point of the sketch where it is (the click snaps to it, so the place is exact). */
const onPoint = async (id) => {
  const p = H.geom().get(id).p;
  await H.sk(p[0], p[1]);
};
/** The four sides of the rectangle selected, one by one with Ctrl, as a person does. */
const selectSides = async (sides) => {
  await H.selectTool();
  await H.key('Escape'); // nothing selected
  for (const id of sides) {
    const [u, v] = H.onEntity(id, 0.5);
    await H.sk(u, v, { ctrlKey: true });
  }
  return same([...H.view().selection].sort(), [...sides].sort());
};
const toolButton = async (label) => {
  H.tab('草圖');
  await H.wait(50);
  H.btn(label);
  await H.wait(80);
};
const undo = async () => {
  store.undo();
  await H.solved();
  await H.wait(100);
};

M.run = async () => {
  S.steps.length = 0;
  let sides = [];
  let corners = [];
  let slant;
  let P;
  let width;

  await step('1 a sketch on the front plane: a 20 × 10 rectangle with its width dimensioned, a slanted line from its top right corner, a point P', async () => {
    await S.fresh();
    await H.treeClick('前基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(20, 5, 6);
    await H.tool('邊角矩形');
    await H.sk(5, 5, { ctrlKey: true });
    await H.sk(25, 15, { ctrlKey: true });
    await H.solved();
    sides = [...H.geom()].filter(([, g]) => g.type === 'line').map(([id]) => id);
    const topRight = H.pointAt(25, 15);
    await H.tool('直線');
    await onPoint(topRight);
    await H.sk(35, 25, { ctrlKey: true });
    await H.selectTool();
    await H.solved();
    slant = [...H.geom()].find(([id, g]) => g.type === 'line' && !sides.includes(id))?.[0];
    await H.tool('點');
    await H.sk(45, 0, { ctrlKey: true });
    await H.selectTool();
    await H.solved();
    P = H.pointAt(45, 0);
    const bottom = H.lineWhere((g, id) => sides.includes(id) && Math.abs(g.a[1] - 5) < 0.5 && Math.abs(g.b[1] - 5) < 0.5);
    await H.dim([bottom], [15, 1], 20);
    await H.selectTool();
    width = H.sketch().constraints.find((c) => c.type === 'distance' && c.a === bottom)?.id;
    corners = [...new Set(sides.flatMap((id) => [entity(id).p1, entity(id).p2]))];
    const shared = entity(slant)?.p1 === topRight || entity(slant)?.p2 === topRight;
    return { pass: sides.length === 4 && corners.length === 4 && !!slant && !!P && !!width && shared, sides, corners, slant, P, width, shared };
  });

  await step('2 right click on a side: 移動／複製 ▸ lists the six tools and 鏡射圖元; 移動圖元 starts on the selection', async () => {
    if (!(await selectSides(sides))) return { pass: false, why: 'the sides could not be selected' };
    const [u, v] = H.onEntity(sides[0], 0.5);
    await rightAt(H.toClient(u, v));
    const top = gids();
    await gclick('transform-entities');
    const sub = gids();
    await gclick('tool-moveEntities');
    const view = H.view();
    const want = ['tool-moveEntities', 'tool-copyEntities', 'tool-rotateEntities', 'tool-scaleEntities', 'tool-linearPattern', 'tool-circularPattern', 'tool-mirror'];
    return { pass: top.includes('transform-entities') && same(sub, want) && view.tool === 'moveEntities' && same([...view.picks].sort(), [...sides].sort()), top, sub, tool: view.tool, picks: view.picks };
  });

  /** A corner of the rectangle by where it is now (read before the tool moves it). */
  const corner = (u, v) => corners.find((id) => dist(H.geom().get(id).p, [u, v]) < 0.5);
  /** The point a side took in place of the shared top right corner when it was split off (保持關係 off). */
  const newCorner = () => sides.map((id) => entity(id)).flatMap((e) => [e.p1, e.p2]).find((p) => !corners.includes(p));
  /** The rectangle's corners where `m` takes them: the three it keeps, and the one it took in place of the shared corner (or that corner, kept). */
  const rectangleMoved = (before, m, topRight) => {
    const split = newCorner();
    const now = pointsNow();
    return allMoved(corners.filter((id) => id !== topRight), before, m) && (split ? dist(now.get(split), m(before.get(topRight))) < EXACT : allMoved([topRight], before, m));
  };
  await step('3 移動圖元, 保持關係 off: base = the bottom left corner, target = P; the rectangle moves by P − corner, the slanted line stays where it was, the shared corner is split', async () => {
    const before = pointsNow();
    const base = corner(5, 5);
    const topRight = corner(25, 15);
    const keep = document.querySelector('.property-manager input[name="keepRelations"]');
    if (!keep || keep.checked) return { pass: false, why: '保持關係 is not there, or not off by default', checked: keep?.checked };
    await onPoint(base);
    await onPoint(P);
    await H.solved();
    await H.wait(200);
    const m = translate([before.get(P)[0] - before.get(base)[0], before.get(P)[1] - before.get(base)[1]]);
    const moved = allMoved(corners.filter((id) => id !== topRight), before, m);
    const L = entity(slant);
    const splitOff = (L.p1 === topRight || L.p2 === topRight) && dist(pointsNow().get(topRight), before.get(topRight)) < EXACT;
    // the side that ended at the old corner now ends at a new point, where the move puts that corner
    const split = newCorner();
    const there = !!split && dist(pointsNow().get(split), m(before.get(topRight))) < EXACT;
    const dim = H.sketch().constraints.find((c) => c.id === width);
    return { pass: moved && splitOff && there && dim?.value === '20' && H.view().tool === 'select' && ['under', 'fully'].includes(store.getState().sketchSolve.status), moved, splitOff, there, dim };
  });

  await step('4 復原, then 移動圖元 with 保持關係 on: the slanted line\'s end goes with the corner, its other end stays', async () => {
    await undo();
    const before = pointsNow();
    const back = corners.every((id) => dist(before.get(id), H.geom().get(id).p) < EXACT) && (entity(slant).p1 === corner(25, 15) || entity(slant).p2 === corner(25, 15));
    if (!(await selectSides(sides))) return { pass: false, why: 'the sides could not be selected' };
    await toolButton('移動圖元');
    await S.pmCheck('保持關係', true);
    const [base, topRight] = [corner(5, 5), corner(25, 15)];
    await onPoint(base);
    await onPoint(P);
    await H.solved();
    await H.wait(200);
    const m = translate([before.get(P)[0] - before.get(base)[0], before.get(P)[1] - before.get(base)[1]]);
    const L = entity(slant);
    const far = L.p1 === topRight ? L.p2 : L.p1;
    const moved = allMoved(corners, before, m);
    const farStays = dist(pointsNow().get(far), before.get(far)) < EXACT;
    await undo();
    return { pass: back && moved && farStays, back, moved, farStays };
  });

  await step('5 複製圖元 with 保持關係 on, ΔX 0, ΔY −25, 套用: four new sides 25 below, the rectangle stays, its relations and the width dimension copied', async () => {
    const before = pointsNow();
    const entitiesBefore = new Set(H.sketch().entities.map((e) => e.id));
    const constraintsBefore = new Set(H.sketch().constraints.map((c) => c.id));
    if (!(await selectSides(sides))) return { pass: false, why: 'the sides could not be selected' };
    await toolButton('複製圖元');
    await S.pmCheck('保持關係', true);
    await S.pmType('ΔX', 0);
    await S.pmType('ΔY', -25);
    await S.pmClick('套用');
    await H.solved();
    await H.wait(200);
    const after = pointsNow();
    const added = H.sketch().entities.filter((e) => !entitiesBefore.has(e.id));
    const copied = H.sketch().constraints.filter((c) => !constraintsBefore.has(c.id));
    const originalsStay = [...before].every(([id, p]) => dist(after.get(id), p) < EXACT);
    const placed = sameSet(added.filter((e) => e.type === 'point').map((e) => after.get(e.id)), corners.map((id) => translate([0, -25])(before.get(id))));
    // what the rectangle had among its sides: its horizontal and vertical relations and the width
    const own = H.sketch().constraints.filter((c) => constraintsBefore.has(c.id) && ['horizontal', 'vertical', 'distance'].includes(c.type) && [c.a, c.b].filter(Boolean).every((r) => sides.includes(r)));
    const kinds = (list) => list.map((c) => c.type).sort();
    const widthCopy = copied.find((c) => c.type === 'distance');
    await undo();
    return { pass: originalsStay && placed && added.filter((e) => e.type === 'line').length === 4 && same(kinds(copied), kinds(own)) && widthCopy?.value === '20', originalsStay, placed, copied: kinds(copied), own: kinds(own) };
  });

  await step('6 旋轉圖元 by clicks: center = the bottom right corner, from = the top right corner, to = P; every corner turned by that angle, horizontal and vertical relations as the rule says', async () => {
    const before = pointsNow();
    const relBefore = new Map(H.sketch().constraints.filter((c) => (c.type === 'horizontal' || c.type === 'vertical') && sides.includes(c.a)).map((c) => [c.a, c.type]));
    if (!(await selectSides(sides))) return { pass: false, why: 'the sides could not be selected' };
    await toolButton('旋轉圖元');
    await S.pmCheck('保持關係', false);
    const [c, from] = [corner(25, 5), corner(25, 15)];
    await onPoint(c);
    await onPoint(from);
    await onPoint(P);
    await H.solved();
    await H.wait(200);
    const [o, f, t] = [before.get(c), before.get(from), before.get(P)];
    const [a, b] = [[f[0] - o[0], f[1] - o[1]], [t[0] - o[0], t[1] - o[1]]];
    const angle = (Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * 180) / Math.PI;
    const turned = rectangleMoved(before, rotate(o, angle), from);
    const q = angle / 90;
    const quarter = Math.abs(q - Math.round(q)) < 1e-9;
    const relAfter = H.sketch().constraints.filter((k) => (k.type === 'horizontal' || k.type === 'vertical') && sides.includes(k.a));
    const rule = quarter ? relAfter.length === relBefore.size : relAfter.length === 0;
    await undo();
    return { pass: turned && rule && Math.abs(angle) > 1, angle, turned, rule, relations: relAfter.length };
  });

  await step('7 旋轉圖元 by value: center = the bottom left corner, 角度 90, 套用; horizontal and vertical swap on every side', async () => {
    const before = pointsNow();
    const relBefore = new Map(H.sketch().constraints.filter((c) => (c.type === 'horizontal' || c.type === 'vertical') && sides.includes(c.a)).map((c) => [c.a, c.type]));
    if (!(await selectSides(sides))) return { pass: false, why: 'the sides could not be selected' };
    await toolButton('旋轉圖元');
    const [c, topRight] = [corner(5, 5), corner(25, 15)];
    await onPoint(c);
    await S.pmType('角度（°）', 90);
    await S.pmClick('套用');
    await H.solved();
    await H.wait(200);
    const turned = rectangleMoved(before, rotate(before.get(c), 90), topRight);
    const relAfter = new Map(H.sketch().constraints.filter((k) => (k.type === 'horizontal' || k.type === 'vertical') && sides.includes(k.a)).map((k) => [k.a, k.type]));
    const swapped = relBefore.size === 4 && [...relBefore].every(([line, type]) => relAfter.get(line) === (type === 'horizontal' ? 'vertical' : 'horizontal'));
    await undo();
    return { pass: turned && swapped, turned, swapped, relBefore: [...relBefore], relAfter: [...relAfter] };
  });

  await step('8 縮放圖元: base = the bottom left corner, 比例 2, 套用; corners scaled about it, the width dimension 40', async () => {
    const before = pointsNow();
    if (!(await selectSides(sides))) return { pass: false, why: 'the sides could not be selected' };
    await toolButton('縮放圖元');
    const [c, topRight] = [corner(5, 5), corner(25, 15)];
    await onPoint(c);
    await S.pmType('比例', 2);
    await S.pmClick('套用');
    await H.solved();
    await H.wait(200);
    const scaled = rectangleMoved(before, scaleAbout(before.get(c), 2), topRight);
    const dim = H.sketch().constraints.find((k) => k.id === width);
    await undo();
    return { pass: scaled && Number(dim?.value) === 40, scaled, dim };
  });

  await step('9 縮放圖元 with 比例 0, −1 and an empty field: each refused with 「比例必須是大於 0 的數字」, the document unchanged', async () => {
    const results = [];
    for (const value of ['0', '-1', '']) {
      if (!(await selectSides(sides))) return { pass: false, why: 'the sides could not be selected' };
      await toolButton('縮放圖元');
      await onPoint(corner(5, 5));
      const doc = store.getState().doc;
      await S.pmType('比例', value);
      await S.pmClick('套用');
      await H.wait(200);
      results.push({ value, said: S.notice(), unchanged: store.getState().doc === doc });
      await H.selectTool();
    }
    return { pass: results.every((r) => r.said.includes('比例必須是大於 0 的數字') && r.unchanged), results };
  });

  await step('10 線性草圖陣列: 副本數 3, 間距 ΔX 30, ΔY 0, 套用; copy i is 30·i to the right', async () => {
    const before = pointsNow();
    const entitiesBefore = new Set(H.sketch().entities.map((e) => e.id));
    if (!(await selectSides(sides))) return { pass: false, why: 'the sides could not be selected' };
    await toolButton('線性草圖陣列');
    await S.pmType('副本數（不含原圖元）', 3);
    await S.pmType('間距 ΔX', 30);
    await S.pmType('間距 ΔY', 0);
    await S.pmClick('套用');
    await H.solved();
    await H.wait(200);
    const after = pointsNow();
    const added = H.sketch().entities.filter((e) => !entitiesBefore.has(e.id));
    const expected = [1, 2, 3].flatMap((i) => corners.map((id) => translate([30 * i, 0])(before.get(id))));
    const placed = sameSet(added.filter((e) => e.type === 'point').map((e) => after.get(e.id)), expected);
    await undo();
    return { pass: placed && added.filter((e) => e.type === 'line').length === 12, placed, lines: added.filter((e) => e.type === 'line').length };
  });

  await step('11 線性草圖陣列 with 副本數 2.5, then 0: refused with 「副本數必須是 1 到 200 的整數」, nothing made', async () => {
    const results = [];
    for (const value of ['2.5', '0']) {
      if (!(await selectSides(sides))) return { pass: false, why: 'the sides could not be selected' };
      await toolButton('線性草圖陣列');
      const doc = store.getState().doc;
      await S.pmType('副本數（不含原圖元）', value);
      await S.pmClick('套用');
      await H.wait(200);
      results.push({ value, said: S.notice(), unchanged: store.getState().doc === doc });
      await H.selectTool();
    }
    return { pass: results.every((r) => r.said.includes('副本數必須是 1 到 200 的整數') && r.unchanged), results };
  });

  await step('12 環狀草圖陣列 of the slanted line: 副本數 5, 總角度 360, center = P (a click); copy i turned 60°·i about P', async () => {
    const before = pointsNow();
    const entitiesBefore = new Set(H.sketch().entities.map((e) => e.id));
    await H.selectTool();
    await H.key('Escape');
    const [u, v] = H.onEntity(slant, 0.5);
    await H.sk(u, v);
    await toolButton('環狀草圖陣列');
    await S.pmType('副本數（不含原圖元）', 5);
    await S.pmType('總角度（°，360 為整圈平均分布）', 360);
    await onPoint(P);
    await H.solved();
    await H.wait(200);
    const after = pointsNow();
    const added = H.sketch().entities.filter((e) => !entitiesBefore.has(e.id));
    const L = entity(slant);
    const expected = [1, 2, 3, 4, 5].flatMap((i) => [L.p1, L.p2].map((id) => rotate(before.get(P), 60 * i)(before.get(id))));
    const placed = sameSet(added.filter((e) => e.type === 'point').map((e) => after.get(e.id)), expected);
    return { pass: placed && added.filter((e) => e.type === 'line').length === 5 && [...before].every(([id, p]) => dist(after.get(id), p) < EXACT), placed, lines: added.filter((e) => e.type === 'line').length };
  });

  await step('13 the tools need a selection: 移動圖元 with nothing selected stays in 選取 and says why', async () => {
    await H.selectTool();
    await H.key('Escape');
    await toolButton('移動圖元');
    return { pass: H.view().tool === 'select' && S.notice().includes('請先選取要移動'), tool: H.view().tool, said: S.notice() };
  });

  await H.selectTool();
  await H.exitSketch();
  return S.result('C27');
};
