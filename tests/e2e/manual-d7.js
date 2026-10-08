// Manual checklist D7 (docs/manual-verification.html): 「干涉檢查」 of an assembly with nothing in the way (no interference), a plate put on top of another (one pair, the overlap in red, the
// pair clicked and clicked again, a hidden one still compared and a suppressed one not, the window says the model changed) and the box 「也檢查子組合件裡面的零件」 (four pairs of about 405.4
// mm³); the steps are those of phase3-interference.js, which opens the 夾具 of two 定位組 of phase3-subassembly.js (the picture of the overlap in red is taken in it), run here one
// after the other in the page of one script. Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-d7.js?' + Date.now());   // in a freshly loaded page
//   await __manualD7.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-interference.js?` + Date.now());
const M = (window.__manualD7 = {});
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
};

M.run = async () => {
  await step('1 nothing in the way, then a plate put on the plate: one pair (the whole plate and what the pins have in its holes), red, chosen, hidden and suppressed, Esc', async () => {
    const r = await window.__interference.run();
    return { r, pass: !!r && r.shared > 0 };
  });
  await step('2 「也檢查子組合件裡面的零件」: four pairs of the pins in the holes, about 405.4 mm³ each; off again: none', async () => {
    // the assembly of step 1 has the plate put on it and is not saved: put away without saving, as the person would
    await window.__ui2.action('檔案', '新零件');
    if (document.querySelector('.modal')) await window.__ui2.modalButton('不儲存');
    await window.__ui2.wait(500);
    const r = await window.__interference.within();
    return { r, pass: !!r && r.total > 1500 && r.total < 1700 };
  });
  return { name: 'D7', steps, pass: steps.every((s) => s.pass) };
};
