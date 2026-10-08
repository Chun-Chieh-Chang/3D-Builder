// Manual checklist C18 (docs/manual-verification.html): autosave and 「找到沒有儲存的零件」: a part drawn and left alone for longer than the wait, the page closed (here: loaded
// again, which is what a closed tab and a new one come to), the dialog answered with 「復原」 (the part is back, not saved), then the same again answered with 「捨棄」, and a
// further load that shows no dialog. Each call runs in a page of its own and the browser keeps what the one before left; replayed in the app's page (http://127.0.0.1:5391,
// 1280×720; `npm run verify:ui` does it). Not a Vitest test. (The text tools of the checklist's last step, `scripts/3dbx.mjs cat` and `git diff`, are tests/phase3/textual.test.ts.)
//
//   1. in a freshly loaded page:   await import('/@fs/<checkout>/tests/e2e/manual-c18.js?' + Date.now());  await __manualC18.edit();
//   2. after loading it again:     await import(...);  await __manualC18.recover();
//   3. after loading it again:     await import(...);  await __manualC18.editAgain();
//   4. after loading it again:     await import(...);  await __manualC18.discard();
//   5. after loading it again:     await import(...);  await __manualC18.nothing();

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, near, shot } = S;
const M = (window.__manualC18 = {});

const DIALOG = '[aria-label="找到沒有儲存的零件"]';
const title = () => document.title;

M.edit = async () => {
  await S.box(40, 30, 10);
  await H.wait(6500); // longer than the 5 seconds after the last change
  return { name: 'a block drawn and left alone: the title has a * (not saved)', title: title(), dirty: store.getState().dirty, pass: /\*/.test(title()) && store.getState().dirty === true && near(S.volume(), 12000) };
};

M.recover = async () => {
  await H.waitFor(() => document.querySelector(DIALOG), 10000, 'the dialog 找到沒有儲存的零件');
  const text = document.querySelector(DIALOG).textContent;
  await shot('recover-dialog');
  [...document.querySelectorAll(`${DIALOG} button`)].find((b) => b.textContent === '復原').click();
  await H.settle();
  const s = store.getState();
  await shot('recovered');
  return { name: '復原: the block is back, in the state of the last edit, and it is not saved', text: text.slice(0, 120), volume: s.result?.mass?.volume, dirty: s.dirty, title: title(), gone: !document.querySelector(DIALOG), pass: near(s.result?.mass?.volume, 12000) && s.dirty === true && /\*/.test(title()) && !document.querySelector(DIALOG) };
};

M.editAgain = async () => {
  await S.box(20, 20, 5);
  await H.wait(6500);
  return { name: 'something else drawn and left alone', volume: S.volume(), pass: near(S.volume(), 2000) && store.getState().dirty === true };
};

M.discard = async () => {
  await H.waitFor(() => document.querySelector(DIALOG), 10000, 'the dialog 找到沒有儲存的零件');
  [...document.querySelectorAll(`${DIALOG} button`)].find((b) => b.textContent === '捨棄').click();
  await H.wait(500);
  return { name: '捨棄: the dialog closes', gone: !document.querySelector(DIALOG), pass: !document.querySelector(DIALOG) };
};

M.nothing = async () => {
  await H.wait(3000);
  return { name: 'loaded again: there is no dialog any more', pass: !document.querySelector(DIALOG) };
};
