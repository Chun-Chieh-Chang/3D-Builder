// Manual checklist E4 (docs/manual-verification.html): the advanced mates of 「結合」 with the faces picked with the cursor: 寬度 (the V-block between the two sides of the plate, the four elements
// named, 結合成立, centred by ✔), 相互對稱 (two faces of one component: the panel says why not) and a 距離 with 最小值 0 and 最大值 10 whose range holds when the part is dragged with the
// mouse; replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. (phase4-mates.js did the same with the calls that
// the picks make.)
//
//   await import('/@fs/<checkout>/tests/e2e/manual-e4.js?' + Date.now());   // in a freshly loaded page
//   await __manualE4.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const model = await import(`${root}packages/model/src/index.ts`);
const io = await import(`${root}packages/io/src/index.ts`);
const M = (window.__manualE4 = {});

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await window.__shot?.(name);
  steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r, ...(typeof r?.knownIssue === 'string' ? { knownIssue: r.knownIssue } : {}) });
  return r;
};
const at = (position) => ({ position, rotation: [0, 0, 0, 1] });
const pose = (id) => H.asm().solution.poses.get(id);
const outermost = (build, n) => {
  let best = null;
  build.faceGeometry.forEach((g, i) => {
    if (g?.kind !== 'plane' || g.normal.some((v, k) => Math.abs(v - n[k]) > 1e-9)) return;
    const d = g.origin[0] * n[0] + g.origin[1] * n[1] + g.origin[2] * n[2];
    if (!best || d > best.d) best = { name: build.faceNames[i], d };
  });
  if (!best) throw new Error(`no plane facing ${n}`);
  return best.name;
};
const jig = (x, y) => {
  let doc = model.createEmptyAssembly();
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '定位板.3dbx' }, component: { id: 'plate', file: 'file1', instance: 1, fixed: true, placement: at([0, 0, 0]) } });
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: 'V型塊.3dbx' }, component: { id: 'v', file: 'file2', instance: 1, fixed: false, placement: at([x, y, 2]) } });
  return doc;
};
async function open(doc, path) {
  await H.writeAt(path, await io.writeAssemblyFile(doc));
  document.querySelector('.status-bar .notice')?.click();
  H.next.open = path;
  await H.action('檔案', '開啟舊檔');
  await H.wait(300);
  if ([...document.querySelectorAll('.modal button')].some((b) => b.textContent === '不儲存')) await H.modalButton('不儲存');
  await H.wait(300);
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => store.getState().notice?.text === `已開啟 ${path.split('/').pop()}`, 20000, `${path} to open`);
  await H.loaded();
  await H.waitFor(() => H.asm().solution, 10000, 'the solution');
}
let sides;

