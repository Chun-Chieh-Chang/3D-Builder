// ADR 0176: the right-click menus of the graphics area — the part (a face, an edge, a vertex, empty space), the sketch being edited (an entity, empty space,
// a drawing tool on) and the assembly (a component, empty space). Each is opened with a real right click at the screen position of the element (the viewer
// finds what is there itself), its lines are compared by their data-action with what the ADR says, and one command of each is run and the document checked
// afterwards (a body hidden, a feature suppressed, a fillet started with the edge in it, a relation added, a component hidden …). Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-context-menus.js?' + Date.now());   // in a freshly loaded page
//   await __contextMenus.part();       // -> { name, steps: [{ name, pass }], pass }   the part and its sketch
//   await __contextMenus.assembly();   // -> { name, steps: [{ name, pass }], pass }   the assembly

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
const C = (window.__contextMenus = {});

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await window.__shot?.(name);
  steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r });
  return r;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** A part menu's own lines, without 選取其他 (D5.6), which is there as well whenever faces lie behind the pointer. */
const ownIds = (ids) => ids.filter((x) => !x.startsWith('select-other'));

// ---------------------------------------------------------------- the graphics area's menu
const gmenu = () => document.querySelector('[data-graphics-menu]');
const gids = () => [...(gmenu()?.querySelectorAll('button[data-action]') ?? [])].map((b) => b.dataset.action);
const gclick = async (H, action) => {
  const b = gmenu()?.querySelector(`button[data-action="${action}"]`);
  if (!b) throw new Error(`no menu line ${action}: ${gids().join(' | ')}`);
  if (b.disabled) throw new Error(`menu line ${action} is greyed out`);
  b.click();
  await H.wait(150);
};
/** A right click at a client point of the canvas, the way the mouse does it (move, then the contextmenu event the browser sends). */
const rightAt = async (H, { x, y }) => {
  H.canvas().dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: 0 }));
  await H.wait(80);
  H.canvas().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  await H.wait(200);
};
const closeMenus = async (H) => {
  window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, button: 0, buttons: 1 }));
  await H.wait(100);
};

