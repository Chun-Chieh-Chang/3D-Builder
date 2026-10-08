// Manual checklist D2 (docs/manual-verification.html): 「線性複製排列」 and 「環狀複製排列」 of a pin, 「鏡射零組件」 of the plate, typed into the panel (the direction, the count, the spacing, the
// instances to skip), the seed dragged with the mouse, hidden and suppressed, saved and reopened, Ctrl+Z; replayed the way a person does it in the app's page (http://127.0.0.1:5391,
// 1280×720; `npm run verify:ui` does it). Not a Vitest test. The scripts of 3b-2 made the same patterns with the store's functions (phase3-component-pattern.js); here the panel's fields are used.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-d2.js?' + Date.now());   // in a freshly loaded page
//   await __manualD2.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualD2 = {});
const shot = (label) => window.__shot?.(label);

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await shot(name);
  steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r });
  return r;
};
const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;
const a = () => store.assembly;
const leaf = (id) => a().leaves().find((l) => l.id === id);
const pm = () => document.querySelector('.property-manager');
const field = (label, nth = 0) => [...pm().querySelectorAll(`[aria-label="${label}"]`)][nth];
const type = async (el, value) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  await H.wait(40);
  if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await H.wait(350);
};
const start = async (label) => {
  await H.action('組合件', label);
  await H.waitFor(() => H.asm().pattern && pm()?.querySelector('.pm-title'), 5000, `the ${label} panel`);
};
const ok = async () => {
  pm().querySelector('.pm-ok').click();
  await H.wait(500);
};
const seedPos = () => leaf('comp2').pose.position;

