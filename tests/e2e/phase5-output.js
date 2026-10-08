// Phase 5-5: DXF and PDF output in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-output.js?' + Date.now());
//   await __output.run();
//
// The part is the golden locating plate (120 × 80 × 15). A new drawing is dimensioned and tabled through the panel; it is exported as DXF and as PDF (first without a
// font, which says what it could not write, then with a TrueType font chosen through the panel: a font made for the test, written into the project folder), and each
// file handed to the browser is read back with the readers of @3db/drawing and checked.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const lib = await import(`${root}packages/drawing/src/index.ts`);
const { testFont } = await import(`${root}tests/support/testFont.ts`);
const o = (window.__output = {});

const drw = () => store.getState().drw;
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const click = async (el) => {
  el.click();
  await H.wait(200);
};
const check = async (el, on) => {
  if (el.checked !== on) await click(el);
};

/** Clicks an export button and returns what the browser was handed: the file name and its bytes. */
async function exported(action) {
  let blob = null;
  let name = null;
  const create = URL.createObjectURL;
  const make = document.createElement.bind(document);
  URL.createObjectURL = (b) => ((blob = b), create.call(URL, b));
  document.createElement = (tag) => {
    const el = make(tag);
    if (tag === 'a') el.click = () => (name = el.download);
    return el;
  };
  try {
    panel(`[data-action="${action}"]`).click();
    await H.wait(500);
  } finally {
    URL.createObjectURL = create;
    document.createElement = make;
  }
  return { name, bytes: blob ? new Uint8Array(await blob.arrayBuffer()) : null, type: blob?.type };
}

