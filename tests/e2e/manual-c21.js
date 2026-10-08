// Manual checklist C21 (docs/manual-verification.html): the selection filter (面 off: a face cannot be picked; only 邊線 on), the right-hand menu on a fillet edge (「選取相切的邊線」,
// 「選取迴圈」), 「選取相切的面」 while 「刪除面」 is open, and 「選取其他…」 on the wall of a shelled box, replayed the way a person does it in the app's page (http://127.0.0.1:5391,
// 1280×720; `npm run verify:ui` does it). Not a Vitest test. The clicks are pointer events at the screen position of a point of the edge or the face, so the viewer has to find what is
// there itself (phase3-select-elements.js calls the viewer's handlers instead).
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c21.js?' + Date.now());   // in a freshly loaded page
//   await __manualC21.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC21 = {});

/** The world position of the middle of an edge of the result. */
const edgeMid = (edge) => {
  const m = state().result.mesh;
  for (let g = 0; g < m.edgeRanges.length; g += 3) {
    if (m.edgeRanges[g + 2] !== edge) continue;
    const start = m.edgeRanges[g];
    const count = m.edgeRanges[g + 1];
    const k = start + Math.floor(count / 2);
    return [m.edgePoints[k * 3], m.edgePoints[k * 3 + 1], m.edgePoints[k * 3 + 2]];
  }
  throw new Error(`no edge ${edge}`);
};
/** A right click at a world point: the menu of the graphics area comes up; its buttons' texts. */
async function rightClick(P) {
  const { x, y } = H.worldToClient(P);
  H.ptr('pointermove', x, y);
  await H.wait(80);
  H.canvas().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  await H.wait(200);
  return [...document.querySelectorAll('.ctx-menu button')].map((b) => b.textContent);
}
const menuClick = async (re) => {
  const b = [...document.querySelectorAll('.ctx-menu button')].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`no menu item ${re}: ${[...document.querySelectorAll('.ctx-menu button')].map((x) => x.textContent).join(' | ')}`);
  b.click();
  await H.settle();
};
const filter = async (label, on) => {
  const box = [...document.querySelectorAll('.pick-filter label')].find((l) => l.textContent.trim() === label).querySelector('input');
  if (box.checked !== on) box.click();
  await H.wait(150);
};
const picked = () => state().selectedElements.map((e) => `${e.kind}:${e.name}`);

