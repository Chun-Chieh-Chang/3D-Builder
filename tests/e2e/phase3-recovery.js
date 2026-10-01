// Phase 3a-9a (B9.3): autosave and recovery through the UI, in the app's page (http://127.0.0.1:5391). Not a Vitest test.
//
//   1. after a fresh load:  await import('/@fs/<checkout>/tests/e2e/phase3-recovery.js?' + Date.now()); await __rec.edit();   // a plate, then waits for the autosave
//   2. reload the page (the way a crash or a closed tab ends a session), then:  await import(...same...); await __rec.after();
//
// edit() draws a plate and returns once a copy has been kept; after() answers the dialog with 「復原」 and reports the part that came back.

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
window.__rec = {
  edit: async () => {
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
    await H.wait(6500); // longer than the wait after the last change
    return { features: store.getState().doc.features.length, dirty: store.getState().dirty };
  },
  after: async () => {
    await H.waitFor(() => document.querySelector('[aria-label="找到沒有儲存的零件"]'), 8000, 'recovery dialog');
    const text = document.querySelector('[aria-label="找到沒有儲存的零件"]').textContent;
    document.querySelector('[aria-label="找到沒有儲存的零件"] .primary').click();
    await H.settle();
    const s = store.getState();
    return { text, features: s.doc.features.map((f) => f.type), dirty: s.dirty, volume: s.result?.mass?.volume, dialogGone: !document.querySelector('[aria-label="找到沒有儲存的零件"]') };
  },
};