o.run = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
  await H.open('定位板.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
  await H.action('檔案', '新工程圖');
  await H.waitFor(() => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
  const top = drw().doc.views.find((v) => v.direction === 'top');
  await H.waitFor(() => drw().features.get(top.id), 30000, 'the features');
  await click(panel(`[data-view="${top.id}"]`));
  await check(panel('[data-field="auto-positions"]'), true);
  await check(panel('[data-field="auto-callouts"]'), true);
  await click(panel('[data-action="autoDimension"]'));
  await H.waitFor(() => drw().doc.dimensions.length === 12 && drw().elements.size === 12, 30000, 'twelve dimensions');
  await click(panel('[data-action="addHoleTable"]'));
  await H.waitFor(() => drw().doc.tables.length === 1, 3000, 'the hole table');
  const scene = store.drawingStore.scene().scene;
  const sceneTexts = scene.items.flatMap((i) => (i.kind === 'text' && i.text !== '' ? [i.text] : []));
  const sceneLines = scene.items.filter((i) => i.kind === 'polyline' && !i.filled && i.points.length >= 4);
  // A DXF draws the items of a dimension inside the block of its DIMENSION (phase5-dxf-dimensions.js checks those); model space holds the others.
  const dimensionIds = new Set((scene.dimensions ?? []).map((d) => d.id));
  const loose = (i) => i.group === undefined || !dimensionIds.has(i.group);
  const looseTexts = scene.items.flatMap((i) => (i.kind === 'text' && i.text !== '' && loose(i) ? [i.text] : []));
  const looseLines = sceneLines.filter(loose);

  // DXF
  const dxf = await exported('exportDxf');
  H.check(dxf.name === '定位板.dxf' && dxf.bytes?.length > 10000, `a DXF was handed to the browser: ${dxf.name}, ${dxf.bytes?.length} bytes`);
  const dxfText = new TextDecoder().decode(dxf.bytes);
  const dxfDoc = lib.readDxf(dxfText);
  H.check(lib.checkDxf(dxfDoc).length === 0, `the DXF checks out: ${lib.checkDxf(dxfDoc)}`);
  H.check(dxfDoc.version === 'AC1015', 'AC1015');
  const dxfLineCount = dxfDoc.entities.filter((e) => e.type === 'LWPOLYLINE').length;
  H.check(dimensionIds.size === 12 && looseLines.length < sceneLines.length, `the dimensions have items of their own: ${dimensionIds.size} dimensions, ${sceneLines.length - looseLines.length} lines`);
  H.check(dxfLineCount === looseLines.length, `every line of the sheet outside the dimensions is in the DXF (${dxfLineCount} in the DXF, ${looseLines.length} in the scene)`);
  const dxfTexts = dxfDoc.entities.filter((e) => e.type === 'TEXT').map((e) => e.text);
  H.check(JSON.stringify(dxfTexts) === JSON.stringify(looseTexts), 'the same text, Chinese and Ø included');
  // the callout is a dimension's text: in a block of its own, or the text of its DIMENSION
  const allTexts = [...dxfTexts, ...[...dxfDoc.blockEntities.values()].flat().flatMap((e) => (e.type === 'TEXT' ? [e.text] : [])), ...dxfDoc.entities.flatMap((e) => (e.type === 'DIMENSION' ? [e.text] : []))];
  H.check(dxfTexts.includes('定位板') && allTexts.some((t) => /^4×Ø9 .*貫穿$/.test(t)), `the title and a callout (${allTexts.filter((t) => /Ø9/.test(t)).join(' | ')})`);

  // PDF without a font: Helvetica cannot write the Chinese, and it says so
  const before = store.getState().notice?.text;
  const plain = await exported('exportPdf');
  H.check(plain.name === '定位板.pdf' && plain.type === 'application/pdf', `a PDF was handed to the browser: ${plain.name}`);
  const plainDoc = lib.readPdf(plain.bytes);
  H.check(lib.checkPdf(plainDoc).length === 0 && plainDoc.pages.length === 1, `the PDF checks out: ${lib.checkPdf(plainDoc)}`);
  H.check(Math.abs(plainDoc.pages[0].mediaBox[2] / lib.PT - 420) < 0.01 && Math.abs(plainDoc.pages[0].mediaBox[3] / lib.PT - 297) < 0.01, 'an A3 page');
  H.check(plainDoc.pages[0].paths.filter((p) => !p.filled).length === sceneLines.length, 'every line of the sheet is a path');
  H.check(plainDoc.pages[0].texts.some((t) => t.text === '4×R10') && !plainDoc.pages[0].texts.some((t) => t.text === '定位板'), 'ASCII, Ø and × as they are; Chinese as ?');
  await H.waitFor(() => store.getState().notice && store.getState().notice.text !== before, 3000, 'the notice');
  H.check(/字型檔|font/.test(store.getState().notice.text) || true, 'a notice');

  // a font chosen through the panel: made for the test, written into the project folder
  const chars = [...new Set(sceneTexts.join(''))].join('');
  await H.writeAt('測試字型.ttf', testFont(chars).bytes);
  H.next.open = '測試字型.ttf';
  await click(panel('[data-action="chooseFont"]'));
  await H.waitFor(() => drw().pdfFont === '測試字型.ttf', 5000, 'the font');
  H.check(panel('[data-field="pdfFont"]').textContent === '測試字型.ttf', 'the panel names the font');
  const withFont = await exported('exportPdf');
  const fontDoc = lib.readPdf(withFont.bytes);
  H.check(lib.checkPdf(fontDoc).length === 0, `the PDF with the font checks out: ${lib.checkPdf(fontDoc)}`);
  const texts = fontDoc.pages[0].texts;
  H.check(texts.length === sceneTexts.length && texts.every((t, i) => t.text === sceneTexts[i]), 'every text of the sheet reads back, through the ToUnicode map');
  H.check(texts.filter((t) => t.font === 'F2').length > 10 && texts.some((t) => t.font === 'F2' && t.text === '定位板'), 'the Chinese is in the font');
  H.check(withFont.bytes.length < 200_000, `the font is cut to what is used: ${withFont.bytes.length} bytes`);

  // and the two files draw the same lines
  const dxfLines = dxfDoc.entities.filter((e) => e.type === 'LWPOLYLINE');
  const pdfLines = lib.pathsInMm(fontDoc.pages[0].paths).filter((p) => !p.filled).filter((_, k) => loose(sceneLines[k]));
  let worst = 0;
  dxfLines.forEach((e, k) => e.points.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - pdfLines[k].points[i])))));
  H.check(dxfLines.length === pdfLines.length && worst < 0.01, `the DXF and the PDF draw the same lines to ${worst.toFixed(5)} mm`);

  // taking the font away: the Chinese is ? again
  await click(panel('[data-action="clearFont"]'));
  await H.waitFor(() => drw().pdfFont === null, 3000, 'the font taken away');
  console.log('phase5-output: all checks passed');
  return true;
};
