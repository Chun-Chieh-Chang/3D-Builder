// ADR 0127 replay (docs/adr/0127-sketch-plane-entries.md): 「偏移草圖」 and 「角度草圖」 in one command each, a reference plane, axis,
// point and coordinate system clicked in the graphics area (and a datum dot that does not reach past itself), a coordinate system
// sketched on, the distance the next plane starts from,
// the 「基準面」 box of the selection filter, and the two ways a sketch meeting a plane whose frame the last rebuild did not have yet can
// end — waiting for it, or saying why it cannot. Replayed the way a person does it in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sketch-plane.js?' + Date.now());   // in a freshly loaded page
//   await __manualSkPlane.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state } = S;
const M = (window.__manualSkPlane = {});

const ids = (type) => state().doc.features.filter((f) => f.type === type).map((f) => f.id);
const nameOf = (id) => state().doc.features.find((f) => f.id === id)?.name ?? '';

M.run = async () => {
  let plane;
  let axis;
  let system;
  let point;
  let tiltedSketch;
  await step('1 「偏移草圖」: 25 off the front plane; the sketch editor opens on the plane it made', async () => {
    await S.fresh();
    await H.treeClick('前基準面');
    await H.action('草圖', '偏移草圖');
    await H.pmInput('偏移距離', '25');
    await H.pmOk();
    plane = ids('refPlane')[0];
    const sketch = store.editedSketch();
    const frame = sketch ? store.frameOf(sketch) : null;
    return { pass: ids('refPlane').length === 1 && !!sketch && sketch.plane.name === plane && !!frame && S.near(frame.origin[2], 25, 1e-6), planes: ids('refPlane'), z: frame?.origin[2], editing: state().editing?.kind };
  });
  await step('2 what is drawn on it is really 25 up: a 10 × 6 × 6 block has its mass centre at z = 28', async () => {
    await H.exitSketch();
    const sk = await S.rectSketch(nameOf(plane), 10, 6, { center: true });
    await S.extrude(sk, 6);
    const m = state().result.mass;
    return { pass: S.near(m.volume, 360, 1e-3) && S.near(m.center[2], 28, 1e-3), volume: m.volume, center: m.center };
  });
  await step('3 a plane clicked in the graphics area becomes the selection, and 「草圖」 opens on it', async () => {
    await H.key('f');
    await H.wait(150);
    await H.at([9, 7, 25]); // on the plane, clear of the block
    const selected = state().selected;
    await H.action('草圖', '草圖');
    const sketch = store.editedSketch();
    const opened = !!sketch && sketch.plane.name === plane;
    if (opened) await H.exitSketch();
    return { pass: selected === plane && opened, selected, plane };
  });
  await step('4 「座標系統」 can be sketched on: at the corner of the block picked for its origin', async () => {
    await H.action('檢視', '等角'); // separate the top vertex from its projection on the support plane
    await H.action('特徵', '座標系統');
    await H.at([5, 3, 31]);
    await H.pmOk();
    system = ids('coordSys')[0];
    await H.treeClick(nameOf(system));
    await H.action('草圖', '草圖');
    const sketch = store.editedSketch();
    const frame = sketch ? store.frameOf(sketch) : null;
    const opened = !!sketch && sketch.plane.name === system && !!frame && S.near(frame.origin[2], 31, 1e-6);
    if (opened) await H.exitSketch();
    return { pass: opened, system, origin: frame?.origin };
  });
  await step('4b a coordinate system clicked on one of its arms in the graphics area becomes the selection', async () => {
    await H.action('檢視', '等角'); // three arms that point in three different screen directions
    store.select(null);
    await H.settle();
    const cleared = state().selected === null;
    const f = store.planeFrameOf({ kind: 'datum', name: system });
    const reach = 20 * store.viewer.pixelSize(); // halfway along an arm, which the viewer draws 40 px long
    const p = f.origin.map((v, i) => v + f.normal[i] * reach);
    const c = H.worldToClient(p);
    // the pixel is on the arm and on nothing else: a vertex or an edge there would be the honest winner
    const on = ((o) => o.vertex < 0 && o.edge < 0 && o.datum === system)(store.viewer.pickOrder(c.x, c.y));
    await H.clickXY(c);
    await H.settle();
    return { pass: cleared && on && state().selected === system, cleared, on, selected: state().selected };
  });
  await step('5 「草圖」 right after the rollback bar goes back: it waits for the rebuild that finds the plane, then opens', async () => {
    await store.rollTo(state().doc.features[0].id);
    await H.settle();
    const hadIt = state().result.frames.has(plane);
    await store.rollTo(null);
    store.newSketch({ kind: 'datum', name: plane }); // what the 「草圖」 button does, one tick later, like a fast click
    const waited = state().pendingSketch !== null;
    await H.settle();
    const sketch = store.editedSketch();
    const opened = !!sketch && sketch.plane.name === plane;
    if (opened) await H.exitSketch();
    return { pass: !hadIt && waited && opened, hadIt, waited, opened };
  });
  await step('6 a plane the rollback bar keeps out says why, and puts nothing in the tree', async () => {
    await store.rollTo(state().doc.features[0].id);
    await H.settle();
    const before = state().doc.features.length;
    store.newSketch({ kind: 'datum', name: plane });
    const waited = state().pendingSketch !== null;
    await H.settle();
    const added = state().doc.features.length - before;
    const notice = S.notice(); // read before the next command, which clears an error notice
    await store.rollTo(null);
    await H.settle();
    return { pass: waited && added === 0 && !state().editing && notice.includes('找不到草圖所在的平面'), waited, added, notice, failed: S.failed() };
  });
  await step('7 the next 「偏移草圖」 starts at the distance just confirmed (25), not at 10', async () => {
    const stored = state().options.datumOffset;
    await H.treeClick('前基準面');
    await H.action('草圖', '偏移草圖');
    const shown = pmField('偏移距離');
    await H.pmInput('偏移距離', '40');
    await H.pmOk();
    const second = ids('refPlane').at(-1);
    const sketch = store.editedSketch();
    const frame = sketch ? store.frameOf(sketch) : null;
    const opened = !!sketch && sketch.plane.name === second;
    if (opened) await H.exitSketch();
    return { pass: stored === '25' && shown === '25' && state().options.datumOffset === '40' && opened && S.near(frame?.origin[2], 40, 1e-6), stored, shown, now: state().options.datumOffset, opened, z: frame?.origin[2] };
  });
  await step('8 「基準軸」 from two planes, then clicked in the graphics area: it becomes the selection', async () => {
    await H.action('特徵', '基準軸');
    await H.pmSelect('planes'); // 兩平面交線
    await chip(nameOf(plane)); // 基準面1 (z = 25)
    await chip('右基準面'); // x = 0 → the line runs along y at z = 25, through what the camera frames
    await H.pmOk();
    axis = ids('refAxis')[0];
    await store.select(null);
    await H.at([0, 5, 25]); // on the drawn line, clear of the block
    return { pass: !!axis && state().selected === axis, axis, selected: state().selected };
  });
  await step('9 「角度草圖」: the axis clicked in the graphics area fills its box, and the sketch is turned 30°', async () => {
    await H.treeClick('前基準面');
    await H.action('草圖', '角度草圖');
    await H.at([0, 5, 25]);
    const tilted = ids('refPlane').at(-1);
    const filled = state().doc.features.find((f) => f.id === tilted)?.def.axis?.name;
    await H.pmInput('角度', '30');
    await H.pmOk();
    const sketch = store.editedSketch();
    const frame = sketch ? store.frameOf(sketch) : null;
    const up = frame ? Math.abs(frame.normal[2]) : 0;
    const opened = !!sketch && sketch.plane.name === tilted;
    let statusOk = false;
    if (opened) {
      tiltedSketch = sketch.name;
      await H.tool('直線');
      const statusText = document.querySelector('[data-sketch-tool-status]')?.textContent ?? '';
      const hintText = H.view()?.hint ?? '';
      statusOk = statusText.includes(sketch.name) && statusText.includes(nameOf(tilted)) && statusText.includes('直線') && hintText.length > 0 && statusText.includes(hintText);
      await H.selectTool();
      await H.exitSketch();
    }
    return { pass: opened && filled === axis && S.near(up, Math.cos(Math.PI / 6), 1e-6) && statusOk, filled, opened, up, statusOk, normal: frame?.normal };
  });
  await step('10 「參考點」 in the middle of the block, then clicked in the graphics area (it is drawn over the model, so it takes the click)', async () => {
    await H.action('特徵', '參考點');
    await H.pmInput('Z', '28');
    await H.pmOk();
    point = ids('refPoint').at(-1);
    await store.select(null);
    await H.at([0, 0, 28]);
    return { pass: !!point && state().selected === point, point, selected: state().selected };
  });
  await step('10b a datum point does not reach past its own dot: 25 px away the model face takes the click', async () => {
    await H.action('檢視', '等角');
    await H.settle();
    const q = state().result.points.get(point);
    const c = H.worldToClient([q[0], q[1], q[2] + 25 * store.viewer.pixelSize()]); // 25 px up: past the 11 px a dot is allowed, off any line
    const datum = store.viewer.pickDatum(c.x, c.y);
    await store.select(null);
    await H.clickXY(c);
    await H.settle();
    return { pass: datum !== point && state().selected !== point && !!state().selectedFace, datum, selected: state().selected, face: state().selectedFace?.fingerprint?.type ?? null };
  });
  await step('11 the 「基準面」 of 選擇濾器 really gates (the bar is hidden until F5, radio since ADR 0145): 基準面 only on, the click picks the plane; 面 only on, it picks nothing; F6 restores', async () => {
    const box = (label) => [...document.querySelectorAll('.pick-filter label')].find((l) => l.textContent.trim() === label)?.querySelector('input');
    await H.key('f');
    await H.wait(150);
    store.togglePickFilterBar(); // the bar is hidden until asked, as in SW (ADR 0145); the F5 key path is exercised in manual-c21
    await H.wait(150);
    box('基準面').click(); // the live filter of the graphics area, the kind a person picks (「選項」裡那一列是下一份零件的起手，刻意不等於這一頁)
    await H.settle();
    await H.wait(150); // the filter reaches the viewer through a render, like it does for a person moving the mouse after clicking the box
    await store.select(null);
    await H.at([9, 7, 25]);
    const on = state().selected;
    const isPlane = state().doc.features.find((f) => f.id === on)?.type === 'refPlane';
    box('面').click();
    await H.settle();
    await H.wait(150);
    await store.select(null);
    await H.at([9, 7, 25]);
    const off = state().selected;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', bubbles: true })); // 清除所有濾器：全部種類恢復可點
    await H.settle();
    await H.wait(150);
    store.togglePickFilterBar(); // hide the bar again, back as it was
    return { pass: on !== null && isPlane && off === null && state().pickFilter.planes === true, off, on, isPlane, pf: state().pickFilter };
  });
  await step('12 rotated custom plane normal vs oblique view cursor landing and solved line match within 1e-4 mm, and nothing in the tree is left broken', async () => {
    await S.treeEdit(tiltedSketch);
    const frame = store.frameOf(store.editedSketch());
    await H.tool('直線');
    await H.action('檢視', '正視於');
    await H.frameSketch(3, -1.5, 12);
    const c1 = H.toClient(6, -3);
    const pNormal = store.viewer.planePoint(c1.x, c1.y, frame);
    await H.sk(0, 0);
    await H.action('檢視', '等角');
    await H.frameSketch(3, -1.5, 12);
    const c2 = H.toClient(6, -3);
    const pOblique = store.viewer.planePoint(c2.x, c2.y, frame);
    await H.sk(6, -3);
    await H.solved();
    await H.selectTool();
    const lineId = H.sketch().entities.find((e) => e.type === 'line')?.id;
    const g = lineId ? H.geom().get(lineId) : null;
    const landingOk =
      !!pNormal &&
      !!pOblique &&
      !!g &&
      Math.hypot(pNormal[0] - 6, pNormal[1] + 3) < 1e-4 &&
      Math.hypot(pOblique[0] - 6, pOblique[1] + 3) < 1e-4 &&
      Math.hypot(g.a[0], g.a[1]) < 1e-4 &&
      Math.hypot(g.b[0] - 6, g.b[1] + 3) < 1e-4;
    await H.exitSketch();
    return { pass: landingOk && S.failed().length === 0, landingOk, pNormal, pOblique, failed: S.failed(), volume: state().result.mass?.volume };
  });
  // 收尾把文件清乾淨：這支腳本會留下一個未儲存的零件，12 支腳本的批次實測在這裡出現「Blocked attempt to show a 'beforeunload'
  // confirmation panel…」，接著下一次載入页面就永久卡住（當下的 verify:ui 還沒有對話框處理與呼叫逾時，那兩項之後由 620473d 補上）。
  await S.fresh();
  return S.result('sketch-plane');
};

const pmField = (label) => [...document.querySelectorAll('.property-manager .pm-row')].find((r) => r.querySelector('span')?.textContent === label)?.querySelector('input')?.value;
/** A datum from the buttons of the PropertyManager (the FeatureManager is hidden while a session is open, ADR 0034 決定 9). */
const chip = async (label) => {
  const b = [...document.querySelectorAll('.property-manager .datum-picker button')].find((x) => x.title === label);
  if (!b) throw new Error(`no datum button ${label}`);
  b.click();
  await H.settle();
};