// ================================================================ the part and its sketch
C.part = async () => {
  steps.length = 0;
  await import(here + 'manual-support.js?' + Date.now());
  const S = window.__man;
  const { H, store } = S;
  const state = () => store.getState();
  const result = () => state().result;
  const feature = (id) => state().doc.features.find((f) => f.id === id);
  /** A client point where the viewer finds this element, and nothing nearer the pointer that a click would take first (a vertex before an edge before a face). */
  const elementSpot = (kind, index) => {
    const r = result();
    const at = (P) => H.worldToClient(P);
    const ok = (p) => {
      const el = store.viewer.elementsAt(p.x, p.y);
      return kind === 'vertex' ? el.vertex === index : kind === 'edge' ? el.vertex < 0 && el.edge === index : el.vertex < 0 && el.edge < 0 && el.face === index;
    };
    if (kind === 'vertex') {
      const p = at([r.vertexPoints[index * 3], r.vertexPoints[index * 3 + 1], r.vertexPoints[index * 3 + 2]]);
      return ok(p) ? p : null;
    }
    if (kind === 'edge') {
      const m = r.mesh;
      for (let g = 0; g < m.edgeRanges.length; g += 3) {
        if (m.edgeRanges[g + 2] !== index) continue;
        // along the edge's run of points (a straight edge has only its two ends): a place between them, never an end, which would be the vertex
        const [start, count] = [m.edgeRanges[g], m.edgeRanges[g + 1]];
        for (const t of [0.5, 0.35, 0.65]) {
          const pos = t * (count - 1);
          const k = start + Math.min(Math.floor(pos), count - 2);
          const f = pos - (k - start);
          const P = [0, 1, 2].map((c) => m.edgePoints[k * 3 + c] * (1 - f) + m.edgePoints[(k + 1) * 3 + c] * f);
          const p = at(P);
          if (ok(p)) return p;
        }
      }
      return null;
    }
    const p = at(r.faceFingerprints[index].center);
    return ok(p) ? p : null;
  };
  const firstSpot = (kind, count) => {
    for (let i = 0; i < count; i++) {
      const p = elementSpot(kind, i);
      if (p) return { index: i, p };
    }
    return null;
  };
  const emptySpot = () => {
    const r = H.rect();
    for (let fy = 0.15; fy < 0.95; fy += 0.05) {
      for (let fx = 0.05; fx < 0.95; fx += 0.05) {
        const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
        const el = store.viewer.elementsAt(x, y);
        if (el.vertex < 0 && el.edge < 0 && el.face < 0) return { x, y };
      }
    }
    return null;
  };
  let extrude;
  let sketch;
  let top;

  await step('1 a 40 × 30 × 10 block (做法 A) in the isometric view', async () => {
    sketch = await S.box(40, 30, 10);
    await S.iso();
    extrude = state().doc.features.find((f) => f.type === 'extrude')?.id;
    top = S.planeFace(1, 10)?.i;
    return { pass: !!extrude && top !== undefined && result().bodies.length === 1, extrude, top, bodies: result().bodies.length };
  });

  await step('2 empty space: the view (全部顯示, 正視於, 標準視角 ▸, 選擇濾器); 標準視角 ▸ 前視 looks along −z', async () => {
    const at = emptySpot();
    if (!at) return { pass: false, why: 'no empty point on the canvas' };
    await rightAt(H, at);
    const what = gmenu()?.dataset.graphicsMenu;
    const ids = gids();
    await gclick(H, 'standard-views');
    const sub = gids();
    await gclick(H, 'view-front');
    await H.wait(300);
    const dir = store.viewer.viewDirection();
    const front = Math.abs(dir[2]) > 0.999;
    await S.iso();
    return { pass: what === 'empty' && same(ids, ['fit', 'view-normal', 'standard-views', 'filter-bar']) && same(sub, ['view-front', 'view-back', 'view-top', 'view-bottom', 'view-left', 'view-right', 'view-iso']) && front, what, ids, sub, dir };
  });

  await step('3 a vertex: 編輯特徵, 量測; 量測 starts measuring with that vertex picked', async () => {
    const v = firstSpot('vertex', result().vertexNames.length);
    if (!v) return { pass: false, why: 'no vertex under the pointer anywhere' };
    await rightAt(H, v.p);
    const what = gmenu()?.dataset.graphicsMenu;
    const ids = gids();
    const selected = state().selectedElements.map((e) => e.name);
    await gclick(H, 'measure-part');
    await H.settle();
    const m = state().measure;
    const picked = m?.picks.length === 1 && m.picks[0].kind === 'vertex' && m.picks[0].index === v.index;
    store.stopMeasure();
    await H.wait(100);
    return { pass: what === 'vertex' && same(ownIds(ids), ['edit-feature', 'measure-part']) && same(selected, [result().vertexNames[v.index]]) && picked, what, ids, selected, picks: m?.picks };
  });

  let edgeAt;
  await step('4 an edge: the feature, its sketch, 圓角, 倒角, 隱藏本體, 抑制, 量測; 圓角 starts with that edge in it', async () => {
    edgeAt = firstSpot('edge', result().edgeNames.length);
    if (!edgeAt) return { pass: false, why: 'no edge under the pointer anywhere' };
    const name = result().edgeNames[edgeAt.index];
    await rightAt(H, edgeAt.p);
    const what = gmenu()?.dataset.graphicsMenu;
    const ids = gids();
    await gclick(H, 'fillet');
    await H.settle();
    const e = state().editing;
    const f = e && feature(e.featureId);
    return { pass: what === 'edge' && same(ownIds(ids), ['edit-feature', 'edit-feature-sketch', 'fillet', 'chamfer', 'toggle-visibility', 'suppress-feature', 'measure-part']) && f?.type === 'fillet' && same(f.edges.map((x) => x.name), [name]), what, ids, edges: f?.edges?.map((x) => x.name), name };
  });

  await step('5 inside the fillet the right click keeps its selection tools (相切的邊線, 迴圈) and offers no feature command; 取消 leaves no fillet', async () => {
    await rightAt(H, edgeAt.p);
    const ids = gids();
    await closeMenus(H);
    store.cancelEdit();
    await H.settle();
    const left = state().doc.features.some((f) => f.type === 'fillet');
    return { pass: ids.includes('select-tangent-edges') && ids.some((x) => x.startsWith('select-loop-')) && !ids.includes('edit-feature') && !left && state().editing === null, ids, left };
  });

  await step('5b the selection filter holds for the right click as for the left: with only 面 on, a right click on the edge gives the menu of the face there', async () => {
    // a point of an edge with a face behind it too (an edge on the outline has none): an edge between two faces that face the viewer
    const m = result().mesh;
    let at = null;
    for (let g = 0; g < m.edgeRanges.length && !at; g += 3) {
      const index = m.edgeRanges[g + 2];
      const [k0, k1] = [m.edgeRanges[g], m.edgeRanges[g] + m.edgeRanges[g + 1] - 1];
      const P = [0, 1, 2].map((c) => (m.edgePoints[k0 * 3 + c] + m.edgePoints[k1 * 3 + c]) / 2);
      const q = H.worldToClient(P);
      const el = store.viewer.elementsAt(q.x, q.y);
      if (el.vertex < 0 && el.edge === index && el.face >= 0) at = q;
    }    if (!at) return { pass: false, why: 'no point of the edge with a face behind it' };
    store.setPickFilterKind('faces');
    await H.wait(150);
    await rightAt(H, at);
    const what = gmenu()?.dataset.graphicsMenu;
    const elements = state().selectedElements.length;
    const face = state().selectedFace?.name ?? null;
    await closeMenus(H);
    store.clearPickFilter();
    await H.wait(150);
    // and with every kind on again, the same point is the edge
    await rightAt(H, at);
    const back = gmenu()?.dataset.graphicsMenu;
    await closeMenus(H);
    return { pass: what === 'face' && elements === 0 && !!face && back === 'edge', what, elements, face, back };
  });

  await step('6 a face: the feature, its sketch, 草圖, 隱藏本體, 外觀, 抑制, 量測, and 選取其他 kept; the face is selected first', async () => {
    const p = elementSpot('face', top);
    if (!p) return { pass: false, why: 'the top face is not under its centre' };
    await rightAt(H, p);
    const what = gmenu()?.dataset.graphicsMenu;
    const ids = gids();
    const chosen = state().selectedFace?.name;
    await closeMenus(H);
    // 選取其他 (D5.6) stays at the end when there are faces behind this one (the bottom of the block is)
    const own = ids.filter((x) => !x.startsWith('select-other'));
    return { pass: what === 'face' && same(own, ['edit-feature', 'edit-feature-sketch', 'sketch', 'toggle-visibility', 'appearance', 'suppress-feature', 'measure-part']) && ids.at(-1) === 'select-other' && chosen === result().faceNames[top], what, ids, chosen };
  });

  await step('6b 外觀 on the face opens the appearance dialog on that face (not on the whole part)', async () => {
    await rightAt(H, elementSpot('face', top));
    await gclick(H, 'appearance');
    await H.wait(200);
    const target = document.querySelector('.modal select')?.value ?? null;
    const offered = [...(document.querySelector('.modal select')?.options ?? [])].map((o) => o.value);
    await S.modalButton('關閉');
    return { pass: target === 'face' && offered.includes('part'), target, offered };
  });

  await step('7 隱藏本體 on the face hides the body; the tree\'s body row shows it again with the same command', async () => {
    await rightAt(H, elementSpot('face', top));
    const label = gmenu()?.querySelector('[data-action="toggle-visibility"]')?.textContent;
    await gclick(H, 'toggle-visibility');
    await H.settle();
    const body = result().bodies[0];
    const hidden = body && body.shown === false;
    const row = document.querySelector('.tree-row.body');
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 8, button: 2 }));
    await H.wait(150);
    const li = document.querySelector('.context-menu li[data-action="toggle-visibility"]');
    const treeLabel = li?.textContent;
    li?.click();
    await H.settle();
    return { pass: label === '隱藏本體' && hidden && treeLabel === '顯示本體' && result().bodies[0]?.shown === true, label, treeLabel, hidden };
  });

  await step('8 抑制 on the face suppresses the extrusion (no body); 復原 brings it back', async () => {
    await rightAt(H, elementSpot('face', top));
    await gclick(H, 'suppress-feature');
    await H.settle();
    const suppressed = feature(extrude)?.suppressed === true && result().bodies.length === 0;
    store.undo();
    await H.settle();
    await S.iso();
    return { pass: suppressed && feature(extrude)?.suppressed === false && result().bodies.length === 1, suppressed };
  });

  await step('9 編輯特徵 on the face opens the extrusion; 編輯草圖 opens its sketch', async () => {
    await rightAt(H, elementSpot('face', top));
    await gclick(H, 'edit-feature');
    await H.settle();
    const edited = state().editing;
    store.cancelEdit();
    await H.settle();
    await rightAt(H, elementSpot('face', top));
    await gclick(H, 'edit-feature-sketch');
    await H.settle();
    const sketchEdited = state().editing;
    store.cancelEdit();
    await H.settle();
    const sketchId = state().doc.features.find((f) => f.type === 'sketch')?.id;
    return { pass: edited?.featureId === extrude && edited.kind === 'feature' && sketchEdited?.featureId === sketchId && sketchEdited.kind === 'sketch', edited, sketchEdited };
  });

  // ---------------------------------------------------------------- the sketch
  let line;
  await step('10 草圖 on the face (the right click) starts a sketch on that face', async () => {
    await rightAt(H, elementSpot('face', top));
    await gclick(H, 'sketch');
    await H.settle();
    const s = H.sketch();
    const ok = state().editing?.kind === 'sketch' && s?.plane.kind === 'face' && s.plane.name === result().faceNames[top];
    await H.frameSketch(8, 5, 8);
    return { pass: ok, plane: s?.plane };
  });

  await step('11 a drawing tool on: 結束目前的工具 first, then 快速抓取 ▸; it ends the tool', async () => {
    await H.tool('直線');
    await H.sk(3, 3, { ctrlKey: true });
    await H.sk(13, 7, { ctrlKey: true });
    await H.solved();
    line = H.lineWhere((g) => Math.abs(g.a[0] - 3) < 0.5 && Math.abs(g.b[0] - 13) < 0.5);
    await rightAt(H, H.toClient(-10, 12));
    const what = gmenu()?.dataset.graphicsMenu;
    const ids = gids();
    await gclick(H, 'sketch-end-tool');
    return { pass: what === 'sketch-tool' && same(ids, ['sketch-end-tool', 'quick-snap']) && H.view().tool === 'select' && !!line, what, ids, tool: H.view().tool, line };
  });

  await step('12 an entity: 加入限制條件 ▸, 智慧型尺寸, 構造線, 選擇鏈, 刪除, 正視於, 離開草圖; the entity is selected first', async () => {
    const [u, v] = H.onEntity(line, 0.5);
    await rightAt(H, H.toClient(u, v));
    const what = gmenu()?.dataset.graphicsMenu;
    const ids = gids();
    const selection = [...H.view().selection];
    await closeMenus(H);
    return { pass: what === 'sketch-entity' && same(ids, ['add-relation', 'tool-dimension', 'construction', 'sketch-select-chain', 'sketch-delete', 'view-normal', 'exit-sketch']) && same(selection, [line]), what, ids, selection };
  });

  await step('13 加入限制條件 ▸ 水平 adds a horizontal relation on the line', async () => {
    const before = H.sketch().constraints.length;
    const [u, v] = H.onEntity(line, 0.5);
    await rightAt(H, H.toClient(u, v));
    await gclick(H, 'add-relation');
    const offered = gids();
    await gclick(H, 'relation-horizontal');
    await H.solved();
    await H.settle();
    const c = H.sketch().constraints.at(-1);
    return { pass: offered.includes('relation-horizontal') && H.sketch().constraints.length === before + 1 && c.type === 'horizontal' && c.a === line, offered, last: c };
  });

  await step('14 構造線 turns the line to construction', async () => {
    const [u, v] = H.onEntity(line, 0.5);
    await rightAt(H, H.toClient(u, v));
    await gclick(H, 'construction');
    await H.settle();
    return { pass: H.construction(line) };
  });

  await step('15 智慧型尺寸 starts from the line: the next click places its length', async () => {
    const before = H.sketch().constraints.length;
    const g = H.geom().get(line);
    const length = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    const [u, v] = H.onEntity(line, 0.5);
    await rightAt(H, H.toClient(u, v));
    await gclick(H, 'tool-dimension');
    const tool = H.view().tool;
    await H.sk(u, v - 3);
    await H.wait(300);
    await H.settle();
    store.editDimension(null);
    await H.selectTool();
    const c = H.sketch().constraints.at(-1);
    return { pass: tool === 'dimension' && H.sketch().constraints.length === before + 1 && c.type === 'distance' && c.a === line && S.near(Number(c.value), length, 1e-3), tool, last: c, length };
  });

  await step('16 選擇鏈 on one side of a rectangle selects its four sides', async () => {
    await H.tool('邊角矩形');
    await H.sk(17, 2, { ctrlKey: true });
    await H.sk(27, 10, { ctrlKey: true });
    await H.solved();
    await H.selectTool();
    const sides = [...H.geom()].filter(([id, g]) => g.type === 'line' && id !== line && g.a[0] > 16 && g.b[0] > 16).map(([id]) => id);
    const bottom = H.lineWhere((g, id) => sides.includes(id) && Math.abs(g.a[1] - 2) < 0.5 && Math.abs(g.b[1] - 2) < 0.5);
    const [u, v] = H.onEntity(bottom, 0.5);
    await rightAt(H, H.toClient(u, v));
    await gclick(H, 'sketch-select-chain');
    const selection = [...H.view().selection].sort();
    return { pass: sides.length === 4 && same(selection, [...sides].sort()), selection, sides };
  });

  await step('17 刪除 removes the line that was right-clicked', async () => {
    const [u, v] = H.onEntity(line, 0.5);
    await rightAt(H, H.toClient(u, v));
    await gclick(H, 'sketch-delete');
    await H.solved();
    return { pass: !H.sketch().entities.some((e) => e.id === line) };
  });

  await step('18 empty space of the sketch: the tools drawn most, 正視於, 離開草圖; 離開草圖 leaves the sketch, kept', async () => {
    await rightAt(H, H.toClient(-10, 12));
    const what = gmenu()?.dataset.graphicsMenu;
    const ids = gids();
    const id = state().editing?.featureId;
    await gclick(H, 'exit-sketch');
    await H.settle();
    return { pass: what === 'sketch-empty' && same(ids, ['tool-line', 'tool-rect', 'tool-circle', 'tool-arc', 'tool-dimension', 'view-normal', 'exit-sketch']) && state().editing === null && !!feature(id) && feature(id).entities.length >= 4, what, ids };
  });

  void sketch;
  return { name: 'context menus: part and sketch (ADR 0176)', steps: [...steps], pass: steps.length > 0 && steps.every((s) => s.pass) };
};

