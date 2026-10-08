// Manual checklist E3 (docs/manual-verification.html): the standard parts library in 「插入零組件」: an ISO 7089 M6 washer and an ISO 4762 M6 × 20 screw made and placed, the screw put through
// the washer with 「結合」 whose faces are picked with the cursor (同軸心, then 重合: the head sits on the washer, 1.6 mm up), and an ISO 8734 6 dowel pin put into a hole of the plate (同軸心
// and 重合: the one step the script of 4a-4 did not do); replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-e3.js?' + Date.now());   // in a freshly loaded page
//   await __manualE3.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualE3 = {});

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
  return r;
};
const pm = () => document.querySelector('.property-manager');
const setSelect = async (label, value) => {
  const row = [...pm().querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent === label);
  const sel = row.querySelector('select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(100);
};
/** 「插入零組件」 → the library group → 「做出並選取」 → a click in the view to put it (`where`: a place of the canvas). */
async function make(kind, size, length, where) {
  if (!H.asm()?.insert) await H.action('組合件', '插入零組件');
  await H.waitFor(() => H.asm()?.insert?.files, 10000, 'the insert panel');
  const hasLibrary = [...pm().querySelectorAll('h4')].some((h) => h.textContent === '標準件圖庫');
  await setSelect('種類', kind);
  await setSelect('規格', size);
  if (length !== undefined) await setSelect('長度', String(length));
  const before = H.asm().doc.components.length;
  [...pm().querySelectorAll('button')].find((b) => b.textContent === '做出並選取').click();
  await H.waitFor(() => H.asm().insert?.chosen && H.asm().files.get(H.asm().insert.chosen)?.status === 'ok' && document.querySelector('.pick-hint')?.textContent.includes('按一下以放置'), 20000, 'the part to be made and read');
  const chosen = H.asm().insert.chosen;
  await H.clickAt(...where);
  await H.waitFor(() => !H.asm().insert && H.asm().doc.components.length === before + 1, 5000, 'the component');
  return { path: chosen, component: H.asm().doc.components.at(-1), hasLibrary };
}

M.run = async () => {
  let plate;
  let washer;
  let screw;
  let pin;
  await step('1 a new assembly with the plate (fixed); 插入零組件 shows 標準件圖庫: ISO 7089 M6 washer made, its file in 標準件, put with a click', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    plate = await H.insert('定位板.3dbx');
    washer = await make('washer', 'M6', undefined, [0.8, 0.25]);
    await H.loaded();
    await H.hud('全部顯示');
    return { library: washer.hasLibrary, path: washer.path, pass: washer.hasLibrary && washer.path === '標準件/ISO 7089 M6.3dbx' && !washer.component.fixed };
  });
  await step('2 ISO 4762 M6 × 20 screw made and put: floating', async () => {
    screw = await make('socketScrew', 'M6', 20, [0.8, 0.6]);
    await H.loaded();
    await H.hud('全部顯示');
    return { path: screw.path, pass: screw.path === '標準件/ISO 4762 M6x20.3dbx' && !screw.component.fixed };
  });
  await step('3 結合: the washer\'s bore and the screw\'s shank (suggested 同軸心), then the washer\'s top and the underside of the head (suggested 重合): the head sits 1.6 above the washer', async () => {
    await H.action('組合件', '結合');
    const first = await H.mate([washer.component.id, 'face', 'revolve1:side:sketch1.bore'], [screw.component.id, 'face', 'revolve1:side:sketch1.shank']);
    const second = await H.mate([washer.component.id, 'face', 'revolve1:side:sketch1.top'], [screw.component.id, 'face', 'revolve1:side:sketch1.under']);
    document.querySelector('.property-manager .pm-ok')?.click();
    await H.solved();
    // the solver goes on after the last mate: wait until the pose of the screw stands still
    for (let i = 0, last = ''; i < 20; i++) {
      await H.wait(300);
      const now = JSON.stringify(H.pose(screw.component.id).position);
      if (now === last) break;
      last = now;
    }
    const w = H.pose(washer.component.id).position;
    const s = H.pose(screw.component.id).position;
    await H.hud('等角');
    await H.hud('全部顯示');
    // Neither part is fixed, so the pair is free to turn as a whole in the assembly (here about 1.4° from where they were put): what the mates fix is the one with the other,
    // the head of the screw 1.6 (the thickness of the washer) from the washer along its axis
    const distance = Math.hypot(s[0] - w[0], s[1] - w[1], s[2] - w[2]);
    return { first: first.suggested, second: second.suggested, distance, pass: first.suggested === '同軸心' && second.suggested === '重合' && Math.abs(distance - 1.6) < 1e-6 };
  });
  await step('4 an ISO 8734 dowel pin Ø6 made and put beside the plate; 結合: its side in a hole of the plate (同軸心) and its top on the top of the plate (重合): the pin stands in the hole', async () => {
    pin = await make('dowelPin', '6', 20, [0.25, 0.3]);
    await H.loaded();
    await H.hud('全部顯示');
    await H.action('組合件', '結合');
    const a = await H.mate([plate.id, 'face', 'cut1:side:sketch2.ci6'], [pin.component.id, 'face', 'revolve1:side:sketch1.side']);
    const b = await H.mate([plate.id, 'face', 'extrude1:cap:end'], [pin.component.id, 'face', 'revolve1:side:sketch1.top']);
    document.querySelector('.property-manager .pm-ok')?.click();
    await H.solved();
    const status = [...H.asm().solution.mates.values()].map((m) => m.status);
    await H.hud('等角');
    await H.hud('全部顯示');
    return { a: a.suggested, b: b.suggested, status, path: pin.path, pass: a.suggested === '同軸心' && b.suggested === '重合' && status.length === 4 && status.every((s) => s === 'ok') && pin.path === '標準件/ISO 8734 6m6x20.3dbx' };
  });
  return { name: 'E3', steps, pass: steps.every((s) => s.pass) };
};
