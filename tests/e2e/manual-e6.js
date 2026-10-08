// Manual checklist E6 (docs/manual-verification.html): 「移動零組件」 with and without 「碰撞偵測（停在接觸前）」 (off at the start): a V-block over a fixed plate dragged down with the mouse goes
// through the plate; Ctrl+Z; with the box ticked it stops where it touches the surface (the part it hit red, 「碰到：…」 in the panel); unticked it goes through again; replayed the way a
// person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-e6.js?' + Date.now());   // in a freshly loaded page
//   await __manualE6.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualE6 = {});

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
const pose = (id) => H.asm().solution.poses.get(id);
const pm = () => document.querySelector('.property-manager');
const box = () => [...pm().querySelectorAll('.pm-row.checkbox, label')].find((l) => l.textContent.includes('碰撞偵測'))?.querySelector('input');

M.run = async () => {
  let plate;
  let block;
  await step('1 a new assembly: the plate (fixed) and the V-block put above it with a click (floating, no mate)', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    plate = await H.insert('定位板.3dbx');
    block = await H.insert('V型塊.3dbx', [0.5, 0.2]);
    await H.loaded();
    await H.solved();
    await H.hud('前視');
    await H.hud('全部顯示');
    return { fixed: plate.fixed, floating: !block.fixed, y: pose(block.id).position[1], pass: plate.fixed && !block.fixed };
  });
  await step('2 「移動零組件」: the panel has 碰撞偵測（停在接觸前）, not ticked', async () => {
    await H.action('組合件', '移動零組件');
    await H.wait(300);
    const c = box();
    return { found: !!c, checked: c?.checked, pass: !!c && c.checked === false };
  });
  await step('3 not ticked: the V-block dragged down goes through the plate; Ctrl+Z puts it back', async () => {
    const start = pose(block.id).position.slice();
    const plateTop = 15;
    const from = H.onComponent(block.id);
    const pxPerMm = Math.abs(H.worldToClient([0, 0, 0]).y - H.worldToClient([0, 10, 0]).y) / 10;
    await H.drag(H.line(from, { x: from.x, y: from.y + (start[1] - plateTop + 25) * pxPerMm }));
    const through = pose(block.id).position[1];
    // while the 「移動零組件」 panel is open Ctrl+Z does nothing (undo is for when no panel is open): the checklist (before 2026-10-08) said to press it at once. The panel is closed with ✔ first.
    await H.ctrl('z');
    const stillThere = Math.abs(pose(block.id).position[1] - through) < 1e-9;
    pm().querySelector('.pm-ok').click();
    await H.wait(300);
    await H.ctrl('z');
    await H.solved();
    await H.action('組合件', '移動零組件');
    await H.wait(300);
    return { start: start[1], through, stillThere, back: pose(block.id).position[1], pass: through < plateTop - 5 && stillThere && Math.abs(pose(block.id).position[1] - start[1]) < 1e-6 };
  });
  await step('4 ticked: dragged again, it stops where it touches the surface of the plate; the part it hit is red and the panel says 碰到', async () => {
    box().click();
    await H.wait(200);
    const start = pose(block.id).position.slice();
    const from = H.onComponent(block.id);
    const pxPerMm = Math.abs(H.worldToClient([0, 0, 0]).y - H.worldToClient([0, 10, 0]).y) / 10;
    // the drag by hand, to look at the panel and the view while the button is still down (what is red, and what the panel says, is for as long as it is dragged)
    const c = H.canvas();
    const ev = (type, p, extra) => c.dispatchEvent(new PointerEvent(type, { clientX: Math.round(p.x), clientY: Math.round(p.y), bubbles: true, pointerId: 1, ...extra }));
    const path = H.line(from, { x: from.x, y: from.y + (start[1] - 15 + 25) * pxPerMm });
    ev('pointermove', path[0], { buttons: 0 });
    ev('pointerdown', path[0], { button: 0, buttons: 1 });
    for (const p of path.slice(1)) {
      ev('pointermove', p, { buttons: 1 });
      await H.wait(60);
    }
    await H.wait(300);
    const during = pm()?.textContent ?? '';
    const hit = during.match(/碰到：[^。]*/)?.[0] ?? null;
    const reds = [...store.viewer.instances.values()].filter((i) => i.body.material.color?.getHex?.() === 0xe53935 || i.body.material.emissive?.getHex?.() !== 0).length;
    await window.__shot?.('4-while-dragged-at-contact');
    const end = path[path.length - 1];
    ev('pointerup', end, { button: 0, buttons: 0 });
    c.dispatchEvent(new MouseEvent('click', { clientX: Math.round(end.x), clientY: Math.round(end.y), bubbles: true }));
    await H.waitFor(() => !H.asm().drag, 5000, 'the drag to end');
    await H.solved();
    const stopped = pose(block.id).position[1];
    await window.__shot?.('4-stopped-at-contact');
    return { start: start[1], stopped, hit, reds, pass: Math.abs(stopped - 15) < 0.05 && !!hit && /定位板/.test(hit) };
  });
  await step('5 unticked again: it goes through once more', async () => {
    box().click();
    await H.wait(200);
    pm().querySelector('.pm-ok').click();
    await H.wait(300);
    await H.ctrl('z');
    await H.solved();
    await H.action('組合件', '移動零組件');
    await H.wait(300);
    if (box().checked) box().click();
    await H.wait(200);
    const start = pose(block.id).position.slice();
    const from = H.onComponent(block.id);
    const pxPerMm = Math.abs(H.worldToClient([0, 0, 0]).y - H.worldToClient([0, 10, 0]).y) / 10;
    await H.drag(H.line(from, { x: from.x, y: from.y + (start[1] - 15 + 25) * pxPerMm }));
    const through = pose(block.id).position[1];
    return { through, pass: through < 15 - 5 };
  });
  return { name: 'E6', steps, pass: steps.every((s) => s.pass) };
};