M.run = async () => {
  await step('1 the plate (fixed) and the V-block (floating, 17 mm off); 結合 shows 進階結合 with 寬度 and 相互對稱', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
    await open(jig(17, 15), 'e4a.3dba');
    const plate = H.asm().builds.get(H.asm().files.get('定位板.3dbx').key);
    const block = H.asm().builds.get(H.asm().files.get('V型塊.3dbx').key);
    sides = { pl: outermost(plate, [-1, 0, 0]), pr: outermost(plate, [1, 0, 0]), vl: outermost(block, [-1, 0, 0]), vr: outermost(block, [1, 0, 0]), vb: outermost(block, [0, -1, 0]) };
    await H.action('組合件', '結合');
    const heads = [...document.querySelectorAll('.property-manager h4')].map((h) => h.textContent);
    const buttons = [...document.querySelectorAll('.mate-types button')].map((b) => b.textContent);
    return { heads, buttons, x: pose('v').position[0], pass: heads.includes('進階結合') && buttons.includes('寬度') && buttons.includes('相互對稱') && Math.abs(pose('v').position[0] - 17) < 1e-9 };
  });
  await step('2 寬度: the plate\'s two sides, then the V-block\'s two sides: the four elements are named, 結合成立; ✔: the V-block is centred', async () => {
    await H.mateType('寬度');
    await H.pickOn('plate', 'face', sides.pl);
    await H.pickOn('plate', 'face', sides.pr);
    await H.pickOn('v', 'face', sides.vl);
    const before = [...document.querySelectorAll('.property-manager .selection-box li')].map((li) => li.textContent);
    await H.pickOn('v', 'face', sides.vr);
    await H.waitFor(() => H.asm().solution?.mates.get('preview')?.status === 'ok', 5000, 'the preview');
    const items = [...document.querySelectorAll('.property-manager .selection-box li')].map((li) => li.textContent);
    const hint = [...document.querySelectorAll('.property-manager .hint')].map((h) => h.textContent).join(' ');
    await window.__shot?.('2-width-four-elements');
    document.querySelector('.property-manager .pm-ok').click();
    await H.waitFor(() => H.asm().doc.mates.length === 1, 5000, 'the mate');
    await H.waitFor(() => Math.abs(pose('v').position[0]) < 1e-6, 5000, 'the V-block to be centred');
    document.querySelector('.property-manager .pm-cancel')?.click();
    await H.wait(150);
    return { items, hint, pass: items.length === 4 && ['寬度面 1', '寬度面 2', '薄片面 1', '薄片面 2'].every((n) => items.some((t) => t.includes(n))) && /結合成立/.test(hint) && Math.abs(pose('v').position[0]) < 1e-6 };
  });
  await step('3 相互對稱: two faces of the one V-block and a plane of the plate: the panel says it does not work, with the reason', async () => {
    await open(jig(12, 15), 'e4b.3dba');
    await H.action('組合件', '結合');
    await H.mateType('相互對稱');
    await H.pickOn('v', 'face', sides.vl);
    await H.pickOn('v', 'face', sides.vr);
    await H.flyout('定位板<1>', '右基準面'); // the planes of a component are in the small tree of the view, under its name
    await H.wait(500);
    const preview = H.asm().solution.mates.get('preview');
    const text = [...document.querySelectorAll('.property-manager .hint, .property-manager .pm-message')].map((h) => h.textContent).join(' | ');
    await window.__shot?.('3-symmetric-refused');
    document.querySelector('.property-manager .pm-cancel')?.click();
    await H.wait(150);
    return { status: preview?.status, text, pass: !!preview && preview.status !== 'ok' && text.length > 0 };
  });
  // The checklist says the part "stops at 5 mm": within the range it stays where it is (a height of 8 stays 8) and only outside it is brought back to the nearer limit (advanced.test.ts).
  // The V-block starts well above (so that its underside can be picked with the cursor): the mate brings it to the upper limit, 10 above the plate; the travel is then tried with the mouse:
  // from the limit down a little, down past the plate (it stops at 0), up past the range (it stops at 10).
  await step('4 距離 5 with 最小值 0 and 最大值 10 between the top of the plate and the underside of the V-block: it is brought to the upper limit; from there it can be dragged down; it stops at 0 and at 10', async () => {
    await open(jig(0, 45), 'e4c.3dba');
    await H.action('組合件', '結合');
    await H.pickOn('plate', 'face', 'extrude1:cap:end');
    await H.pickOn('v', 'face', sides.vb);
    await H.mateType('距離');
    await H.mateValue('5');
    const row = (label) => [...document.querySelectorAll('.property-manager .pm-row')].find((r) => r.textContent.startsWith(label)).querySelector('input');
    const type = async (input, text) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.blur();
      await H.wait(150);
    };
    await type(row('最小值'), '0');
    await type(row('最大值'), '10');
    await H.waitFor(() => H.asm().solution?.mates.get('preview')?.status === 'ok', 5000, 'the preview');
    document.querySelector('.property-manager .pm-ok').click();
    await H.waitFor(() => H.asm().doc.mates.length === 1, 5000, 'the mate');
    document.querySelector('.property-manager .pm-cancel')?.click();
    await H.waitFor(() => Math.abs(pose('v').position[1] - 25) < 1e-6, 5000, 'the V-block at the upper limit');
    await H.wait(600);
    const rest = pose('v').position[1];
    await H.hud('前視');
    await H.hud('全部顯示');
    // the mouse
    const drag = async (dy) => {
      const grab = H.onComponent('v');
      await H.drag(H.line(grab, { x: grab.x, y: grab.y + dy }));
      return pose('v').position[1];
    };
    const away = await drag(40);
    const low = await drag(300);
    const high = await drag(-500);
    await window.__shot?.('4-limited-travel');
    const moves = away < 25 - 1e-3 && away >= 15 - 1e-6;
    // From the upper limit the part can be dragged back into its range (it was held on the limit by the half slope of the difference at the limit: E4), stops at 0 and at 10.
    return { rest, away, low, high, pass: Math.abs(rest - 25) < 1e-6 && moves && Math.abs(low - 15) < 1e-6 && Math.abs(high - 25) < 1e-6 };
  });  return { name: 'E4', steps, pass: steps.every((s) => s.pass) };
};
