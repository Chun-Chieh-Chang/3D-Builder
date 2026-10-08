// Manual checklist C6 (docs/manual-verification.html): sketch relations, driven dimensions, 「檢查草圖用於特徵」 with its gap tolerance, and 「所選輪廓」, replayed in
// the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The scripts of 3a-4b and 4c do the first five steps and the last two; what
// is new here is steps 6 to 8 the way a person does them: a rectangle made of four clicks of the 「直線」 tool with the last side short by 4 mm, the tolerance typed
// into the panel (1, then 5), 「修復草圖」 pressed, and the sketch extruded.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c6.js?' + Date.now());   // in a freshly loaded page
//   await __manualC6.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase3-sketch-relations.js?' + Date.now());
await import(here + 'phase3-sketch-checks.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const R = window.__r;
const K = window.__k;
const M = (window.__manualC6 = {});

const pm = () => document.querySelector('.property-manager');
const group = (title) => [...pm().querySelectorAll('.pm-group')].find((g) => g.querySelector('h4')?.textContent === title);
const issues = () => [...(group('檢查草圖用於特徵')?.querySelectorAll('li') ?? [])].map((li) => li.textContent);
const setTolerance = async (value) => {
  const input = [...pm().querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent === '間隙容差').querySelector('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.wait(500);
};

/** Steps 6 to 8: the rectangle of the line tool with a 4 mm gap, the tolerance, the repair, the extrusion. */
M.lineGap = async () => {
  H.ready();
  await H.action('檔案', '新零件');
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(20, 10, 8);
  await H.tool('直線');
  for (const [u, v] of [[0, 0], [40, 0], [40, 20], [0, 20], [0, 4]]) await H.sk(u, v);
  await H.key('Escape');
  await H.solved();
  await H.wait(400);
  const open = issues();
  await window.__shot?.('lineGap-open-ends');
  await setTolerance(1);
  const at1 = issues();
  await setTolerance(5);
  const at5 = issues();
  const repair = [...pm().querySelectorAll('button')].find((b) => b.textContent === '修復草圖');
  await window.__shot?.('lineGap-gap-with-repair-button');
  if (!repair) return { name: 'line rectangle with a 4 mm gap', open, at1, at5, pass: false, why: 'no 修復草圖 button' };
  repair.click();
  await H.solved();
  await H.wait(500);
  const notice = store.getState().notice?.text ?? '';
  const panel = group('檢查草圖用於特徵')?.textContent ?? '';
  await window.__shot?.('lineGap-repaired');
  const name = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(name);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '10');
  await H.pmOk();
  const volume = store.getState().result.mass?.volume ?? null;
  const failed = store.getState().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
  await window.__shot?.('lineGap-extruded');
  return {
    name: 'a rectangle of four line clicks with a 4 mm gap: two open ends, none at tolerance 1, a 4 mm gap at 5, repaired, extruded to a 40 × 20 × 10 block',
    open,
    at1,
    at5,
    notice,
    panel,
    volume,
    failed,
    pass: open.length === 2 && open.every((s) => s.includes('開放端點')) && at1.length === 2 && at1.every((s) => s.includes('開放端點')) && at5.length === 1 && /間隙 4 mm/.test(at5[0]) && /已修復 1 處；0 處沒有修/.test(notice) && panel.includes('沒有發現問題，草圖可以用於特徵。') && volume !== null && Math.abs(volume - 8000) < 1e-3 && failed.length === 0,
  };
};

M.run = async () => {
  const steps = [];
  const run = async (name, fn) => {
    H.ready();
    store.newPart(); // each step starts on a part of its own; what the one before left is put away (the app asks, the answer is "don't save")
    if (store.getState().unsaved) await store.answerUnsaved('discard');
    await H.settle();
    const r = await fn();
    await window.__shot?.(name);
    steps.push({ name, pass: r.pass === true, detail: r.pass ? undefined : r });
  };
  await run('1 coradial circles', () => R.coradial());
  await run('2 point at the crossing', () => R.intersection());
  await run('3 merge the end points', () => R.merge());
  await run('4 arc length dimension', () => R.arcLengthAndDriven());
  await run('5 third dimension is a driven (30)', () => R.driven());
  await run('5b over-defined sketch lists the cures', () => K.diagnose());
  await run('6-8 line rectangle with a gap, tolerance, repair, extrusion', () => M.lineGap());
  await run('8b gap and duplicate repaired together', () => K.repair());
  await run('9-10 two contours, choose one', () => K.contours());
  return { name: 'C6', steps, pass: steps.every((s) => s.pass) };
};