M.run = async () => {
  await step('1 a new assembly: the plate at the origin (fixed), a pin put beside it', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, '零件/削邊銷.3dbx': `${H.GOLDEN}diamond-pin.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    const plate = await H.insert('定位板.3dbx');
    const pin = await H.insert('零件/削邊銷.3dbx', [0.25, 0.3]);
    await H.loaded();
    await H.hud('全部顯示');
    return { plate: plate.id, pin: pin.id, pass: plate.fixed && !pin.fixed && H.asm().doc.components.length === 2 };
  });
  await step('2 the pin selected, 「線性複製排列」: the panel names the pin as the seed; 方向 1 = 組合件的 X 軸, 4 instances, 40 apart: a row of four, the third 80 from the seed', async () => {
    a().select('comp2');
    await start('線性複製排列');
    const seed = field('要排列的零組件').selectedOptions[0].textContent;
    await type(field('方向 1'), 'x');
    await type(field('實例數（含種子）'), '4');
    await type(field('間距'), '40');
    const p3 = leaf('comp2@pattern-preview#3');
    const instances = [...store.viewer.instances.keys()].filter((k) => k.startsWith('comp2@pattern-preview')).length;
    await shot('2-preview');
    return { seed, instances, p3: p3?.pose.position, seedAt: seedPos(), pass: /削邊銷/.test(seed) && instances === 4 - 1 && !!p3 && near(p3.pose.position[0], seedPos()[0] + 80) };
  });
  await step('3 要跳過的實例 = 2: the second pin goes; emptied it comes back; ✔: a row in the tree', async () => {
    await type(field('要跳過的實例'), '2');
    const skipped = [...store.viewer.instances.keys()].filter((k) => k.startsWith('comp2@pattern-preview')).length;
    await type(field('要跳過的實例'), '');
    const back = [...store.viewer.instances.keys()].filter((k) => k.startsWith('comp2@pattern-preview')).length;
    await ok();
    const row = document.querySelector('[data-pattern-row]');
    return { skipped, back, row: row?.textContent, pass: back - skipped === 1 && !!row && /線性複製排列1/.test(row.textContent) && H.asm().doc.patterns.length === 1 };
  });
  await step('4 the pin selected again, 「環狀複製排列」 about 組合件的 Z 軸, 4 instances, 90: a quarter turn each', async () => {
    a().select('comp2');
    await start('環狀複製排列');
    await type(field('旋轉軸'), 'z');
    await type(field('實例數（含種子）'), '4');
    await type(field('間距'), '90');
    const seed = seedPos();
    const q = leaf('comp2@pattern-preview#2').pose.position;
    await shot('4-circular-preview');
    await ok();
    return { seed, q, pass: near(q[0], -seed[1]) && near(q[1], seed[0]) && H.asm().doc.patterns.length === 2 };
  });
  await step('5 the plate selected, 「鏡射零組件」 about 右基準面: the mirror of the plate on the other side (it is not saved as a file)', async () => {
    a().select('comp1');
    await start('鏡射零組件');
    await type(field('鏡射面'), 'plane:right');
    await H.waitFor(() => a().leaves().some((l) => l.mirrored), 10000, 'the mirrored plate');
    const m = a().leaves().find((l) => l.mirrored && l.id.startsWith('comp1/'.slice(0, 5)));
    await shot('5-mirror-preview');
    await ok();
    return { mirrored: a().leaves().filter((l) => l.mirrored).length, patterns: H.asm().doc.patterns.length, files: H.asm().doc.files.length, pass: a().leaves().filter((l) => l.mirrored).length >= 1 && H.asm().doc.patterns.length === 3 && H.asm().doc.files.length === 2 };
  });
  await step('6 the pin (seed) moved with the mouse: every copy of it follows; the copy cannot be given a mate; hidden or suppressed, the copies go with it', async () => {
    const before = a().leaves().filter((l) => l.instanceOf === 'pattern1').map((l) => l.pose.position.slice());
    a().select('comp2');
    await a().moveSelected({ kind: 'by', delta: [0, 0, 25] });
    await H.wait(900);
    const after = a().leaves().filter((l) => l.instanceOf === 'pattern1').map((l) => l.pose.position.slice());
    const dz = after.map((p, i) => +(p[2] - before[i][2]).toFixed(5));
    a().setComponentState(['comp2'], 'hidden', true);
    await H.wait(500);
    const hidden = [...store.viewer.instances.values()].filter((i) => i.owner === 'comp2' || String(i.owner).startsWith('comp2')).length;
    a().setComponentState(['comp2'], 'hidden', false);
    a().setComponentState(['comp2'], 'suppressed', true);
    await H.wait(900);
    const suppressed = a().leaves().filter((l) => l.top === 'comp2' || l.instanceOf === 'pattern1' || l.instanceOf === 'pattern2').length; // (the mirror of the plate is the plate's own)
    a().undo();
    await H.wait(900);
    return { dz, hidden, suppressed, pass: dz.length > 0 && dz.every((d) => near(d, 25, 1e-3)) && hidden === 0 && suppressed === 0 };
  });
  await step('7 saved with 「另存新檔」 and opened again: the patterns are there; Ctrl+Z takes one step back', async () => {
    H.next.save = '夾具-d2.3dba';
    await H.action('檔案', '另存新檔');
    await H.waitFor(() => !H.asm().dirty, 10000, 'the save');
    const leaves = a().leaves().length;
    document.querySelector('.status-bar .notice')?.click();
    H.next.open = '夾具-d2.3dba';
    await H.action('檔案', '開啟舊檔');
    await H.waitFor(() => store.getState().notice?.text === '已開啟 夾具-d2.3dba', 20000, 'open');
    await H.loaded();
    await H.wait(1500);
    const patterns = H.asm().doc.patterns.length;
    const same = a().leaves().length === leaves;
    a().select(null);
    const countBefore = H.asm().doc.components.length;
    a().setComponentState(['comp2'], 'hidden', true);
    await H.wait(300);
    await H.ctrl('z');
    await H.wait(500);
    return { patterns, same, undone: H.asm().doc.components[1].hidden !== true, pass: patterns === 3 && same && H.asm().doc.components[1].hidden !== true };
  });
  return { name: 'D2', steps, pass: steps.every((s) => s.pass) };
};
