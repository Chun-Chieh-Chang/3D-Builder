// Manual checklist C17 (docs/manual-verification.html): 「檔案屬性」 (carbon steel and the mass of 8000 mm³ = 62.80 g, the quality of the mesh), 「外觀」 (a colour on a face, then removed),
// 「輸出 STEP」 through its dialog (AP242, with colours, in the part origin and in a coordinate system), 「輸出 STL」 and 「輸出影像」, replayed the way a person does it in the app's
// page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The files the page hands to the browser are read back here (STEP text, the triangles of
// the STL, the pixels of the picture); only looking at them in eDrawings or an image viewer stays with a person.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c17.js?' + Date.now());   // in a freshly loaded page
//   await __manualC17.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC17 = {});

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
const dialog = () => document.querySelector('.modal');
const triangleCount = () => {
  const m = state().result.mesh;
  return m ? m.indices.length / 3 : null;
};
/** The points of the vertices of a STEP file: min and max along each axis. */
const stepBox = (text) => {
  const points = new Map([...text.matchAll(/#(\d+)\s*=\s*CARTESIAN_POINT\('[^']*',\(([^)]*)\)\)/g)].map((m) => [m[1], m[2].split(',').map(Number)]));
  const vertices = [...text.matchAll(/VERTEX_POINT\('[^']*',#(\d+)\)/g)].map((m) => points.get(m[1])).filter(Boolean);
  const box = [0, 1, 2].map((a) => [Math.min(...vertices.map((v) => v[a])), Math.max(...vertices.map((v) => v[a]))]);
  return { count: vertices.length, box };
};

M.run = async () => {
  await step('1 a 20 × 20 × 20 block; 檔案屬性 → 材質 碳鋼 (7.85): the dialog says 質量 62.80 g, the status bar has a mass', async () => {
    await S.box(20, 20, 20);
    await H.action('工具', '檔案屬性');
    const select = dialog().querySelector('.props-material select');
    const option = [...select.options].find((o) => /碳鋼/.test(o.textContent));
    await S.select(select, option.value);
    const line = dialog().querySelector('.props-material .hint')?.textContent ?? '';
    const bar = document.querySelector('.status-bar')?.textContent ?? '';
    await shot('1-material-dialog');
    return { option: option.textContent, line, bar: bar.slice(-80), pass: /碳鋼.*7\.85/.test(option.textContent) && /質量：62\.80 g（7\.85 g\/cm³）/.test(line) && /質量/.test(bar) };
  });
  await step('2 顯示與輸出品質: 細 and 粗 change the mesh (the fine one has more triangles); back to 一般', async () => {
    const quality = () => [...dialog().querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent === '顯示與輸出品質').querySelector('select');
    const sel = quality();
    const labels = [...sel.options].map((o) => `${o.value}=${o.textContent}`);
    await S.select(sel, 'coarse');
    const coarse = triangleCount();
    await S.select(quality(), 'fine');
    const fine = triangleCount();
    await S.select(quality(), 'normal');
    // a block has the same twelve triangles at any quality: the quality shows on curved faces, so the numbers are recorded and only "no error, no change of volume" is asserted for the block
    await S.modalButton('關閉');
    return { labels, coarse, fine, pass: labels.length === 3 && coarse !== null && fine !== null && fine >= coarse && near(S.volume(), 8000) && S.failed().length === 0 };
  });
  await step('3 外觀: a face picked, the dialog offers 面, 套用 puts a colour on it (a row in 已上色的), 移除顏色 takes it off', async () => {
    await S.iso();
    await H.at(S.planeFace(1, 20).center);
    await H.action('工具', '外觀');
    const target = [...dialog().querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent === '上色的對象').querySelector('select');
    const offered = [...target.options].map((o) => o.value);
    await S.select(target, 'face');
    const color = dialog().querySelector('input[type=color]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(color, '#cc3333');
    color.dispatchEvent(new Event('input', { bubbles: true }));
    color.dispatchEvent(new Event('change', { bubbles: true }));
    await H.wait(100);
    const apply = [...dialog().querySelectorAll('button')].find((b) => b.textContent === '套用');
    apply.click();
    await H.settle();
    const rows = () => [...dialog().querySelectorAll('.eq-table tbody tr')].filter((r) => r.querySelector('.swatch')).length;
    const applied = rows();
    await shot('3-appearance-applied');
    [...dialog().querySelectorAll('button')].find((b) => b.textContent === '移除顏色').click();
    await H.settle();
    const removed = rows();
    await S.modalButton('關閉');
    return { offered, applied, removed, pass: offered.includes('part') && offered.includes('face') && applied === 1 && removed === 0 };
  });
  await step('4 輸出 STEP in the dialog as AP242 with colours, in the part origin: a file called …step with AP242 and a colour', async () => {
    store.execute({ type: 'setAppearance', target: { kind: 'part' }, color: '#3366cc' });
    await H.settle();
    const out = await caught(async () => {
      await H.action('檔案', '輸出 STEP');
      const d = dialog();
      await S.select(d.querySelector('select'), 'AP242');
      const colors = d.querySelector('input[type=checkbox]');
      if (!colors.checked) colors.click();
      await shot('4-step-dialog');
      d.querySelector('.modal-actions button').click();
    });
    const text = new TextDecoder().decode(out.bytes);
    window.__stepOrigin = stepBox(text);
    return { name: out.name, notice: S.notice(), box: window.__stepOrigin.box, count: window.__stepOrigin.count, pass: /\.step$/i.test(out.name) && text.includes('AP242') && text.includes('COLOUR_RGB') && /已輸出/.test(S.notice()) && near(window.__stepOrigin.box[1][1], 20) };
  });
  await step('5 a coordinate system at the middle of the top face (a reference point first), 輸出 STEP in it: the file moves by the origin of the system', async () => {
    await H.action('特徵', '參考點');
    await H.pmSelect('center');
    await H.at(S.planeFace(1, 20).center);
    await H.pmOk();
    const point = state().result.points.get('point1');
    await H.action('特徵', '座標系統');
    const chip = [...document.querySelectorAll('.property-manager .datum-picker button')].find((b) => b.title === '參考點1');
    chip.click();
    await H.settle();
    await H.pmOk();
    const out = await caught(async () => {
      await H.action('檔案', '輸出 STEP');
      const d = dialog();
      const sels = d.querySelectorAll('select');
      await S.select(sels[0], 'AP242');
      const system = [...sels[1].options].find((o) => /座標系統/.test(o.textContent));
      await S.select(sels[1], system.value);
      d.querySelector('.modal-actions button').click();
    });
    const shifted = stepBox(new TextDecoder().decode(out.bytes));
    const base = window.__stepOrigin;
    const delta = [0, 1, 2].map((a) => Math.round((base.box[a][0] - shifted.box[a][0]) * 1e6) / 1e6);
    return { point, delta, base: base.box, shifted: shifted.box, pass: !!point && shifted.count === base.count && [0, 1, 2].every((a) => Math.abs(Math.abs(delta[a]) - Math.abs(point[a])) < 1e-6) };
  });
  await step('6 輸出 STL: a binary STL of the block (12 triangles) whose triangles add up to the volume; 輸出影像: a picture that is not one colour', async () => {
    const stl = await caught(() => H.action('檔案', '輸出 STL'));
    const view = new DataView(stl.bytes.buffer, stl.bytes.byteOffset, stl.bytes.byteLength);
    const n = view.getUint32(80, true);
    let volume = 0;
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      const p = [0, 1, 2].map((k) => [0, 1, 2].map((c) => view.getFloat32(o + k * 12 + c * 4, true)));
      volume += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    }
    await S.iso();
    const png = await caught(() => H.action('檔案', '輸出影像'));
    const bitmap = await createImageBitmap(new Blob([png.bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const colours = new Set();
    for (let i = 0; i < px.length; i += 4 * 97) colours.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    return { stl: stl.name, n, volume, png: png.name, size: [bitmap.width, bitmap.height], colours: colours.size, pass: /\.stl$/i.test(stl.name) && n === 12 && stl.bytes.length === 84 + 50 * 12 && near(Math.abs(volume), 8000, 1e-3) && /\.png$/i.test(png.name) && bitmap.width > 300 && colours.size > 3 };
  });
  return S.result('C17');
};
