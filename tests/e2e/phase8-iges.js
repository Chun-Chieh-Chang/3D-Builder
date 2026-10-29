// IGES export and import through the UI (F1.4, F2.2), in the app's page (1280×720). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/phase8-iges.js?' + Date.now());   // after a fresh load of the page
//   await __iges.run();   // -> { exported, imported, opened, stopped, pass }
//
// A plate 60 × 20 × 5 with a colour: 「輸出 IGES」 through its dialog as trimmed surfaces in mm and as a B-rep solid in inches; the first file opened
// with 「開啟舊檔」 (a new part named after it) and imported with 「輸入 STEP／IGES」 (a body of the same volume, its data kept as IGES); and a broken
// file that OCCT's reader loops on (a plane whose record ends at its first parameter), which the probe worker stops within the limit, adding nothing.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const I = (window.__iges = {});
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
  return { name: got.name, text: await (await fetch(got.href)).text() };
}

/** 「輸出 IGES」: the dialog, its selects set to `mode` and `unit`, then 「輸出」. */
async function exportIges(mode, unit) {
  return caught(async () => {
    await H.action('檔案', '輸出 IGES');
    const dialog = await H.waitFor(() => document.querySelector('[aria-label="輸出 IGES"]'), 5000, 'the IGES dialog');
    const [modeSelect, unitSelect] = dialog.querySelectorAll('select');
    const set = (select, value) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(modeSelect, mode);
    set(unitSelect, unit);
    await H.wait(100);
    dialog.querySelector('.modal-actions button').click();
  });
}

/** The next file dialog answers with `name` holding `text`. */
function nextFile(name, text) {
  window.showOpenFilePicker = async () => [{ kind: 'file', name, getFile: async () => new File([text], name) }];
}

/** A file action that replaces the part: 「要儲存變更嗎？」 is answered 「不儲存」 when it comes. */
async function replacing(tab, label) {
  await H.action(tab, label);
  await H.wait(200);
  if (store.getState().unsaved) await store.answerUnsaved('discard');
  await H.settle();
}

/** The entity types of an IGES text's directory section. */
const types = (text) => new Set(text.split(/\r?\n/).filter((l) => l[72] === 'D').filter((_, i) => i % 2 === 0).map((l) => Number(l.slice(0, 8))));
const globalOf = (text) => text.split(/\r?\n/).filter((l) => l[72] === 'G').map((l) => l.slice(0, 72)).join('');

/** The volume of the part's body, from the last rebuild. */
const volume = async () => store.getState().result?.mass?.volume ?? NaN;

I.run = async () => {
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
  store.execute({ type: 'setAppearance', target: { kind: 'part' }, color: '#3366cc' });
  await H.settle();

  // export: trimmed surfaces in mm, then a B-rep solid in inches
  const faces = await exportIges('faces', 'MM');
  const brep = await exportIges('brep', 'INCH');
  const exported = {
    faces: { name: faces.name, trimmed: types(faces.text).has(144), mm: /,2,2HMM,/.test(globalOf(faces.text)), notice: store.getState().notice?.text },
    brep: { name: brep.name, solid: types(brep.text).has(186), inch: /,1,4HINCH,/.test(globalOf(brep.text)) },
  };
  check(/\.igs$/.test(faces.name) && exported.faces.trimmed && exported.faces.mm, `trimmed-surface file: ${JSON.stringify(exported.faces)}`);
  check(exported.brep.solid && exported.brep.inch, `B-rep file: ${JSON.stringify(exported.brep)}`);

  // 「開啟舊檔」 an IGES file: a new part named after it, holding the body
  await replacing('檔案', '新零件');
  nextFile('板子.igs', faces.text);
  await replacing('檔案', '開啟舊檔');
  await H.waitFor(() => store.history.doc.features.some((f) => f.type === 'importedBody'), 60000, 'the opened IGES');
  await H.settle();
  const opened = { title: store.documentName(), blob: store.history.doc.blobs[0]?.kind, status: store.getState().result?.features.at(-1)?.status, volume: await volume() };
  check(opened.title === '板子' && opened.blob === 'iges' && opened.status === 'ok' && Math.abs(opened.volume / 6000 - 1) < 1e-6, `opened: ${JSON.stringify(opened)}`);

  // 「輸入 STEP／IGES」 into a part: one more body of the same volume
  await replacing('檔案', '新零件');
  nextFile('板子.igs', faces.text);
  await H.action('特徵', '輸入 STEP／IGES');
  await H.waitFor(() => store.history.doc.features.some((f) => f.type === 'importedBody'), 60000, 'the imported IGES');
  await H.settle();
  const imported = { blob: store.history.doc.blobs[0]?.kind, status: store.getState().result?.features.at(-1)?.status, volume: await volume() };
  check(imported.blob === 'iges' && imported.status === 'ok' && Math.abs(imported.volume / 6000 - 1) < 1e-6, `imported: ${JSON.stringify(imported)}`);

  // a broken file OCCT loops on: stopped within the limit, nothing added, the kernel worker untouched
  const lines = faces.text.split('\n');
  const plane = lines.findIndex((l) => l.startsWith('108,'));
  lines[plane] = '108,0.;'.padEnd(64) + lines[plane].slice(64);
  const limit = store.rebuildLimitMs;
  store.rebuildLimitMs = 8000;
  const before = store.history.doc.features.length;
  const started = performance.now();
  try {
    nextFile('壞掉.igs', lines.join('\n'));
    await H.action('特徵', '輸入 STEP／IGES');
    await H.waitFor(() => /秒內沒有讀完/.test(store.getState().notice?.text ?? ''), 30000, 'the stop');
  } finally {
    store.rebuildLimitMs = limit;
  }
  const stopped = { ms: Math.round(performance.now() - started), notice: store.getState().notice?.text, features: store.history.doc.features.length - before, bootMs: store.getState().bootMs };
  check(plane >= 0 && stopped.features === 0 && stopped.ms < 8000 + 5000 && stopped.bootMs !== null, `stopped: ${JSON.stringify(stopped)}`);
  // the part is still rebuilt as before
  store.rebuild();
  await H.settle();
  check(Math.abs((await volume()) / 6000 - 1) < 1e-6, 'the part still rebuilds after the stop');

  return { exported, opened, imported, stopped, failures, pass: failures.length === 0 };
};
