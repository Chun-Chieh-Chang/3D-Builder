// STL export and import through the UI (F4.1, F2.3, ADR 0221), in the app's page (1280×720). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/phase8-stl.js?' + Date.now());   // after a fresh load of the page
//   await __stl.run();   // -> { exported, split, opened, imported, refused, pass }
//
// A plate 60 × 20 × 5: 「輸出 STL」 through its dialog as binary in mm, ASCII, and binary in inches; a second body apart from it, and 「每個本體各存一個檔」,
// which downloads a ZIP of two STL files. The binary file opened with 「開啟舊檔」 (a new part named after it, its unit asked: a reference mesh, no body)
// and imported into the plate with 「輸入 STEP／IGES／STL」 in inches (the mesh 25.4³ times larger, the plate's volume unchanged); a file cut short refused
// with nothing added.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const S = (window.__stl = {});
const failures = [];
const check = (ok, what) => (ok ? null : failures.push(what));

/** Runs `go`, catching the file the page offers for download. */
async function caught(go) {
  let got = null;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    got = { href: this.href, name: this.download };
  };
  try {
    await go();
    await H.waitFor(() => got, 60000, 'download');
  } finally {
    HTMLAnchorElement.prototype.click = click;
  }
  return { name: got.name, bytes: new Uint8Array(await (await fetch(got.href)).arrayBuffer()) };
}

const setSelect = (select, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

/** 「輸出 STL」: the dialog, its format and unit set, the split box ticked when asked, then 「輸出」. */
async function exportStl(format, unit, split = false) {
  return caught(async () => {
    await H.action('檔案', '輸出 STL');
    const dialog = await H.waitFor(() => document.querySelector('[aria-label="輸出 STL"]'), 5000, 'the STL dialog');
    const [formatSelect, unitSelect] = dialog.querySelectorAll('select');
    setSelect(formatSelect, format);
    setSelect(unitSelect, unit);
    const box = dialog.querySelector('input[type="checkbox"]');
    if (split) {
      if (!box) throw new Error('no split box');
      box.click();
    }
    await H.wait(100);
    dialog.querySelector('.modal-actions button').click();
  });
}

/** A binary STL read here, independently of the program: its triangle count, the volume of its triangles, and its largest x. */
function readBinary(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(80, true);
  let volume = 0;
  let maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    const f = (k) => view.getFloat32(84 + 50 * i + 12 + 4 * k, true);
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from({ length: 9 }, (_, k) => f(k));
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    maxX = Math.max(maxX, ax, bx, cx);
  }
  return { size: bytes.byteLength === 84 + 50 * n, triangles: n, volume, maxX };
}

/** The next file dialog answers with `name` holding `bytes`. */
function nextFile(name, bytes) {
  window.showOpenFilePicker = async () => [{ kind: 'file', name, getFile: async () => new File([bytes], name) }];
}

/** A file action that replaces the part: 「要儲存變更嗎？」 is answered 「不儲存」 when it comes. */
async function replacing(tab, label) {
  await H.action(tab, label);
  await H.wait(200);
  if (store.getState().unsaved) await store.answerUnsaved('discard');
  await H.settle();
}

/** The STL import dialog: its unit set, then 「輸入」. */
async function answerUnit(unit) {
  const dialog = await H.waitFor(() => document.querySelector('[aria-label="輸入 STL"]'), 10000, 'the STL import dialog');
  const text = dialog.textContent;
  setSelect(dialog.querySelector('select'), unit);
  await H.wait(100);
  dialog.querySelector('.modal-actions button').click();
  await H.waitFor(() => store.history.doc.features.some((f) => f.type === 'importedMesh'), 10000, 'the mesh feature');
  await H.settle();
  return text;
}

async function rectangleBody(x0, y0, x1, y1, depth) {
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 8);
  await H.tool('邊角矩形');
  await H.sk(x0, y0);
  await H.sk(x1, y1);
  await H.solved();
  const name = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(name);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', String(depth));
  await H.pmOk();
  await H.settle();
}

const meshGroup = () => store.viewer?.scene.getObjectByName('reference-meshes') ?? null;