M.run = async () => {
  let arcEdge;
  await step('1 新示範件 in the isometric view', async () => {
    await S.fresh();
    await H.action('檔案', '新示範件');
    await S.iso();
    const r = state().result;
    arcEdge = r.edgeFingerprints.findIndex((fp) => fp.type === 'circle' || fp.type === 'arc');
    return { arcEdge, kinds: [...new Set(r.edgeFingerprints.map((f) => f.type))], pass: arcEdge >= 0 };
  });
  await step('2 選擇濾器: 面 off, a click on the top face picks nothing; with only 邊線 on, a click on an edge picks the edge', async () => {
    const top = S.planeFace(1, 5);
    await filter('面', false);
    await H.at(top.center);
    const withoutFaces = { face: state().selectedFace?.name ?? null, elements: picked() };
    await filter('面', true);
    await filter('頂點', false);
    await H.at(edgeMid(0));
    const onlyEdges = picked();
    await shot('2-an-edge-picked');
    await filter('頂點', true);
    return { withoutFaces, onlyEdges, pass: withoutFaces.face === null && withoutFaces.elements.length === 0 && onlyEdges.length === 1 && onlyEdges[0].startsWith('edge:') };
  });
  // The checklist (before 2026-10-08) said to right-click an edge of the fillet with nothing open. The menu has 選取相切的邊線 and 選取迴圈 only while a feature that picks edges is
  // open (「圓角」, 「導角」): the multi-select of D5.6 is a help for filling that list. Without one the menu has nothing of the kind.
  await step('3 without a feature open the right-click on an edge offers no tangent chain (only 選取其他… when faces are stacked)', async () => {
    store.selectElement(null, false);
    await H.settle();
    const items = await rightClick(edgeMid(arcEdge));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await H.wait(150);
    return { items, pass: !items.some((x) => /選取相切的邊線|選取迴圈/.test(x)) };
  });
  await step('4 「圓角」 open, right-click on an edge of the fillet: 選取相切的邊線 puts the whole chain in the list', async () => {
    await H.action('特徵', '圓角');
    const items = await rightClick(edgeMid(arcEdge));
    await shot('4-edge-menu');
    await menuClick(/選取相切的邊線/);
    await S.iso();
    const fillet = state().doc.features.filter((f) => f.type === 'fillet').at(-1); // the demo part has a fillet of its own: the one just opened is the last
    const chain = fillet.edges.map((e) => e.name);
    await shot('4-tangent-edges-selected');
    return { items, chain, pass: items.some((x) => /選取相切的邊線/.test(x)) && items.some((x) => /選取迴圈（面/.test(x)) && chain.length >= 3 };
  });
  await step('5 right-click again: 選取迴圈（面 …） adds the whole outline of that face; ✕', async () => {
    const last = () => state().doc.features.filter((f) => f.type === 'fillet').at(-1).edges.length;
    const before = last();
    const items = await rightClick(edgeMid(arcEdge));
    const loop = items.find((x) => /選取迴圈（面/.test(x));
    await menuClick(/選取迴圈（面/);
    const after = last();
    await shot('5-loop-selected');
    document.querySelector('.property-manager .pm-cancel').click();
    await H.settle();
    return { loop, before, after, pass: !!loop && after >= 4 && after >= before };
  });
  await step('6 「刪除面」 open, right-click on the face of the fillet: 選取相切的面 adds the faces tangent to it', async () => {
    store.selectElement(null, false);
    await H.settle();
    await H.action('特徵', '刪除面');
    const r = state().result;
    const cyl = r.faceFingerprints.findIndex((fp) => fp.type === 'cylinder');
    const centre = r.faceFingerprints[cyl].center;
    const before = [...S.pm().querySelectorAll('.selection-box li')].length;
    const items = await rightClick(centre);
    await menuClick(/選取相切的面/);
    const rows = [...S.pm().querySelectorAll('.selection-box li')].map((li) => li.textContent);
    await shot('5-tangent-faces-in-the-list');
    document.querySelector('.property-manager .pm-cancel').click();
    await H.settle();
    return { items, before, rows, pass: items.some((x) => /選取相切的面/.test(x)) && rows.length >= 2 };
  });
  await step('7 a shelled box: right-click on an outer wall, 選取其他…（共 N 個面） lists the faces from the front, one behind it is picked', async () => {
    await S.box(40, 30, 10);
    await S.iso();
    await H.at(S.planeFace(1, 10).center);
    await H.action('特徵', '薄殼');
    await H.pmInput('壁厚', '2');
    await H.pmOk();
    await S.iso();
    const r = state().result;
    const wall = r.faceFingerprints.map((fp, i) => ({ fp, i })).filter(({ fp }) => fp.type === 'plane' && fp.dir && Math.abs(fp.dir[0]) > 0.99).sort((a, b) => b.fp.center[0] - a.fp.center[0])[0];
    const items = await rightClick(wall.fp.center);
    const other = items.find((x) => /選取其他/.test(x));
    await shot('6-other-menu');
    await menuClick(/選取其他/);
    const list = [...document.querySelectorAll('.ctx-menu button')].map((b) => b.textContent);
    await shot('6-other-list');
    const last = list.at(-1);
    await menuClick(new RegExp(last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const chosen = state().selectedFace?.name ?? null;
    return { other, list, chosen, front: r.faceNames[wall.i], pass: !!other && /共 \d+ 個面/.test(other) && list.length >= 2 && !!chosen && chosen !== r.faceNames[wall.i] };
  });
  return S.result('C21');
};
