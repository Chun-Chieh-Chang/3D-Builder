// Phase 4a-5 (E2.2, A3.6): clearance verification, room to take a component out, and a drag that stops before contact, in the browser. Run it in a freshly
// loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase4-clearance.js?' + Date.now());
//   await __clearance.run();
//
// The project folder is OPFS, as in phase2-assembly.js, whose helpers come with it. The golden plate (120 × 80 × 15, top at y = 15) is fixed at the origin and
// the V-block (60 × 40 × 50, its underside at its own y = 0) floats 5 mm above it.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const model = await import(`${root}packages/model/src/index.ts`);
const io = await import(`${root}packages/io/src/index.ts`);
const c = (window.__clearance = {});

const at = (position) => ({ position, rotation: [0, 0, 0, 1] });

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

const jig = (y) => {
  let doc = model.createEmptyAssembly();
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '定位板.3dbx' }, component: { id: 'plate', file: 'file1', instance: 1, fixed: true, placement: at([0, 0, 0]) } });
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: 'V型塊.3dbx' }, component: { id: 'v', file: 'file2', instance: 1, fixed: false, placement: at([0, y, 0]) } });
  return doc;
};
const pose = (id) => H.asm().solution.poses.get(id);
const field = (name) => document.querySelector(`[data-clearance] [data-field="${name}"]`);
const typeInto = async (input, text) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(100);
};
const choose = async (select, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await H.wait(100);
};

c.run = async () => {
  H.ready();
  const g = H.GOLDEN;
  await H.project({ '定位板.3dbx': `${g}locating-plate.3dbx`, 'V型塊.3dbx': `${g}v-block.3dbx` });
  await open(jig(20), 'a.3dba'); // 5 mm above the plate's top

  // ---------------------------------------------------------------- the clearance check: nothing is closer than 1 mm, one pair is closer than 10 mm
  await H.action('組合件', '餘隙確認');
  await H.waitFor(() => field('summary'), 20000, 'the first check');
  H.check(field('summary').textContent.includes('沒有'), `nothing is closer than 1 mm: ${field('summary').textContent}`);
  await typeInto(field('least'), '10');
  [...document.querySelectorAll('[data-clearance] button')].find((b) => b.textContent === '檢查').click();
  await H.waitFor(() => field('pairs'), 20000, 'the pairs');
  const rows = [...field('pairs').querySelectorAll('tbody tr')].map((r) => [...r.children].map((td) => td.textContent));
  H.check(rows.length === 1 && Math.abs(Number(rows[0][1]) - 5) < 1e-9, `one pair, 5 mm apart: ${JSON.stringify(rows)}`);
  // choosing the pair selects its two components
  field('pairs').querySelector('tbody tr').click();
  await H.wait(200);
  H.check(store.getState().clearance.selected === 0, 'the pair is chosen');
  await window.__shot?.('clearance-pair-chosen');

  // ---------------------------------------------------------------- room to take the V-block out
  store.assembly.select('v');
  await H.waitFor(() => H.asm().selected === 'v', 3000, 'the V-block selected');
  const sweep = async (dir, length) => {
    await choose(field('sweepDir'), dir);
    await typeInto(field('sweepLength'), String(length));
    [...document.querySelectorAll('[data-clearance] button')].find((b) => b.textContent === '算取放空間').click();
    await H.waitFor(() => field('sweepResult') && !field('sweepResult').textContent.includes('正在'), 20000, 'the sweep');
    return field('sweepResult').textContent;
  };
  H.check((await sweep('-y', 100)).includes('只能移動 5 mm'), 'down it can move 5 mm: it meets the plate');
  await window.__shot?.('clearance-room-to-take-out');
  H.check((await sweep('+y', 100)).includes('沒有阻礙'), 'up there is nothing in the way');
  H.check((await sweep('+x', 100)).includes('沒有阻礙'), 'sideways, above the plate, nothing in the way');
  [...document.querySelectorAll('[data-clearance] button')].find((b) => b.textContent === '關閉').click();
  await H.wait(200);

  // ---------------------------------------------------------------- a drag that stops before contact (A3.6)
  const drag = async (down) => {
    const grab = [0, 20, 0]; // the V-block's origin, as it stands
    H.check(store.assembly.startDrag('v', grab, 'left'), 'the drag begins');
    // the cursor's line goes through the grabbed point's x and z, `down` mm lower: the part follows it
    store.assembly.dragTo({ origin: [0, 20 - down, 500], dir: [0, 0, -1], dx: 0, dy: 0, right: [1, 0, 0], up: [0, 1, 0] });
    await H.waitFor(() => H.asm().drag?.poses?.get('v') && Math.abs(H.asm().drag.poses.get('v').position[1] - 20) > 1e-6, 10000, 'the dragged pose');
    await H.wait(1500);
    const shown = H.asm().drag?.poses?.get('v')?.position[1];
    const blocked = H.asm().drag?.blocked ?? null;
    store.assembly.endDrag(false);
    await H.wait(500);
    return { shown, blocked };
  };
  await H.action('組合件', '移動零組件');
  const free = await drag(10);
  H.check(Math.abs(free.shown - 10) < 1e-6 && !free.blocked, `without collision detection it goes into the plate: ${JSON.stringify(free)}`);
  store.assembly.closeMove();
  await H.wait(200);
  await open(jig(20), 'b.3dba');
  await H.action('組合件', '移動零組件');
  document.querySelector('[data-field="collisionStop"]').click();
  await H.waitFor(() => H.asm().collisionStop, 2000, 'the option');
  const stopped = await drag(10);
  H.check(stopped.shown >= 15 - 1e-9 && stopped.shown < 15.01, `it stops at the plate's top (y = 15): ${stopped.shown}`);
  H.check(stopped.blocked && stopped.blocked.names.length === 1 && stopped.blocked.tops.includes('plate'), `and says what it ran into: ${JSON.stringify(stopped.blocked)}`);
  console.log('phase4-clearance: all checks passed');
  return true;
};