S.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await rectangleBody(-30, -10, 30, 10, 5);

  // binary mm, ASCII, binary inch
  const bin = await exportStl('binary', 'mm');
  const ascii = await exportStl('ascii', 'mm');
  const inch = await exportStl('binary', 'inch');
  const b = readBinary(bin.bytes);
  const asciiText = new TextDecoder().decode(ascii.bytes);
  const exported = {
    name: bin.name,
    binary: b,
    ascii: { solid: asciiText.startsWith('solid '), facets: (asciiText.match(/facet normal/g) ?? []).length, end: /endsolid/.test(asciiText) },
    inch: readBinary(inch.bytes),
  };
  check(/\.stl$/.test(bin.name) && b.size && b.triangles === 12 && Math.abs(b.volume / 6000 - 1) < 1e-6, `binary: ${JSON.stringify(exported.binary)}`);
  check(exported.ascii.solid && exported.ascii.facets === 12 && exported.ascii.end, `ascii: ${JSON.stringify(exported.ascii)}`);
  check(Math.abs(exported.inch.maxX - 30 / 25.4) < 1e-5 && Math.abs((exported.inch.volume * 25.4 ** 3) / 6000 - 1) < 1e-5, `inch: ${JSON.stringify(exported.inch)}`);

  // a second body apart from the plate: one file per body, in a ZIP
  await rectangleBody(-10, 14, 10, 22, 4);
  const bodies = store.getState().result?.bodies.length;
  const zip = await exportStl('binary', 'mm', true);
  const zipText = new TextDecoder('latin1').decode(zip.bytes);
  const split = { bodies, name: zip.name, entries: (zipText.match(/PK\x01\x02/g) ?? []).length, notice: store.getState().notice?.text };
  check(bodies === 2 && /\.zip$/.test(zip.name) && split.entries === 2, `split: ${JSON.stringify(split)}`);

  // 「開啟舊檔」 the binary file: a new part named after it, asked its unit; a mesh, no body
  await replacing('檔案', '新零件');
  nextFile('板子.stl', bin.bytes);
  await replacing('檔案', '開啟舊檔');
  const asked = await answerUnit('mm');
  const r = store.getState().result;
  const opened = {
    title: store.documentName(),
    asked: /12 個三角形/.test(asked) && ['60.00', '20.00', '5.00'].every((x) => asked.includes(x)), // the plate lies on the top plane: 60 × 5 × 20 in x, y, z
    blob: store.history.doc.blobs[0]?.kind,
    status: r?.features.at(-1)?.status,
    info: r?.features.at(-1)?.info,
    meshes: r?.meshes.length,
    triangles: r?.meshes[0] ? r.meshes[0].indices.length / 3 : 0,
    body: r?.mesh ?? null,
    drawn: meshGroup()?.children.length ?? 0,
  };
  check(opened.title === '板子' && opened.asked && opened.blob === 'stl' && opened.status === 'ok' && opened.meshes === 1 && opened.triangles === 12 && opened.body === null && opened.drawn === 1, `opened: ${JSON.stringify(opened)}`);
  check(/6000\.000/.test(opened.info ?? ''), `the mesh's volume is reported: ${opened.info}`);

  // hidden from the tree's visibility: not drawn
  store.execute({ type: 'setVisibility', keys: [store.history.doc.features.find((f) => f.type === 'importedMesh').id], value: false });
  await H.settle();
  const hidden = meshGroup()?.children.length ?? 0;
  check(hidden === 0, `a hidden mesh is not drawn: ${hidden}`);

  // 「輸入 STEP／IGES／STL」 into the plate, in inches: a mesh 25.4³ as large, the plate's volume unchanged
  await replacing('檔案', '新零件');
  await rectangleBody(-30, -10, 30, 10, 5);
  const plate = store.getState().result?.mass?.volume;
  nextFile('板子.stl', bin.bytes);
  await H.action('特徵', '輸入 STEP／IGES／STL');
  await answerUnit('inch');
  const after = store.getState().result;
  const imported = { plate, volume: after?.mass?.volume, bodies: after?.bodies.length, info: after?.features.at(-1)?.info, unit: store.history.doc.features.at(-1)?.unit };
  check(Math.abs(plate / 6000 - 1) < 1e-6 && imported.volume === plate && imported.bodies === 1 && imported.unit === 'inch', `imported: ${JSON.stringify(imported)}`);
  check(new RegExp(`${(6000 * 25.4 ** 3).toFixed(0).slice(0, 6)}`).test(imported.info ?? ''), `inch volume reported: ${imported.info}`);

  // a file cut short: refused, nothing added
  const before = store.history.doc.features.length;
  nextFile('壞掉.stl', bin.bytes.slice(0, bin.bytes.length - 10));
  await H.action('特徵', '輸入 STEP／IGES／STL');
  await H.waitFor(() => /84 \+ 50/.test(store.getState().notice?.text ?? ''), 10000, 'the refusal');
  const refused = { notice: store.getState().notice?.text, features: store.history.doc.features.length - before, dialog: !!document.querySelector('[aria-label="輸入 STL"]') };
  check(refused.features === 0 && !refused.dialog, `refused: ${JSON.stringify(refused)}`);

  return { failures, exported, split, opened, imported, refused, pass: failures.length === 0 };
};
