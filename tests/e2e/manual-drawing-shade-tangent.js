// ADR 0146 §7: a shaded view draws no line that is behind the part. The user saw 「圖彩部份會出現突兀的線條，可能是原本應該被遮蔽的輪廓線」: the tangent edges
// of the fillets at the back of the locating plate were drawn across its top face. In the app: the plate's isometric in 「帶邊線塗彩」 draws its seen tangent
// edges and none of the hidden ones, and on the page its lines are exactly those of 「移除隱藏線」; 「隱藏線可見」 draws the hidden ones dashed. Replayed in the
// app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-shade-tangent.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingShadeTangent.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const { toSheet } = await import(`${root}packages/drawing/src/index.ts`);
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingShadeTangent = {});

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
const drw = () => store.getState().drw;
const d = () => store.drawingStore;
const iso = () => drw().doc.pages[drw().page ?? 0].views.find((v) => v.direction === 'isometric') ?? drw().doc.pages[0].views.find((v) => v.direction === 'isometric');
/** A view's polyline as the scene has it on the sheet, as a key. */
const key = (style, pts) => `${style}:${pts.map((v) => v.toFixed(3)).join(',')}`;
const onSheet = (l) => {
  const placed = d().scene().placed.get(iso().id);
  const out = [];
  for (let i = 0; i < l.length; i += 2) out.push(...toSheet(placed, l[i], l[i + 1]));
  return out;
};
const sceneKeys = () => new Set(d().scene().scene.items.filter((i) => i.kind === 'polyline').map((i) => key(i.style, i.points)));
/** The lines on the page: the SVG's polylines (the images left out). */
const pageLines = () => [...document.querySelectorAll('[data-svg] svg polyline, [data-svg] svg polygon')].map((p) => `${p.getAttribute('stroke-dasharray') ?? ''}|${p.getAttribute('points')}`).sort();
const setDisplay = async (display) => {
  d().setView(iso().id, { display });
  await H.waitFor(() => iso().display === display && drw().lines.get(iso().id), 30000, `the view in ${display}`);
  await H.wait(300);
};

M.run = async () => {
  await step('1 the locating plate and a drawing of its isometric in 「帶邊線塗彩」: the image of its faces is there, and it has tangent edges seen and hidden', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.newDrawing(['isometric']);
    await H.waitFor(() => iso() && drw().lines.get(iso().id), 30000, 'the isometric');
    await setDisplay('shadedEdges');
    await H.waitFor(() => drw().lines.get(iso().id)?.shade, 30000, 'the shading');
    const lines = drw().lines.get(iso().id);
    return { pass: (lines.tangent?.length ?? 0) >= 3 && (lines.tangentHidden?.length ?? 0) >= 3, tangent: lines.tangent?.length, hidden: lines.tangentHidden?.length };
  });
  await step('2 「帶邊線塗彩」 draws every seen tangent edge thin and none of the hidden ones', async () => {
    const lines = drw().lines.get(iso().id);
    const keys = sceneKeys();
    const seen = lines.tangent.filter((l) => keys.has(key('thin', onSheet(l)))).length;
    const hidden = lines.tangentHidden.filter((l) => keys.has(key('thin', onSheet(l))) || keys.has(key('hidden', onSheet(l))) || keys.has(key('visible', onSheet(l)))).length;
    return { pass: seen === lines.tangent.length && hidden === 0, seen, of: lines.tangent.length, hidden };
  });
  let shadedPage;
  await step('3 on the page, its lines are exactly those of 「移除隱藏線」 (only the image differs)', async () => {
    shadedPage = pageLines();
    await setDisplay('hiddenRemoved');
    const removed = pageLines();
    const images = document.querySelectorAll('[data-svg] svg image').length;
    return { pass: shadedPage.length > 0 && JSON.stringify(shadedPage) === JSON.stringify(removed) && images === 0, shaded: shadedPage.length, removed: removed.length, images };
  });
  await step('4 「隱藏線可見」 draws the hidden tangent edges dashed, with the other hidden lines', async () => {
    await setDisplay('hiddenVisible');
    const lines = drw().lines.get(iso().id);
    const keys = sceneKeys();
    const dashed = lines.tangentHidden.filter((l) => keys.has(key('hidden', onSheet(l)))).length;
    const thin = lines.tangentHidden.filter((l) => keys.has(key('thin', onSheet(l)))).length;
    return { pass: dashed === lines.tangentHidden.length && thin === 0, dashed, of: lines.tangentHidden.length, thin };
  });
  await step('5 back in 「帶邊線塗彩」: none of the hidden ones again', async () => {
    await setDisplay('shadedEdges');
    const lines = drw().lines.get(iso().id);
    const keys = sceneKeys();
    const hidden = lines.tangentHidden.filter((l) => ['thin', 'hidden', 'visible'].some((s) => keys.has(key(s, onSheet(l))))).length;
    return { pass: hidden === 0 && JSON.stringify(pageLines()) === JSON.stringify(shadedPage), hidden };
  });
  const pass = steps.every((s) => s.pass);
  return { name: 'manual-drawing-shade-tangent', steps, pass };
};