// ================================================================ the assembly
C.assembly = async () => {
  steps.length = 0;
  await import(here + 'phase2-assembly.js?' + Date.now());
  const H = window.__ui2;
  const { store } = H;
  const comp = (id) => H.asm().doc.components.find((c) => c.id === id);
  const spot = (id) => {
    const r = H.rect();
    for (let fy = 0.1; fy < 0.95; fy += 0.04) {
      for (let fx = 0.05; fx < 0.97; fx += 0.04) {
        const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
        if (store.viewer.pickInstance(x, y) === id) return { x, y };
      }
    }
    return null;
  };
  const emptySpot = () => {
    const r = H.rect();
    for (let fy = 0.15; fy < 0.95; fy += 0.05) {
      for (let fx = 0.05; fx < 0.97; fx += 0.05) {
        const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
        if (store.viewer.pickInstance(x, y) === null) return { x, y };
      }
    }
    return null;
  };
  const cmenu = () => document.querySelector('[data-component-menu]');
  const cids = () => [...(cmenu()?.querySelectorAll('li[data-action]') ?? [])].map((li) => li.dataset.action);
  const cclick = async (action) => {
    const li = cmenu()?.querySelector(`li[data-action="${action}"]`);
    if (!li) throw new Error(`no menu line ${action}: ${cids().join(' | ')}`);
    li.click();
    await H.wait(250);
  };
  const ON_COMPONENT = ['open-component', 'relink-component', 'mate', 'move-component', 'rotate-component', 'float-component', 'hide-component', 'transparent-component', 'suppress-component', 'delete-component'];
  let block;

  await step('1 a new assembly with the plate (fixed) and the V-block (floating)', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.insert('定位板.3dbx');
    block = (await H.insert('V型塊.3dbx', [0.5, 0.2])).id;
    await H.loaded();
    await H.hud('等角');
    await H.hud('全部顯示');
    return { pass: !!block && comp(block)?.fixed === false };
  });

  await step('2 a component: open, re-link, 結合, 移動, 旋轉, 固定 (it floats), 隱藏, 透明, 抑制, 刪除; it is selected first', async () => {
    store.assembly.select(null);
    const at = spot(block);
    if (!at) return { pass: false, why: 'no point of the V-block under the pointer' };
    await rightAt(H, at);
    const ids = cids();
    const selected = H.asm().selected;
    await closeMenus(H);
    return { pass: same(ids, ON_COMPONENT.map((x) => (x === 'float-component' ? 'fix-component' : x))) && selected === block, ids, selected };
  });

  await step('3 the tree row offers the same lines', async () => {
    const row = document.querySelector(`[data-component-row="${block}"]`);
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 8, button: 2 }));
    await H.wait(150);
    const ids = cids();
    await closeMenus(H);
    return { pass: same(ids, ON_COMPONENT.map((x) => (x === 'float-component' ? 'fix-component' : x))), ids };
  });

  await step('4 隱藏 hides the component; 隱藏 again (now 顯示) shows it', async () => {
    await rightAt(H, spot(block));
    await cclick('hide-component');
    const hidden = comp(block).hidden === true;
    const row = document.querySelector(`[data-component-row="${block}"]`);
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 8, button: 2 }));
    await H.wait(150);
    const label = cmenu()?.querySelector('[data-action="hide-component"]')?.textContent;
    await cclick('hide-component');
    return { pass: hidden && label === '顯示' && !comp(block).hidden, hidden, label };
  });

  await step('5 抑制 suppresses the component; 復原 brings it back', async () => {
    await rightAt(H, spot(block));
    await cclick('suppress-component');
    const suppressed = comp(block).suppressed === true;
    store.undo();
    await H.wait(300);
    return { pass: suppressed && !comp(block).suppressed, suppressed };
  });

  await step('6 結合 opens the mate PropertyManager; 移動零組件 the move one', async () => {
    await rightAt(H, spot(block));
    await cclick('mate');
    const mating = !!H.asm().mate;
    store.assembly.cancelMate();
    await H.wait(200);
    await rightAt(H, spot(block));
    await cclick('move-component');
    const moving = H.asm().move?.tool === 'move';
    store.assembly.closeMove();
    await H.wait(200);
    return { pass: mating && moving && !H.asm().mate && !H.asm().move, mating, moving };
  });

  await step('7 empty space: 插入零組件, 結合 and the view; 插入零組件 opens its PropertyManager', async () => {
    const at = emptySpot();
    if (!at) return { pass: false, why: 'no empty point' };
    await rightAt(H, at);
    const what = gmenu()?.dataset.graphicsMenu;
    const ids = gids();
    await gclick(H, 'insert-component');
    await H.wait(200);
    const inserting = !!H.asm().insert;
    store.assembly.cancelInsert();
    await H.wait(200);
    return { pass: what === 'assembly-empty' && same(ids, ['insert-component', 'mate', 'fit', 'view-normal', 'standard-views', 'filter-bar']) && inserting && !cmenu(), what, ids, inserting };
  });

  return { name: 'context menus: assembly (ADR 0176)', steps: [...steps], pass: steps.length > 0 && steps.every((s) => s.pass) };
};
