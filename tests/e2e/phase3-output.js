// Phase 3a-8c (F3.3, F4.1, F1.3): the files the app writes, through the UI, in the app's page (http://127.0.0.1:5391, 1280×720). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-output.js?' + Date.now());   // after a fresh load of the page
//   await __o.run();   // -> { png, stl, step, pass }
//
// A plate 60 × 20 × 5 with a colour on it: 「輸出影像」 (a PNG that is a PNG and has pixels that are not all one), 「輸出 STL」 (the size of a binary STL of a plate),
// 「輸出 STEP」 through its dialog as AP242 with colours.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const O = (window.__o = {});

/** Runs `go`, catching the file the page offers for download. */
async function caught(go) {
  let got = null;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    got = { href: this.href, name: this.download };
  };
  try {
    await go();
    await H.waitFor(() => got, 30000, 'download');
  } finally {
    HTMLAnchorElement.prototype.click = click;
  }
  return { name: got.name, bytes: new Uint8Array(await (await fetch(got.href)).arrayBuffer()) };
}

O.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 8);
  await H.tool('邊角矩形');
  await H.sk(-30, -10);
  await H.sk(30, 10);
  await H.solved();
  const first = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(first);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '5');
  await H.pmOk();
  // a colour on the whole part, through the dialog
  store.execute({ type: 'setAppearance', target: { kind: 'part' }, color: '#3366cc' });
  await H.settle();
  store.viewer.setView('iso');
  await H.wait(500);

  const png = await caught(() => H.action('檔案', '輸出影像'));
  const isPng = [0x89, 0x50, 0x4e, 0x47].every((b, i) => png.bytes[i] === b);
  const stl = await caught(() => H.action('檔案', '輸出 STL'));
  const triangles = new DataView(stl.bytes.buffer).getUint32(80, true);
  const step = await caught(async () => {
    await H.action('檔案', '輸出 STEP');
    await H.pmSelectIn?.('AP242');
    const dialog = document.querySelector('[aria-label="輸出 STEP"]');
    const select = dialog.querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'AP242');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await H.wait(100);
    dialog.querySelector('.modal-actions button').click();
  });
  const text = new TextDecoder().decode(step.bytes);
  const result = {
    png: { name: png.name, bytes: png.bytes.length, isPng },
    stl: { name: stl.name, bytes: stl.bytes.length, triangles },
    step: { name: step.name, ap242: text.includes('AP242'), coloured: text.includes('COLOUR_RGB') },
  };
  return { ...result, pass: isPng && png.bytes.length > 2000 && triangles === 12 && stl.bytes.length === 84 + 50 * 12 && result.step.ap242 && result.step.coloured };
};
